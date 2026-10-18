"""EdgeGuard AI Flask API."""

from datetime import datetime, timedelta, timezone
from functools import wraps
import hashlib
import hmac
import os
import re
import secrets
import smtplib
from pathlib import Path

import jwt
import psutil
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_mail import Mail, Message
from pymongo import MongoClient, DESCENDING
from pymongo.errors import PyMongoError
from bson import ObjectId
from werkzeug.security import check_password_hash, generate_password_hash

from monitoring import collect_metrics, detect_anomalies, health_score, metrics_history

load_dotenv(Path(__file__).with_name(".env"))
_EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("FLASK_SECRET_KEY", "dev-only-change-me"),
        JWT_SECRET_KEY=os.environ.get("JWT_SECRET_KEY", "dev-only-change-me-too"),
        JWT_EXPIRY_HOURS=12,
        MONGODB_URI=os.environ.get("MONGODB_URI", "mongodb://localhost:27017/"),
        MONGODB_DATABASE=os.environ.get("MONGODB_DATABASE", "edgeguard_ai"),
        FRONTEND_ORIGIN=os.environ.get("FRONTEND_ORIGIN", ""),
        PUBLIC_APP_URL=os.environ.get("PUBLIC_APP_URL", "http://localhost:5173"),
        DEBUG=os.environ.get("FLASK_DEBUG", "false").lower() == "true",
        MAIL_SERVER=os.environ.get("MAIL_SERVER"),
        MAIL_PORT=int(os.environ.get("MAIL_PORT", "587")),
        MAIL_USE_TLS=os.environ.get("MAIL_USE_TLS", "true").lower() == "true",
        MAIL_USERNAME=os.environ.get("MAIL_USERNAME"),
        MAIL_PASSWORD=os.environ.get("MAIL_PASSWORD"),
        MAIL_DEFAULT_SENDER=os.environ.get("MAIL_DEFAULT_SENDER"),
    )
    if test_config:
        app.config.update(test_config)
    configured_origins = app.config["FRONTEND_ORIGIN"]
    if isinstance(configured_origins, str):
        configured_origins = [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
    allowed_origins = list(dict.fromkeys([
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        *configured_origins,
    ]))
    CORS(
        app,
        resources={r"/api/*": {
            "origins": allowed_origins,
            "allow_headers": ["Authorization", "Content-Type"],
            "methods": ["GET", "POST", "PUT", "OPTIONS"],
        }},
        supports_credentials=False,
    )
    mail = Mail(app)

    client = app.config.get("MONGO_CLIENT") or MongoClient(
        app.config["MONGODB_URI"], serverSelectionTimeoutMS=2500
    )
    db = app.config.get("MONGO_DB") or client[app.config["MONGODB_DATABASE"]]
    app.extensions["edgeguard_db"] = db
    app.extensions["edgeguard_mongo_client"] = client

    def payload():
        data = request.get_json(silent=True)
        return data if isinstance(data, dict) else {}

    def db_ready():
        try:
            client.admin.command("ping")
            return True
        except PyMongoError:
            return False

    def serialize(doc):
        if not doc:
            return doc
        result = dict(doc)
        identifier = result.pop("_id", None)
        if identifier is not None:
            result["id"] = str(identifier)
        for key, value in result.items():
            if isinstance(value, datetime):
                result[key] = value.isoformat()
        return result

    def token_for(user):
        now = datetime.now(timezone.utc)
        token = jwt.encode({
            "sub": str(user["_id"]), "email": user["email"],
            "jti": secrets.token_urlsafe(24),
            "iat": now, "exp": now + timedelta(hours=app.config["JWT_EXPIRY_HOURS"]),
        }, app.config["JWT_SECRET_KEY"], algorithm="HS256")
        return token

    def authenticated(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            authorization = request.headers.get("Authorization", "")
            token = authorization.removeprefix("Bearer ").strip()
            if not token:
                return jsonify(error="Sign in to continue."), 401
            try:
                claims = jwt.decode(token, app.config["JWT_SECRET_KEY"], algorithms=["HS256"])
            except jwt.ExpiredSignatureError:
                return jsonify(error="Your session expired. Please sign in again."), 401
            except jwt.InvalidTokenError:
                return jsonify(error="Invalid authentication token."), 401
            try:
                user_id = ObjectId(claims["sub"])
            except (KeyError, TypeError, ValueError):
                return jsonify(error="Invalid authentication token."), 401
            g.token_id = claims.get("jti") or hashlib.sha256(token.encode("utf-8")).hexdigest()
            if db.revoked_tokens.find_one({"token_id": g.token_id}):
                return jsonify(error="This session has been signed out."), 401
            user = db.users.find_one({"_id": user_id})
            if not user:
                return jsonify(error="Account not found."), 401
            g.user = user
            g.token_expiry = datetime.fromtimestamp(claims["exp"], tz=timezone.utc)
            return fn(*args, **kwargs)
        return wrapped

    def log_incident(alert, snapshot):
        if not db_ready():
            return
        fingerprint = f'{alert["kind"]}:{alert["metric"]}:{alert["severity"]}'
        previous = db.incidents.find_one({
            "user_id": str(g.user["_id"]), "fingerprint": fingerprint,
            "resolved": False, "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(minutes=20)},
        })
        if previous:
            db.incidents.update_one({"_id": previous["_id"]}, {"$set": {"latest_value": alert["value"], "updated_at": datetime.now(timezone.utc)}})
            return
        db.incidents.insert_one({
            "user_id": str(g.user["_id"]), "fingerprint": fingerprint,
            "title": alert["title"], "metric": alert["metric"], "severity": alert["severity"],
            "description": alert["description"], "confidence": alert["confidence"],
            "value": alert["value"], "resolved": False, "created_at": datetime.now(timezone.utc),
        })
        if g.user.get("notifications", {}).get("email"):
            if not app.config["MAIL_SERVER"] or not app.config["MAIL_DEFAULT_SENDER"]:
                app.logger.error("Email alert preference is enabled but SMTP is not configured.")
            else:
                try:
                    mail.send(Message(f'EdgeGuard alert: {alert["title"]}', recipients=[g.user["email"]],
                                      body=f'{alert["description"]}\n\nSeverity: {alert["severity"]}\nConfidence: {alert["confidence"]:.0%}'))
                except (OSError, TimeoutError, smtplib.SMTPException) as exc:
                    app.logger.error("Could not deliver anomaly notification email: %s", exc)

    @app.get("/api/health")
    def health():
        connected = db_ready()
        return jsonify(status="ok" if connected else "degraded", database="connected" if connected else "disconnected"), (200 if connected else 503)

    @app.post("/api/auth/signup")
    def signup():
        data = payload()
        if not isinstance(data.get("name"), str) or not isinstance(data.get("email"), str) or not isinstance(data.get("password"), str):
            return jsonify(error="Name, email, and password are required."), 400
        name, email, password = (data[key].strip() for key in ("name", "email", "password"))
        if not name or len(name) > 80:
            return jsonify(error="Enter a name between 1 and 80 characters."), 400
        if not _EMAIL_PATTERN.fullmatch(email) or len(email) > 254:
            return jsonify(error="Enter a valid email address."), 400
        if len(password) < 10 or len(password) > 1024:
            return jsonify(error="Password must be between 10 and 1024 characters long."), 400
        if db.users.find_one({"email": email.lower()}):
            return jsonify(error="An account with this email already exists."), 409
        user = {"name": name, "email": email.lower(), "password_hash": generate_password_hash(password), "theme": "dark",
                "monitoring": True, "notifications": {"email": False, "in_app": True}, "created_at": datetime.now(timezone.utc)}
        inserted = db.users.insert_one(user)
        user["_id"] = inserted.inserted_id
        return jsonify(token=token_for(user), user={"name": name, "email": email.lower(), "theme": "dark", "monitoring": True}), 201

    @app.post("/api/auth/login")
    def login():
        data = payload()
        if not isinstance(data.get("email"), str) or not isinstance(data.get("password"), str):
            return jsonify(error="Enter your email and password."), 400
        email, password = data["email"].strip().lower(), data["password"]
        user = db.users.find_one({"email": email})
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify(error="Email or password is incorrect."), 401
        return jsonify(token=token_for(user), user={
            "name": user["name"], "email": user["email"], "theme": user.get("theme", "dark"),
            "monitoring": user.get("monitoring", True), "notifications": user.get("notifications", {}),
        })

    @app.post("/api/auth/forgot-password")
    def forgot_password():
        email_value = payload().get("email", "")
        if not isinstance(email_value, str) or "@" not in email_value or len(email_value) > 254:
            return jsonify(error="Enter a valid email address."), 400
        email = email_value.strip().lower()
        if not (app.config["MAIL_SERVER"] and app.config["MAIL_DEFAULT_SENDER"]) and not app.config["DEBUG"]:
            app.logger.error("Password reset requested but SMTP is not configured.")
            return jsonify(error="Password reset email is unavailable. Contact the administrator."), 503
        user = db.users.find_one({"email": email})
        response = {"message": "If an account exists for that email, reset instructions have been sent."}
        if not user:
            return jsonify(response)
        selector = secrets.token_urlsafe(12)
        validator = secrets.token_urlsafe(32)
        token = f"{selector}.{validator}"
        db.password_resets.update_one({"user_id": str(user["_id"])}, {"$set": {
            "selector": selector,
            "token_hash": hashlib.sha256(validator.encode("utf-8")).hexdigest(),
            "token_hash_scheme": "sha256",
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=30),
        }}, upsert=True)
        link = f'{app.config["PUBLIC_APP_URL"].rstrip("/")}/reset-password?token={token}'
        if app.config["MAIL_SERVER"] and app.config["MAIL_DEFAULT_SENDER"]:
            mail.send(Message("Reset your EdgeGuard AI password", recipients=[email],
                              body=f"Use this link within 30 minutes to set a new password:\n\n{link}"))
        elif app.config["DEBUG"]:
            response["development_reset_link"] = link
        return jsonify(response)

    @app.post("/api/auth/reset-password")
    def reset_password():
        data = payload()
        token, password = data.get("token", ""), data.get("password", "")
        if not isinstance(token, str) or not isinstance(password, str):
            return jsonify(error="A reset token and new password are required."), 400
        if len(password) < 10 or len(password) > 1024:
            return jsonify(error="Password must be between 10 and 1024 characters long."), 400
        now = datetime.now(timezone.utc)
        record = None
        if "." in token:
            selector, validator = token.split(".", 1)
            candidate = db.password_resets.find_one({
                "selector": selector, "expires_at": {"$gt": now},
                "token_hash_scheme": "sha256",
            })
            if candidate and hmac.compare_digest(
                candidate["token_hash"], hashlib.sha256(validator.encode("utf-8")).hexdigest()
            ):
                record = candidate
        else:
            # Accept a still-valid link created before selector-based reset tokens.
            for candidate in db.password_resets.find({"expires_at": {"$gt": now}}):
                if not candidate.get("token_hash_scheme") and check_password_hash(candidate["token_hash"], token):
                    record = candidate
                    break
        if not record:
            return jsonify(error="This reset link is invalid or has expired."), 400
        db.users.update_one({"_id": ObjectId(record["user_id"])}, {"$set": {"password_hash": generate_password_hash(password)}})
        db.password_resets.delete_one({"_id": record["_id"]})
        return jsonify(message="Password updated. You can now sign in.")

    @app.get("/api/auth/me")
    @authenticated
    def me():
        user = g.user
        return jsonify(user={"name": user["name"], "email": user["email"], "theme": user.get("theme", "dark"),
                             "monitoring": user.get("monitoring", True), "notifications": user.get("notifications", {})})

    @app.post("/api/auth/logout")
    @authenticated
    def logout():
        db.revoked_tokens.create_index("expires_at", expireAfterSeconds=0)
        db.revoked_tokens.update_one(
            {"token_id": g.token_id},
            {"$set": {"user_id": str(g.user["_id"]), "expires_at": g.token_expiry}},
            upsert=True,
        )
        return jsonify(message="Signed out successfully.")

    @app.get("/api/monitoring/snapshot")
    @authenticated
    def snapshot():
        if not g.user.get("monitoring", True):
            return jsonify(error="Monitoring is paused. Enable it in Settings to resume live data."), 423
        metrics = collect_metrics()
        alerts = detect_anomalies(metrics)
        for alert in alerts:
            log_incident(alert, metrics)
        metrics["health"] = health_score(metrics)
        metrics["alerts"] = alerts
        db.health_history.insert_one({"user_id": str(g.user["_id"]), "health": metrics["health"], "metrics": {
            key: metrics[key] for key in ("cpu", "memory", "disk")
        }, "created_at": metrics["timestamp"]})
        return jsonify(metrics=serialize(metrics))

    @app.get("/api/monitoring/history")
    @authenticated
    def history_metrics():
        limit = min(180, max(1, request.args.get("limit", default=60, type=int)))
        snapshots = metrics_history(limit)
        for item in snapshots:
            item["health"] = health_score(item)
        return jsonify(metrics=[serialize(item) for item in snapshots])

    @app.get("/api/anomalies")
    @authenticated
    def anomalies():
        query = {"user_id": str(g.user["_id"])}
        status = request.args.get("status")
        if status == "open":
            query["resolved"] = False
        elif status == "resolved":
            query["resolved"] = True
        results = [serialize(item) for item in db.incidents.find(query).sort("created_at", DESCENDING).limit(100)]
        return jsonify(anomalies=results)

    @app.post("/api/anomalies/<incident_id>/resolve")
    @authenticated
    def resolve_anomaly(incident_id):
        if not ObjectId.is_valid(incident_id):
            return jsonify(error="Invalid incident identifier."), 400
        result = db.incidents.update_one({"_id": ObjectId(incident_id), "user_id": str(g.user["_id"])},
                                         {"$set": {"resolved": True, "resolved_at": datetime.now(timezone.utc)}})
        if not result.matched_count:
            return jsonify(error="Incident not found."), 404
        return jsonify(message="Incident marked as resolved.")

    @app.get("/api/diagnosis")
    @authenticated
    def diagnosis():
        metrics = collect_metrics()
        processes = metrics["processes"]
        cpu_process = next((process for process in processes if process["cpu"] >= 10), None)
        memory_process = next((process for process in processes if process["memory"] >= 5), None)
        findings = []
        if metrics["cpu"] >= 75:
            findings.append({"title": "High processor load", "metric": "cpu", "severity": "high" if metrics["cpu"] >= 90 else "medium",
                             "confidence": 0.91, "cause": f'Processor usage is {metrics["cpu"]:.1f}%. ' +
                             (f'{cpu_process["name"]} is currently the busiest visible process.' if cpu_process else "No single process dominates the visible process list."),
                             "process": cpu_process})
        if metrics["memory"] >= 80:
            findings.append({"title": "Memory pressure", "metric": "memory", "severity": "high" if metrics["memory"] >= 92 else "medium",
                             "confidence": 0.88, "cause": f'{metrics["memory"]:.1f}% of available memory is in use. ' +
                             (f'{memory_process["name"]} has the largest visible memory footprint.' if memory_process else "Review open applications and background tasks."),
                             "process": memory_process})
        if metrics["disk"] >= 85:
            findings.append({"title": "Low disk headroom", "metric": "disk", "severity": "high" if metrics["disk"] >= 95 else "medium",
                             "confidence": 0.94, "cause": f'{metrics["disk"]:.1f}% of the monitored system volume is used. Review large files and application caches.'})
        if not findings:
            findings.append({"title": "No active resource pressure", "severity": "low", "confidence": 0.75,
                             "cause": "Current CPU, memory, and disk readings are within the configured diagnostic thresholds."})
        recent_logs = list(db.incidents.find({
            "user_id": str(g.user["_id"]),
            "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(hours=24)},
        }).sort("created_at", DESCENDING).limit(5))
        for finding in findings:
            matching = [item for item in recent_logs if item.get("metric") == finding.get("metric")]
            if matching:
                finding["cause"] += f' Recent monitoring logs recorded {len(matching)} related alert(s) in the last 24 hours.'
                finding["confidence"] = min(0.99, finding["confidence"] + 0.04)
        recommended = []
        for process in (cpu_process, memory_process):
            if process and process["pid"] not in [item["pid"] for item in recommended]:
                recommended.append({"pid": process["pid"], "name": process["name"], "action": "lower_process_priority",
                                    "label": f'Lower {process["name"]} priority', "reason": "Reduce its scheduling priority without stopping the process."})
        for item in recommended:
            db.recommendations.update_one(
                {"user_id": str(g.user["_id"]), "pid": item["pid"], "action": item["action"], "status": "pending"},
                {"$set": {**item, "created_at": datetime.now(timezone.utc)}},
                upsert=True,
            )
        return jsonify(diagnosis={"metrics": {key: metrics[key] for key in ("cpu", "memory", "disk")},
                                  "findings": findings, "recommendations": recommended,
                                  "processes": processes[:10], "recent_logs": [{
                                      "title": item["title"], "metric": item["metric"], "severity": item["severity"],
                                      "created_at": item["created_at"].isoformat(),
                                  } for item in recent_logs],
                                  "generated_at": metrics["timestamp"].isoformat()})

    @app.get("/api/recovery")
    @authenticated
    def recovery_history():
        results = [serialize(item) for item in db.recoveries.find({"user_id": str(g.user["_id"])}).sort("created_at", DESCENDING).limit(100)]
        return jsonify(recoveries=results)

    @app.get("/api/history")
    @authenticated
    def full_history():
        user_id = str(g.user["_id"])
        health = [serialize(item) for item in db.health_history.find({"user_id": user_id}).sort("created_at", DESCENDING).limit(90)]
        recommendations = [serialize(item) for item in db.recommendations.find({"user_id": user_id}).sort("created_at", DESCENDING).limit(100)]
        incidents = [serialize(item) for item in db.incidents.find({"user_id": user_id}).sort("created_at", DESCENDING).limit(100)]
        recoveries = [serialize(item) for item in db.recoveries.find({"user_id": user_id}).sort("created_at", DESCENDING).limit(100)]
        return jsonify(health=health, recommendations=recommendations, incidents=incidents, recoveries=recoveries)

    @app.post("/api/recovery/execute")
    @authenticated
    def execute_recovery():
        data = payload()
        if data.get("approved") is not True:
            return jsonify(error="Explicit approval is required before a corrective action can run."), 400
        if data.get("action") != "lower_process_priority":
            return jsonify(error="This corrective action is not allowlisted."), 400
        pid = data.get("pid")
        if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0 or pid == os.getpid():
            return jsonify(error="Select a valid non-system process."), 400
        record = {"user_id": str(g.user["_id"]), "action": data["action"], "pid": pid,
                  "process_name": str(data.get("process_name", "Unknown process"))[:120],
                  "status": "failed", "created_at": datetime.now(timezone.utc)}
        try:
            process = psutil.Process(pid)
            record["process_name"] = process.name()
            before = {"priority": process.nice(), "cpu": round(psutil.cpu_percent(interval=0.2), 1),
                      "memory": round(psutil.virtual_memory().percent, 1)}
            if process.username() != psutil.Process().username():
                return jsonify(error="For safety, only processes owned by your current user can be adjusted."), 403
            if os.name == "nt":
                process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
            else:
                process.nice(min(19, int(before["priority"]) + 1))
            after = {"priority": process.nice(), "cpu": round(psutil.cpu_percent(interval=0.2), 1),
                     "memory": round(psutil.virtual_memory().percent, 1)}
            record.update({"status": "verified" if after["priority"] != before["priority"] else "not_verified",
                           "before": before, "after": after,
                           "message": "Priority was lowered and the updated setting was verified." if after["priority"] != before["priority"] else "The priority did not change."})
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, OSError) as exc:
            record["message"] = f"Action failed: {type(exc).__name__}."
        inserted = db.recoveries.insert_one(record)
        record["_id"] = inserted.inserted_id
        if record["status"] == "verified":
            db.recommendations.update_one(
                {"user_id": str(g.user["_id"]), "pid": pid, "action": data["action"], "status": "pending"},
                {"$set": {"status": "completed", "completed_at": datetime.now(timezone.utc),
                          "recovery_id": str(inserted.inserted_id)}},
            )
        return jsonify(recovery=serialize(record)), (200 if record["status"] == "verified" else 409)

    @app.get("/api/settings")
    @authenticated
    def get_settings():
        user = g.user
        return jsonify(settings={"name": user["name"], "email": user["email"], "theme": user.get("theme", "dark"),
                                 "monitoring": user.get("monitoring", True),
                                 "notifications": user.get("notifications", {"email": False, "in_app": True}),
                                 "email_notifications_available": bool(app.config["MAIL_SERVER"] and app.config["MAIL_DEFAULT_SENDER"])})

    @app.put("/api/settings")
    @authenticated
    def update_settings():
        data = payload()
        updates = {}
        if "name" in data:
            if not isinstance(data["name"], str):
                return jsonify(error="Name must be text."), 400
            name = data["name"].strip()
            if not name or len(name) > 80:
                return jsonify(error="Name must be between 1 and 80 characters."), 400
            updates["name"] = name
        if "theme" in data:
            if data["theme"] not in ("dark", "light"):
                return jsonify(error="Theme must be dark or light."), 400
            updates["theme"] = data["theme"]
        if "monitoring" in data:
            if not isinstance(data["monitoring"], bool):
                return jsonify(error="Monitoring must be enabled or disabled."), 400
            updates["monitoring"] = data["monitoring"]
        if "notifications" in data:
            prefs = data["notifications"]
            if not isinstance(prefs, dict) or any(key not in ("email", "in_app") or not isinstance(value, bool) for key, value in prefs.items()):
                return jsonify(error="Invalid notification preferences."), 400
            if prefs.get("email") is True and not (app.config["MAIL_SERVER"] and app.config["MAIL_DEFAULT_SENDER"]):
                return jsonify(error="Email notifications require SMTP configuration by the administrator."), 503
            updates["notifications"] = {**g.user.get("notifications", {}), **prefs}
        if updates:
            db.users.update_one({"_id": g.user["_id"]}, {"$set": updates})
        return jsonify(message="Settings saved.", settings={**{
            "name": g.user["name"], "email": g.user["email"], "theme": g.user.get("theme", "dark"),
            "monitoring": g.user.get("monitoring", True), "notifications": g.user.get("notifications", {}),
            "email_notifications_available": bool(app.config["MAIL_SERVER"] and app.config["MAIL_DEFAULT_SENDER"]),
        }, **updates})

    @app.errorhandler(PyMongoError)
    def database_error(error):
        app.logger.exception("Database operation failed: %s", error)
        return jsonify(error="The database is unavailable. Check the MongoDB connection and try again."), 503

    @app.errorhandler(500)
    def internal_error(error):
        app.logger.exception("Unhandled API error: %s", error)
        return jsonify(error="An unexpected server error occurred."), 500

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=app.config["DEBUG"])
