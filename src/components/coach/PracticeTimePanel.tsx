// src/components/coach/PracticeTimePanel.tsx
//
// Where practice time actually went, by drill category.
//
// The bar is a background fill behind each row rather than a separate
// chart, so one layout works everywhere: on a phone it's a readable
// sorted list, on a desktop the bars have room to carry the comparison.
// Nothing to switch between and nothing that only works at one width.
//
// Deliberately not a pie or a stacked bar. The question is "did shooting
// get enough time", which is a comparison between rows — and a sorted
// list with proportional weight answers that better than a shape you have
// to decode.

import { useState, useEffect } from "react";
import { getPracticeTimeReport, PracticeTimeReport, Season } from "../../lib/practicePlanner";

export default function PracticeTimePanel({ seasons, selectedSeasonId }: {
  seasons: Season[];
  selectedSeasonId: string | null;
}) {
  const [scope, setScope] = useState<"season" | "all">("season");
  const [report, setReport] = useState<PracticeTimeReport | null>(null);
  const [open, setOpen] = useState(false);

  const seasonName = seasons.find(s => s.id === selectedSeasonId)?.name ?? "this season";

  useEffect(() => {
    if (!open) return;
    setReport(null);
    getPracticeTimeReport(scope === "all" ? null : selectedSeasonId)
      .then(setReport)
      .catch(err => { console.error(err); setReport({ totalMinutes: 0, practiceCount: 0, rows: [] }); });
  }, [open, scope, selectedSeasonId]);

  const hours = (m: number) => m >= 120 ? `${Math.round(m / 60)} hr` : `${m} min`;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--gold)", letterSpacing: 0.4 }}>
          {open ? "▾" : "▸"} Where the time went
        </span>
        {report && open && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {report.practiceCount} practice{report.practiceCount === 1 ? "" : "s"} · {hours(report.totalMinutes)}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ display: "flex", gap: 5, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, margin: "10px 0 6px" }}>
            {(["season", "all"] as const).map(v => (
              <button key={v} onClick={() => setScope(v)}
                style={{
                  flex: 1, textAlign: "center", fontSize: 11.5, padding: 6, borderRadius: 6, cursor: "pointer",
                  fontFamily: "inherit", border: "none", fontWeight: 600,
                  background: scope === v ? "var(--royal)" : "transparent",
                  color: scope === v ? "#fff" : "var(--muted)",
                }}>
                {v === "season" ? seasonName : "All time"}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Clock minutes from published practices — a 5-minute block of three stations counts as 5.
          </div>

          {report === null && <div style={{ fontSize: 12, color: "var(--muted)" }}>Adding it up…</div>}
          {report?.rows.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              No published practices {scope === "all" ? "yet" : `in ${seasonName}`}.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {report?.rows.map(r => {
              const pct = report.totalMinutes ? (r.minutes / report.totalMinutes) * 100 : 0;
              const uncategorised = r.category === null;
              return (
                <div key={r.category ?? "__none"} style={{ position: "relative", padding: "8px 10px", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{
                    position: "absolute", inset: 0, width: `${Math.max(pct, 2)}%`, borderRadius: 6,
                    background: uncategorised ? "rgba(255,107,107,0.12)" : `rgba(240,192,64,${0.06 + (pct / 100) * 0.12})`,
                  }} />
                  <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                    <span style={{ color: uncategorised ? "#ff9b9b" : "var(--text)" }}>
                      {r.category ?? "Uncategorised"}
                    </span>
                    <span style={{ color: uncategorised ? "#ff9b9b" : "var(--text)", whiteSpace: "nowrap" }}>
                      {r.minutes} min
                      <span style={{ color: uncategorised ? "#c47a7a" : "var(--muted)", fontSize: 11 }}>
                        {" · "}{Math.round(pct)}%
                        {uncategorised ? " · tag these drills" : ` · ${r.practiceCount} practice${r.practiceCount === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
