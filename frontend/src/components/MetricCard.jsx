import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export default function MetricCard({ title, value, unit = "%", icon: Icon, color = "purple", detail, trend }) {
  const numeric = Number(value || 0);
  return <article className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${color}`}><Icon size={18} /></span></div><div className="metric-value">{value == null ? "—" : numeric.toLocaleString(undefined, { maximumFractionDigits: 1 })}<small>{value == null ? "" : unit}</small></div><div className="metric-bottom">{detail || "Live system reading"}{trend != null && <span className={trend >= 0 ? "trend-up" : "trend-down"}>{trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(trend).toFixed(1)}%</span>}</div><div className={`metric-progress ${color}`}><span style={{ width: `${Math.min(100, Math.max(0, numeric))}%` }} /></div></article>;
}
