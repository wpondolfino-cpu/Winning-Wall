// src/pages/LoginPage.tsx
import { useState } from "react";
import { signIn, signUp, GRADE_CATEGORIES, GradeCategory } from "../lib/supabase";
import { supabase } from "../lib/supabase";

type Mode = "signin" | "signup" | "forgot";
type Role = "player" | "coach";

export default function LoginPage() {
  const [mode, setMode]           = useState<Mode>("signin");
  const [submitted, setSubmitted] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [role, setRole]           = useState<Role>("player");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [name, setName]           = useState("");
  const [gradeCategory, setGradeCategory] = useState<GradeCategory>(GRADE_CATEGORIES[0]);
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit() {
    setError("");
    if (!email.trim())    { setError("Please enter your email."); return; }
    if (mode !== "forgot" && !password.trim()) { setError("Please enter your password."); return; }
    if (mode === "signup" && !name.trim()) { setError("Please enter your name."); return; }
    if (mode !== "forgot" && password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else if (mode === "forgot") {
        if (!name.trim()) { setError("Please enter your name."); setLoading(false); return; }
        // Look up player profile by email
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, name")
          .eq("email", email)
          .single();
        // Insert reset request (even if profile not found, to avoid leaking info)
        await supabase.from("password_reset_requests").insert({
          player_id: profile?.id ?? null,
          name: name.trim(),
          email: email.trim(),
          status: "pending",
        });
        setResetSent(true);
        return;
      } else {
        await signUp(email, password, {
          name,
          role,
          grade_category: role === "player" ? gradeCategory : undefined,
        });
        setSubmitted(true);
        return;
      }
    } catch (e: any) {
      setError(e.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Pending approval screen ──
  if (submitted) {
    return (
      <div className="login-screen">
        <div className="login-box" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <div className="app-logo" style={{ fontSize: 24 }}>Account Submitted!</div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 12, lineHeight: 1.7 }}>
            Your {role} account request has been submitted.
            {role === "coach"
              ? " An admin will review and approve your account."
              : " A coach or admin will review and approve your account."}
            <br/><br/>You'll be able to sign in once approved.
          </div>
          <button onClick={() => { setSubmitted(false); setMode("signin"); }}
            style={{ marginTop: 20, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  // ── Reset email sent screen ──
  if (resetSent) {
    return (
      <div className="login-screen">
        <div className="login-box" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <div className="app-logo" style={{ fontSize: 24 }}>Request Sent!</div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 12, lineHeight: 1.7 }}>
            Your request has been sent to an admin.
            <br/><br/>Once they reset your password, you'll be able to sign in with the temporary password <strong style={{ color: "var(--text)" }}>Bombardiers1!</strong> — then you'll be prompted to create your own.
          </div>
          <button onClick={() => { setResetSent(false); setMode("signin"); setEmail(""); }}
            style={{ marginTop: 20, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  // ── Forgot password screen ──
  if (mode === "forgot") {
    return (
      <div className="login-screen">
        <div className="login-box">
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <img src="/logo.png" alt="Attleboro Blue Bombardiers" style={{ height: 90, objectFit: "contain" }} />
          </div>
          <div className="app-logo" style={{ fontSize: 28 }}>Winning <span>Wall</span></div>
          <div className="logo-sub">Forgot your password?</div>

          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, lineHeight: 1.6 }}>
            Enter your name and email and an admin will reset your password to a temporary one you can use to sign in.
          </div>

          <div className="form-group">
            <label>Your Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Marcus Johnson"
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
            />
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button className="btn-primary" onClick={handleSubmit} disabled={loading} style={{ width: "100%" }}>
            {loading ? "Sending…" : "Send Request to Admin"}
          </button>

          <button onClick={() => { setMode("signin"); setError(""); }}
            style={{ width: "100%", marginTop: 10, background: "transparent", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: "6px" }}>
            ← Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  // ── Main sign in / sign up screen ──
  return (
    <div className="login-screen">
      <div className="login-box">
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <img src="/logo.png" alt="Attleboro Blue Bombardiers" style={{ height: 90, objectFit: "contain" }} />
        </div>
        <div className="app-logo" style={{ fontSize: 28 }}>Winning <span>Wall</span></div>
        <div className="logo-sub">Attleboro Blue Bombardiers · Offseason Training</div>

        {/* Player / Coach tabs */}
        <div className="role-tabs">
          <div className={`role-tab ${role === "player" ? "active" : ""}`} onClick={() => setRole("player")}>Player</div>
          <div className={`role-tab ${role === "coach" ? "active" : ""}`} onClick={() => setRole("coach")}>Coach</div>
        </div>

        {/* Sign In / Create Account toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => setMode("signin")} style={{
            flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border)",
            background: mode === "signin" ? "var(--royal)" : "var(--surface2)",
            color: mode === "signin" ? "#fff" : "var(--muted)",
            fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}>Sign In</button>
          <button onClick={() => setMode("signup")} style={{
            flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border)",
            background: mode === "signup" ? "var(--royal)" : "var(--surface2)",
            color: mode === "signup" ? "#fff" : "var(--muted)",
            fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}>Create Account</button>
        </div>

        {/* Sign up extra fields */}
        {mode === "signup" && (
          <>
            <div className="form-group">
              <label>Full Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marcus Johnson" />
            </div>
            {role === "player" && (
              <div className="form-group">
                <label>Grade / Level</label>
                <select value={gradeCategory} onChange={e => setGradeCategory(e.target.value as GradeCategory)}>
                  {GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
          </>
        )}

        <div className="form-group">
          <label>Email</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" onKeyDown={e => e.key === "Enter" && handleSubmit()}
          />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••" onKeyDown={e => e.key === "Enter" && handleSubmit()}
          />
        </div>

        {/* Forgot password link — only on sign in */}
        {mode === "signin" && (
          <div style={{ textAlign: "right", marginTop: -10, marginBottom: 12 }}>
            <button onClick={() => { setMode("forgot"); setError(""); }} style={{
              background: "none", border: "none", color: "var(--muted)", fontSize: 12,
              cursor: "pointer", fontFamily: "inherit", padding: 0,
            }}>Forgot password?</button>
          </div>
        )}

        {/* Remember me — only on sign in */}
        {mode === "signin" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer", marginBottom: 12 }}>
            <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--royal)", cursor: "pointer" }} />
            Remember me
          </label>
        )}

        {error && <div className="error-msg">{error}</div>}

        <button className="btn-primary" onClick={handleSubmit} disabled={loading} style={{ width: "100%" }}>
          {loading ? "Loading…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
      </div>
    </div>
  );
}
