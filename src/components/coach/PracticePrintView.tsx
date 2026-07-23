// src/components/coach/PracticePrintView.tsx
// Renders one or more practices as a clean, printer-friendly sheet and
// hands off to the browser's native print-to-PDF — same approach
// already used for Plays/Playbooks, no new dependencies.

import { useState, useEffect } from "react";
import { getPracticePrintData, PrintPractice } from "../../lib/practicePlanner";

interface Props {
  practiceIds: string[];
  onClose: () => void;
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function formatClock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function PracticePrintView({ practiceIds, onClose }: Props) {
  const [practices, setPractices] = useState<PrintPractice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all(practiceIds.map(id => getPracticePrintData(id))).then(results => {
      setPractices(results.filter((p): p is PrintPractice => !!p));
      setLoading(false);
    });
  }, [practiceIds]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 2000, overflowY: "auto" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .practice-print-page { page-break-after: always; }
          .practice-print-page:last-child { page-break-after: auto; }
          body { background: #fff; }
        }
      `}</style>

      <div className="no-print" style={{ position: "sticky", top: 0, background: "#f5f5f5", borderBottom: "1px solid #ddd", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
        <div style={{ fontWeight: 700, color: "#222" }}>Print Preview — {practiceIds.length} practice{practiceIds.length === 1 ? "" : "s"}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => window.print()} style={{ background: "#1a3fa8", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 600, cursor: "pointer" }}>Print / Save as PDF</button>
          <button onClick={onClose} style={{ background: "#e5e5e5", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 600, cursor: "pointer" }}>Close</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Preparing print view…</div>
      ) : (
        practices.map(p => (
          <div key={p.id} className="practice-print-page" style={{ maxWidth: 800, margin: "0 auto", padding: "30px 24px", color: "#111", fontFamily: "Georgia, serif" }}>
            <div style={{ borderBottom: "3px solid #111", paddingBottom: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{formatDate(p.practice_date)}</div>
              <div style={{ fontSize: 14, color: "#444" }}>
                Start: {formatClock(p.start_time)} &nbsp;·&nbsp; {p.rosterNames.join(", ") || "No team set"}
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #111", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", width: "14%" }}>Time</th>
                  <th style={{ padding: "6px 8px", width: "24%" }}>Drill</th>
                  <th style={{ padding: "6px 8px", width: "26%" }}>Notes</th>
                  <th style={{ padding: "6px 8px", width: "22%" }}>Group</th>
                  <th style={{ padding: "6px 8px", width: "14%" }}>Coach</th>
                </tr>
              </thead>
              <tbody>
                {p.blocks.map((b, bi) => {
                  // A block can have multiple segments (team columns) and each
                  // segment can have multiple drills (stations) — flatten to rows,
                  // repeating the time only on the first row of the block.
                  const rows: { seg: typeof b.segments[number]; drill: typeof b.segments[number]["drills"][number] }[] = [];
                  b.segments.forEach(seg => seg.drills.forEach(drill => rows.push({ seg, drill })));
                  return rows.map((row, ri) => (
                    <tr key={`${bi}-${ri}`} style={{ borderBottom: "1px solid #ddd", verticalAlign: "top" }}>
                      {ri === 0 && (
                        <td rowSpan={rows.length} style={{ padding: "6px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {formatClock(b.start)}–{formatClock(b.end)}
                        </td>
                      )}
                      <td style={{ padding: "6px 8px" }}>
                        {row.drill.title}
                        {row.drill.label && <div style={{ fontSize: 10.5, color: "#666" }}>{row.drill.label}</div>}
                        {row.seg.rosterName && <div style={{ fontSize: 10.5, color: "#666" }}>{row.seg.rosterName}</div>}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{row.drill.goal_text ?? "—"}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {row.drill.groups.length === 0 ? "—" : row.drill.groups.map((g, gi) => (
                          <div key={gi} style={{ marginBottom: 4 }}>
                            <span style={{ fontWeight: 700 }}>{g.label}:</span> {g.memberNames.join(", ") || "(empty)"}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{row.drill.coachNames.join(", ") || "—"}</td>
                    </tr>
                  ));
                })}
                {p.blocks.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "16px 8px", color: "#888" }}>No drills scheduled yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
