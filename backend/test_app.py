"""Focused API tests with a small in-memory MongoDB stand-in."""

from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from bson import ObjectId
import psutil
from werkzeug.security import check_password_hash

from app import create_app


class Cursor:
    def __init__(self, documents):
        self.documents = list(documents)

    def sort(self, field, direction):
        self.documents.sort(key=lambda item: item.get(field, datetime.min.replace(tzinfo=timezone.utc)),
                            reverse=direction == -1)
        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    def __iter__(self):
        return iter(self.documents)


class Collection:
    def __init__(self):
        self.documents = []

    @staticmethod
    def matches(document, query):
        for key, expected in query.items():
            actual = document.get(key)
            if isinstance(expected, dict):
                if "$gt" in expected and not (actual and actual > expected["$gt"]):
                    return False
                if "$gte" in expected and not (actual and actual >= expected["$gte"]):
                    return False
            elif actual != expected:
                return False
        return True

    def find_one(self, query):
        return next((item for item in self.documents if self.matches(item, query)), None)

    def insert_one(self, document):
        saved = dict(document)
        saved["_id"] = saved.get("_id", ObjectId())
        self.documents.append(saved)
        return type("InsertResult", (), {"inserted_id": saved["_id"]})()

    def update_one(self, query, update, upsert=False):
        document = self.find_one(query)
        if document is None and upsert:
            document = {key: value for key, value in query.items() if not isinstance(value, dict)}
            document["_id"] = ObjectId()
            document.update(update.get("$setOnInsert", {}))
            self.documents.append(document)
        if document is not None:
            document.update(update.get("$set", {}))
        return type("UpdateResult", (), {"matched_count": int(document is not None)})()

    def delete_one(self, query):
        document = self.find_one(query)
        if document:
            self.documents.remove(document)

    def create_index(self, *_args, **_kwargs):
        return "test-index"

    def find(self, query):
        return Cursor(item for item in self.documents if self.matches(item, query))


class Database:
    def __init__(self):
        self.collections = {}

    def __getattr__(self, name):
        return self.collections.setdefault(name, Collection())


class MongoClient:
    class Admin:
        @staticmethod
        def command(_):
            return {"ok": 1}

    admin = Admin()


class FakeProcess:
    def __init__(self, _pid=None):
        self.priority = 0

    def name(self):
        return "edgeguard-test-process"

    def username(self):
        return "test-user"

    def nice(self, value=None):
        if value is not None:
            self.priority = value
        return self.priority


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.app = create_app({
            "TESTING": True,
            "DEBUG": True,
            "JWT_SECRET_KEY": "test-jwt-secret",
            "FLASK_SECRET_KEY": "test-flask-secret",
            "MONGO_CLIENT": MongoClient(),
            "MONGO_DB": self.db,
            "FRONTEND_ORIGIN": "http://localhost:5173",
        })
        self.client = self.app.test_client()

    def sign_up(self):
        return self.client.post("/api/auth/signup", json={
            "name": "Test User", "email": "test@example.com", "password": "a-very-long-password",
        })

    def test_signup_login_and_authenticated_settings(self):
        created = self.sign_up()
        self.assertEqual(created.status_code, 201)
        user_record = self.db.users.find_one({"email": "test@example.com"})
        self.assertTrue(check_password_hash(user_record["password_hash"], "a-very-long-password"))

        login = self.client.post("/api/auth/login", json={
            "email": "test@example.com", "password": "a-very-long-password",
        })
        self.assertEqual(login.status_code, 200)
        headers = {"Authorization": f'Bearer {login.json["token"]}'}
        settings = self.client.put("/api/settings", headers=headers, json={
            "name": "Updated User", "theme": "light", "monitoring": False,
        })
        self.assertEqual(settings.status_code, 200)
        self.assertEqual(settings.json["settings"]["theme"], "light")
        self.assertFalse(settings.json["settings"]["monitoring"])
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).json["user"]["name"], "Updated User")
        unavailable_email = self.client.put("/api/settings", headers=headers, json={
            "notifications": {"email": True},
        })
        self.assertEqual(unavailable_email.status_code, 503)

    def test_cors_allows_both_vite_origins_and_authorization_preflight(self):
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            response = self.client.options(
                "/api/auth/login",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), origin)
            self.assertIn("authorization", response.headers.get("Access-Control-Allow-Headers", "").lower())

    def test_logout_revokes_the_authenticated_token(self):
        created = self.sign_up()
        headers = {"Authorization": f'Bearer {created.json["token"]}'}
        signed_out = self.client.post("/api/auth/logout", headers=headers)
        self.assertEqual(signed_out.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).status_code, 401)
        self.assertEqual(len(self.db.revoked_tokens.documents), 1)

    def test_api_routes_cover_frontend_auth_monitoring_anomalies_diagnosis_recovery_and_history(self):
        expected = {
            ("POST", "/api/auth/signup"),
            ("POST", "/api/auth/login"),
            ("POST", "/api/auth/forgot-password"),
            ("POST", "/api/auth/reset-password"),
            ("POST", "/api/auth/logout"),
            ("GET", "/api/auth/me"),
            ("GET", "/api/monitoring/snapshot"),
            ("GET", "/api/monitoring/history"),
            ("GET", "/api/anomalies"),
            ("POST", "/api/anomalies/<incident_id>/resolve"),
            ("GET", "/api/diagnosis"),
            ("POST", "/api/recovery/execute"),
            ("GET", "/api/recovery"),
            ("GET", "/api/history"),
            ("GET", "/api/settings"),
            ("PUT", "/api/settings"),
        }
        actual = {
            (method, rule.rule)
            for rule in self.app.url_map.iter_rules()
            for method in rule.methods - {"HEAD", "OPTIONS"}
            if rule.rule.startswith("/api/")
        }
        self.assertTrue(expected.issubset(actual), expected - actual)

    def test_password_reset_is_one_time_and_expires(self):
        self.sign_up()
        response = self.client.post("/api/auth/forgot-password", json={"email": "test@example.com"})
        self.assertEqual(response.status_code, 200)
        link = response.json["development_reset_link"]
        token = link.split("token=", 1)[1]
        changed = self.client.post("/api/auth/reset-password", json={
            "token": token, "password": "another-long-password",
        })
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(self.client.post("/api/auth/reset-password", json={
            "token": token, "password": "yet-another-password",
        }).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/login", json={
            "email": "test@example.com", "password": "another-long-password",
        }).status_code, 200)

    def test_password_reset_links_work_for_multiple_accounts(self):
        for name, email in (("First", "first@example.com"), ("Second", "second@example.com")):
            response = self.client.post("/api/auth/signup", json={
                "name": name, "email": email, "password": "a-very-long-password",
            })
            self.assertEqual(response.status_code, 201)

        reset_links = []
        for email in ("first@example.com", "second@example.com"):
            response = self.client.post("/api/auth/forgot-password", json={"email": email})
            self.assertEqual(response.status_code, 200)
            reset_links.append(response.json["development_reset_link"])

        for email, link in zip(("second@example.com", "first@example.com"), reversed(reset_links)):
            response = self.client.post("/api/auth/reset-password", json={
                "token": link.split("token=", 1)[1], "password": "a-different-long-password",
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self.client.post("/api/auth/login", json={
                "email": email, "password": "a-different-long-password",
            }).status_code, 200)

    def test_recovery_requires_explicit_approval_and_allowlisted_action(self):
        created = self.sign_up()
        headers = {"Authorization": f'Bearer {created.json["token"]}'}
        missing_approval = self.client.post("/api/recovery/execute", headers=headers, json={
            "action": "lower_process_priority", "pid": 1234, "approved": False,
        })
        self.assertEqual(missing_approval.status_code, 400)
        not_allowlisted = self.client.post("/api/recovery/execute", headers=headers, json={
            "action": "run_shell_command", "pid": 1234, "approved": True,
        })
        self.assertEqual(not_allowlisted.status_code, 400)
        self.assertEqual(len(self.db.recoveries.documents), 0)

    def test_approved_recovery_records_verified_before_and_after_metrics(self):
        created = self.sign_up()
        headers = {"Authorization": f'Bearer {created.json["token"]}'}
        with patch("app.psutil.Process", side_effect=lambda *args: FakeProcess(*args)):
            response = self.client.post("/api/recovery/execute", headers=headers, json={
                "action": "lower_process_priority", "pid": 12345, "approved": True,
            })
        self.assertEqual(response.status_code, 200)
        recovery = response.json["recovery"]
        self.assertEqual(recovery["status"], "verified")
        self.assertNotEqual(recovery["before"]["priority"], recovery["after"]["priority"])
        self.assertTrue({"cpu", "memory"}.issubset(recovery["before"]))
        self.assertTrue({"cpu", "memory"}.issubset(recovery["after"]))

    def test_monitoring_and_diagnosis_return_live_host_data(self):
        created = self.sign_up()
        headers = {"Authorization": f'Bearer {created.json["token"]}'}
        snapshot = self.client.get("/api/monitoring/snapshot", headers=headers)
        self.assertEqual(snapshot.status_code, 200)
        self.assertTrue({"cpu", "memory", "disk", "network", "processes", "health"}.issubset(snapshot.json["metrics"]))
        self.assertGreaterEqual(snapshot.json["metrics"]["health"], 0)
        self.assertLessEqual(snapshot.json["metrics"]["health"], 100)

        diagnosis = self.client.get("/api/diagnosis", headers=headers)
        self.assertEqual(diagnosis.status_code, 200)
        self.assertTrue(diagnosis.json["diagnosis"]["findings"])
        self.assertIn("recent_logs", diagnosis.json["diagnosis"])
        self.assertTrue(self.db.health_history.documents)

    def test_alert_ids_are_returned_and_resolvable(self):
        created = self.sign_up()
        headers = {"Authorization": f'Bearer {created.json["token"]}'}
        metrics = {
            "timestamp": datetime.now(timezone.utc),
            "cpu": 95.0, "memory": 35.0, "disk": 40.0,
            "memory_used": 100, "memory_total": 200,
            "disk_used": 100, "disk_total": 200,
            "network": {"sent": 0, "received": 0},
            "processes": [], "platform": "Test",
        }
        with patch("app.collect_metrics", return_value=metrics), patch(
            "app.detect_anomalies",
            return_value=[{
                "metric": "cpu", "value": 95.0, "severity": "critical",
                "title": "CPU usage is critically high",
                "description": "CPU is at 95.0%.", "confidence": 0.98, "kind": "threshold",
            }],
        ):
            snapshot = self.client.get("/api/monitoring/snapshot", headers=headers)
        self.assertEqual(snapshot.status_code, 200)
        alert_response = self.client.get("/api/anomalies?status=open", headers=headers)
        self.assertEqual(alert_response.status_code, 200)
        alert = alert_response.json["anomalies"][0]
        self.assertTrue(alert["id"])
        resolved = self.client.post(f'/api/anomalies/{alert["id"]}/resolve', headers=headers)
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(self.client.get("/api/anomalies?status=resolved", headers=headers).json["anomalies"][0]["id"], alert["id"])

    def test_complete_registration_monitoring_alert_diagnosis_recovery_history_logout_flow(self):
        registration = self.sign_up()
        self.assertEqual(registration.status_code, 201)
        login = self.client.post("/api/auth/login", json={
            "email": "test@example.com", "password": "a-very-long-password",
        })
        self.assertEqual(login.status_code, 200)
        headers = {"Authorization": f'Bearer {login.json["token"]}'}
        process = {
            "pid": 23456, "name": "high-load-app", "cpu": 25.0,
            "memory": 1.0, "username": "test-user", "status": "running",
        }
        metrics = {
            "timestamp": datetime.now(timezone.utc),
            "cpu": 95.0, "memory": 35.0, "disk": 40.0,
            "memory_used": 100, "memory_total": 200,
            "disk_used": 100, "disk_total": 200,
            "network": {"sent": 2, "received": 4},
            "processes": [process], "platform": "Test",
            "uptime_seconds": 100,
        }
        alert = {
            "metric": "cpu", "value": 95.0, "severity": "critical",
            "title": "CPU usage is critically high",
            "description": "CPU is at 95.0%.", "confidence": 0.98, "kind": "threshold",
        }
        fake_process = FakeProcess()

        with patch("app.collect_metrics", return_value=metrics), patch(
            "app.detect_anomalies", return_value=[alert]
        ), patch("app.psutil.Process", return_value=fake_process):
            snapshot = self.client.get("/api/monitoring/snapshot", headers=headers)
            self.assertEqual(snapshot.status_code, 200)
            self.assertEqual(snapshot.json["metrics"]["cpu"], 95.0)

            anomalies = self.client.get("/api/anomalies?status=open", headers=headers)
            self.assertEqual(anomalies.status_code, 200)
            self.assertEqual(len(anomalies.json["anomalies"]), 1)
            alert_id = anomalies.json["anomalies"][0]["id"]

            diagnosis = self.client.get("/api/diagnosis", headers=headers)
            self.assertEqual(diagnosis.status_code, 200)
            recommendation = diagnosis.json["diagnosis"]["recommendations"][0]
            self.assertEqual(recommendation["pid"], process["pid"])

            recovery = self.client.post("/api/recovery/execute", headers=headers, json={
                "action": recommendation["action"], "pid": recommendation["pid"],
                "approved": True,
            })
            self.assertEqual(recovery.status_code, 200)
            self.assertEqual(recovery.json["recovery"]["status"], "verified")
            self.assertTrue(recovery.json["recovery"]["before"])
            self.assertTrue(recovery.json["recovery"]["after"])

            resolved = self.client.post(f"/api/anomalies/{alert_id}/resolve", headers=headers)
            self.assertEqual(resolved.status_code, 200)
            recovery_records = self.client.get("/api/recovery", headers=headers)
            self.assertEqual(len(recovery_records.json["recoveries"]), 1)
            history = self.client.get("/api/history", headers=headers)
            self.assertTrue(history.json["health"])
            self.assertTrue(history.json["incidents"])
            self.assertTrue(history.json["recoveries"])

        logout = self.client.post("/api/auth/logout", headers=headers)
        self.assertEqual(logout.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).status_code, 401)

    def test_signup_validates_input_and_protected_routes_require_auth(self):
        self.assertEqual(self.client.post("/api/auth/signup", json=[]).status_code, 400)
        self.assertEqual(self.client.post("/api/auth/signup", json={
            "name": "User", "email": "user@example.com", "password": "short",
        }).status_code, 400)
        self.assertEqual(self.client.get("/api/settings").status_code, 401)


if __name__ == "__main__":
    unittest.main()
