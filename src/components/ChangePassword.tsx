// src/components/ChangePassword.tsx
import { useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  onComplete: () => void;
}

export default function ChangePassword({ onComplete }: Props) {
  const [newPass, setNewPass]     = useState("");
  const [confirm, setConfirm]     = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  async function handleSubmit() {
    setError("");
    if (newPass.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPass !== confirm)  { setError("Passwords do not match."); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;
      // Mark password as changed so we don't show this screen again
      await supabase.from("profiles").update({ must_change_password: false })
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");
      onComplete();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "var(--black)",
      backgroundImage: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(26,63,168,0.35) 0%, transparent 70%)",
    }}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 20, padding: "40px", width: 360,
      }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: "var(--white)", marginBottom: 6 }}>
          Welcome! 🏀
        </div>
        <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 28, lineHeight: 1.6 }}>
          Your account was set up by a coach or admin. Please create your own personal password before continuing.
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>New Password</label>
          <input
            type="password" value={newPass}
            onChange={e => setNewPass(e.target.value)}
            placeholder="At least 6 characters"
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 13px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>Confirm Password</label>
          <input
            type="password" value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Type it again"
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 13px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }}
          />
        </div>

        {error && (
          <div style={{ background: "rgba(220,50,50,0.15)", border: "1px solid rgba(220,50,50,0.3)", color: "#ff7b7b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit} disabled={saving}
          style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10, padding: 13, fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
        >
          {saving ? "Saving…" : "Set My Password"}
        </button>
      </div>
    </div>
  );
}
