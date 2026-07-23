// src/components/coach/SavedGroupingsManager.tsx
// Manage living, coach-only groupings for one roster (e.g. "Varsity
// Starters"). These are never visible to players. Editing membership
// here only affects future uses — any practice that already used this
// grouping keeps its own snapshot untouched (see practicePlanner.ts).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { Roster, SavedGrouping, getSavedGroupings, getSavedGroupingMembers, createSavedGrouping, updateSavedGroupingMembers, renameSavedGrouping, deleteSavedGrouping } from "../../lib/practicePlanner";

interface PlayerLite { id: string; name: string; }

interface Props {
  roster: Roster;
  onClose: () => void;
}

export default function SavedGroupingsManager({ roster, onClose }: Props) {
  const [groupings, setGroupings] = useState<SavedGrouping[]>([]);
  const [players, setPlayers]     = useState<PlayerLite[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName]   = useState("");
  const [editMembers, setEditMembers] = useState<Set<string>>(new Set());
  const [showNew, setShowNew]     = useState(false);
  const [newName, setNewName]     = useState("");
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [g, { data: p }] = await Promise.all([
      getSavedGroupings(roster.id),
      supabase.from("profiles").select("id,name").eq("home_roster_id", roster.id).eq("role", "player"),
    ]);
    setGroupings(g); setPlayers(p ?? []);
    setLoading(false);
  }, [roster.id]);

  useEffect(() => { load(); }, [load]);

  async function startEdit(g: SavedGrouping) {
    setEditingId(g.id); setEditName(g.name);
    setEditMembers(new Set(await getSavedGroupingMembers(g.id)));
  }

  async function saveEdit() {
    if (!editingId) return;
    setError(null);
    if (editName.trim()) await renameSavedGrouping(editingId, editName);
    const { error } = await updateSavedGroupingMembers(editingId, Array.from(editMembers));
    if (error) setError(error);
    setEditingId(null);
    await load();
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setError(null);
    const { error } = await createSavedGrouping(newName, roster.id, []);
    if (error) { setError(error); return; }
    setNewName(""); setShowNew(false);
    await load();
  }

  async function handleDelete(g: SavedGrouping) {
    if (!window.confirm(`Delete "${g.name}"? This only removes the saved grouping — past practices that used it keep their own snapshot.`)) return;
    await deleteSavedGrouping(g.id);
    await load();
  }

  function toggleMember(id: string) {
    setEditMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(480px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>{roster.name} groupings</div>
          <button onClick={onClose} style={smallBtn}>Close</button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>Coach-only — never shown to players. Editing membership only changes future uses.</div>

        {error && <div style={{ fontSize: 12, color: "#f09595", marginBottom: 10 }}>{error}</div>}

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {groupings.map(g => (
              <div key={g.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                {editingId === g.id ? (
                  <div>
                    <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto", marginBottom: 8 }}>
                      {players.map(p => (
                        <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                          <input type="checkbox" checked={editMembers.has(p.id)} onChange={() => toggleMember(p.id)} />
                          {p.name}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={saveEdit} style={primaryBtn}>Save</button>
                      <button onClick={() => setEditingId(null)} style={smallBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => startEdit(g)} style={smallBtn}>Edit</button>
                      <button onClick={() => handleDelete(g)} style={dangerSmallBtn}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {groupings.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No saved groupings for {roster.name} yet.</div>}
          </div>
        )}

        {showNew ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={`${roster.name} Starters`} style={inputStyle} />
            <button onClick={handleCreate} style={primaryBtn}>Create</button>
            <button onClick={() => setShowNew(false)} style={smallBtn}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setShowNew(true)} style={{ ...smallBtn, width: "100%" }}>+ New grouping</button>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
const dangerSmallBtn: React.CSSProperties = {
  background: "rgba(226,75,74,0.08)", border: "1px solid rgba(226,75,74,0.2)", color: "#ff7b7b", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
