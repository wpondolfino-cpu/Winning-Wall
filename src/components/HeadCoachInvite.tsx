// src/components/HeadCoachInvite.tsx
// What someone sees when they open a head-coach invite link (?invite=TOKEN).
// Opening it uses nothing up: the platform admin can open it to check it,
// and an email scanner "clicking" it does no harm. The invite is used only
// when the person sets their password (or signs in to their own account)
// and taps the button.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { acceptInvite, clearInviteParam, lookupInvite, type InviteLookup } from "../lib/headCoachInvite";
import LoginPage from "../pages/LoginPage";

interface Props {
  token: string;
  /** Signed-in account, if any. */
  userEmail: string | null;
  userName: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

const page: CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 12px",
  background: "#0a0c14", boxSizing: "border-box",
};
const box: CSSProperties = {
  background: "#111828", border: "1px solid rgba(176,184,200,0.15)", borderRadius: 20,
  padding: "32px 28px", width: 400, maxWidth: "100%", boxSizing: "border-box",
  display: "flex", flexDirection: "column", gap: 14,
};
const inputStyle: CSSProperties = {
  width: "100%", background: "#1a2235", border: "1px solid rgba(176,184,200,0.15)", borderRadius: 10,
  padding: "11px 13px", color: "var(--text, #e8ecf4)", fontSize: 15, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted, #9aa3b5)" };
const muted: CSSProperties = { fontSize: 13, color: "var(--muted, #9aa3b5)", lineHeight: 1.55 };
const linkBtn: CSSProperties = {
  background: "transparent", border: 0, color: "var(--muted, #9aa3b5)", fontSize: 13, cursor: "pointer",
  textDecoration: "underline", padding: 6, alignSelf: "center", fontFamily: "inherit",
};

function leave() {
  clearInviteParam();
  window.location.replace(window.location.pathname + window.location.search);
}

export default function HeadCoachInvite({ token, userEmail, userName }: Props) {
  const [info, setInfo] = useState<InviteLookup | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<"welcome" | "setup" | "signin">("welcome");
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoadErr(null);
    lookupInvite(token)
      .then(r => { setInfo(r); setName(r.name ?? ""); })
      .catch(e => setLoadErr(e?.message ?? "Couldn't load the invite."));
  };
  useEffect(load, [token]);

  const color = info?.program?.primary_color && HEX.test(info.program.primary_color) ? info.program.primary_color : "#1a3fa8";
  const accent = info?.program?.accent_color && HEX.test(info.program.accent_color) ? info.program.accent_color : "#f0c040";
  const btn: CSSProperties = {
    width: "100%", background: color, color: "#fff", border: "none", borderRadius: 12, padding: 14,
    fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
  };
  const shell = (children: ReactNode) => (
    <div style={{ ...page, backgroundImage: `radial-gradient(ellipse 80% 60% at 50% 0%, ${color}59 0%, transparent 70%)` }}>
      <div style={box}>{children}</div>
    </div>
  );

  // Signed out partway through "Sign in to accept": the normal sign-in page,
  // with the invite still in the address so it comes back after signing in.
  if (step === "signin" && !userEmail) {
    return (
      <>
        <button onClick={() => setStep("welcome")} style={{ position: "fixed", top: 12, left: 12, zIndex: 50, background: "#1c2742", color: "#eef2ff", border: "1px solid rgba(147,180,255,0.45)", borderRadius: 10, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>← Back to invite</button>
        <LoginPage />
      </>
    );
  }

  if (loadErr) return shell(<>
    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--white, #fff)" }}>Couldn't open this invite</div>
    <div style={muted}>{loadErr}</div>
    <button style={btn} onClick={load}>Try again</button>
  </>);

  if (!info) return shell(<div style={{ ...muted, textAlign: "center" }}>Opening your invite…</div>);

  if (info.status !== "open" || !info.program) {
    const why = info.status === "used" ? "It's already been used to set up an account."
      : info.status === "expired" ? "Invite links are good for 7 days, and this one ran out."
      : info.status === "revoked" ? "It was turned off, or a newer link was made."
      : "The link may be incomplete. Check that you copied all of it.";
    return shell(<>
      <div style={{ fontSize: 40, textAlign: "center" }}>🔒</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: "var(--white, #fff)", textAlign: "center" }}>This invite isn't active anymore</div>
      <div style={{ ...muted, textAlign: "center" }}>
        {why}{info.program_name ? ` Ask whoever invited you to ${info.program_name} for a new link.` : " Ask whoever invited you for a new link."}
      </div>
      <div style={{ ...muted, textAlign: "center" }}>Already set up your account? Just sign in.</div>
      <button style={btn} onClick={leave}>Go to sign in</button>
    </>);
  }

  const prog = info.program;
  const email = info.email ?? "";
  const signedInAsInvitee = !!userEmail && userEmail.toLowerCase() === email.toLowerCase();
  const signedInAsSomeoneElse = !!userEmail && !signedInAsInvitee;
  const expires = info.expires_at ? new Date(info.expires_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null;

  async function signOut() {
    setBusy(true);
    try { await supabase.auth.signOut(); } finally { setBusy(false); }
  }

  async function create() {
    setErr(null);
    if (!name.trim()) { setErr("Type your name."); return; }
    if (pass.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pass !== pass2) { setErr("The passwords don't match."); return; }
    setBusy(true);
    try {
      await acceptInvite(token, name.trim(), pass);
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw new Error(`Your account is ready, but signing in didn't work (${error.message}). Go to sign in and use ${email} and your new password.`);
      leave();
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
      setBusy(false);
    }
  }

  async function acceptAsMe() {
    setErr(null); setBusy(true);
    try { await acceptInvite(token); leave(); }
    catch (e: any) { setErr(e?.message ?? "Something went wrong."); setBusy(false); }
  }

  const header = (
    <>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {prog.logo_url
          ? <img src={prog.logo_url} alt="" style={{ width: 72, height: 72, objectFit: "contain", borderRadius: 14 }} />
          : <div style={{ width: 72, height: 72, borderRadius: 18, background: color, border: `3px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>🏀</div>}
      </div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: 2, color: "var(--muted, #9aa3b5)", textAlign: "center" }}>
        Winning <span style={{ color: accent }}>Wall</span>
      </div>
    </>
  );

  const errBox = err && (
    <div role="alert" style={{ background: "rgba(220,50,50,0.15)", border: "1px solid rgba(220,50,50,0.3)", color: "var(--danger-text, #ff9b9b)", padding: "10px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>{err}</div>
  );

  if (step === "setup") return shell(<>
    {header}
    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--white, #fff)" }}>Set up your account</div>
    <div style={muted}>You'll sign in with <b style={{ color: "var(--text, #e8ecf4)" }}>{email}</b> and the password you pick here.</div>
    <label style={labelStyle}>Your name
      <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="First and last name" style={inputStyle} />
    </label>
    <label style={labelStyle}>Password
      <input type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" style={inputStyle} />
    </label>
    <label style={labelStyle}>Password again
      <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" placeholder="Type it again"
        onKeyDown={e => { if (e.key === "Enter" && !busy) create(); }} style={inputStyle} />
    </label>
    {errBox}
    <button style={btn} disabled={busy} onClick={create}>{busy ? "Setting up…" : "Create account and go"}</button>
    <button style={linkBtn} disabled={busy} onClick={() => { setErr(null); setStep("welcome"); }}>← Back</button>
  </>);

  // Welcome
  return shell(<>
    {header}
    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 14, color: "var(--muted, #9aa3b5)" }}>{info.name ? `Hi ${info.name.split(" ")[0]} 👋` : "Hi 👋"}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: "var(--white, #fff)", lineHeight: 1.3 }}>
        You've been invited to be head coach of <span style={{ color: accent }}>{prog.name}</span>
      </div>
      {prog.school && prog.school !== prog.name && <div style={{ fontSize: 13, color: "var(--muted, #9aa3b5)" }}>{prog.school}</div>}
    </div>
    <div style={{ background: "#0d1322", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--tx-c8cfde, #c8cfde)" }}>
      <div><span style={{ color: "var(--muted, #9aa3b5)" }}>For </span>{email}</div>
      {info.invited_by && <div><span style={{ color: "var(--muted, #9aa3b5)" }}>Invited by </span>{info.invited_by}</div>}
      {expires && <div><span style={{ color: "var(--muted, #9aa3b5)" }}>Good until </span>{expires}</div>}
    </div>

    {signedInAsSomeoneElse && (
      <>
        <div style={{ ...muted, background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "10px 12px", color: "var(--amber-text, #f0c96a)" }}>
          You're signed in as {userName ?? userEmail} on this device. This invite is for {email}.
          {" "}Opening the link didn't use it up, so it's still good to send.
        </div>
        <button style={btn} disabled={busy} onClick={signOut}>{busy ? "Signing out…" : `Sign out so ${email.split("@")[0]} can use it`}</button>
        <button style={linkBtn} onClick={leave}>Back to Winning Wall</button>
      </>
    )}

    {!signedInAsSomeoneElse && info.account === "existing" && (signedInAsInvitee ? (
      <>
        <div style={muted}>You're signed in as {userName ?? email}. Tap below and you'll be head coach of {prog.name}.</div>
        {errBox}
        <button style={btn} disabled={busy} onClick={acceptAsMe}>{busy ? "Working…" : "Accept and go"}</button>
      </>
    ) : (
      <>
        <div style={muted}>You already have a Winning Wall account with this email. Sign in to accept.</div>
        <button style={btn} onClick={() => setStep("signin")}>Sign in to accept</button>
      </>
    ))}

    {!signedInAsSomeoneElse && info.account !== "existing" && (
      <>
        <div style={muted}>Pick a password and you're in. It takes about a minute.</div>
        <button style={btn} onClick={() => { setErr(null); setStep("setup"); }}>Set up my account</button>
      </>
    )}

    {!signedInAsSomeoneElse && <button style={linkBtn} onClick={leave}>Not you? Go to Winning Wall</button>}
  </>);
}
