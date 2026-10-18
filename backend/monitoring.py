"""Live machine metrics and conservative anomaly detection."""

from collections import deque
from datetime import datetime, timezone
import os
import platform
import statistics
import threading

import psutil
from sklearn.ensemble import IsolationForest


_history = deque(maxlen=180)
_lock = threading.Lock()
_model = IsolationForest(contamination=0.12, random_state=42)


def _bytes_per_second(current, previous, elapsed):
    if previous is None or elapsed <= 0:
        return 0
    return max(0, round((current - previous) / elapsed, 1))


def collect_metrics():
    """Collect a fresh snapshot from this machine using psutil."""
    now = datetime.now(timezone.utc)
    cpu = psutil.cpu_percent(interval=0.15)
    memory = psutil.virtual_memory()
    disk_path = os.environ.get("EDGEGUARD_DISK_PATH") or (
        "C:\\" if platform.system() == "Windows" else "/"
    )
    try:
        disk = psutil.disk_usage(disk_path)
    except (OSError, ValueError):
        disk = psutil.disk_usage("/")

    net = psutil.net_io_counters()
    elapsed = 1
    previous = _history[-1] if _history else None
    if previous:
        elapsed = max(0.1, (now - previous["timestamp"]).total_seconds())
    net_rate = {
        "sent": _bytes_per_second(net.bytes_sent, previous["net_bytes_sent"] if previous else None, elapsed),
        "received": _bytes_per_second(net.bytes_recv, previous["net_bytes_recv"] if previous else None, elapsed),
    }
    processes = []
    for proc in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_percent", "status"]):
        try:
            item = proc.info
            processes.append({
                "pid": item["pid"],
                "name": item.get("name") or "Unknown process",
                "username": item.get("username"),
                "cpu": round(item.get("cpu_percent") or 0, 1),
                "memory": round(item.get("memory_percent") or 0, 2),
                "status": item.get("status") or "unknown",
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    processes.sort(key=lambda process: (process["cpu"], process["memory"]), reverse=True)
    snapshot = {
        "timestamp": now,
        "cpu": round(cpu, 1),
        "memory": round(memory.percent, 1),
        "memory_used": memory.used,
        "memory_total": memory.total,
        "disk": round(disk.percent, 1),
        "disk_used": disk.used,
        "disk_total": disk.total,
        "network": net_rate,
        "net_bytes_sent": net.bytes_sent,
        "net_bytes_recv": net.bytes_recv,
        "processes": processes[:20],
        "platform": platform.platform(),
        "uptime_seconds": max(0, int(now.timestamp() - psutil.boot_time())),
    }
    with _lock:
        _history.append(snapshot)
    return snapshot


def _public_snapshot(snapshot):
    return {key: value for key, value in snapshot.items() if not key.startswith("net_bytes_")}


def metrics_history(limit=60):
    with _lock:
        return [_public_snapshot(item) for item in list(_history)[-limit:]]


def detect_anomalies(snapshot):
    """Combine explicit thresholds, a fitted IsolationForest, and trend checks."""
    alerts = []
    levels = (("cpu", snapshot["cpu"], 90, "CPU usage is critically high"),
              ("memory", snapshot["memory"], 92, "Memory usage is critically high"),
              ("disk", snapshot["disk"], 95, "Disk space is nearly exhausted"))
    with _lock:
        samples = list(_history)
    for metric, value, threshold, message in levels:
        if value >= threshold:
            alerts.append({
                "metric": metric, "value": value, "severity": "critical",
                "title": message, "description": f"{metric.title()} is at {value:.1f}%.",
                "confidence": 0.98, "kind": "threshold",
            })

    if len(samples) >= 12:
        features = [[item["cpu"], item["memory"], item["disk"]] for item in samples]
        labels = _model.fit_predict(features)
        if labels[-1] == -1 and not any(alert["metric"] in {"cpu", "memory", "disk"} for alert in alerts):
            recent = features[-1]
            baseline = [statistics.median(row[index] for row in features[:-1]) for index in range(3)]
            index = max(range(3), key=lambda i: abs(recent[i] - baseline[i]))
            name = ("cpu", "memory", "disk")[index]
            alerts.append({
                "metric": name, "value": recent[index], "severity": "warning",
                "title": f"Unusual {name} activity detected",
                "description": f"{name.title()} differs from its recent baseline ({baseline[index]:.1f}%).",
                "confidence": 0.78, "kind": "isolation_forest",
            })

    if len(samples) >= 10:
        for metric in ("cpu", "memory"):
            recent = [item[metric] for item in samples[-10:]]
            if recent[-1] >= 65 and recent[-1] - recent[0] >= 25 and all(a <= b for a, b in zip(recent, recent[1:])):
                alerts.append({
                    "metric": metric, "value": recent[-1], "severity": "warning",
                    "title": f"Gradual {metric} pressure detected",
                    "description": f"{metric.title()} has risen steadily over the last 10 samples.",
                    "confidence": 0.83, "kind": "trend",
                })
    return alerts


def health_score(snapshot):
    return max(0, min(100, round(100 - (
        max(0, snapshot["cpu"] - 50) * 0.35
        + max(0, snapshot["memory"] - 55) * 0.4
        + max(0, snapshot["disk"] - 75) * 0.5
    ))))
