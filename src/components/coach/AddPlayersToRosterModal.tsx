// src/components/coach/AddPlayersToRosterModal.tsx
// Type a few letters, check off however many players match, hit Add —
// no more going into each player's edit modal one at a time. Since a
// player only has one roster at a time, adding someone who's already
// on another roster MOVES them (called out clearly in the list).

import { useState, useEffect, useMemo } from "react";
import { Roster, PlayerForRosterPicker, getAllPlayersLite, bulkSetPlayerRoster } from "../../lib/practicePlanner";

interface Props {
  roster: Roster;
  onClose: () => void;
  onAdded: () => void; // let the parent refresh member counts
}

export default function AddPlayersToRosterModal({ roster, onClose, onAdded }: Props) {
  const [players, setPlayers] = useState<PlayerForRosterPicker[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving]   = useState(false);

  useEffect(() => { getAllPlayersLite().then(p => { setPlayers(p); setLoading(false); }); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? players.filter(p => p.name.toLowerCase().includes(q)) : players;
    // Players already on this roster sort to the bottom — nothing to do with them.
    return [...base].sort((a, b) => {
      const aOn = a.home_roster_id === roster.id, bOn = b.home_roster_id === roster.id;
      if (aOn !== bOn) return aOn ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [players, search, roster.id]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setSaving(true);
    const { error } = await bulkSetPlayerRoster(Array.from(selected), roster.id);
    setSaving(false);
    if (error) { alert("Couldn't add players: " + error); return; }
    onAdded();
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(420px, 96vw)", maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)" }}>Add players — {roster.name}</div>
          <button onClick={onClose} style={smallBtn}>Close</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
          Adding someone already on another roster moves them here — it doesn't duplicate them.
        </div>

        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a few letters…" autoFocus
          style={{ ...inputStyle, marginBottom: 10 }} />

        <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 2, marginBottom: 12 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>No players match.</div>
          ) : (
            filtered.map(p => {
              const alreadyHere = p.home_roster_id === roster.id;
              return (
                <label key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6,
                  cursor: alreadyHere ? "default" : "pointer",
                  opacity: alreadyHere ? 0.5 : 1,
                  background: selected.has(p.id) ? "rgba(26,63,168,0.15)" : "transparent",
                }}>
                  <input type="checkbox" disabled={alreadyHere} checked={selected.has(p.id) || alreadyHere}
                    onChange={() => !alreadyHere && toggle(p.id)} />
                  <span style={{ fontSize: 13 }}>{p.name}</span>
                  {alreadyHere ? (
                    <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>already here</span>
                  ) : p.home_roster_id ? (
                    <span style={{ fontSize: 10, color: "var(--gold)", marginLeft: "auto" }}>moves from another roster</span>
                  ) : null}
                </label>
              );
            })
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleAdd} disabled={saving || selected.size === 0} style={primaryBtn}>
            {saving ? "Adding…" : `Add ${selected.size > 0 ? selected.size : ""} to ${roster.name}`}
          </button>
          <button onClick={onClose} style={smallBtn}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
