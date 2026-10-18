import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import api, { apiMessage } from "./api";
import Layout from "./components/Layout";
import toast from "react-hot-toast";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
const SignIn = lazy(() => import("./pages/Auth").then((module) => ({ default: module.SignIn })));
const SignUp = lazy(() => import("./pages/Auth").then((module) => ({ default: module.SignUp })));
const ForgotPassword = lazy(() => import("./pages/Auth").then((module) => ({ default: module.ForgotPassword })));
const ResetPassword = lazy(() => import("./pages/Auth").then((module) => ({ default: module.ResetPassword })));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Monitoring = lazy(() => import("./pages/Monitoring"));
const Anomalies = lazy(() => import("./pages/Anomalies"));
const Diagnosis = lazy(() => import("./pages/Diagnosis"));
const History = lazy(() => import("./pages/History"));
const Settings = lazy(() => import("./pages/Settings"));

function Guard({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="app-loading"><span className="spinner" />Checking your session…</div>;
  return user ? children : <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
}

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("edgeguard_user") || "null"); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("edgeguard_token")));

  useEffect(() => {
    if (!localStorage.getItem("edgeguard_token")) { setLoading(false); return; }
    api.get("/auth/me").then(({ data }) => {
      setUser(data.user);
      localStorage.setItem("edgeguard_user", JSON.stringify(data.user));
    }).catch((error) => {
      setUser(null);
      localStorage.removeItem("edgeguard_token");
      localStorage.removeItem("edgeguard_user");
      if (error.response?.status !== 401) toast.error(apiMessage(error));
    }).finally(() => setLoading(false));
  }, []);

  const auth = useMemo(() => ({
    user,
    loading,
    signIn: (data) => {
      localStorage.setItem("edgeguard_token", data.token);
      localStorage.setItem("edgeguard_user", JSON.stringify(data.user));
      setUser(data.user);
    },
    updateUser: (next) => {
      setUser(next);
      localStorage.setItem("edgeguard_user", JSON.stringify(next));
    },
    signOut: async () => {
      try {
        await api.post("/auth/logout");
      } finally {
        localStorage.removeItem("edgeguard_token");
        localStorage.removeItem("edgeguard_user");
        setUser(null);
      }
    },
  }), [user, loading]);

  useEffect(() => { document.documentElement.dataset.theme = user?.theme || "dark"; }, [user?.theme]);

  return (
    <AuthContext.Provider value={auth}>
      <Suspense fallback={<div className="app-loading"><span className="spinner" />Loading EdgeGuard…</div>}>
        <Routes>
          <Route path="/sign-in" element={user ? <Navigate to="/" replace /> : <SignIn />} />
          <Route path="/sign-up" element={user ? <Navigate to="/" replace /> : <SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<Guard><Layout /></Guard>}>
            <Route index element={<Dashboard />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="anomalies" element={<Anomalies />} />
            <Route path="diagnosis" element={<Diagnosis />} />
            <Route path="history" element={<History />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthContext.Provider>
  );
}
