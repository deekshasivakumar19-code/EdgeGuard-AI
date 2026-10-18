import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Check, Clock3, History as HistoryIcon, RefreshCw, ShieldCheck } from "lucide-react";
import api, { apiMessage } from "../api";
import MetricChart from "../components/MetricChart";

const readableDate = (date) => date ? new Date(date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function History() {
  const [data, setData] = useState({ health: [], recommendations: [], incidents: [], recoveries: [] });
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { const { data: response } = await api.get("/history"); setData(response); setError(""); }
    catch (err) { setError(apiMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const chart = useMemo(() => [...data.health].reverse().map((item) => ({
    health: item.health,
    label: new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  })), [data.health]);
  const events = useMemo(() => {
    const all = [
      ...data.recoveries.map((item) => ({ ...item, type: "recovery", at: item.created_at, title: item.status === "verified" ? "Corrective action verified" : "Corrective action not verified", description: `${item.action === "lower_process_priority" ? "Lowered process priority" : item.action} · ${item.process_name || `PID ${item.pid}`}`, status: item.status })),
      ...data.incidents.map((item) => ({ ...item, type: "incident", at: item.created_at, title: item.title, description: item.description, status: item.resolved ? "resolved" : item.severity })),
      ...data.recommendations.map((item) => ({ ...item, type: "recommendation", at: item.created_at, title: "Recovery recommendation", description: `${item.label || item.action} · ${item.name || `PID ${item.pid}`}`, status: item.status })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));
    return filter === "all" ? all : all.filter((item) => item.type === filter);
  }, [data, filter]);

  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">AUDIT TRAIL</div><h1>Recovery history</h1><p>Review health snapshots, detected incidents, and actions taken on your system.</p></div><button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Refresh</button></div>
    {error && <div className="inline-error"><span>{error}</span><button className="text-button" onClick={load}>Try again</button></div>}
    <section className="panel history-health"><div className="panel-header"><div><h2>Health history</h2><p>Stored health score snapshots from monitoring sessions</p></div><span className="history-count">{data.health.length} snapshots</span></div>{data.health.length ? <MetricChart data={chart} metric="health" name="Health score" height={230} /> : <div className="chart-empty history-empty"><span className="chart-empty-icon"><Activity size={24} /></span><b>No health history yet</b><span>Health readings are stored when monitoring collects live snapshots.</span></div>}</section>
    <div className="history-toolbar"><div><div className="eyebrow">SYSTEM EVENTS</div><h2>Activity log</h2></div><label className="filter-control"><span className="sr-only">Filter event type</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All activity</option><option value="recovery">Recovery actions</option><option value="incident">Incidents</option><option value="recommendation">Recommendations</option></select></label></div>
    {loading && !events.length ? <div className="loading-panel"><span className="spinner" />Loading saved history…</div> : events.length ? <div className="timeline">{events.map((item, index) => <article className="timeline-item" key={`${item.type}-${item._id || index}`}><div className={`timeline-icon ${item.type}`}>{item.type === "recovery" ? <Check size={15} /> : item.type === "incident" ? <Activity size={15} /> : <ShieldCheck size={15} />}</div><div className="timeline-card panel"><div className="timeline-top"><div><b>{item.title}</b><span className={`event-type ${item.type}`}>{item.type}</span></div><span className="timeline-date"><Clock3 size={13} />{readableDate(item.at)}</span></div><p>{item.description}</p>{item.type === "recovery" && item.before && <div className="recovery-metrics">Priority {item.before.priority} → {item.after?.priority ?? "—"} · CPU {item.before.cpu}% → {item.after?.cpu}% · Memory {item.before.memory}% → {item.after?.memory}% · {item.message}</div>}{item.type === "incident" && <span className={`severity ${item.severity}`}>{item.severity}</span>}</div></article>)}</div> : <div className="panel empty-state large-empty"><div className="empty-icon"><HistoryIcon size={22} /></div><h2>No activity to show</h2><p>Alerts, system recommendations, and recovery results will be saved here as they occur.</p></div>}
    {data.health.length > 0 && <div className="info-strip"><ShieldCheck size={15} /><span>Health history and recovery records are stored in your configured MongoDB database.</span></div>}
  </div>;
}
