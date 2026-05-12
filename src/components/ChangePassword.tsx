// src/components/ChangePassword.tsx
import { useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  onComplete: () => void;
  title?: string;
  subtitle?: string;
}

export default function ChangePassword({
  onComplete,
  title = "Create Your Password",
  subtitle = "Please create a personal password before continuing.",
}: Props) {
  const [newPass, setNewPass]   = useState("");
  const [confirm, setConfirm]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  async function handleSubmit() {
    setError("");
    if (newPass.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPass !== confirm)  { setError("Passwords do not match."); return; }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPass });
      if (updateError) throw updateError;

      // Mark must_change_password as false so this screen never shows again
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles")
          .update({ must_change_password: false })
          .eq("id", user.id);
      }

      onComplete();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#0a0c14",
      backgroundImage: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(26,63,168,0.35) 0%, transparent 70%)",
    }}>
      <div style={{
        background: "#111828", border: "1px solid rgba(176,184,200,0.15)",
        borderRadius: 20, padding: "40px", width: 380, maxWidth: "94vw",
      }}>
        {/* Logo */}
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "#f5f7fc", textAlign: "center", letterSpacing: 2, marginBottom: 4 }}>
          AHS <span style={{ color: "#f0c040" }}>Winning</span> Wall
        </div>

        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#f5f7fc", marginBottom: 8, marginTop: 20 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "#7a85a0", marginBottom: 28, lineHeight: 1.6 }}>
          {subtitle}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, color: "#7a85a0", marginBottom: 5 }}>New Password</label>
          <input
            type="password"
            value={newPass}
            onChange={e => setNewPass(e.target.value)}
            placeholder="At least 6 characters"
            style={{
              width: "100%", background: "#1a2235", border: "1px solid rgba(176,184,200,0.15)",
              borderRadius: 10, padding: "10px 13px", color: "#e8eaf2", fontSize: 14,
              fontFamily: "inherit", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={{ display: "block", fontSize: 12, color: "#7a85a0", marginBottom: 5 }}>Confirm Password</label>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Type it again"
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            style={{
              width: "100%", background: "#1a2235", border: "1px solid rgba(176,184,200,0.15)",
              borderRadius: 10, padding: "10px 13px", color: "#e8eaf2", fontSize: 14,
              fontFamily: "inherit", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {error && (
          <div style={{
            background: "rgba(220,50,50,0.15)", border: "1px solid rgba(220,50,50,0.3)",
            color: "#ff7b7b", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            width: "100%", background: "#1a3fa8", color: "#fff", border: "none",
            borderRadius: 10, padding: 13, fontSize: 15, fontWeight: 600,
            fontFamily: "inherit", cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving…" : "Set My Password & Continue"}
        </button>
      </div>
    </div>
  );
}
