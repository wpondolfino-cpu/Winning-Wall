// src/components/coach/SendNotificationPanel.tsx
import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function SendNotificationPanel() {
  const [title, setTitle]     = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState("");

  async function send() {
    if (!title.trim() || !message.trim()) return;
    setSending(true);
    setResult("");
    try {
      const { error } = await supabase.functions.invoke("send-push", {
        body: { title: title.trim(), message: message.trim(), allPlayers: true },
      });
      if (error) throw error;
      setResult("✅ Sent!");
      setTitle(""); setMessage("");
    } catch (e: any) {
      setResult("❌ Failed to send: " + (e?.message ?? "unknown error"));
    } finally {
      setSending(false);
      setTimeout(() => setResult(""), 4000);
    }
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#93b4ff", letterSpacing: 1 }}>🔔 Send Push Notification</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>One-off blast to every player who has notifications enabled</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (e.g. 🏀 Reminder)" maxLength={65}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
        <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Message" rows={2}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={send} disabled={sending || !title.trim() || !message.trim()}
            style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            {sending ? "Sending…" : "🔔 Send to All Players"}
          </button>
          {result && <span style={{ fontSize: 12, color: result.startsWith("✅") ? "#5de098" : "#ff7b7b" }}>{result}</span>}
        </div>
      </div>
    </div>
  );
}
