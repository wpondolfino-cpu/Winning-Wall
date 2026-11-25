// src/components/coach/PracticeImportModal.tsx
// "Import / paste" on the practice list.
//   Paste a plan (first): text from Google Docs, Word, Notes... read by
//     lib/practicePaste.ts, checked here, then made into a draft practice.
//   Import from PDF: only PDFs exported from Winning Wall (they carry the
//     plan's data inside). The file pick itself stays in the practice list.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPracticeDrill, createPracticeFromPlan, getPracticeDrillLibrary, type RosterWithCount } from "../../lib/practicePlanner";
import { parsePastedPlan, type PasteRow } from "../../lib/practicePaste";
import { inputStyle } from "../../lib/inputStyle";

interface Props {
  rosters: RosterWithCount[];
  defaultRosterId: string | null;
  onClose: () => void;
  /** A new draft practice was made from a pasted plan. */
  onCreated: (practiceId: string) => void;
  /** Open the file picker for a Winning Wall PDF. */
  onChoosePdf: () => void;
}

const primaryBtn: CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px",
  fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const secondaryBtn: CSSProperties = {
  background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const muted: CSSProperties = { fontSize: 12, color: "var(--muted)", lineHeight: 1.5 };
const warnChip: CSSProperties = { fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 6, background: "rgba(240,192,64,0.15)", color: "var(--gold-text, #f0c040)", whiteSpace: "nowrap" };
const libChip: CSSProperties = { fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 6, background: "rgba(40,180,80,0.15)", color: "var(--success-text, #6fd38a)", whiteSpace: "nowrap" };

/** Library names match ignoring capitals and extra spaces. */
const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
const addable = (t: string) => norm(t).length > 0 && norm(t) !== "—" && norm(t) !== "untitled";

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const clock = (min: number) => {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export default function PracticeImportModal({ rosters, defaultRosterId, onClose, onCreated, onChoosePdf }: Props) {
  const [tab, setTab] = useState<"paste" | "pdf">("paste");
  const [step, setStep] = useState<"text" | "check">("text");
  const [text, setText] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>(defaultRosterId ? [defaultRosterId] : rosters.slice(0, 1).map(r => r.id));
  const [rows, setRows] = useState<PasteRow[]>([]);
  const [date, setDate] = useState(todayIso());
  const [start, setStart] = useState("15:00");
  const [tryout, setTryout] = useState(false);
  const [library, setLibrary] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getPracticeDrillLibrary().then(({ drills }) => {
      const map: Record<string, string> = {};
      for (const d of drills) map[norm(d.title)] = d.id;
      setLibrary(map);
    }).catch(() => {});
  }, []);

  const teams = rosters.filter(r => teamIds.includes(r.id));
  const teamName = (id: string | null) => (id ? rosters.find(r => r.id === id)?.name ?? "Team" : null);
  const libId = (title: string) => library[norm(title)] ?? null;
  // "+ Add to library" ticks, by name (on unless she unticks it).
  const [skipLib, setSkipLib] = useState<Record<string, boolean>>({});
  const wantsLib = (title: string) => addable(title) && !libId(title) && !skipLib[norm(title)];

  function read() {
    setErr(null);
    if (!text.trim()) { setErr("Paste your plan first."); return; }
    if (teams.length === 0) { setErr("Pick at least one team."); return; }
    const plan = parsePastedPlan(text, teams.map(t => ({ id: t.id, name: t.name })));
    if (!plan.rows.some(r => r.startMin !== null)) {
      setErr("Couldn't find any times. Each block needs a line that starts with a time, like \"6:05 - Kings drill\".");
      return;
    }
    setRows(plan.rows);
    if (plan.date) setDate(plan.date);
    if (plan.startTime) setStart(plan.startTime);
    setTryout(plan.isTryout);
    setStep("check");
  }

  const patchRow = (key: string, patch: Partial<PasteRow>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r));
  const patchPart = (key: string, i: number, patch: Partial<PasteRow["parts"][number]>) =>
    setRows(rs => rs.map(r => r.key === key ? { ...r, parts: r.parts.map((p, j) => j === i ? { ...p, ...patch } : p) } : r));

  // Which rows make it in, and when each one starts.
  const included = (r: PasteRow) => (r.minutes ?? 0) > 0;
  const timeline = useMemo(() => {
    let t = toMin(start);
    const at: Record<string, number> = {};
    for (const r of rows) { if (!included(r)) continue; at[r.key] = t; t += r.minutes!; }
    return { at, end: t };
  }, [rows, start]);
  const missingLength = rows.filter(r => r.startMin !== null && !included(r));
  const leftOut = rows.filter(r => r.startMin === null && !included(r));
  const blockCount = rows.filter(included).length;

  async function create() {
    setErr(null);
    if (missingLength.length) { setErr(`Give ${missingLength.map(r => `"${r.parts[0]?.title}"`).join(", ")} a length first.`); return; }
    if (!blockCount) { setErr("There's nothing to make a practice from."); return; }
    if (!date) { setErr("Pick a date."); return; }
    setBusy(true);
    try {
      // New library drills first (name only), so the practice links to them.
      const made: Record<string, string> = {};
      const toAdd = new Map<string, string>();
      for (const r of rows.filter(included)) for (const p of r.parts) if (wantsLib(p.title)) toAdd.set(norm(p.title), p.title.trim().replace(/\s+/g, " "));
      for (const [key, title] of toAdd) {
        const { id: newId, error: libErr } = await createPracticeDrill({ title });
        if (libErr || !newId) throw new Error(`couldn't add "${title}" to the drill library (${libErr ?? "unknown error"})`);
        made[key] = newId;
        setLibrary(m => ({ ...m, [key]: newId }));
      }
      const { id } = await createPracticeFromPlan({
        practice_date: date, start_time: start, roster_ids: teamIds, is_tryout: tryout,
        blocks: rows.filter(included).map(r => ({
          duration_minutes: r.minutes!,
          water_break: r.water,
          parts: r.parts.map(p => {
            const drillId = libId(p.title) ?? made[norm(p.title)] ?? null;
            return {
              roster_id: teamIds.length > 1 ? p.rosterId : null,
              drill_id: drillId,
              label: drillId ? null : (p.title.trim() || "Untitled"),
              goal_text: p.notes.trim() || null,
            };
          }),
        })),
      });
      onCreated(id);
    } catch (e: any) {
      setErr("Couldn't make the practice: " + (e?.message ?? "unknown error"));
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 12px", overflowY: "auto" }}
         onClick={() => !busy && onClose()}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Import or paste a practice"
           style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, width: 680, maxWidth: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--title)", letterSpacing: 1, flex: 1 }}>Import / paste a practice</div>
          <button onClick={onClose} disabled={busy} aria-label="Close" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 4, background: "var(--surface2)", borderRadius: 10, padding: 4, border: "1px solid var(--border)" }}>
          {([["paste", "📋 Paste a plan"], ["pdf", "📥 Import from PDF"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); setErr(null); }}
              style={{ flex: 1, padding: "8px 6px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: tab === k ? "var(--royal)" : "transparent", color: tab === k ? "#fff" : "var(--muted)" }}>{l}</button>
          ))}
        </div>

        {tab === "pdf" && (
          <>
            <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
              This only works with a practice PDF that was <b>exported from Winning Wall</b> (the Export button on a practice). Those PDFs carry the whole plan inside them.
            </div>
            <div style={muted}>A plan written in Google Docs, Word or anywhere else won't import this way, even saved as a PDF. Use <b>Paste a plan</b> for those.</div>
            <div><button style={primaryBtn} onClick={onChoosePdf}>Choose a Winning Wall PDF</button></div>
          </>
        )}

        {tab === "paste" && step === "text" && (
          <>
            <div style={muted}>Copy your plan from your doc and paste it here. Each line that starts with a time ("6:05 - Kings drill") becomes a block, and the lines under it become its notes. You'll check everything before it's saved.</div>
            {rosters.length > 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Teams in this practice</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {rosters.map(r => {
                    const on = teamIds.includes(r.id);
                    return (
                      <button key={r.id} onClick={() => setTeamIds(ids => on ? ids.filter(x => x !== r.id) : [...ids, r.id])}
                        style={{ ...secondaryBtn, padding: "6px 12px", background: on ? "var(--royal)" : "var(--surface2)", color: on ? "#fff" : "var(--muted)", borderColor: on ? "var(--royal)" : "var(--border)" }}>
                        {on ? "✓ " : ""}{r.name}
                      </button>
                    );
                  })}
                </div>
                {teamIds.length > 1 && <span style={muted}>A line under a block that starts with a team's name ("JV - Fundamental work") gives that team its own column.</span>}
              </div>
            )}
            <textarea value={text} onChange={e => setText(e.target.value)} rows={12} aria-label="Practice plan text"
              placeholder={"Tryout 12/2\n6:00 - Circle up\n6:05 - Kings drill\n   - Foot fire\n   - Slide\n6:15 - Fast break\n6:30 - Water"}
              style={{ ...inputStyle, width: "100%", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.5, resize: "vertical" }} />
            {err && <div className="error-msg">{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}><button style={primaryBtn} onClick={read}>Read plan →</button></div>
          </>
        )}

        {tab === "paste" && step === "check" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>Date
                <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>Starts at
                <input type="time" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} /></label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)", paddingTop: 18 }}>
                <input type="checkbox" checked={tryout} onChange={e => setTryout(e.target.checked)} /> Tryout practice</label>
            </div>
            <div style={muted}>
              {blockCount} block{blockCount === 1 ? "" : "s"} · {clock(toMin(start))}–{clock(timeline.end)} · {teams.map(t => t.name).join(" + ")}. Fix anything below, then create. It saves as a draft.
              {" "}Ticked "Add to library" names become drills in your drill library (just the name; add the rest there later). Untick one-offs.
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {rows.map(r => {
                const untimed = r.startMin === null;
                const needsLength = !included(r);
                return (
                  <div key={r.key} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 8px", borderTop: "1px solid var(--border)", background: needsLength ? "rgba(240,192,64,0.07)" : undefined, borderRadius: needsLength ? 8 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", minWidth: 62 }}>{included(r) ? clock(timeline.at[r.key]) : "—"}</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--muted)" }}>
                        <input type="number" min={1} max={240} value={r.minutes ?? ""} placeholder="?" aria-label="Minutes"
                          onChange={e => { const v = parseInt(e.target.value, 10); patchRow(r.key, { minutes: Number.isFinite(v) && v > 0 ? Math.min(v, 240) : null }); }}
                          style={{ ...inputStyle, width: 58, padding: "6px 8px" }} /> min
                      </label>
                      <label title="Water break after this block" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: r.water ? "var(--info-text, #93b4ff)" : "var(--muted)", cursor: "pointer" }}>
                        <input type="checkbox" checked={r.water} onChange={e => patchRow(r.key, { water: e.target.checked })} /> 💧 Water after
                      </label>
                      {untimed && needsLength && <span style={warnChip}>No time: give it minutes or it's left out</span>}
                      {!untimed && needsLength && <span style={warnChip}>Set a length</span>}
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))} aria-label="Remove this block"
                        style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 14, cursor: "pointer" }}>✕</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: r.parts.length > 1 ? "repeat(auto-fit, minmax(220px, 1fr))" : "1fr", gap: 8 }}>
                      {r.parts.map((p, i) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {teams.length > 1 && p.rosterId && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--info-text, #93b4ff)" }}>{teamName(p.rosterId)}</span>}
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input value={p.title} onChange={e => patchPart(r.key, i, { title: e.target.value })} aria-label="Drill name"
                              style={{ ...inputStyle, flex: 1, minWidth: 0, fontWeight: 600 }} />
                            {libId(p.title)
                              ? <span style={libChip} title="Links to this drill in your drill library">In drill library</span>
                              : addable(p.title) && (
                                <label title="Make this a drill in your drill library (name only; add the description, diagram and tags there later)"
                                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", color: wantsLib(p.title) ? "var(--info-text, #93b4ff)" : "var(--muted)" }}>
                                  <input type="checkbox" checked={wantsLib(p.title)} onChange={e => setSkipLib(m => ({ ...m, [norm(p.title)]: !e.target.checked }))} />
                                  Add to library
                                </label>
                              )}
                          </div>
                          <textarea value={p.notes} onChange={e => patchPart(r.key, i, { notes: e.target.value })} aria-label="Notes" placeholder="Notes"
                            rows={Math.min(6, Math.max(1, p.notes.split("\n").length))}
                            style={{ ...inputStyle, width: "100%", fontSize: 12, lineHeight: 1.45, resize: "vertical" }} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {leftOut.length > 0 && <div style={muted}>{leftOut.length} line{leftOut.length === 1 ? "" : "s"} with no time will be left out unless you give {leftOut.length === 1 ? "it" : "them"} minutes.</div>}
            {err && <div className="error-msg">{err}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <button style={secondaryBtn} disabled={busy} onClick={() => { setErr(null); setStep("text"); }}>← Back to text</button>
              <button style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }} disabled={busy} onClick={create}>{busy ? "Creating…" : "Create draft practice"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
