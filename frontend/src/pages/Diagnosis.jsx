import { useEffect, useState } from "react";
import { AlertOctagon, Check, ChevronRight, Cpu, Info, Play, RefreshCw, ShieldCheck, X } from "lucide-react";
import api, { apiMessage } from "../api";
import toast from "react-hot-toast";

const timeLabel = (date) => new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Diagnosis() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const diagnose = async () => {
    setLoading(true); setError(""); setOutcome(null);
    try { const { data } = await api.get("/diagnosis"); setReport(data.diagnosis); }
    catch (err) { setError(apiMessage(err)); }
    finally { setLoading(false); }
  };
  useEffect(() => { diagnose(); }, []);
  const execute = async () => {
    if (!chosen) return;
    setRunning(true);
    try {
      const { data } = await api.post("/recovery/execute", { action: chosen.action, pid: chosen.pid, process_name: chosen.name, approved: true });
      setOutcome(data.recovery); setChosen(null); toast.success("Action completed and verified.");
      const { data: fresh } = await api.get("/diagnosis"); setReport(fresh.diagnosis);
    } catch (err) {
      const failedRecovery = err.response?.data?.recovery;
      if (failedRecovery) setOutcome(failedRecovery);
      toast.error(failedRecovery?.message || apiMessage(err));
      setChosen(null);
    }
    finally { setRunning(false); }
  };

  return <div className="page">
    <div className="page-heading"><div><div className="eyebrow">SYSTEM TROUBLESHOOTING</div><h1>Diagnosis</h1><p>Plain-language analysis of current metrics and the processes behind them.</p></div><button className="button button-secondary" onClick={diagnose} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Run diagnosis</button></div>
    {error && <div className="inline-error"><span>{error}</span><button className="text-button" onClick={diagnose}>Try again</button></div>}
    {loading && !report ? <div className="loading-panel"><span className="spinner" />Analyzing current system readings…</div> : report && <>
      <div className="diagnosis-intro panel"><div className="diagnosis-symbol"><Cpu size={20} /></div><div><b>Analysis refreshed at {timeLabel(report.generated_at)}</b><p>Causes are estimated from current operating-system metrics and visible process data.</p></div><span className="live-pill"><i />LIVE DATA</span></div>
      <section className="diagnosis-section"><div className="section-heading"><div><div className="eyebrow">ASSESSMENT</div><h2>What we found</h2></div><span>{report.findings.length} finding{report.findings.length === 1 ? "" : "s"}</span></div>
        <div className="finding-list">{report.findings.map((finding, index) => <article className="panel finding-card" key={`${finding.title}-${index}`}><div className={`finding-icon ${finding.severity}`}><AlertOctagon size={18} /></div><div className="finding-copy"><div className="finding-top"><h3>{finding.title}</h3><span className={`severity ${finding.severity}`}>{finding.severity}</span></div><p>{finding.cause}</p>{finding.process && <div className="linked-process"><span className="process-dot" />{finding.process.name}<span>PID {finding.process.pid}</span><span>{finding.process.cpu.toFixed(1)}% CPU</span></div>}<div className="confidence-line"><span>Confidence</span><div><i style={{ width: `${Math.round(finding.confidence * 100)}%` }} /></div><b>{Math.round(finding.confidence * 100)}%</b></div></div></article>)}</div>
      </section>
      {report.recent_logs?.length > 0 && <section className="diagnosis-section"><div className="section-heading"><div><div className="eyebrow">HISTORICAL CONTEXT</div><h2>Recent monitoring logs</h2></div></div><div className="panel alert-list">{report.recent_logs.map((item, index) => <div className="alert-row" key={`${item.metric}-${item.created_at}-${index}`}><span className={`alert-symbol ${item.severity}`}><AlertOctagon size={15} /></span><div className="alert-copy"><b>{item.title}</b><span>{item.metric.toUpperCase()} · {timeLabel(item.created_at)}</span></div><span className={`severity ${item.severity}`}>{item.severity}</span></div>)}</div></section>}
      <section className="diagnosis-section"><div className="section-heading"><div><div className="eyebrow">SAFE RECOVERY</div><h2>Recommended actions</h2></div></div>
        {report.recommendations.length ? <div className="recommendation-list">{report.recommendations.map((item) => <article className="panel recommendation-card" key={`${item.action}-${item.pid}`}><div className="recommendation-icon"><Play size={16} /></div><div className="recommendation-copy"><h3>{item.label}</h3><p>{item.reason} Only processes owned by your current account are eligible.</p><span className="process-chip">{item.name} · PID {item.pid}</span></div><button className="button button-primary small-button" onClick={() => setChosen(item)}>Review action <ChevronRight size={14} /></button></article>)}</div> : <div className="panel empty-state compact-empty"><div className="empty-icon"><ShieldCheck size={20} /></div><b>No corrective actions needed</b><p>There are no eligible high-resource processes at this time.</p></div>}
      </section>
      {outcome && <div className={`outcome-card ${outcome.status}`}><span>{outcome.status === "verified" ? <Check size={18} /> : <Info size={18} />}</span><div><b>{outcome.status === "verified" ? "Recovery verified" : "Recovery needs attention"}</b><p>{outcome.message}</p>{outcome.before && <small>Priority {outcome.before.priority} → {outcome.after.priority} · System CPU {outcome.before.cpu}% → {outcome.after.cpu}% · Memory {outcome.before.memory}% → {outcome.after.memory}%</small>}</div><button className="icon-button" onClick={() => setOutcome(null)} aria-label="Dismiss result"><X size={16} /></button></div>}
      <div className="info-strip safety-note"><ShieldCheck size={16} /><span>Every action is predefined and requires your explicit approval. EdgeGuard never runs AI-generated or arbitrary commands. Results are checked and saved to your recovery history.</span></div>
    </>}
    {chosen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !running) setChosen(null); }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setChosen(null)}><X size={18} /></button><div className="modal-icon"><ShieldCheck size={22} /></div><div className="eyebrow">USER APPROVAL REQUIRED</div><h2 id="confirm-title">Lower process priority?</h2><p>This will reduce the scheduling priority for <b>{chosen.name}</b> (PID {chosen.pid}). It will not stop or close the process. The current and resulting priority will be checked and recorded.</p><div className="modal-process"><span className="process-dot" />{chosen.name}<span>PID {chosen.pid}</span></div><div className="modal-actions"><button className="button button-secondary" onClick={() => setChosen(null)} disabled={running}>Cancel</button><button className="button button-primary" onClick={execute} disabled={running}>{running && <span className="spinner spinner-small" />}{running ? "Applying…" : "Approve & apply"}</button></div></section></div>}
  </div>;
}
