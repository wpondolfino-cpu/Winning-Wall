// src/components/coach/RosterManager.tsx
// Manage rosters (Varsity/JV/Freshman + any custom ones like a state
// tournament team). Permanent rosters always stay in every picker;
// seasonal rosters can be archived once the season/event is over and
// restored later without losing their history.

import { useState, useEffect } from "react";
import {
  Roster, RosterWithCount, getRosters, createRoster, updateRoster,
  archiveRoster, restoreRoster,
} from "../../lib/practicePlanner";

const PRESET_COLORS = ["#1a3fa8", "#8a8f98", "#e8e8e8", "#f0c040", "#5de098", "#d85a30", "#993c56"];

export default function RosterManager() {
  const [rosters, setRosters]       = useState<RosterWithCount[]>([]);
  const [archived, setArchived]     = useState<RosterWithCount[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [newName, setNewName]       = useState("");
  const [newColor, setNewColor]     = useState(PRESET_COLORS[0]);
  const [newType, setNewType]       = useState<"permanent" | "seasonal">("seasonal");
  const [newCoach, setNewCoach]     = useState("");

  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editName, setEditName]     = useState("");
  const [editColor, setEditColor]   = useState("");
  const [editCoach, setEditCoach]   = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [active, all] = await Promise.all([getRosters(false), getRosters(true)]);
    setRosters(active);
    setArchived(all.filter(r => r.status === "archived"));
    setLoading(false);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving(true); setError(null);
    const { error } = await createRoster({
      name: newName, color: newColor, roster_type: newType,
      default_coach_name: newCoach || undefined,
    });
    if (error) setError(error);
    else {
      setNewName(""); setNewCoach(""); setNewType("seasonal"); setShowForm(false);
      await load();
    }
    setSaving(false);
  }

  function startEdit(r: Roster) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditColor(r.color);
    setEditCoach(r.default_coach_name ?? "");
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;
    setSaving(true); setError(null);
    const { error } = await updateRoster(editingId, {
      name: editName.trim(), color: editColor, default_coach_name: editCoach || null,
    });
    if (error) setError(error);
    else { setEditingId(null); await load(); }
    setSaving(false);
  }

  async function handleArchive(r: RosterWithCount) {
    if (!window.confirm(`Archive "${r.name}"? It'll drop out of the main pickers but every practice you've run with it stays intact — you can restore it anytime.`)) return;
    await archiveRoster(r.id);
    await load();
  }

  async function handleRestore(r: RosterWithCount) {
    await restoreRoster(r.id);
    await load();
  }

  function RosterRow({ r, archived: isArchived }: { r: RosterWithCount; archived?: boolean }) {
    const isEditing = editingId === r.id;
    return (
      <div style={{
        background: "var(--surface)", border: `1px solid var(--border)`, borderRadius: 10,
        padding: "12px 14px", display: "flex", flexDirection: "column", gap: isEditing ? 8 : 0,
      }}>
        {isEditing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={editName} onChange={e => setEditName(e.target.value)}
              style={inputStyle} />
            <input value={editCoach} onChange={e => setEditCoach(e.target.value)} placeholder="Default coach name (optional)"
              style={inputStyle} />
            <div style={{ display: "flex", gap: 6 }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setEditColor(c)}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer",
                    border: editColor === c ? "2px solid var(--gold)" : "1px solid var(--border)",
                  }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveEdit} disabled={saving} style={primaryBtn}>Save</button>
              <button onClick={() => setEditingId(null)} style={secondaryBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                {r.name} <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>— {r.member_count} player{r.member_count === 1 ? "" : "s"}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {r.roster_type === "permanent" ? "Permanent" : "Seasonal"}
                {r.default_coach_name ? ` · Coach: ${r.default_coach_name}` : ""}
              </div>
            </div>
            {!isArchived && (
              <button onClick={() => startEdit(r)} style={smallBtn}>Edit</button>
            )}
            {r.roster_type === "seasonal" && !isArchived && (
              <button onClick={() => handleArchive(r)} style={smallBtn}>Archive</button>
            )}
            {isArchived && (
              <button onClick={() => handleRestore(r)} style={smallBtn}>Restore</button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>Rosters</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Manage teams — Varsity, JV, Freshman, and any custom rosters</div>
        </div>
        <button onClick={() => setShowForm(s => !s)} style={primaryBtn}>
          {showForm ? "Cancel" : "+ New roster"}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#f09595", background: "rgba(226,75,74,0.08)", border: "1px solid rgba(226,75,74,0.2)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
          {error}
        </div>
      )}

      {showForm && (
        <div style={{ background: "var(--surface)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Roster name (e.g. State Tournament Team)" style={inputStyle} />
          <input value={newCoach} onChange={e => setNewCoach(e.target.value)} placeholder="Default coach name (optional)" style={inputStyle} />
          <div style={{ display: "flex", gap: 6 }}>
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                style={{ width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer", border: newColor === c ? "2px solid var(--gold)" : "1px solid var(--border)" }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" checked={newType === "permanent"} onChange={() => setNewType("permanent")} />
              Permanent — always visible in every picker
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--muted)" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" checked={newType === "seasonal"} onChange={() => setNewType("seasonal")} />
              Seasonal — can be archived once the season/event ends
            </label>
          </div>
          <button onClick={handleCreate} disabled={saving || !newName.trim()} style={primaryBtn}>
            {saving ? "Creating…" : "Create roster"}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rosters.map(r => <RosterRow key={r.id} r={r} />)}
        </div>
      )}

      {archived.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowArchived(s => !s)} style={{ ...smallBtn, marginBottom: 8 }}>
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {archived.map(r => <RosterRow key={r.id} r={r} archived />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 14px", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
