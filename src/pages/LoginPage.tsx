// src/pages/LoginPage.tsx
import { useState } from "react";
import { supabase, signIn, signUp } from "../lib/supabase";

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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(""); setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        await signUp(email, password, {
          name,
          role,
          position: role === "player" ? position : undefined,
          jersey: role === "player" && jersey ? parseInt(jersey) : undefined,
        });
      }
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="app-logo">AHS <span>Winning</span> Wall</div>
        <div className="logo-sub">Offseason Training Platform</div>

        {/* Player / Coach role selector */}
        <div className="role-tabs">
          <div className={`role-tab ${role === "player" ? "active" : ""}`} onClick={() => setRole("player")}>Player</div>
          <div className={`role-tab ${role === "coach" ? "active" : ""}`} onClick={() => setRole("coach")}>Coach</div>
        </div>

        {/* Sign in / Sign up toggle */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <button className={`tab-btn ${mode === "signin" ? "active" : ""}`} onClick={() => setMode("signin")}>Sign In</button>
          <button className={`tab-btn ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")}>Create Account</button>
        </div>

        {mode === "signup" && (
          <>
            <div className="form-group">
              <label>Full Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marcus Johnson" />
            </div>
            {role === "player" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label>Position</label>
                  <select value={position} onChange={e => setPosition(e.target.value)}>
                    {["PG","SG","SF","PF","C"].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Jersey #</label>
                  <input type="number" value={jersey} onChange={e => setJersey(e.target.value)} placeholder="4" />
                </div>
              </div>
            )}
          </>
        )}

        <div className="form-group">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
        </div>

        {error && <div className="error-msg">{error}</div>}
        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? "Loading…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
      </div>
    </div>
  );
}
