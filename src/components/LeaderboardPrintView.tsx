// src/components/LeaderboardPrintView.tsx
// A clean, printable copy of the current leaderboard -- for posting on the
// wall. Uses the browser's print dialog (Save as PDF), like the play and
// quiz print views, and the same global print CSS (.no-print, .print-page).

import type { CSSProperties } from "react";
import type { BoardTable } from "../lib/leaderboardExport";

const paper: CSSProperties = { background: "#fff", color: "#111", padding: 24, borderRadius: 12 };
const cell: CSSProperties = { padding: "6px 10px", borderBottom: "1px solid #ddd", fontSize: 13, textAlign: "left" };

export default function LeaderboardPrintView({ table, onBack }: { table: BoardTable; onBack: () => void }) {
  const today = new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  // Rank first on paper; the CSV keeps History's column order.
  const rankAt = table.columns.indexOf("Overall Rank");
  const cols = [table.columns[rankAt], ...table.columns.filter((_, i) => i !== rankAt)];
  const rows = table.rows.map(r => [r[rankAt], ...r.filter((_, i) => i !== rankAt)]);

  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ padding: "8px 14px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer" }}>← Back</button>
        <button onClick={() => window.print()} style={{ padding: "8px 14px", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          🖨️ Print / Save as PDF
        </button>
      </div>

      <div className="print-page" style={paper}>
        <h2 style={{ fontSize: 20, margin: "0 0 4px", color: "#111" }}>{table.title}</h2>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>As of {today}</div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: "#666" }}>No players on the leaderboard yet.</div>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>{cols.map(c => <th key={c} style={{ ...cell, fontWeight: 700, borderBottom: "2px solid #111" }}>{c === "Overall Rank" ? "#" : c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ breakInside: "avoid" }}>
                  {r.map((v, j) => <td key={j} style={{ ...cell, fontWeight: j === 1 ? 600 : 400 }}>{v ?? "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
