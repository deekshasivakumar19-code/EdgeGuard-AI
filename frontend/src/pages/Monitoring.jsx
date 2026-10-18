import { useMemo, useState } from "react";
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import useMonitoring from "../hooks/useMonitoring";
import MetricCard from "../components/MetricCard";
import MetricChart from "../components/MetricChart";

const chartOptions = [
  { key: "cpu", label: "CPU", unit: "%", color: Cpu },
  { key: "memory", label: "Memory", unit: "%", color: MemoryStick },
  { key: "disk", label: "Disk", unit: "%", color: HardDrive },
  { key: "network", label: "Network", unit: "MB/s", color: Wifi },
];

export default function Monitoring() {
  const { metrics, history, loading, error, paused, refresh } = useMonitoring();
  const [selected, setSelected] = useState("cpu");
  const [range, setRange] = useState(30);
  const points = useMemo(() => history.slice(-range), [history, range]);
  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">LIVE TELEMETRY</div><h1>Monitoring</h1><p>Real-time resource readings and process activity from your computer.</p></div><button className="button button-secondary" onClick={refresh} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Refresh</button></div>
    {error && <div className="inline-error"><span>{error}</span><button className="text-button" onClick={refresh}>Try again</button></div>}
    {metrics && !paused && <><div className="metric-grid metric-grid-three"><MetricCard title="CPU usage" value={metrics.cpu} icon={Cpu} color="purple" /><MetricCard title="Memory usage" value={metrics.memory} icon={MemoryStick} color="blue" detail={`${(metrics.memory_used / 1073741824).toFixed(1)} GB used`} /><MetricCard title="Disk usage" value={metrics.disk} icon={HardDrive} color="green" detail={`${(metrics.disk_total / 1073741824).toFixed(1)} GB total`} /></div>
      <section className="panel monitor-chart-panel"><div className="panel-header monitor-chart-header"><div><h2>Resource history</h2><p>Samples collected while this workspace is open</p></div><div className="control-row"><label className="sr-only" htmlFor="chart-range">Chart sample range</label><select id="chart-range" value={range} onChange={(e) => setRange(Number(e.target.value))}><option value={15}>Last 15 samples</option><option value={30}>Last 30 samples</option><option value={60}>Last 60 samples</option></select></div></div>
        <div className="chart-tabs" role="tablist" aria-label="Select resource metric">{chartOptions.map(({ key, label, color: Icon }) => <button role="tab" aria-selected={selected === key} className={`chart-tab ${selected === key ? "selected" : ""}`} key={key} onClick={() => setSelected(key)}><Icon size={15} />{label}</button>)}</div>
        <MetricChart data={points} metric={selected} unit={chartOptions.find((item) => item.key === selected)?.unit} name={chartOptions.find((item) => item.key === selected)?.label} height={300} />
      </section>
      <section className="panel process-panel standalone-panel"><div className="panel-header"><div><h2>Running processes</h2><p>Top processes by CPU usage · refreshed every 10 seconds</p></div><span className="live-pill"><i />LIVE</span></div>
        {metrics.processes?.length ? <div className="table-scroll"><table><thead><tr><th>PROCESS</th><th>PID</th><th>STATUS</th><th>CPU</th><th>MEMORY</th><th>USER</th></tr></thead><tbody>{metrics.processes.map((process) => <tr key={process.pid}><td><span className="process-dot" />{process.name}</td><td className="mono">{process.pid}</td><td><span className="status-text">{process.status}</span></td><td>{process.cpu.toFixed(1)}%</td><td>{process.memory.toFixed(2)}%</td><td>{process.username || "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Activity size={22} /><b>No process data</b><p>Process information is not available from the operating system.</p></div>}
      </section>
    </>}
    {!metrics && loading && <div className="loading-panel"><span className="spinner" />Collecting live system metrics…</div>}
    {paused && <div className="empty-panel"><Activity size={26} /><b>Monitoring is paused</b><p>Enable live collection in Settings to see your system metrics.</p><Link className="button button-secondary" to="/settings">Open settings</Link></div>}
  </div>;
}
