import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Filter, RefreshCw, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import api, { apiMessage } from "../api";
import useMonitoring from "../hooks/useMonitoring";
import toast from "react-hot-toast";

const dateLabel = (value) => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function Anomalies() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { refresh } = useMonitoring(30000);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/anomalies?status=${filter}`);
      setItems(data.anomalies || []);
      setError("");
    } catch (err) { setError(apiMessage(err)); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => !query || `${item.title} ${item.description} ${item.metric} ${item.severity}`.toLowerCase().includes(query));
  }, [items, search]);
  const resolve = async (item) => {
    try { await api.post(`/anomalies/${item.id}/resolve`); toast.success("Alert marked as resolved."); load(); }
    catch (err) { toast.error(apiMessage(err)); }
  };
  const refreshAll = async () => { await refresh(); await load(); };

  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">DETECTION CENTER</div><h1>Anomalies</h1><p>Unusual patterns and resource pressure detected from live system signals.</p></div><button className="button button-secondary" onClick={refreshAll} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Scan now</button></div>
    {error && <div className="inline-error"><span>{error}</span><button className="text-button" onClick={load}>Try again</button></div>}
    <div className="toolbar panel"><div className="search-field"><Search size={16} /><label className="sr-only" htmlFor="anomaly-search">Search alerts</label><input id="anomaly-search" placeholder="Search alerts…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="filter-control"><Filter size={15} /><label className="sr-only" htmlFor="anomaly-filter">Filter alert status</label><select id="anomaly-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="open">Open alerts</option><option value="resolved">Resolved</option><option value="all">All alerts</option></select></div><span className="result-count">{visible.length} result{visible.length === 1 ? "" : "s"}</span></div>
    {loading && !items.length ? <div className="loading-panel"><span className="spinner" />Loading anomaly history…</div> : visible.length ? <div className="anomaly-list">{visible.map((item) => <article className="panel anomaly-card" key={item.id}><div className={`anomaly-icon ${item.severity}`}><TriangleAlert size={19} /></div><div className="anomaly-main"><div className="anomaly-title-row"><h2>{item.title}</h2><span className={`severity ${item.severity}`}>{item.severity}</span></div><p>{item.description}</p><div className="anomaly-meta"><span>{item.metric?.toUpperCase()} · {Number(item.value).toFixed(1)}%</span><span>Confidence {Math.round(item.confidence * 100)}%</span><span>{dateLabel(item.created_at)}</span></div></div>{!item.resolved ? <button className="button button-secondary small-button" onClick={() => resolve(item)}><Check size={14} />Resolve</button> : <span className="resolved-badge"><Check size={14} />Resolved</span>}</article>)}</div> : <div className="panel empty-state large-empty"><div className="empty-icon"><ShieldCheck size={23} /></div><h2>{search ? "No matching alerts" : filter === "open" ? "All clear for now" : "No alerts in this view"}</h2><p>{search ? "Try a different search term." : "Live anomaly detection runs as your system metrics are collected. Threshold alerts and unusual trends will appear here."}</p>{search && <button className="button button-secondary" onClick={() => setSearch("")}>Clear search</button>}{!search && <button className="button button-secondary" onClick={refreshAll}>Run a scan</button>}</div>}
    <div className="info-strip"><AlertTriangle size={15} /><span>Detection combines resource thresholds, recent-sample anomaly modeling, and gradual trend analysis. Insights are advisory.</span></div>
  </div>;
}
