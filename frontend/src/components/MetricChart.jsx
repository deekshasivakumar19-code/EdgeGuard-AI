import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const colors = { cpu: "#9a7cff", memory: "#4ea8ff", disk: "#27c79a", health: "#aa8cff", network: "#ed9c62" };
const formatValue = (value, unit) => unit === "MB/s" ? `${value} MB/s` : `${value}%`;

export default function MetricChart({ data = [], metric = "cpu", unit = "%", name, height = 245, compact = false }) {
  const color = colors[metric] || colors.cpu;
  const hasData = data.length > 0;
  return <div className="chart-wrap" style={{ height }}>
    {hasData ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
      <defs><linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.26} /><stop offset="100%" stopColor={color} stopOpacity={0.01} /></linearGradient></defs>
      <CartesianGrid stroke="#242735" strokeDasharray="3 5" vertical={false} />
      <XAxis dataKey="label" tick={{ fill: "#747b8e", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={compact ? 42 : 28} />
      <YAxis domain={unit === "%" ? [0, 100] : ["auto", "auto"]} tick={{ fill: "#747b8e", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => unit === "%" ? `${value}%` : value} />
      <Tooltip contentStyle={{ background: "#151823", border: "1px solid #2c3040", borderRadius: 9, color: "#f0f1f7", fontSize: 12 }} labelStyle={{ color: "#a0a5b5" }} formatter={(value) => [formatValue(Number(value).toFixed(1), unit), name || metric.toUpperCase()]} />
      <Area type="monotone" dataKey={metric} stroke={color} strokeWidth={2.2} fill={`url(#fill-${metric})`} activeDot={{ r: 4, fill: color, stroke: "#11131c", strokeWidth: 2 }} />
    </AreaChart></ResponsiveContainer> : <div className="chart-empty"><span className="chart-empty-icon">◌</span><b>Collecting live samples</b><span>Chart data appears as your computer is monitored.</span></div>}
  </div>;
}
