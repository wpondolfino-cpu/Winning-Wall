// src/components/coach/GroupingEditor.tsx
// Manages the groups for one segment_drill. "Generate" replaces
// whatever's there with a fresh balanced split; dragging a player
// chip between groups (or the bench) is a manual override that never
// gets undone by regenerating unless you hit Generate again. Loading a
// saved grouping (e.g. "Varsity Starters") SNAPSHOTS its current
// members in — editing the saved grouping later never changes this.

import { useState, useEffect, useCallback } from "react";
import {
  SavedGrouping, SegmentDrillGroup, SegmentDrill, getSegmentDrillGroups,
  generateBalancedGroups, saveGeneratedGroups, assignSavedArrangementToSegmentDrill, createSavedArrangement,
  getSavedGroupingArrangement, deleteSavedGrouping, clearSegmentDrillGroups,
  movePlayerBetweenGroups, removeGroupMember, addGroupMember, updateSegmentDrill,
} from "../../lib/practicePlanner";

interface PlayerLite { id: string; name: string; home_roster_id: string | null; }

interface Props {
  drill: SegmentDrill;
  attendees: PlayerLite[];       // effective attendees available to this segment
  // On a tryout practice the parent supplies pool names here in PlayerLite
  // shape, and lists their ids below. Keeping them in one flat list means
  // none of the drag-and-drop or naming logic needs to know the difference
  // — only the writes do, because they go to a different column.
  tryoutIds?: Set<string>;
  excusedIds: Set<string>;       // excused for this practice — drives the yellow flag
  rosterId: string | null;       // where a newly saved arrangement is filed
  onGroupingsChanged?: () => void; // the saved list changed — parent refetches
  savedGroupings: SavedGrouping[]; // relevant to the roster(s) in this segment
  onClose: () => void;
  onChanged: () => void;
}

export default function GroupingEditor({ drill, attendees, excusedIds, rosterId, tryoutIds, savedGroupings, onGroupingsChanged, onClose, onChanged }: Props) {
  const [groups, setGroups]     = useState<SegmentDrillGroup[]>([]);
  const [loading, setLoading]   = useState(true);
  const [groupSize, setGroupSize] = useState(drill.group_size ?? 5);
  const [numGroups, setNumGroups] = useState(drill.num_groups ?? 2);
  const [groupSizeDraft, setGroupSizeDraft] = useState<string | null>(null);
  const [numGroupsDraft, setNumGroupsDraft] = useState<string | null>(null);
  const [dragPlayer, setDragPlayer] = useState<{ id: string; from: string | null } | null>(null);
  const [showSaveBox, setShowSaveBox] = useState(false);
  const [newArrangementName, setNewArrangementName] = useState("");
  const [savingArrangement, setSavingArrangement] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string[][]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setGroups(await getSegmentDrillGroups(drill.id));
    setLoading(false);
  }, [drill.id]);

  useEffect(() => { load(); }, [load]);

  const assignedIds = new Set(groups.flatMap(g => g.member_ids));
  const bench = attendees.filter(p => !assignedIds.has(p.id));
  // Assigned players who aren't among today's attendees. Covers a saved
  // arrangement loaded with someone out sick and one loaded with someone
  // who left the team -- the cause doesn't change what the coach does next,
  // so one count covers both.
  const unavailableCount = [...assignedIds].filter(id => !attendees.some(p => p.id === id)).length;
  const nameOf = (id: string) => attendees.find(p => p.id === id)?.name ?? "Unknown";

  async function handleGenerate() {
    const { groups: generated } = generateBalancedGroups(attendees, groupSize, numGroups);
    await saveGeneratedGroups(drill.id, generated, tryoutIds);
    await updateSegmentDrill(drill.id, { group_size: groupSize, num_groups: numGroups });
    await load(); onChanged();
  }

  /**
   * Loads a saved arrangement over whatever is currently on screen.
   *
   * Replaces rather than appends. Picking "3s Week 1" means you want those
   * threes, not those threes bolted onto the groups already there -- and
   * appending silently produced 6 groups from a 3-group pick, which looked
   * like a bug. Everything stays draggable afterwards, so a swap or two on
   * top of a loaded arrangement works exactly as before.
   */
  async function handleAssignSaved(groupingId: string) {
    const grouping = savedGroupings.find(g => g.id === groupingId);
    if (!grouping) return;
    if (groups.length > 0 && !window.confirm(`Load "${grouping.name}"? It replaces the groups currently on screen.`)) return;
    await clearSegmentDrillGroups(drill.id);
    const { error } = await assignSavedArrangementToSegmentDrill(drill.id, grouping, 0, tryoutIds);
    if (error) { setSaveMsg(error); return; }
    setShowPicker(false);
    await load(); onChanged();
  }

  /** Loads a preview of each saved arrangement so the picker can show what's inside rather than just a name. */
  async function openPicker() {
    setShowPicker(true);
    setSaveMsg(null);
    const entries = await Promise.all(
      savedGroupings.map(async g => [g.id, await getSavedGroupingArrangement(g.id)] as const)
    );
    setPreviews(Object.fromEntries(entries));
  }

  async function handleDeleteSaved(g: SavedGrouping) {
    if (!window.confirm(`Delete "${g.name}"? Practices that already used it keep their groups.`)) return;
    await deleteSavedGrouping(g.id);
    setPreviews(prev => { const next = { ...prev }; delete next[g.id]; return next; });
    onGroupingsChanged?.();
  }

  /**
   * Saves the split currently on screen so it can be reused.
   *
   * This is what was missing: the generator wrote straight to this
   * practice and stopped, so a good set of threes couldn't survive to next
   * week. Saves the whole arrangement rather than one group at a time.
   */
  async function handleSaveArrangement() {
    const name = newArrangementName.trim();
    if (!name) { setSaveMsg("Give it a name first."); return; }
    if (!rosterId) { setSaveMsg("This drill has no roster to save against."); return; }
    const payload = groups.filter(g => g.member_ids.length > 0).map(g => g.member_ids);
    if (!payload.length) { setSaveMsg("Nothing to save — build some groups first."); return; }
    const labels = groups.filter(g => g.member_ids.length > 0).map(g => g.group_label || null);
    setSavingArrangement(true);
    const { error } = await createSavedArrangement(name, rosterId, payload, labels, tryoutIds);
    setSavingArrangement(false);
    setSaveMsg(error ?? `Saved "${name}" — ${payload.length} group${payload.length === 1 ? "" : "s"}. Find it under "Pick saved group".`);
    if (!error) { setNewArrangementName(""); setShowSaveBox(false); onChanged(); onGroupingsChanged?.(); }
  }

  function handleDragStart(playerId: string, from: string | null) { setDragPlayer({ id: playerId, from }); }

  async function handleDrop(to: string | null) {
    if (!dragPlayer) return;
    const { id: playerId, from } = dragPlayer;
    if (from === to) { setDragPlayer(null); return; }
    const isTryout = Boolean(tryoutIds?.has(playerId));
    if (from) await removeGroupMember(from, playerId, isTryout);
    if (to) await addGroupMember(to, playerId, isTryout);
    setDragPlayer(null);
    await load(); onChanged();
  }

  async function handleQuickSwap(groupId: string, excusedPlayerId: string, replacementId: string) {
    await removeGroupMember(groupId, excusedPlayerId, Boolean(tryoutIds?.has(excusedPlayerId)));
    await addGroupMember(groupId, replacementId, Boolean(tryoutIds?.has(replacementId)));
    await load(); onChanged();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(720px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>Groups — {drill.label}</div>
          <button onClick={onClose} style={smallBtn}>Close</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>Drag a player chip to move them between groups or the bench. Generate replaces the current split; manual moves stick until you generate again.</div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
          <div>
            <div style={fieldLabel}>Group size</div>
            <input type="number" min={1}
              value={groupSizeDraft ?? String(groupSize)}
              onChange={e => setGroupSizeDraft(e.target.value)}
              onBlur={e => { setGroupSize(Math.max(1, parseInt(e.target.value) || groupSize)); setGroupSizeDraft(null); }}
              style={{ ...inputStyle, width: 60 }} />
          </div>
          <div>
            <div style={fieldLabel}># of groups</div>
            <input type="number" min={1}
              value={numGroupsDraft ?? String(numGroups)}
              onChange={e => setNumGroupsDraft(e.target.value)}
              onBlur={e => { setNumGroups(Math.max(1, parseInt(e.target.value) || numGroups)); setNumGroupsDraft(null); }}
              style={{ ...inputStyle, width: 60 }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", paddingBottom: 8 }}>
            {groupSize}v{Array(numGroups).fill(groupSize).join("v")}
          </div>
          <button onClick={handleGenerate} style={primaryBtn}>Generate</button>
          {/* Always shown, even with nothing saved yet -- a button that
              vanishes when the list is empty is how you end up saving a
              grouping and then being unable to find it. */}
          <button onClick={openPicker} style={inputStyle}>📂 Pick saved group</button>
          {groups.length > 0 && rosterId && (
            <button onClick={() => { setShowSaveBox(v => !v); setSaveMsg(null); }} style={inputStyle}>
              💾 Save these groups
            </button>
          )}
        </div>

        {showPicker && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12, background: "var(--surface2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Saved groups</div>
              <button onClick={() => setShowPicker(false)} style={{ ...inputStyle, padding: "4px 10px" }}>Close</button>
            </div>
            {savedGroupings.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Nothing saved for this roster yet. Build some groups and hit "Save these groups".
              </div>
            ) : (
              savedGroupings.map(g => {
                const preview = previews[g.id] ?? [];
                const labels = (g as any).group_labels as (string | null)[] | null;
                return (
                  <div key={g.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => handleAssignSaved(g.id)} style={{ ...primaryBtn, padding: "6px 12px" }}>Use</button>
                      <div style={{ flex: 1, fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{g.name}</div>
                      <button onClick={() => handleDeleteSaved(g)} title="Delete this saved group" style={{ ...inputStyle, padding: "4px 9px", color: "var(--muted)" }}>✕</button>
                    </div>
                    {/* Names, not just a count -- "3s Week 1" and "3s Week 2"
                        are indistinguishable otherwise. */}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                      {preview.length === 0 ? "…" : preview.map((ids, gi) => (
                        <div key={gi}>
                          <strong>{labels?.[gi] || `Group ${gi + 1}`}:</strong> {ids.map(nameOf).join(", ")}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              Loading one replaces the groups on screen. You can still drag players afterwards.
            </div>
          </div>
        )}

        {showSaveBox && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              value={newArrangementName}
              onChange={e => setNewArrangementName(e.target.value)}
              placeholder="Name it — e.g. 3s Week 1, or Starters"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={handleSaveArrangement} disabled={savingArrangement} style={primaryBtn}>
              {savingArrangement ? "Saving…" : "Save"}
            </button>
          </div>
        )}

        {saveMsg && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{saveMsg}</div>}

        {unavailableCount > 0 && (
          <div style={{ fontSize: 12, color: "#c9a227", marginBottom: 10 }}>
            ⚠ {unavailableCount} assigned {unavailableCount === 1 ? "player isn't" : "players aren't"} available today — swap or move them to the bench.
          </div>
        )}

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
              {groups.map(g => {
                const hasExcused = g.member_ids.some(id => excusedIds.has(id));
                return (
                  <div key={g.id}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop(g.id)}
                    style={{
                      background: hasExcused ? "rgba(240,192,64,0.1)" : "var(--surface2)",
                      border: hasExcused ? "1px solid rgba(240,192,64,0.5)" : "1px solid var(--border)",
                      borderRadius: 10, padding: 10, minHeight: 90,
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: hasExcused ? "var(--gold)" : "var(--text)", marginBottom: 6 }}>
                      {hasExcused && "⚠ "}{g.group_label}
                    </div>
                    {g.member_ids.map(pid => {
                      const excused = excusedIds.has(pid);
                      return (
                        <div key={pid} draggable onDragStart={() => handleDragStart(pid, g.id)}
                          style={{
                            fontSize: 12, padding: "4px 6px", marginBottom: 3, borderRadius: 6, cursor: "grab",
                            background: excused ? "rgba(226,75,74,0.12)" : "var(--surface)",
                            color: excused ? "#ff9b9b" : "var(--text)",
                            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6,
                          }}>
                          <span>{excused ? "⚠ " : ""}{nameOf(pid)}</span>
                          {excused && bench.length > 0 && (
                            <select onChange={e => { if (e.target.value) handleQuickSwap(g.id, pid, e.target.value); e.target.value = ""; }} defaultValue=""
                              style={{ fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
                              <option value="">swap…</option>
                              {bench.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div onDragOver={e => e.preventDefault()} onDrop={() => handleDrop(null)}
              style={{ background: "var(--surface2)", border: "1px dashed var(--border)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Bench / unassigned ({bench.length})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {bench.map(p => (
                  <div key={p.id} draggable onDragStart={() => handleDragStart(p.id, null)}
                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, background: "var(--surface)", cursor: "grab", color: excusedIds.has(p.id) ? "var(--muted)" : "var(--text)" }}>
                    {p.name}
                  </div>
                ))}
                {bench.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>Everyone's assigned.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = { fontSize: 11, color: "var(--muted)", marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
