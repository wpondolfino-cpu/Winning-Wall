// src/components/parent/FamilyInvitePage.tsx
// What a parent sees when they open a family invite link (?family=TOKEN).
// Opening it uses nothing up. The parent either makes a parent account or
// signs in to the one they already have (a second child), and then waits
// for a coach to approve them.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { acceptFamilyInvite, clearFamilyParam, lookupFamilyInvite, notifyFamilyRequest, type FamilyInviteLookup } from "../../lib/family";
import LoginPage from "../../pages/LoginPage";

interface Props {
  token: string;
  userEmail: string | null;
  userName: string | null;
  userRole: string | null;
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
  clearFamilyParam();
  window.location.replace(window.location.pathname + window.location.search);
}

export default function FamilyInvitePage({ token, userEmail, userName, userRole }: Props) {
  const [info, setInfo] = useState<FamilyInviteLookup | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<"welcome" | "setup" | "signin" | "done">("welcome");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoadErr(null);
    lookupFamilyInvite(token).then(setInfo).catch(e => setLoadErr(e?.message ?? "Couldn't load the invite."));
  };
  useEffect(load, [token, userEmail]);

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

  // "I already have a parent account": the normal sign-in page, with the
  // link still in the address so it comes back here after signing in.
  if (step === "signin" && !userEmail) {
    return (
      <>
        <button onClick={() => setStep("welcome")} style={{ position: "fixed", top: 12, left: 12, zIndex: 50, background: "#1c2742", color: "#eef2ff", border: "1px solid rgba(147,180,255,0.45)", borderRadius: 10, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>← Back to invite</button>
        <LoginPage />
      </>
    );
  }

  if (loadErr) return shell(<>
    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--white, #fff)" }}>Couldn't open this link</div>
    <div style={muted}>{loadErr}</div>
    <button style={btn} onClick={load}>Try again</button>
  </>);

  if (!info) return shell(<div style={{ ...muted, textAlign: "center" }}>Opening your invite…</div>);

  if (info.status !== "open" || !info.program) {
    const why = info.status === "expired" ? "Family links are good for 30 days, and this one ran out."
      : info.status === "revoked" ? "It was turned off, or the player isn't on the team anymore."
      : "The link may be incomplete. Check that you copied all of it.";
    return shell(<>
      <div style={{ fontSize: 40, textAlign: "center" }}>🔒</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: "var(--white, #fff)", textAlign: "center" }}>This link isn't active anymore</div>
      <div style={{ ...muted, textAlign: "center" }}>{why} Ask your player (or their coach) for a new one. It's on their My Profile page.</div>
      <button style={btn} onClick={leave}>Go to sign in</button>
    </>);
  }

  const prog = info.program;
  const child = info.child ?? "your player";
  const isParent = userRole === "parent";
  const signedInAsOther = !!userEmail && !isParent;

  async function finish(linkId: string | null) {
    notifyFamilyRequest(linkId);
    setStep("done");
    setBusy(false);
  }

  async function create() {
    setErr(null);
    if (!name.trim()) { setErr("Type your name."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr("That doesn't look like an email address."); return; }
    if (pass.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pass !== pass2) { setErr("The passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await acceptFamilyInvite(token, { name: name.trim(), email: email.trim().toLowerCase(), password: pass });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pass });
      if (error) throw new Error(`Your account is ready, but signing in didn't work (${error.message}). Go to sign in and use ${email.trim()} and your new password.`);
      await finish(r.link_id);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
      setBusy(false);
    }
  }

  async function acceptAsMe() {
    setErr(null); setBusy(true);
    try { const r = await acceptFamilyInvite(token); await finish(r.link_id); }
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
        Winning <span style={{ color: accent }}>Wall</span> · Family
      </div>
    </>
  );
  const errBox = err && (
    <div role="alert" style={{ background: "rgba(220,50,50,0.15)", border: "1px solid rgba(220,50,50,0.3)", color: "var(--danger-text, #ff9b9b)", padding: "10px 14px", borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>{err}</div>
  );

  if (step === "done") return shell(<>
    {header}
    <div style={{ fontSize: 40, textAlign: "center" }}>⏳</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--white, #fff)", textAlign: "center" }}>Almost there</div>
    <div style={{ ...muted, textAlign: "center" }}>
      {child}'s coach needs to approve you. We let them know. Once they do, you'll see {child}'s schedule and the team's announcements for families.
    </div>
    <button style={btn} onClick={leave}>OK</button>
  </>);

  if (step === "setup") return shell(<>
    {header}
    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--white, #fff)" }}>Make your parent account</div>
    <label style={labelStyle}>Your name
      <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="First and last name" style={inputStyle} />
    </label>
    <label style={labelStyle}>Email
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" style={inputStyle} />
    </label>
    <label style={labelStyle}>Password
      <input type="password" value={pass} onChange={e => setPass(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" style={inputStyle} />
    </label>
    <label style={labelStyle}>Password again
      <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} autoComplete="new-password" placeholder="Type it again"
        onKeyDown={e => { if (e.key === "Enter" && !busy) create(); }} style={inputStyle} />
    </label>
    <div style={{ ...muted, fontSize: 12 }}>Use your own email, not {child}'s. Each parent makes their own account.</div>
    {errBox}
    <button style={btn} disabled={busy} onClick={create}>{busy ? "Setting up…" : "Create account"}</button>
    <button style={linkBtn} disabled={busy} onClick={() => { setErr(null); setStep("welcome"); }}>← Back</button>
  </>);

  // Welcome
  return shell(<>
    {header}
    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 21, fontWeight: 700, color: "var(--white, #fff)", lineHeight: 1.3 }}>
        Follow <span style={{ color: accent }}>{child}</span>{info.team ? ` on ${info.team}` : ""}
      </div>
      <div style={{ fontSize: 13, color: "var(--muted, #9aa3b5)" }}>{prog.name}{prog.school && prog.school !== prog.name ? ` · ${prog.school}` : ""}</div>
    </div>
    <div style={{ background: "#0d1322", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--tx-c8cfde, #c8cfde)", lineHeight: 1.5 }}>
      <div>📅 Practice and game times and places, with changes flagged</div>
      <div>📢 Announcements the coaches send to families</div>
      <div>🙋 Tell the coaches when {child} will miss something</div>
    </div>

    {signedInAsOther && (
      <>
        <div style={{ ...muted, background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "10px 12px", color: "var(--amber-text, #f0c96a)" }}>
          You're signed in as {userName ?? userEmail}, which isn't a parent account. Parents need their own account. Sign out first, then open this link again.
        </div>
        <button style={btn} disabled={busy} onClick={async () => { setBusy(true); try { await supabase.auth.signOut(); } finally { setBusy(false); } }}>{busy ? "Signing out…" : "Sign out"}</button>
        <button style={linkBtn} onClick={leave}>Back to Winning Wall</button>
      </>
    )}

    {isParent && (
      <>
        <div style={muted}>You're signed in as {userName ?? userEmail}. Add {child} to your account?</div>
        {errBox}
        <button style={btn} disabled={busy} onClick={acceptAsMe}>{busy ? "Working…" : `Add ${child}`}</button>
        <button style={linkBtn} onClick={leave}>Not now</button>
      </>
    )}

    {!userEmail && (
      <>
        <button style={btn} onClick={() => { setErr(null); setStep("setup"); }}>I'm new: make a parent account</button>
        <button style={{ ...btn, background: "transparent", border: `1px solid ${color}`, color: "var(--text, #e8ecf4)" }} onClick={() => setStep("signin")}>I already have a parent account</button>
        <div style={{ ...muted, fontSize: 12, textAlign: "center" }}>A coach approves each parent before they see anything.</div>
      </>
    )}
  </>);
}
