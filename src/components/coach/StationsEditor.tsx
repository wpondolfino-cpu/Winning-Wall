// src/components/coach/StationsEditor.tsx
//
// Two kinds of stations, and the block says which it is.
//
// FIXED — people are assigned to a station and stay there. Bigs at one
// basket, guards at another. Membership lives on the drill.
//
// ROTATING — groups are made once for the block and move between
// stations. Here the split is a property of the STATION, not the people:
// station 2 runs 4v4, so whoever arrives gets halved. You aren't
// assigning people to a 4v4, you're saying this station is one.
//
// The rotation order is generated rather than configured — group i starts
// at station i and everyone shifts along each round, which is how a
// rotation is actually run.
//
// Nothing is saved until Save stations. That's the opposite of the
// grouping editor, which writes as you go, so both dialogs say which they
// are rather than leaving it to be discovered.

import { useState, useEffect } from "react";
import {
  SegmentDrill, PracticeBlock, setStationMembers, clearStationMembers,
  getRotationGroups, setRotationGroups, setBlockStationMode, setDrillSplitRule,
  splitForStation, rotationSchedule, getPracticeDrillLibrary, resolvedSplit, setSplitOverride,
} from "../../lib/practicePlanner";
import { inputStyle } from "../../lib/inputStyle";

interface PlayerLite { id: string; name: string; }
type Rule = "none" | "teams" | "size" | "size_exact";

interface Props {
  block: PracticeBlock;
  drills: SegmentDrill[];
  attendees: PlayerLite[];
  tryoutIds?: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}

export default function StationsEditor({ block, drills, attendees, tryoutIds, onClose, onChanged }: Props) {
  const hasFixedAssignments = drills.some(d => (d.station_member_ids ?? []).length > 0);
  const [mode, setMode] = useState<"fixed" | "rotating">(
    block.station_mode === "fixed" && !hasFixedAssignments ? "rotating" : (block.station_mode ?? "rotating")
  );
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  // fixed: drillId -> member ids
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  // rotating: groups for the whole block, plus a rule per drill
  const [groups, setGroups] = useState<string[][]>([]);
  const [rules, setRules] = useState<Record<string, { rule: Rule; n: number }>>({});
  const [drillTitles, setDrillTitles] = useState<Record<string, string>>({});
  // Which station's splits are expanded, and the staged overrides for all
  // of them. Editing is opt-in: nine sub-splits shown open by default
  // would bury the two controls that matter.
  const [openSplits, setOpenSplits] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Record<string, string[][]>>>({});
  const [splitDrag, setSplitDrag] = useState<{ drillId: string; gi: number; playerId: string } | null>(null);

  useEffect(() => {
    const seed: Record<string, string[]> = {};
    const r: Record<string, { rule: Rule; n: number }> = {};
    const ov: Record<string, Record<string, string[][]>> = {};
    for (const d of drills) {
      seed[d.id] = [...(d.station_member_ids ?? []), ...(d.station_tryout_member_ids ?? [])];
      r[d.id] = { rule: (d.split_rule ?? "none") as Rule, n: d.split_n ?? 2 };
      ov[d.id] = { ...(d.split_overrides ?? {}) };
    }
    setAssigned(seed);
    setRules(r);
    setOverrides(ov);
    getRotationGroups(block.id).then(gs => setGroups(gs.map(g => g.member_ids))).catch(console.error);
    getPracticeDrillLibrary().then(({ drills: lib }) => {
      setDrillTitles(Object.fromEntries(lib.map(l => [l.id, l.title])));
    }).catch(console.error);
  }, [drills, block.id]);

  const nameOf = (id: string) => attendees.find(p => p.id === id)?.name ?? "Unknown";
  // The drill title names the station. A hand-typed sub-label is free
  // text — two drills can easily both say "Station 3" — so it's shown
  // alongside rather than instead of.
  const labelOf = (d: SegmentDrill, i: number) => drillTitles[d.drill_id ?? ""] || d.label?.trim() || `Station ${i + 1}`;
  const subLabelOf = (d: SegmentDrill) => d.label?.trim() || null;

  /* ── fixed ─────────────────────────────────────────────── */
  const placed = new Set(Object.values(assigned).flat());
  const unassigned = attendees.filter(p => !placed.has(p.id));

  function splitEvenlyFixed() {
    const shuffled = [...attendees].sort(() => Math.random() - 0.5);
    const next: Record<string, string[]> = {};
    drills.forEach(d => { next[d.id] = []; });
    shuffled.forEach((p, i) => { next[drills[i % drills.length].id].push(p.id); });
    setAssigned(next);
  }

  function moveFixed(playerId: string, toDrillId: string | null) {
    setAssigned(prev => {
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(prev)) next[k] = v.filter(id => id !== playerId);
      if (toDrillId) next[toDrillId] = [...(next[toDrillId] ?? []), playerId];
      return next;
    });
  }

  /* ── rotating ──────────────────────────────────────────── */
  const inGroups = new Set(groups.flat());
  const ungrouped = attendees.filter(p => !inGroups.has(p.id));

  function makeGroups(count: number) {
    const shuffled = [...attendees].sort(() => Math.random() - 0.5);
    const next: string[][] = Array.from({ length: count }, () => []);
    shuffled.forEach((p, i) => next[i % count].push(p.id));
    setGroups(next);
  }

  function moveRot(playerId: string, toIndex: number | null) {
    setGroups(prev => {
      const next = prev.map(g => g.filter(id => id !== playerId));
      if (toIndex !== null && next[toIndex]) next[toIndex].push(playerId);
      return next;
    });
  }

  /* ── save ──────────────────────────────────────────────── */
  async function save() {
    setBusy(true);
    try {
      await setBlockStationMode(block.id, mode);
      if (mode === "fixed") {
        const { error } = await setStationMembers(drills.map(d => {
          const ids = assigned[d.id] ?? [];
          return {
            drillId: d.id,
            memberIds: ids.filter(id => !tryoutIds?.has(id)),
            tryoutIds: ids.filter(id => tryoutIds?.has(id)),
          };
        }));
        if (error) throw new Error(error);
        await setRotationGroups(block.id, []);
        // A fixed station splits its own people by the same rules, so they
        // have to be saved in this mode too.
        for (const d of drills) {
          const r = rules[d.id] ?? { rule: "none" as Rule, n: 2 };
          await setDrillSplitRule(d.id, r.rule, r.rule === "none" ? null : r.n);
          const mine = overrides[d.id] ?? {};
          const before = d.split_overrides ?? {};
          for (const k of new Set([...Object.keys(mine), ...Object.keys(before)])) {
            if (JSON.stringify(mine[k]) === JSON.stringify(before[k])) continue;
            await setSplitOverride(d.id, Number(k), mine[k] ?? null);
          }
        }
      } else {
        const { error } = await setRotationGroups(block.id, groups.filter(g => g.length > 0));
        if (error) throw new Error(error);
        for (const d of drills) {
          const r = rules[d.id] ?? { rule: "none" as Rule, n: 2 };
          await setDrillSplitRule(d.id, r.rule, r.rule === "none" ? null : r.n);
          const mine = overrides[d.id] ?? {};
          const before = d.split_overrides ?? {};
          const keys = new Set([...Object.keys(mine), ...Object.keys(before)]);
          for (const k of keys) {
            if (JSON.stringify(mine[k]) === JSON.stringify(before[k])) continue;
            await setSplitOverride(d.id, Number(k), mine[k] ?? null);
          }
        }
        await clearStationMembers(drills.map(d => d.id));
      }
      onChanged();
      onClose();
    } catch (e: any) {
      alert("Couldn't save the stations: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const chip = (id: string) => (
    <div key={id} draggable onDragStart={() => setDragId(id)}
      style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 11.5, color: "var(--text)", cursor: "grab", marginBottom: 4 }}>
      {nameOf(id)}
    </div>
  );

  const dropOn = (fn: () => void) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => { fn(); setDragId(null); },
  });

  const tab = (value: "fixed" | "rotating", label: string) => (
    <button onClick={() => setMode(value)}
      style={{
        flex: 1, textAlign: "center", fontSize: 11.5, padding: 7, borderRadius: 6, cursor: "pointer",
        fontFamily: "inherit", border: "none", fontWeight: 600,
        background: mode === value ? "var(--royal)" : "transparent",
        color: mode === value ? "#fff" : "var(--muted)",
      }}>{label}</button>
  );

  /**
   * How each station divides the people who turn up at it.
   *
   * Identical in both modes, because the question is: a rotating station
   * splits whichever group has rotated in, and a fixed station splits the
   * people assigned to it. Only the number of groups differs — several in
   * a rotation, exactly one when it's fixed.
   */
  function splitRules(groupsAtStation: (drill: SegmentDrill) => string[][]) {
    return (
      <>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
          How each station splits {mode === "rotating" ? "whoever\u2019s there" : "the people at it"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
          {drills.map((d, i) => {
            const r = rules[d.id] ?? { rule: "none" as Rule, n: 2 };
            const groupsHere = groupsAtStation(d);
            return (
              <div key={d.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--text)" }}>
                  {labelOf(d, i)}
                  {subLabelOf(d) && <span style={{ color: "var(--muted)", fontSize: 11 }}> \u00b7 {subLabelOf(d)}</span>}
                </span>
                <select value={r.rule} onChange={e => setRules(p => ({ ...p, [d.id]: { ...r, rule: e.target.value as Rule } }))}
                  style={{ ...inputStyle, padding: "5px 8px", fontSize: 11.5 }}>
                  <option value="none">Keep together</option>
                  <option value="teams">Split into \u2026 teams</option>
                  <option value="size">Groups of \u2026 (spare joins a group)</option>
                  <option value="size_exact">Groups of exactly \u2026 (spare waits)</option>
                </select>
                {r.rule !== "none" && (
                  <input inputMode="numeric" value={String(r.n)}
                    onChange={e => {
                      const digits = e.target.value.replace(/[^0-9]/g, "");
                      setRules(p => ({ ...p, [d.id]: { ...r, n: digits === "" ? ("" as any) : parseInt(digits, 10) } }));
                    }}
                    onBlur={() => setRules(p => {
                      const n = Number(p[d.id]?.n);
                      return { ...p, [d.id]: { ...r, n: !n || n < 2 ? 2 : Math.min(n, 20) } };
                    })}
                    style={{ ...inputStyle, width: 56, padding: "5px 8px", fontSize: 11.5, textAlign: "center" }} />
                )}
              </div>
              {r.rule !== "none" && groupsHere.length > 0 && (
                <div style={{ marginLeft: 10, marginBottom: 6 }}>
                  <button onClick={() => setOpenSplits(openSplits === d.id ? null : d.id)}
                    style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 11, cursor: "pointer", padding: "3px 0" }}>
                    {openSplits === d.id ? "\u25be" : "\u25b8"} Who\u2019s on which side
                    {Object.keys(overrides[d.id] ?? {}).length > 0 && (
                      <span style={{ color: "var(--gold)" }}> \u00b7 {Object.keys(overrides[d.id] ?? {}).length} set by hand</span>
                    )}
                  </button>
                  {openSplits === d.id && groupsHere.map((g, gi) => {
                    const staged = { split_rule: r.rule, split_n: r.n, split_overrides: overrides[d.id] ?? {} };
                    const { parts, overridden } = resolvedSplit(staged as any, gi, g);
                    return (
                      <div key={gi} style={{ marginTop: 6, padding: "6px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 7 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>
                            {mode === "rotating" ? `Group ${String.fromCharCode(65 + gi)}` : "At this station"}
                          </span>
                          {overridden && (
                            <button onClick={() => setOverrides(p => {
                              const next = { ...(p[d.id] ?? {}) }; delete next[String(gi)];
                              return { ...p, [d.id]: next };
                            })}
                              style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 10.5, cursor: "pointer", padding: 0 }}>
                              reset to the rule
                            </button>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {parts.map((part, pi) => (
                            <div key={pi}
                              onDragOver={e => e.preventDefault()}
                              onDrop={() => {
                                if (!splitDrag || splitDrag.drillId !== d.id || splitDrag.gi !== gi) return;
                                const moved = parts.map(p2 => p2.filter(id => id !== splitDrag.playerId));
                                moved[pi] = [...moved[pi], splitDrag.playerId];
                                setOverrides(p => ({ ...p, [d.id]: { ...(p[d.id] ?? {}), [String(gi)]: moved.filter(x => x.length > 0) } }));
                                setSplitDrag(null);
                              }}
                              style={{ flex: 1, minWidth: 110, border: "1px dashed var(--border)", borderRadius: 6, padding: 5 }}>
                              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>
                                {r.rule === "teams" ? `Side ${pi + 1}`
                                  : r.rule === "size_exact" && pi === parts.length - 1 && parts[pi].length < r.n
                                    ? "Waiting" : `Group ${pi + 1}`}
                              </div>
                              {part.map(id => (
                                <div key={id} draggable
                                  onDragStart={() => setSplitDrag({ drillId: d.id, gi, playerId: id })}
                                  style={{ fontSize: 11, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "3px 6px", marginBottom: 3, cursor: "grab" }}>
                                  {nameOf(id)}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  const schedule = mode === "rotating" && groups.length > 0
    ? rotationSchedule(groups.length, drills.length) : [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 16, width: "min(900px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 22 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>Stations</div>
          <button onClick={onClose} title="Close without saving"
            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 5, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, marginBottom: 6 }}>
          {tab("rotating", "Groups rotate")}
          {tab("fixed", "Stations are fixed")}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          {mode === "rotating"
            ? "Groups are made once for the block and move between stations. Each station splits whoever arrives by its own rule."
            : "People are assigned to a station and stay there — bigs at one, guards at another."}
          <br /><span style={{ color: "var(--gold)" }}>Nothing is saved until you press Save stations.</span>
        </div>

        {mode === "fixed" ? (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <button onClick={splitEvenlyFixed} style={{ ...inputStyle, background: "var(--royal)", color: "#fff", border: "none", fontWeight: 600 }}>Split evenly</button>
              <button onClick={() => setAssigned(Object.fromEntries(drills.map(d => [d.id, []])))} style={inputStyle}>Clear</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(drills.length, 4)}, minmax(0,1fr))`, gap: 10, marginBottom: 14 }}>
              {drills.map((d, i) => (
                <div key={d.id} {...dropOn(() => dragId && moveFixed(dragId, d.id))}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, minHeight: 130 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{labelOf(d, i)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>{(assigned[d.id] ?? []).length} players</div>
                  {(assigned[d.id] ?? []).map(chip)}
                </div>
              ))}
            </div>
            <div {...dropOn(() => dragId && moveFixed(dragId, null))}
              style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Not at a station ({unassigned.length})</div>
              {unassigned.length === 0
                ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Everyone&rsquo;s placed.</div>
                : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{unassigned.map(p => chip(p.id))}</div>}
            </div>

            <div style={{ marginTop: 14 }}>
              {/* A fixed station has exactly one group to split: the people
                  assigned to it. Same rules, same editor. */}
              {splitRules(d => [assigned[d.id] ?? []])}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
              Rotation groups — one per station, so nobody is idle
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={() => makeGroups(drills.length)} style={{ ...inputStyle, background: "var(--royal)", color: "#fff", border: "none", fontWeight: 600, padding: "7px 12px", fontSize: 12 }}>
                Split into {drills.length} groups
              </button>
              <button onClick={() => setGroups([])} style={{ ...inputStyle, padding: "7px 11px", fontSize: 12 }}>Clear</button>
            </div>

            {groups.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(groups.length, 4)}, minmax(0,1fr))`, gap: 8, marginBottom: 14 }}>
                {groups.map((g, gi) => (
                  <div key={gi} {...dropOn(() => dragId && moveRot(dragId, gi))}
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 9, minHeight: 110 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>Group {String.fromCharCode(65 + gi)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 7 }}>{g.length} players</div>
                    {g.map(chip)}
                  </div>
                ))}
              </div>
            )}

            {ungrouped.length > 0 && (
              <div {...dropOn(() => dragId && moveRot(dragId, null))}
                style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 11, marginBottom: 14 }}>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 7 }}>Not in a group ({ungrouped.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{ungrouped.map(p => chip(p.id))}</div>
              </div>
            )}

            {splitRules(() => groups)}

            {schedule.length > 0 && (
              <div style={{ background: "rgba(44,76,155,0.12)", border: "1px solid rgba(44,76,155,0.4)", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#93b4ff", fontWeight: 600, marginBottom: 4 }}>Rotation order</div>
                <div style={{ fontSize: 11.5, color: "var(--text)", lineHeight: 1.6 }}>
                  {drills.map((d, i) => `${labelOf(d, i)} → ${String.fromCharCode(65 + schedule[0][i])}`).join("  ·  ")}
                  , then everyone moves one station along each round.
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 5 }}>
                  {schedule.length} round{schedule.length === 1 ? "" : "s"}. Every group visits every station once.
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 10, padding: 10, color: "var(--muted)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={save} disabled={busy}
            style={{ flex: 1, background: "var(--gold)", border: "none", borderRadius: 10, padding: 10, color: "#1a1a1a", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Saving…" : "Save stations"}
          </button>
        </div>
      </div>
    </div>
  );
}
