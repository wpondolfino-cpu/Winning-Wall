// src/components/DownloadProgramDataButton.tsx
// "⬇️ Download program data" -- one Excel file, a tab per area
// (migration 195). Platform admin only, on a program's Manage page.

import { CSSProperties, useState } from "react";
import { downloadProgramData } from "../lib/exportData";

export default function DownloadProgramDataButton({ programId, style }: { programId?: string | null; style?: CSSProperties }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    setBusy(true); setMsg(null);
    try {
      const r = await downloadProgramData(programId);
      setMsg({ ok: true, text: `Downloaded ${r.program}: ${r.tabs} tabs, ${r.rows.toLocaleString()} rows.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Couldn't download the data." });
    }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <button onClick={go} disabled={busy} style={{
        background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
        padding: "10px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: busy ? "default" : "pointer",
        ...style,
      }}>{busy ? "Preparing…" : "⬇️ Download program data"}</button>
      {msg && <span role="status" style={{ fontSize: 12, color: msg.ok ? "#5de098" : "#ff8a8a" }}>{msg.text}</span>}
    </div>
  );
}
