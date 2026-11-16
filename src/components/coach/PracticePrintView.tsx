// src/components/coach/PracticePrintView.tsx
// Renders one or more practices as a clean, printer-friendly sheet and
// hands off to the browser's native print-to-PDF — same approach
// already used for Plays/Playbooks, no new dependencies.

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
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

// A letter page printed with half-inch margins leaves 7.5 x 10 inches.
// The preview lays the schedule out at that width so it can tell when a
// schedule won't fit on one page.
const PAGE_W_IN = 7.5;
const PAGE_H_IN = 10;
const DESC_KEY = "ww.printDrillDescriptions";

export default function PracticePrintView({ practiceIds, onClose }: Props) {
  const [practices, setPractices] = useState<PrintPractice[]>([]);
  const [loading, setLoading] = useState(true);
  // The back page of drill descriptions: on unless turned off (remembered).
  const [withDescriptions, setWithDescriptions] = useState(() => {
    try { return localStorage.getItem(DESC_KEY) !== "off"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem(DESC_KEY, withDescriptions ? "on" : "off"); } catch { /* fine */ } }, [withDescriptions]);

  // Which practices' schedules run past one page (measured in the preview).
  const scheduleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const inchRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState<string[]>([]);
  useLayoutEffect(() => {
    if (loading) return;
    const measure = () => {
      const pxPerIn = inchRef.current?.offsetWidth || 96;
      const limit = PAGE_H_IN * pxPerIn;
      setOverflowing(practices.filter(p => (scheduleRefs.current[p.id]?.scrollHeight ?? 0) > limit + 2).map(p => p.id));
    };
    measure();
    // Fonts can finish loading after the first measure and change heights.
    const t = setTimeout(measure, 400);
    return () => clearTimeout(t);
  }, [loading, practices]);
  const pageLinePx = PAGE_H_IN * (inchRef.current?.offsetWidth || 96);

  useEffect(() => {
    Promise.all(practiceIds.map(id => getPracticePrintData(id))).then(results => {
      setPractices(results.filter((p): p is PrintPractice => !!p));
      setLoading(false);
    });
  }, [practiceIds]);

  // Drawn straight onto the page body (not inside the app) so that when
  // printing, the app can be hidden and the sheet laid out in full: a
  // scrolling overlay would only ever print its first page.
  return createPortal(
    <div className="practice-print-root" style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 2000, overflowY: "auto" }}>
      <style>{`
        @page { size: letter; margin: 0.5in; }
        @media print {
          #root { display: none !important; }
          .practice-print-root { position: static !important; overflow: visible !important; inset: auto !important; height: auto !important; }
          .no-print { display: none !important; }
          .practice-print-page { padding: 0 !important; margin: 0 !important; }
          /* Every page after the very first starts on a new sheet. */
          .practice-print-page.new-sheet { break-before: page; page-break-before: always; }
          body { background: #fff; }
        }
      `}</style>

      <div className="no-print" style={{ position: "sticky", top: 0, background: "#f5f5f5", borderBottom: "1px solid #ddd", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
        <div style={{ fontWeight: 700, color: "#222" }}>Print Preview — {practiceIds.length} practice{practiceIds.length === 1 ? "" : "s"}</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "#333", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={withDescriptions} onChange={e => setWithDescriptions(e.target.checked)} />
            Print drill descriptions on the back
          </label>
          <button onClick={() => window.print()} style={{ background: "#1a3fa8", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontWeight: 600, cursor: "pointer" }}>Print / Save as PDF</button>
          <button onClick={onClose} style={{ background: "#fff", border: "1px solid #999", color: "#222", borderRadius: 8, padding: "8px 18px", fontWeight: 600, cursor: "pointer" }}>Close</button>
        </div>
      </div>

      {/* 1 inch, for measuring pages in this screen's pixels. */}
      <div ref={inchRef} aria-hidden style={{ position: "absolute", visibility: "hidden", width: "1in", height: 0 }} />

      {!loading && withDescriptions && overflowing.length > 0 && (
        <div className="no-print" style={{ maxWidth: `${PAGE_W_IN}in`, margin: "14px auto 0", padding: "10px 14px", borderRadius: 8, background: "#fff6dd", border: "1px solid #e8c25a", color: "#5a4300", fontSize: 13, lineHeight: 1.45 }}>
          ⚠ {overflowing.map(id => { const p = practices.find(x => x.id === id); return p ? formatDate(p.practice_date) : ""; }).join(", ")}{" "}
          {overflowing.length === 1 ? "runs" : "run"} past one page, so the drill descriptions won't land on the back of page 1 when printed two-sided.
          The dashed line shows where page 1 ends. Shortening notes or splitting the practice will bring it back to one page.
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Preparing print view…</div>
      ) : (
        practices.map((p, pi) => (
          <div key={p.id}>
          <div className={`practice-print-page${pi > 0 ? " new-sheet" : ""}`} style={{ width: `${PAGE_W_IN}in`, maxWidth: "100%", margin: "0 auto", padding: "30px 0", color: "#111", fontFamily: "Georgia, serif" }}>
          <div ref={el => { scheduleRefs.current[p.id] = el; }} style={{ position: "relative" }}>
            {overflowing.includes(p.id) && (
              <div className="no-print" style={{ position: "absolute", left: -8, right: -8, top: pageLinePx, borderTop: "2px dashed #d9534f", zIndex: 2, pointerEvents: "none" }}>
                <span style={{ position: "absolute", right: 0, top: 2, fontSize: 11, color: "#d9534f", background: "#fff", padding: "0 4px", fontFamily: "sans-serif" }}>page 1 ends here</span>
              </div>
            )}
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
                  return [...rows.map((row, ri) => (
                    <tr key={`${bi}-${ri}`} style={{ borderBottom: "1px solid #ddd", verticalAlign: "top" }}>
                      {ri === 0 && (
                        <td rowSpan={rows.length} style={{ padding: "6px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {b.start}–{b.end}{b.water_break ? " 💧" : ""}
                        </td>
                      )}
                      <td style={{ padding: "6px 8px" }}>
                        {row.drill.title}{row.drill.film ? " 🎥" : ""}
                        {row.drill.label && <div style={{ fontSize: 10.5, color: "#666" }}>{row.drill.label}</div>}
                        {row.seg.rosterName && <div style={{ fontSize: 10.5, color: "#666" }}>{row.seg.rosterName}</div>}
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "pre-wrap" }}>{row.drill.goal_text ?? "—"}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {row.drill.groups.length === 0 ? "—" : row.drill.groups.map((g, gi) => (
                          <div key={gi} style={{ marginBottom: 4 }}>
                            <span style={{ fontWeight: 700 }}>
                              {g.label}{g.place ? ` · ${g.place}` : ""}{g.coachNames?.length ? ` · Coach ${g.coachNames.join(" & ")}` : ""}:
                            </span> {g.memberNames.join(", ") || "(empty)"}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {/* Coaches by group when the groups have them ("Houle (A)"), otherwise the drill's. */}
                        {row.drill.groups.some(g => g.coachNames?.length)
                          ? row.drill.groups.filter(g => g.coachNames?.length).map(g => `${g.coachNames!.join(" & ")} (${g.label.replace(/^Group /, "")})`).join(", ")
                          : row.drill.coachNames.join(", ") || "—"}
                      </td>
                    </tr>
                  )),
                  // 💧 after the block: a marker only, it takes no minutes.
                  ...(b.water_break ? [(
                    <tr key={`${bi}-water`} style={{ borderBottom: "1px solid #ddd", background: "#eef5fb" }}>
                      <td colSpan={5} style={{ padding: "4px 8px", fontWeight: 700, color: "#1f6fb2" }}>💧 Water break</td>
                    </tr>
                  )] : [])];
                })}
                {p.blocks.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "16px 8px", color: "#888" }}>No drills scheduled yet.</td></tr>
                )}
              </tbody>
            </table>

            {/* Rotating blocks, written out in full. A coach standing at one
                station needs to know who they've got and how they're
                divided, so every round's split is printed by name rather
                than left as a rule to apply. */}
            {p.blocks.filter(b => b.rotation).map((b, bi) => {
              const rot = b.rotation!;
              return (
                <div key={`rot-${bi}`} style={{ marginTop: 14, pageBreakInside: "avoid" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, borderBottom: "1.5px solid #111", paddingBottom: 4, marginBottom: 8 }}>
                    {b.start} – {b.end} · STATIONS — {rot.groups.length} groups rotate
                  </div>

                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginBottom: 10 }}>
                    <thead>
                      <tr style={{ background: "#eee" }}>
                        <th style={{ textAlign: "left", padding: "3px 6px", border: "0.5px solid #bbb" }}>Station</th>
                        {rot.grid.map((_, r) => (
                          <th key={r} style={{ padding: "3px 6px", border: "0.5px solid #bbb" }}>Rd {r + 1}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rot.stations.map((st, si) => (
                        <tr key={si}>
                          <td style={{ padding: "3px 6px", border: "0.5px solid #bbb" }}>{st.title}{st.film ? " 🎥" : ""}</td>
                          {rot.grid.map((row, r) => (
                            <td key={r} style={{ textAlign: "center", padding: "3px 6px", border: "0.5px solid #bbb" }}>
                              {row[si].replace("Group ", "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {rot.stations.map((st, si) => (
                    <div key={si} style={{ marginBottom: 9, pageBreakInside: "avoid" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                        {st.title.toUpperCase()}{st.film ? " 🎥" : ""} — {st.ruleText}
                        {st.coachNames.length > 0 && <> · {st.coachNames.join(", ")}</>}
                      </div>
                      <div style={{ fontSize: 10, lineHeight: 1.7 }}>
                        {st.rounds.map(rd => (
                          <div key={rd.round}>
                            Rd {rd.round} · <b>{rd.groupLabel.replace("Group ", "")}</b> —{" "}
                            {/* Teams play each other, so "vs". Pairs and small
                                groups are parallel, so a divider. Members
                                within a pair join with "+" because a comma
                                reads the same as the divider at a glance. */}
                            {st.ruleText === "keep together"
                              ? rd.parts[0].join(", ")
                              : st.ruleText.startsWith("split into")
                                ? rd.parts.map(part => part.join(", ")).join("  vs  ")
                                : rd.parts.map(part => part.join(part.length <= 2 ? " + " : ", ")).join("   |   ")}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          </div>

          {/* The back page: how each drill runs, for a coach who doesn't know it. */}
          {withDescriptions && p.drillDescriptions.length > 0 && (
            <div className="practice-print-page new-sheet" style={{ width: `${PAGE_W_IN}in`, maxWidth: "100%", margin: "0 auto", padding: "30px 0", color: "#111", fontFamily: "Georgia, serif", borderTop: "1px dashed #ccc" }}>
              <div style={{ borderBottom: "3px solid #111", paddingBottom: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>Drill descriptions</div>
                <div style={{ fontSize: 13, color: "#444" }}>{formatDate(p.practice_date)} · in practice order</div>
              </div>
              {p.drillDescriptions.map((d, i) => (
                <div key={i} style={{ marginBottom: 14, pageBreakInside: "avoid" }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>
                    {d.title}{d.film ? " 🎥" : ""}
                    <span style={{ fontSize: 12, fontWeight: 400, color: "#666" }}> · {d.minutes} min</span>
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 3, whiteSpace: "pre-wrap", color: d.description ? "#111" : "#999", fontStyle: d.description ? "normal" : "italic" }}>
                    {d.description ?? "No description yet. Add one in the Drill Library."}
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        ))
      )}
    </div>,
    document.body
  );
}
