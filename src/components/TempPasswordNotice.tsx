// src/components/TempPasswordNotice.tsx
//
// Shown once after a password reset: the one-time temporary password for
// the coach to pass on. It isn't stored anywhere, so this is the only
// place it appears.

import { useState } from "react";

export default function TempPasswordNotice({ name, password, onClose }: { name: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked: the password is on screen to copy by hand */ }
  }
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="log-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: "92%" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", letterSpacing: 1, marginBottom: 6 }}>
          Password reset
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          Give {name} this temporary password. They'll set their own when they sign in.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: 0.5, userSelect: "all", fontFamily: "monospace" }}>
            {password}
          </div>
          <button type="button" onClick={copy}
            style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
          This is the only time it's shown. If it's lost, reset again.
        </div>
        <button type="button" onClick={onClose}
          style={{ marginTop: 16, width: "100%", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          Done
        </button>
      </div>
    </div>
  );
}
