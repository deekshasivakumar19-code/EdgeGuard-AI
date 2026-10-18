import { useCallback, useEffect, useState } from "react";
import { Bell, Check, MonitorCog, Moon, Save, ShieldCheck, Sun, UserRound } from "lucide-react";
import { useAuth } from "../App";
import api, { apiMessage } from "../api";
import toast from "react-hot-toast";

const defaults = { name: "", email: "", theme: "dark", monitoring: true, notifications: { email: false, in_app: true }, email_notifications_available: false };

export default function Settings() {
  const { updateUser } = useAuth();
  const [settings, setSettings] = useState(defaults);
  const [saved, setSaved] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/settings");
      setSettings(data.settings);
      setSaved(data.settings);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => { document.documentElement.dataset.theme = settings.theme || "dark"; }, [settings.theme]);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const updateNotification = (field) => setSettings((current) => ({
    ...current, notifications: { ...current.notifications, [field]: !current.notifications[field] },
  }));
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const { data } = await api.put("/settings", settings);
      setSettings(data.settings); setSaved(data.settings);
      updateUser(data.settings); document.documentElement.dataset.theme = data.settings.theme;
      toast.success("Your preferences have been saved.");
    } catch (err) { setError(apiMessage(err)); toast.error(apiMessage(err)); }
    finally { setSaving(false); }
  };
  const discard = () => { setSettings(saved); document.documentElement.dataset.theme = saved.theme; };

  if (loading) return <div className="page"><div className="loading-panel"><span className="spinner" />Loading your settings…</div></div>;
  if (error && !settings.name) return <div className="page"><div className="page-heading"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p>Manage your profile, monitoring behavior, and workspace preferences.</p></div></div><div className="inline-error"><span>{error}</span><button className="text-button" onClick={load}>Retry</button></div></div>;
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p>Manage your profile, monitoring behavior, and workspace preferences.</p></div></div>
    {error && <div className="inline-error"><span>{error}</span><button className="text-button" onClick={() => setError("")}>Dismiss</button></div>}
    <form onSubmit={submit} className="settings-form">
      <section className="panel settings-section"><div className="settings-title"><span className="settings-icon"><UserRound size={18} /></span><div><h2>Profile</h2><p>Manage the details associated with your account.</p></div></div><div className="settings-fields"><label className="field"><span>Display name</span><input required maxLength={80} value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} /></label><label className="field"><span>Email address</span><input type="email" value={settings.email} readOnly /><small>Email changes are not available to keep account recovery secure.</small></label></div></section>
      <section className="panel settings-section"><div className="settings-title"><span className="settings-icon"><MonitorCog size={18} /></span><div><h2>Monitoring</h2><p>Choose whether this computer collects live system metrics.</p></div></div><div className="setting-row"><div><b>Live system monitoring</b><p>Collect CPU, memory, disk, network, and process readings while you use the app.</p></div><button type="button" role="switch" aria-checked={settings.monitoring} aria-label="Live system monitoring" className={`switch ${settings.monitoring ? "on" : ""}`} onClick={() => setSettings({ ...settings, monitoring: !settings.monitoring })}><i /></button></div></section>
      <section className="panel settings-section"><div className="settings-title"><span className="settings-icon"><Bell size={18} /></span><div><h2>Notifications</h2><p>Set how you would like to receive updates.</p></div></div><div className="toggle-list"><div className="setting-row"><div><b>In-app notifications</b><p>Show a notification when a new anomaly is recorded.</p></div><button type="button" role="switch" aria-checked={settings.notifications?.in_app ?? true} aria-label="In-app notifications" className={`switch ${settings.notifications?.in_app ?? true ? "on" : ""}`} onClick={() => updateNotification("in_app")}><i /></button></div><div className="setting-row"><div><b>Email notifications</b><p>{settings.email_notifications_available ? "Email new anomalies using the configured SMTP service." : "Unavailable until an administrator configures SMTP."}</p></div><button type="button" role="switch" aria-checked={settings.notifications?.email || false} aria-label="Email notifications" disabled={!settings.email_notifications_available && !settings.notifications?.email} className={`switch ${settings.notifications?.email ? "on" : ""}`} onClick={() => updateNotification("email")}><i /></button></div></div></section>
      <section className="panel settings-section"><div className="settings-title"><span className="settings-icon"><Moon size={18} /></span><div><h2>Appearance</h2><p>Choose the interface theme for this workspace.</p></div></div><div className="theme-options"><button type="button" className={`theme-option ${settings.theme === "dark" ? "selected" : ""}`} onClick={() => setSettings({ ...settings, theme: "dark" })}><span className="theme-preview dark-preview"><Moon size={18} /></span><span><b>Dark</b><small>Easy on the eyes</small></span>{settings.theme === "dark" && <Check size={16} />}</button><button type="button" className={`theme-option ${settings.theme === "light" ? "selected" : ""}`} onClick={() => setSettings({ ...settings, theme: "light" })}><span className="theme-preview light-preview"><Sun size={18} /></span><span><b>Light</b><small>Bright and clear</small></span>{settings.theme === "light" && <Check size={16} />}</button></div></section>
      <div className="settings-actions">{dirty && <span>Unsaved changes</span>}<div><button type="button" className="button button-quiet" onClick={discard} disabled={!dirty || saving}>Discard</button><button type="submit" className="button button-primary" disabled={!dirty || saving}><Save size={15} />{saving ? "Saving…" : "Save changes"}</button></div></div>
    </form>
    <div className="info-strip"><ShieldCheck size={15} /><span>Your password is stored as a salted hash. Monitoring and history data are saved to your configured MongoDB instance.</span></div>
  </div>;
}
