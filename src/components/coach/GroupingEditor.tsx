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
  generateBalancedGroups, saveGeneratedGroups, assignSavedGroupingToSegmentDrill,
  movePlayerBetweenGroups, removeGroupMember, addGroupMember, updateSegmentDrill,
} from "../../lib/practicePlanner";

interface PlayerLite { id: string; name: string; home_roster_id: string | null; }

interface Props {
  drill: SegmentDrill;
  attendees: PlayerLite[];       // effective attendees available to this segment
  excusedIds: Set<string>;       // excused for this practice — drives the yellow flag
  savedGroupings: SavedGrouping[]; // relevant to the roster(s) in this segment
  onClose: () => void;
  onChanged: () => void;
}

export default function GroupingEditor({ drill, attendees, excusedIds, savedGroupings, onClose, onChanged }: Props) {
  const [groups, setGroups]     = useState<SegmentDrillGroup[]>([]);
  const [loading, setLoading]   = useState(true);
  const [groupSize, setGroupSize] = useState(drill.group_size ?? 5);
  const [numGroups, setNumGroups] = useState(drill.num_groups ?? 2);
  const [dragPlayer, setDragPlayer] = useState<{ id: string; from: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setGroups(await getSegmentDrillGroups(drill.id));
    setLoading(false);
  }, [drill.id]);

  useEffect(() => { load(); }, [load]);

  const assignedIds = new Set(groups.flatMap(g => g.member_ids));
  const bench = attendees.filter(p => !assignedIds.has(p.id));
  const nameOf = (id: string) => attendees.find(p => p.id === id)?.name ?? "Unknown";

  async function handleGenerate() {
    const { groups: generated } = generateBalancedGroups(attendees, groupSize, numGroups);
    await saveGeneratedGroups(drill.id, generated);
    await updateSegmentDrill(drill.id, { group_size: groupSize, num_groups: numGroups });
    await load(); onChanged();
  }

  async function handleAssignSaved(groupingId: string) {
    const grouping = savedGroupings.find(g => g.id === groupingId);
    if (!grouping) return;
    await assignSavedGroupingToSegmentDrill(drill.id, grouping, groups.length);
    await load(); onChanged();
  }

  function handleDragStart(playerId: string, from: string | null) { setDragPlayer({ id: playerId, from }); }

  async function handleDrop(to: string | null) {
    if (!dragPlayer) return;
    const { id: playerId, from } = dragPlayer;
    if (from === to) { setDragPlayer(null); return; }
    if (from) await removeGroupMember(from, playerId);
    if (to) await addGroupMember(to, playerId);
    setDragPlayer(null);
    await load(); onChanged();
  }

  async function handleQuickSwap(groupId: string, excusedPlayerId: string, replacementId: string) {
    await removeGroupMember(groupId, excusedPlayerId);
    await addGroupMember(groupId, replacementId);
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
            <input type="number" min={1} value={groupSize} onChange={e => setGroupSize(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...inputStyle, width: 60 }} />
          </div>
          <div>
            <div style={fieldLabel}># of groups</div>
            <input type="number" min={1} value={numGroups} onChange={e => setNumGroups(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...inputStyle, width: 60 }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", paddingBottom: 8 }}>
            {groupSize}v{Array(numGroups).fill(groupSize).join("v")}
          </div>
          <button onClick={handleGenerate} style={primaryBtn}>Generate</button>
          {savedGroupings.length > 0 && (
            <select onChange={e => { if (e.target.value) handleAssignSaved(e.target.value); e.target.value = ""; }} defaultValue="" style={inputStyle}>
              <option value="">+ Load saved grouping…</option>
              {savedGroupings.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>

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
