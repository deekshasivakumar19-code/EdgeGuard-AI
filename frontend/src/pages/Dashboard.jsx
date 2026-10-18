import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Clock3, Cpu, HardDrive, MemoryStick, RefreshCw, ShieldCheck, Wifi } from "lucide-react";
import { useAuth } from "../App";
import useMonitoring from "../hooks/useMonitoring";
import MetricCard from "../components/MetricCard";
import MetricChart from "../components/MetricChart";
import api, { apiMessage } from "../api";
import toast from "react-hot-toast";

const ago = (value) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 60 ? "just now" : `${Math.floor(seconds / 60)}m ago`;
};

export default function Dashboard() {
  const { user } = useAuth();
  const { metrics, history, error, loading, paused, refresh } = useMonitoring();
  const [recentIncidents, setRecentIncidents] = useState([]);
  const [alertsError, setAlertsError] = useState("");
  const seenIncidentIds = useRef(null);
  const loadIncidents = useCallback(async () => {
    try {
      const { data } = await api.get("/anomalies?status=all");
      const incidents = data.anomalies || [];
      if (seenIncidentIds.current && user?.notifications?.in_app !== false) {
        incidents.filter((item) => !seenIncidentIds.current.has(item.id)).forEach((item) => toast(item.title, { icon: "⚠️" }));
      }
      seenIncidentIds.current = new Set(incidents.map((item) => item.id));
      setRecentIncidents(incidents);
      setAlertsError("");
    } catch (err) { setAlertsError(apiMessage(err)); }
  }, [user?.notifications?.in_app]);
  useEffect(() => {
    loadIncidents();
    const timer = window.setInterval(loadIncidents, 30000);
    return () => window.clearInterval(timer);
  }, [loadIncidents]);
  const chartData = useMemo(() => history.slice(-30), [history]);
  const alerts = useMemo(() => {
    const current = metrics?.alerts || [];
    const saved = recentIncidents.filter((item) => !item.resolved);
    const seen = new Set(saved.map((item) => `${item.metric}:${item.title}`));
    return [...saved, ...current.filter((item) => !seen.has(`${item.metric}:${item.title}`))].slice(0, 4);
  }, [metrics?.alerts, recentIncidents]);
  const processes = metrics?.processes || [];
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">SYSTEM OVERVIEW</div><h1>Good to see you, {user?.name?.split(" ")[0] || "there"}</h1><p>A live look at your computer’s health and activity.</p></div><button className="button button-secondary" onClick={refresh} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Refresh now</button></div>
    {error && <div className="inline-error"><span>{error}</span><button className="text-button" onClick={refresh}>Try again</button></div>}
    {!metrics && loading ? <div className="skeleton-grid">{[1, 2, 3, 4].map((x) => <div className="skeleton-card" key={x} />)}</div> : metrics && !paused && <>
      <div className="metric-grid">
        <MetricCard title="CPU usage" value={metrics.cpu} icon={Cpu} color="purple" detail="Current processor load" />
        <MetricCard title="Memory" value={metrics.memory} icon={MemoryStick} color="blue" detail={`${(metrics.memory_used / 1073741824).toFixed(1)} of ${(metrics.memory_total / 1073741824).toFixed(1)} GB used`} />
        <MetricCard title="Disk usage" value={metrics.disk} icon={HardDrive} color="green" detail={`${(metrics.disk_used / 1073741824).toFixed(1)} GB used`} />
        <MetricCard title="Network" value={(metrics.network.received + metrics.network.sent) / 1048576} unit="MB/s" icon={Wifi} color="orange" detail="Combined send and receive rate" />
      </div>
      <div className="dashboard-grid">
        <section className="panel performance-panel"><div className="panel-header"><div><h2>Performance</h2><p>Recent live samples from this computer</p></div><Link to="/monitoring" className="panel-link">Full monitoring <ArrowRight size={14} /></Link></div>
          <div className="chart-legend"><span><i className="legend-dot cpu-dot" />CPU</span><span><i className="legend-dot memory-dot" />Memory</span><span><i className="legend-dot disk-dot" />Disk</span></div>
          <div className="multi-chart"><MetricChart data={chartData} metric="cpu" compact height={225} name="CPU" /><MetricChart data={chartData} metric="memory" compact height={225} name="Memory" /><MetricChart data={chartData} metric="disk" compact height={225} name="Disk" /></div>
        </section>
        <section className="panel health-panel"><div className="panel-header"><div><h2>System health</h2><p>Based on current resource pressure</p></div><span className="health-shield"><ShieldCheck size={17} /></span></div><div className="health-meter" style={{ "--health": `${metrics.health}%` }}><div className="health-meter-inner"><b>{metrics.health}</b><span>out of 100</span></div></div><div className={`health-state ${metrics.health >= 80 ? "good" : metrics.health >= 55 ? "warning" : "critical"}`}><span />{metrics.health >= 80 ? "System looks healthy" : metrics.health >= 55 ? "Some resource pressure" : "Attention recommended"}</div><div className="health-foot"><span><Clock3 size={14} /> Updated {ago(metrics.timestamp)}</span><span>{metrics.platform?.split("-")[0]}</span></div></section>
        <section className="panel alerts-panel"><div className="panel-header"><div><h2>Recent alerts</h2><p>Signals detected by your monitor</p></div><Link to="/anomalies" className="panel-link">View all <ArrowRight size={14} /></Link></div>
          {alertsError && <div className="alert-load-error"><span>{alertsError}</span><button className="text-button" onClick={loadIncidents}>Retry</button></div>}
          {alerts.length ? <div className="alert-list">{alerts.map((alert, index) => <div className="alert-row" key={alert.id || `${alert.metric}-${alert.kind}-${index}`}><span className={`alert-symbol ${alert.severity}`}><Activity size={15} /></span><div className="alert-copy"><b>{alert.title}</b><span>{alert.description}</span></div><span className={`severity ${alert.severity}`}>{alert.severity}</span></div>)}</div> : !alertsError && <div className="empty-state compact-empty"><span className="empty-icon"><ShieldCheck size={20} /></span><b>No active alerts</b><p>New signals will appear here as they are detected.</p></div>}
        </section>
        <section className="panel process-panel"><div className="panel-header"><div><h2>Top processes</h2><p>Highest current CPU usage</p></div><Link to="/diagnosis" className="panel-link">Diagnose <ArrowRight size={14} /></Link></div>
          {processes.length ? <div className="table-scroll"><table><thead><tr><th>PROCESS</th><th>PID</th><th>CPU</th><th>MEMORY</th></tr></thead><tbody>{processes.slice(0, 5).map((process) => <tr key={process.pid}><td><span className="process-dot" />{process.name}</td><td className="mono">{process.pid}</td><td><span className="table-value">{process.cpu.toFixed(1)}%</span></td><td>{process.memory.toFixed(1)}%</td></tr>)}</tbody></table></div> : <div className="empty-state compact-empty"><p>Process information is not available yet.</p></div>}
        </section>
      </div>
    </>}
    {paused && <div className="empty-panel"><ShieldCheck size={26} /><b>Live monitoring is paused</b><p>Enable monitoring in Settings to collect current system data.</p><Link className="button button-secondary" to="/settings">Open settings</Link></div>}
  </div>;
}
