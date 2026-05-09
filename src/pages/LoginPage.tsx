// src/pages/LoginPage.tsx
import { useState } from "react";
import { signIn, signUp, GRADE_CATEGORIES, GradeCategory } from "../lib/supabase";

type Mode = "signin" | "signup";
type Role = "player" | "coach";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [role, setRole] = useState<Role>("player");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("PG");
  const [jersey, setJersey] = useState("");
  const [gradeCategory, setGradeCategory] = useState<GradeCategory>(GRADE_CATEGORIES[0]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        if (!name.trim()) { setError("Please enter your name."); setLoading(false); return; }
        await signUp(email, password, {
          name,
          role,
          position: role === "player" ? position : undefined,
          jersey: role === "player" && jersey ? parseInt(jersey) : undefined,
          grade_category: role === "player" ? gradeCategory : undefined,
        });
      }
    } catch (e: any) {
      setError(e.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="app-logo">AHS <span>Winning</span> Wall</div>
        <div className="logo-sub">Offseason Training Platform</div>

        {/* Player / Coach tabs */}
        <div className="role-tabs">
          <div
            className={`role-tab ${role === "player" ? "active" : ""}`}
            onClick={() => setRole("player")}
          >Player</div>
          <div
            className={`role-tab ${role === "coach" ? "active" : ""}`}
            onClick={() => setRole("coach")}
          >Coach</div>
        </div>

        {/* Sign in / Sign up toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button
            onClick={() => setMode("signin")}
            style={{
              flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border)",
              background: mode === "signin" ? "var(--royal)" : "var(--surface2)",
              color: mode === "signin" ? "#fff" : "var(--muted)",
              fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >Sign In</button>
          <button
            onClick={() => setMode("signup")}
            style={{
              flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border)",
              background: mode === "signup" ? "var(--royal)" : "var(--surface2)",
              color: mode === "signup" ? "#fff" : "var(--muted)",
              fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >Create Account</button>
        </div>

        {/* Sign up extra fields */}
        {mode === "signup" && (
          <>
            <div className="form-group">
              <label>Full Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Marcus Johnson"
              />
            </div>

            {role === "player" && (
              <>
                {/* Grade category dropdown */}
                <div className="form-group">
                  <label>Grade / Level</label>
                  <select
                    value={gradeCategory}
                    onChange={e => setGradeCategory(e.target.value as GradeCategory)}
                  >
                    {GRADE_CATEGORIES.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

            
              </>
            )}
          </>
        )}

        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && <div className="error-msg">{error}</div>}

        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? "Loading…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
      </div>
    </div>
  );
}
