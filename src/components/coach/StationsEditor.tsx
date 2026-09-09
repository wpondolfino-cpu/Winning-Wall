// src/components/coach/StationsEditor.tsx
//
// Deals the people at a block across its stations.
//
// A segment holding more than one drill IS stations — the app already
// knows that, so this doesn't ask. The groups here ARE the stations, one
// column per drill, labelled with the drill's own name.
//
// This is the first of two tiers. Once a station has its eight, that
// drill's ordinary grouping editor pools from those eight instead of the
// whole practice, so splitting station 2 into 4v4 finally means 4v4 of
// the right people.
//
// Deliberately not saveable as an arrangement. A saved grouping is a
// named list of specific people, and a station split is about who turned
// up today — the picker would fill with things nobody wants to load
// again. Duplicating a practice carries stations along, which is the
// repeat case that actually happens.

import { useState, useEffect } from "react";
import { SegmentDrill, setStationMembers, clearStationMembers } from "../../lib/practicePlanner";
import { inputStyle } from "../../lib/inputStyle";

interface PlayerLite { id: string; name: string; }

interface Props {
  drills: SegmentDrill[];
  attendees: PlayerLite[];
  tryoutIds?: Set<string>;
  onClose: () => void;
  onChanged: () => void;
}

export default function StationsEditor({ drills, attendees, tryoutIds, onClose, onChanged }: Props) {
  // drillId -> member ids. Unassigned is everyone not in any column.
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const seed: Record<string, string[]> = {};
    for (const d of drills) {
      seed[d.id] = [...(d.station_member_ids ?? []), ...(d.station_tryout_member_ids ?? [])];
    }
    setAssigned(seed);
  }, [drills]);

  const placed = new Set(Object.values(assigned).flat());
  const unassigned = attendees.filter(p => !placed.has(p.id));
  const nameOf = (id: string) => attendees.find(p => p.id === id)?.name ?? "Unknown";
  const labelOf = (d: SegmentDrill, i: number) => d.label?.trim() || `Station ${i + 1}`;

  /** Round-robin, so uneven numbers spread rather than piling on the last one. */
  function deal() {
    const shuffled = [...attendees].sort(() => Math.random() - 0.5);
    const next: Record<string, string[]> = {};
    drills.forEach(d => { next[d.id] = []; });
    shuffled.forEach((p, i) => { next[drills[i % drills.length].id].push(p.id); });
    setAssigned(next);
  }

  function move(playerId: string, toDrillId: string | null) {
    setAssigned(prev => {
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(prev)) next[k] = v.filter(id => id !== playerId);
      if (toDrillId) next[toDrillId] = [...(next[toDrillId] ?? []), playerId];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    const { error } = await setStationMembers(drills.map(d => {
      const ids = assigned[d.id] ?? [];
      return {
        drillId: d.id,
        memberIds: ids.filter(id => !tryoutIds?.has(id)),
        tryoutIds: ids.filter(id => tryoutIds?.has(id)),
      };
    }));
    setBusy(false);
    if (error) { alert("Couldn't save the stations: " + error); return; }
    setJustSaved(true);
    onChanged();
    setTimeout(() => setJustSaved(false), 1600);
  }

  async function clearAll() {
    if (!window.confirm("Clear the station split? Each drill goes back to grouping from everyone at the practice.")) return;
    setBusy(true);
    await clearStationMembers(drills.map(d => d.id));
    setBusy(false);
    setAssigned(Object.fromEntries(drills.map(d => [d.id, []])));
    onChanged();
  }

  const chip = (id: string, from: string | null) => (
    <div key={id} draggable onDragStart={() => setDragId(id)}
      style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 12, color: "var(--text)", cursor: "grab", marginBottom: 4 }}>
      {nameOf(id)}
    </div>
  );

  const dropZone = (drillId: string | null) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => { if (dragId) move(dragId, drillId); setDragId(null); },
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 16, width: "min(860px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 22 }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>Stations</div>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#5de098", opacity: justSaved ? 1 : 0, transition: "opacity .25s" }}>✓ Saved</span>
            <button onClick={onClose} style={inputStyle}>Done</button>
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Who is at each station in this block. Deal splits everyone evenly; drag to adjust.
          Once saved, each station&rsquo;s own Groups button splits just those people &mdash; so a station of eight can become 4v4.
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <button onClick={deal} style={{ ...inputStyle, background: "var(--royal)", color: "#fff", border: "none", fontWeight: 600 }}>Deal evenly</button>
          <button onClick={save} disabled={busy} style={{ ...inputStyle, background: "var(--gold)", color: "#1a1a1a", border: "none", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Saving…" : "Save stations"}
          </button>
          <button onClick={clearAll} disabled={busy} style={inputStyle}>Clear split</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(drills.length, 4)}, minmax(0,1fr))`, gap: 10, marginBottom: 14 }}>
          {drills.map((d, i) => (
            <div key={d.id} {...dropZone(d.id)}
              style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, minHeight: 130 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>{labelOf(d, i)}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                {(assigned[d.id] ?? []).length} player{(assigned[d.id] ?? []).length === 1 ? "" : "s"}
              </div>
              {(assigned[d.id] ?? []).map(id => chip(id, d.id))}
            </div>
          ))}
        </div>

        <div {...dropZone(null)}
          style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Not at a station ({unassigned.length})</div>
          {unassigned.length === 0
            ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Everyone&rsquo;s placed.</div>
            : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{unassigned.map(p => chip(p.id, null))}</div>}
        </div>
      </div>
    </div>
  );
}
