import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, ShieldCheck, Activity, LockKeyhole, ArrowLeft } from "lucide-react";
import api, { apiMessage } from "../api";
import { useAuth } from "../App";
import toast from "react-hot-toast";

function AuthFrame({ eyebrow, title, subtitle, children, footer }) {
  return <main className="auth-page"><div className="auth-glow auth-glow-a" /><div className="auth-glow auth-glow-b" />
    <section className="auth-card"><Link to="/sign-in" className="auth-brand"><span className="brand-mark"><ShieldCheck size={20} /></span><b>edgeguard<span> AI</span></b></Link>
      <div className="auth-heading"><div className="auth-eyebrow"><span className="status-dot" />{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{children}<div className="auth-foot">{footer}</div>
    </section><div className="auth-aside"><div className="aside-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-center"><ShieldCheck size={43} /></div><div className="orbit-node"><Activity size={17} /></div><div className="orbit-node second"><LockKeyhole size={16} /></div></div><h2>Clarity when your system needs it.</h2><p>Thoughtful monitoring, helpful explanations, and safe recovery — all in one place.</p><div className="aside-meta"><span>● PRIVATE BY DESIGN</span><span>● HUMAN-APPROVED ACTIONS</span></div></div></main>;
}

function PasswordField({ value, onChange, label = "Password", autoComplete = "current-password" }) {
  const [show, setShow] = useState(false);
  return <label className="field"><span>{label}</span><div className="password-wrap"><input required type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} minLength={10} maxLength={1024} placeholder="At least 10 characters" /><button type="button" aria-label={show ? "Hide password" : "Show password"} className="password-toggle" onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>;
}

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const submit = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { email: email.trim(), password });
      signIn(data); toast.success("Welcome back."); navigate(location.state?.from || "/", { replace: true });
    } catch (error) { toast.error(apiMessage(error)); } finally { setBusy(false); }
  };
  return <AuthFrame eyebrow="YOUR SYSTEM, IN FOCUS" title="Welcome back" subtitle="Sign in to continue to your monitoring workspace." footer={<>New to EdgeGuard? <Link to="/sign-up">Create an account</Link></>}>
    <form className="auth-form" onSubmit={submit}><label className="field"><span>Email address</span><input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label><PasswordField value={password} onChange={(e) => setPassword(e.target.value)} /><div className="form-between"><span className="muted-small">Secure, private sign-in</span><Link to="/forgot-password">Forgot password?</Link></div><button className="button button-primary button-wide" disabled={busy}>{busy && <span className="spinner spinner-small" />}{busy ? "Signing in…" : "Sign in"}<span className="button-arrow">→</span></button></form>
  </AuthFrame>;
}

export function SignUp() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const change = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    if (form.password.length < 10) { toast.error("Password must be at least 10 characters."); return; }
    setBusy(true);
    try { const { data } = await api.post("/auth/signup", { ...form, name: form.name.trim(), email: form.email.trim() }); signIn(data); toast.success("Your account is ready."); navigate("/", { replace: true }); }
    catch (error) { toast.error(apiMessage(error)); } finally { setBusy(false); }
  };
  return <AuthFrame eyebrow="A CALMER WAY TO TROUBLESHOOT" title="Create your account" subtitle="Set up your private system monitoring workspace." footer={<>Already have an account? <Link to="/sign-in">Sign in</Link></>}>
    <form className="auth-form" onSubmit={submit}><label className="field"><span>Your name</span><input required maxLength={80} autoComplete="name" value={form.name} onChange={change("name")} placeholder="Alex Morgan" /></label><label className="field"><span>Email address</span><input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={change("email")} placeholder="you@example.com" /></label><PasswordField label="Create password" autoComplete="new-password" value={form.password} onChange={change("password")} /><p className="field-hint">Use at least 10 characters.</p><button className="button button-primary button-wide" disabled={busy}>{busy && <span className="spinner spinner-small" />}{busy ? "Creating account…" : "Create account"}<span className="button-arrow">→</span></button></form>
  </AuthFrame>;
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState("");
  const submit = async (event) => {
    event.preventDefault(); setBusy(true);
    try { const { data } = await api.post("/auth/forgot-password", { email: email.trim() }); setSent(true); setDevLink(data.development_reset_link || ""); toast.success(data.message); }
    catch (error) { toast.error(apiMessage(error)); } finally { setBusy(false); }
  };
  return <AuthFrame eyebrow="ACCOUNT RECOVERY" title={sent ? "Check your inbox" : "Reset your password"} subtitle={sent ? "If there is an account for that email, reset instructions are on their way." : "Enter your account email and we’ll send you a secure reset link."} footer={<Link to="/sign-in"><ArrowLeft size={15} /> Back to sign in</Link>}>
    {!sent ? <form className="auth-form" onSubmit={submit}><label className="field"><span>Email address</span><input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label><button className="button button-primary button-wide" disabled={busy}>{busy && <span className="spinner spinner-small" />}{busy ? "Sending…" : "Send reset link"}</button></form> : <div className="success-panel"><div className="success-icon"><ShieldCheck size={22} /></div><p>Check your email for a password reset link. The link expires in 30 minutes.</p>{devLink && <a className="button button-secondary button-wide" href={devLink}>Open development reset link <span>→</span></a>}</div>}
  </AuthFrame>;
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 10) { toast.error("Password must be at least 10 characters."); return; }
    setBusy(true);
    try { const { data } = await api.post("/auth/reset-password", { token: params.get("token"), password }); toast.success(data.message); navigate("/sign-in", { replace: true }); }
    catch (error) { toast.error(apiMessage(error)); } finally { setBusy(false); }
  };
  return <AuthFrame eyebrow="SECURE YOUR ACCOUNT" title="Choose a new password" subtitle="Your new password must be at least 10 characters." footer={<Link to="/sign-in"><ArrowLeft size={15} /> Back to sign in</Link>}>
    <form className="auth-form" onSubmit={submit}><PasswordField label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="button button-primary button-wide" disabled={busy || !params.get("token")}>{busy ? "Updating…" : "Update password"}</button></form>
  </AuthFrame>;
}
