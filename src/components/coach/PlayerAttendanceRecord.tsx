// src/components/coach/PlayerAttendanceRecord.tsx
//
// One player's attendance, a row per season, shown under them in
// Players & coaches.
//
// Counts, not a percentage. The denominator is a judgement — call-ups,
// mid-season joiners, practices nobody took attendance for — and a
// percentage would present that judgement as a fact. Counts let a coach
// do the division themselves, knowing what went into it.
//
// The line about practices still awaiting attendance is the important
// part: without it, a coach who skipped attendance six times sees a
// suspiciously clean record with no way to know why.

import { useState, useEffect } from "react";
import { getPlayerAttendance, SeasonAttendance } from "../../lib/practicePlanner";

export default function PlayerAttendanceRecord({ playerId }: { playerId: string }) {
  const [rows, setRows] = useState<SeasonAttendance[] | null>(null);

  useEffect(() => {
    let alive = true;
    getPlayerAttendance(playerId)
      .then(r => { if (alive) setRows(r); })
      .catch(err => { console.error(err); if (alive) setRows([]); });
    return () => { alive = false; };
  }, [playerId]);

  if (rows === null) {
    return <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading attendance…</div>;
  }
  if (rows.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--muted)" }}>No practices with attendance taken yet.</div>;
  }

  const awaiting = rows.reduce((n, r) => n + r.awaiting, 0);
  const cols = "1.4fr 0.8fr 0.7fr 0.8fr 0.9fr";
  const head: React.CSSProperties = { fontSize: 10.5, color: "var(--muted)", textAlign: "right" };
  const cell: React.CSSProperties = { fontSize: 12.5, textAlign: "right" };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Attendance</div>

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, padding: "0 6px 5px" }}>
        <span style={{ ...head, textAlign: "left" }}>Season</span>
        <span style={head}>Practices</span>
        <span style={head}>Out</span>
        <span style={head}>Excused</span>
        <span style={head}>Unexcused</span>
      </div>

      {rows.map((r, i) => (
        <div key={r.seasonId ?? "none"}
          style={{
            display: "grid", gridTemplateColumns: cols, gap: 6, padding: "7px 6px", borderRadius: 6,
            background: i === 0 ? "rgba(255,255,255,0.03)" : "transparent",
            color: i === 0 ? "var(--text)" : "var(--muted)",
          }}>
          <span style={{ fontSize: 12.5 }}>{r.seasonName}</span>
          <span style={cell}>{r.practices}</span>
          <span style={cell}>{r.absences}</span>
          <span style={{ ...cell, color: r.excused > 0 ? "#5de098" : undefined }}>{r.excused}</span>
          <span style={{ ...cell, color: r.unexcused > 0 ? "#ff7b7b" : undefined }}>{r.unexcused}</span>
        </div>
      ))}

      {rows.some(r => r.unanswered > 0) && (
        <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
          {rows.reduce((n, r) => n + r.unanswered, 0)} absence
          {rows.reduce((n, r) => n + r.unanswered, 0) === 1 ? "" : "s"} not marked excused or unexcused.
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
        Counts only practices where attendance was completed
        {awaiting > 0 && <> — {awaiting} more {awaiting === 1 ? "is" : "are"} still waiting</>}.
      </div>
    </div>
  );
}
