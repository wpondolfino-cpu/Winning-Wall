// src/components/ViewAsBanner.tsx
// Gold bar across the top while viewing as a test account (approved
// design: option B). Return puts you back in your own account.
// In the platform admin's sandbox (migration 198) the bar is always there,
// viewing as someone or not, so it's never mistaken for a real program.

import { useState } from "react";
import { currentViewAs, returnFromViewAs } from "../lib/viewAs";

export default function ViewAsBanner({ userId, inSandbox = false }: { userId: string; inSandbox?: boolean }) {
  const [leaving, setLeaving] = useState(false);
  const m = currentViewAs(userId);
  if (!m && inSandbox) {
    return (
      <div role="status" style={{
        background: "#f0c040", color: "#14110a", padding: "8px 14px",
        display: "flex", alignItems: "center", gap: 10, flexShrink: 0, minHeight: 56, boxSizing: "border-box",
      }}>
        <span style={{ fontSize: 18 }} aria-hidden="true">🧪</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Sandbox</span>
          <span style={{ fontSize: 11, color: "#3d3418" }}>Nothing here reaches a real program. Switch programs (top right) to leave.</span>
        </div>
      </div>
    );
  }
  if (!m) return null;

  return (
    <div role="status" style={{
      background: "#f0c040", color: "#14110a", padding: "8px 8px 8px 14px",
      display: "flex", alignItems: "center", gap: 10, flexShrink: 0, minHeight: 56, boxSizing: "border-box",
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14110a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Viewing as {m.testName}</span>
        <span style={{ fontSize: 11, color: "#3d3418", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {inSandbox ? "🧪 Sandbox · nothing here reaches a real program" : `${m.programName} · actions are real`}
        </span>
      </div>
      <button
        onClick={async () => { setLeaving(true); await returnFromViewAs(); }}
        disabled={leaving}
        style={{
          height: 40, padding: "0 14px", background: "transparent", color: "#14110a",
          border: "2.5px solid #14110a", borderRadius: 20, fontFamily: "inherit", fontSize: 14, fontWeight: 700,
          cursor: leaving ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#14110a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        {leaving ? "Returning…" : "Return"}
      </button>
    </div>
  );
}
