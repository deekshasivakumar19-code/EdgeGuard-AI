import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, CircleHelp, Cpu, History, LayoutDashboard, LogOut, Menu, Settings as SettingsIcon, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../App";
import { useLocation } from "react-router-dom";
import toast from "react-hot-toast";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/monitoring", label: "Monitoring", icon: Activity },
  { to: "/anomalies", label: "Anomalies", icon: AlertTriangle },
  { to: "/diagnosis", label: "Diagnosis", icon: Cpu },
  { to: "/history", label: "Recovery history", icon: History },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
    } catch {
      toast.error("Your local session was cleared, but the server could not confirm token revocation.");
    } finally {
      navigate("/sign-in", { replace: true });
      setLoggingOut(false);
    }
  };

  return (
    <div className={`shell ${collapsed ? "shell-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brand-mark"><ShieldCheck size={19} /></span><span className="brand-name">edgeguard<span> AI</span></span><button className="mobile-close icon-button" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {nav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} title={collapsed ? label : undefined} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon size={18} /><span>{label}</span>{label === "Anomalies" && <span className="nav-live" />}</NavLink>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><div className="note-icon"><CircleHelp size={17} /></div><div><b>Need a hand?</b><p>View diagnosis for system insights.</p></div></div>
          <div className="profile-row"><div className="avatar">{(user?.name || "U").slice(0, 1).toUpperCase()}</div><div className="profile-info"><b>{user?.name || "User"}</b><span>{user?.email}</span></div><button title="Sign out" aria-label="Sign out" className="icon-button logout-button" onClick={logout} disabled={loggingOut}><LogOut size={17} /></button></div>
        </div>
        <button className="collapse-toggle icon-button" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button>
      </aside>
      <div className="main-area">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><span className="crumb-sep">/</span><b>{nav.find((item) => item.to === location.pathname)?.label || "Overview"}</b></div><div className="topbar-right"><span className={`system-status ${user?.monitoring === false ? "is-paused" : ""}`}><span /> Monitoring {user?.monitoring === false ? "paused" : "on"}</span><div className="topbar-avatar">{(user?.name || "U").slice(0, 1).toUpperCase()}</div></div></header>
        <main className="page-content"><Outlet /></main>
        <footer className="footer"><span><ShieldCheck size={14} /> EdgeGuard AI</span><span>Local-first monitoring · Your data stays yours</span></footer>
      </div>
    </div>
  );
}
