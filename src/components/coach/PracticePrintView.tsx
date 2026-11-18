// src/components/coach/PracticePrintView.tsx
// Renders one or more practices as a clean, printer-friendly sheet and
// hands off to the browser's native print-to-PDF — same approach
// already used for Plays/Playbooks, no new dependencies.

import { useState, useEffect, useLayoutEffect, useRef, type ReactNode, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { groupLetter, getPracticePrintData, PrintPractice } from "../../lib/practicePlanner";

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

  // ── Shared bits for group cards ─────────────────────────────
  // Each name stays on one line ("Isaiah J." never splits).
  const nameList = (names: string[]) => names.map((nm, i) => (
    <span key={i} style={{ whiteSpace: "nowrap" }}>{nm}{i < names.length - 1 ? ", " : ""}</span>
  ));
  // "Group C" -> "C"; an old "Group 9" -> its letter by position;
  // "At this station" -> no label; anything typed stays as typed.
  const groupTag = (label: string, i: number) => {
    const m = /^Group ([A-Z]{1,2})$/.exec(label);
    if (m) return m[1];
    if (/^Group \d+$/.test(label)) return groupLetter(i);
    if (label === "At this station" || label === "Group") return "";
    return label;
  };
  const isLetter = (t: string) => /^[A-Z]{1,2}$/.test(t);
  // A drill's own label, minus "Station 4" (the row already says 4).
  const extraLabel = (label: string | null | undefined) => label && !/^station\s*\d+$/i.test(label.trim()) ? label : null;
  const cardGrid = (items: { key: string; tag: string; sub?: string; body: ReactNode }[], across: number) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, Math.min(across, items.length))}, minmax(0, 1fr))`, gap: 5 }}>
      {items.map(it => (
        <div key={it.key} style={{ border: "0.5px solid #999", borderRadius: 5, padding: "3px 8px", background: "#fff", fontSize: 10.5, lineHeight: 1.45 }}>
          {it.tag && <b>{it.tag}</b>}
          {it.sub && <span style={{ color: "#555" }}>{it.tag ? " · " : ""}{it.sub}</span>}
          {(it.tag || it.sub) && <>&nbsp;&nbsp;</>}
          {it.body}
        </div>
      ))}
    </div>
  );

  // A rotating block, inside the schedule: one row per station with the
  // group that starts there, then who's in each group. Teams print once
  // with the groups when every station that splits makes the same teams;
  // otherwise each splitting station lists its own teams right under it.
  const rotationRows = (b: PrintPractice["blocks"][number], bi: number) => {
    const rot = b.rotation!;
    const letterOf = (label: string) => label.replace(/^Group /, "");
    const n = rot.stations.length;
    const drills = b.segments[0]?.drills ?? [];
    const splitStations = rot.stations.filter(st => st.ruleText !== "keep together");
    const norm = (parts: string[][]) => JSON.stringify(parts.map(pt => [...pt].sort()).sort());
    const teamsFor = (st: typeof rot.stations[number], groupLabel: string) =>
      st.rounds.find(rd => rd.groupLabel === groupLabel)?.parts ?? [];
    const shared = splitStations.length > 0 && rot.groups.every(g =>
      splitStations.every(st => norm(teamsFor(st, g.label)) === norm(teamsFor(splitStations[0], g.label))));
    const perStation = splitStations.length > 0 && !shared;

    const mins = Math.round(b.duration_minutes / Math.max(1, rot.grid.length));
    const path = n > 1 ? ` (${Array.from({ length: n }, (_, i) => i + 1).join(" → ")} → 1)` : "";
    const waiting = rot.groups.slice(n).map(g => letterOf(g.label));
    const waitText = waiting.length
      ? ` · ${waiting.join(", ")} start${waiting.length === 1 ? "s" : ""} waiting, and after station ${n} you wait your turn`
      : "";
    // Starting letters; a station with no group of its own in round 1 shows a dash.
    const seen = new Set<string>();
    const startAt = (rot.grid[0] ?? []).map(l => { if (seen.has(l)) return null; seen.add(l); return l; });

    const shade = "#f1f1f1";
    const cell = { padding: "5px 8px" } as const;
    const teamLine = (parts: string[][], vs: boolean) => parts.map((part, i) => (
      <span key={i}>
        {i > 0 && (vs
          ? <b style={{ margin: "0 6px", fontSize: 10.5 }}>vs</b>
          : <b style={{ margin: "0 6px", fontSize: 13, fontWeight: 900 }}>┃</b>)}
        {nameList(part)}
      </span>
    ));
    const cards = (items: { letter: string; body: ReactNode }[]) =>
      cardGrid(items.map(it => ({ key: it.letter, tag: it.letter, body: it.body })), 2);
    const isVs = (st: typeof rot.stations[number]) => st.ruleText.startsWith("split into");

    const out: ReactElement[] = [
      <tr key={`${bi}-head`} style={{ borderBottom: "1px solid #999", verticalAlign: "top" }}>
        <td style={{ ...cell, fontWeight: 700, whiteSpace: "nowrap" }}>{b.start}–{b.end}{b.water_break ? " 💧" : ""}</td>
        <td colSpan={4} style={{ ...cell, fontWeight: 700 }}>
          Stations <span style={{ fontWeight: 400, color: "#555" }}>· {mins} min each, move to the next station{path}{waitText}</span>
        </td>
      </tr>,
    ];
    rot.stations.forEach((st, si) => {
      const d = drills[si];
      out.push(
        <tr key={`${bi}-st-${si}`} style={{ borderBottom: "1px solid #ddd", verticalAlign: "top", background: shade }}>
          <td style={{ ...cell, paddingLeft: 18, color: "#555" }}>{si + 1}</td>
          <td style={cell}>
            {st.title}{st.film ? " 🎥" : ""}
            {extraLabel(d?.label) && <div style={{ fontSize: 10.5, color: "#666" }}>{extraLabel(d?.label)}</div>}
            {st.ruleText !== "keep together" && <div style={{ fontSize: 10.5, color: "#666" }}>{st.ruleText}</div>}
          </td>
          <td style={{ ...cell, whiteSpace: "pre-wrap" }}>{d?.goal_text ?? "—"}</td>
          <td style={cell}>
            {startAt[si]
              ? <span style={{ display: "inline-block", minWidth: 18, textAlign: "center", fontWeight: 700, border: "1px solid #333", borderRadius: 4, padding: "0 4px" }}>{startAt[si]}</span>
              : "—"}
          </td>
          <td style={cell}>{st.coachNames.length ? nameList(st.coachNames) : "—"}</td>
        </tr>
      );
      if (perStation && st.ruleText !== "keep together") {
        out.push(
          <tr key={`${bi}-tm-${si}`} style={{ borderBottom: "1px solid #ddd", background: shade }}>
            <td colSpan={5} style={{ padding: "1px 8px 7px 18px" }}>
              {cards(rot.groups.map(g => ({ letter: letterOf(g.label), body: teamLine(teamsFor(st, g.label), isVs(st)) })))}
            </td>
          </tr>
        );
      }
    });
    if (!perStation) {
      const note = shared
        ? `Teams ┃ same at ${splitStations.length === n ? "every station" : splitStations.map(st => st.title).join(" and ")}`
        : null;
      out.push(
        <tr key={`${bi}-groups`} style={{ borderBottom: "1.5px solid #999", background: shade }}>
          <td colSpan={5} style={{ padding: "4px 8px 7px 18px" }}>
            {note && <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>{note}</div>}
            {cards(rot.groups.map(g => ({
              letter: letterOf(g.label),
              body: shared ? teamLine(teamsFor(splitStations[0], g.label), isVs(splitStations[0])) : (g.memberNames.length ? nameList(g.memberNames) : "(empty)"),
            })))}
          </td>
        </tr>
      );
    }
    return out;
  };

  // Drawn straight onto the page body (not inside the app) so that when
  // printing, the app can be hidden and the sheet laid out in full: a
  // scrolling overlay would only ever print its first page.
  return createPortal(
    <div className="practice-print-root" style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 2000, overflowY: "auto" }}>
      <style>{`
        @page { size: letter; margin: 0.5in; }
        .practice-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
                  <th style={{ padding: "6px 8px", width: "13%" }}>Time</th>
                  <th style={{ padding: "6px 8px", width: "27%" }}>Drill</th>
                  <th style={{ padding: "6px 8px", width: "43%" }}>Notes</th>
                  {/* Starting letters only; the groups print under each drill. */}
                  <th style={{ padding: "6px 4px", width: "5%" }}></th>
                  <th style={{ padding: "6px 8px", width: "12%" }}>Coach</th>
                </tr>
              </thead>
              <tbody>
                {p.blocks.map((b, bi) => {
                  // A block can have multiple segments (team columns) and each
                  // segment can have multiple drills (stations) — flatten to rows,
                  // repeating the time only on the first row of the block.
                  const rows: { seg: typeof b.segments[number]; drill: typeof b.segments[number]["drills"][number] }[] = [];
                  b.segments.forEach(seg => seg.drills.forEach(drill => rows.push({ seg, drill })));
                  const waterRow = b.water_break ? [(
                    <tr key={`${bi}-water`} style={{ borderBottom: "1px solid #ddd", background: "#eef5fb" }}>
                      <td colSpan={5} style={{ padding: "4px 8px", fontWeight: 700, color: "#1f6fb2" }}>💧 Water break</td>
                    </tr>
                  )] : [];
                  if (b.rotation) return [...rotationRows(b, bi), ...waterRow];
                  return [...rows.flatMap((row, ri) => {
                    const gs = row.drill.groups.map((g, gi) => ({ ...g, tag: groupTag(g.label, gi) }));
                    const letters = gs.map(g => g.tag).filter(isLetter);
                    const letterCell = letters.length === 0 ? "" : letters.length === 1 ? letters[0] : `${letters[0]}–${letters[letters.length - 1]}`;
                    const last = ri === rows.length - 1;
                    const line = last ? "1.5px solid #999" : "1px solid #ddd";
                    const out = [
                      <tr key={`${bi}-${ri}`} style={{ borderBottom: gs.length ? "none" : line, verticalAlign: "top" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          {ri === 0 ? <>{b.start}–{b.end}{b.water_break ? " 💧" : ""}</> : null}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          {row.drill.title}{row.drill.film ? " 🎥" : ""}
                          {extraLabel(row.drill.label) && <div style={{ fontSize: 10.5, color: "#666" }}>{extraLabel(row.drill.label)}</div>}
                          {row.seg.rosterName && <div style={{ fontSize: 10.5, color: "#666" }}>{row.seg.rosterName}</div>}
                        </td>
                        <td style={{ padding: "6px 8px", whiteSpace: "pre-wrap" }}>{row.drill.goal_text ?? "—"}</td>
                        <td style={{ padding: "6px 4px", color: "#555", whiteSpace: "nowrap" }}>{letterCell}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {/* Coaches by group when the groups have them ("Houle (A)"), otherwise the drill's. */}
                          {gs.some(g => g.coachNames?.length)
                            ? gs.filter(g => g.coachNames?.length).map(g => `${g.coachNames!.join(" & ")}${g.tag ? ` (${g.tag})` : ""}`).join(", ")
                            : row.drill.coachNames.length ? nameList(row.drill.coachNames) : "—"}
                        </td>
                      </tr>,
                    ];
                    if (gs.length) out.push(
                      <tr key={`${bi}-${ri}-groups`} style={{ borderBottom: line }}>
                        <td colSpan={5} style={{ padding: "0 8px 7px 18px" }}>
                          {cardGrid(gs.map((g, gi) => ({
                            key: String(gi),
                            tag: g.tag,
                            sub: [g.place, g.coachNames?.length ? `Coach ${g.coachNames.join(" & ")}` : ""].filter(Boolean).join(" · ") || undefined,
                            body: g.memberNames.length ? nameList(g.memberNames) : "(empty)",
                          })), 3)}
                        </td>
                      </tr>
                    );
                    return out;
                  }),
                  // 💧 after the block: a marker only, it takes no minutes.
                  ...waterRow];
                })}
                {p.blocks.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "16px 8px", color: "#888" }}>No drills scheduled yet.</td></tr>
                )}
              </tbody>
            </table>

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
