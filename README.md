# EdgeGuard AI

EdgeGuard AI is a local-first computer monitoring and troubleshooting application. Its existing React + Vite frontend is in `frontend/`, and its Flask API and `psutil`/Scikit-learn monitoring backend are in `backend/`. MongoDB stores accounts and incident, recommendation, recovery, and health-history records.

## Requirements

- Python 3.10 or newer
- Node.js 20 or newer and npm
- MongoDB Community Server running locally, or a MongoDB Atlas URI

## Start MongoDB

Start your local MongoDB service, or obtain an Atlas connection URI. The default is `mongodb://localhost:27017/`; EdgeGuard uses the `edgeguard_ai` database.

## Configure and run the backend

In PowerShell, from the project root:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
Set-Location backend
python app.py
```

The Flask API listens on `http://127.0.0.1:5000`. Its health endpoint is `http://127.0.0.1:5000/api/health`. Leave this terminal open. If PowerShell blocks virtual-environment activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal and activate again.

Configure `backend\.env` before deployment:

- Set long, unique `FLASK_SECRET_KEY` and `JWT_SECRET_KEY` values.
- Set `MONGODB_URI` if MongoDB is not running at its local default.
- `FRONTEND_ORIGIN` is a comma-separated allowlist. Both Vite development origins (`http://localhost:5173` and `http://127.0.0.1:5173`) are enabled by default; add any other required frontend origin.
- Configure `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`, and `MAIL_DEFAULT_SENDER` to enable password-reset email and email alerts.
- In development mode (`FLASK_DEBUG=true`), reset links are returned in the API response when SMTP is not configured. Do not enable debug mode in production.

## Install and run the frontend

Open a second PowerShell terminal and run these commands from the project root:

```powershell
Set-Location frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://127.0.0.1:5173`). `VITE_API_URL` defaults to `http://127.0.0.1:5000`; frontend API calls use its `/api` path. Set `VITE_API_URL` in `frontend\.env` to change the backend origin. The Vite server also proxies `/api` when `VITE_API_URL=/api` is selected. Flask enables CORS for both default Vite origins.

## Frontend commands

Run these from `frontend\`:

```powershell
npm install
npm run dev
npm run build
npm run preview
```

## Backend checks

Run these from the project root after installing the Python requirements and activating `.venv`:

```powershell
python -m unittest discover -s backend -p "test_*.py" -v
python -m py_compile backend\app.py backend\monitoring.py backend\test_app.py
```

The API tests use an in-memory MongoDB stand-in and exercise registration, sign-in, live metric delivery, anomaly detection and resolution, diagnosis, explicitly approved and verified recovery, history, logout/token revocation, CORS, and frontend route coverage. For a full local sign-in against persistent storage, start MongoDB and both servers, create an account at `/sign-up`, then sign in at `/sign-in`.

## Features and safety

- Account creation, sign-in, sign-out, password reset, protected pages, and hashed passwords.
- Logout revokes the session token; expired revocation records are automatically removed by MongoDB TTL.
- Dashboard and live CPU, memory, disk, network, process, and system-health monitoring.
- Threshold, Scikit-learn `IsolationForest`, and trend-based anomaly detection.
- Metric/process/log-informed diagnosis with severity and confidence explanations.
- One allowlisted recovery action: lower the scheduling priority of an eligible process owned by the current user. The action requires explicit user approval; EdgeGuard does not execute arbitrary or AI-generated commands or terminate processes. The API records and verifies before-and-after priority and system CPU/memory readings.
- MongoDB-backed incidents, recommendations, recovery outcomes, and health history.
- Profile, theme, monitoring, and notification settings.

Run the backend on the computer you want to monitor: `psutil` reports metrics from the machine running Flask. The API binds to loopback by default; do not expose it publicly without HTTPS, production-grade secrets, appropriate access controls, and a deployment review. Corrective actions do not request administrator privileges and may be rejected by the operating system.
