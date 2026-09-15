// TryoutPoolManager — the roster substitute for tryout practices.
//
// These people don't have accounts and never will: profiles.id references
// auth.users, and forty kids aren't signing up to be cut on Thursday. So
// the pool is its own table, invisible to players, and nothing outside the
// tryout flow joins to it.
//
// Scoped to a season rather than a practice, because day two of tryouts
// shouldn't mean retyping forty names.
//
// Cut vs delete: cutting hides someone from group building while keeping
// the notes that justified the decision. Deleting throws away exactly the
// record a coach would want if a parent asks why.

import { useState, useEffect } from "react";
import {
  TryoutPlayer, getTryoutPlayers, addTryoutPlayer, addTryoutPlayersBulk,
  updateTryoutPlayer, deleteTryoutPlayer, clearTryoutPool, Roster,
} from "../../lib/practicePlanner";

interface Props {
  seasonId: string | null;
  onClose: () => void;
  onChanged?: () => void;
  /** Teams to put new names in contention for. Passed by a tryout
   *  practice so the common path needs no picking at all. */
  defaultRosterIds?: string[];
  rosters?: Roster[];
}

export default function TryoutPoolManager({ seasonId, onClose, onChanged, defaultRosterIds, rosters = [] }: Props) {
  // Which teams to show. Null is everyone, including names nobody has
  // assigned yet.
  const [filterRosterId, setFilterRosterId] = useState<string | null>(null);
  const [players, setPlayers] = useState<TryoutPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCut, setShowCut] = useState(false);
  const [newName, setNewName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { load(); }, [seasonId, showCut]);

  async function load() {
    setLoading(true);
    setPlayers(await getTryoutPlayers(seasonId, showCut));
    setLoading(false);
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    const { error } = await addTryoutPlayer(seasonId, newName, null, null, defaultRosterIds ?? []);
    if (error) { setMsg(error); return; }
    setNewName("");
    await load(); onChanged?.();
  }

  async function handleBulk() {
    const { added, error } = await addTryoutPlayersBulk(seasonId, bulkText);
    if (error) { setMsg(error); return; }
    setBulkText(""); setBulkOpen(false);
    setMsg(`Added ${added} ${added === 1 ? "player" : "players"}.`);
    await load(); onChanged?.();
  }

  async function toggleCut(p: TryoutPlayer) {
    await updateTryoutPlayer(p.id, { status: p.status === "cut" ? "active" : "cut" });
    await load(); onChanged?.();
  }

  async function saveNotes(id: string) {
    await updateTryoutPlayer(id, { notes: notesDraft.trim() || null });
    setNotesFor(null); setNotesDraft("");
    await load();
  }

  async function handleDelete(p: TryoutPlayer) {
    if (!window.confirm(`Delete ${p.name}? Their notes and group placements go too. Use Cut instead if you might want the record.`)) return;
    await deleteTryoutPlayer(p.id);
    await load(); onChanged?.();
  }

  async function handleClearPool() {
    if (!window.confirm("Clear the whole tryout pool? Every name, note, group placement and attendance record for tryouts is deleted. This can't be undone.")) return;
    if (!window.confirm("Really clear it? There's no undo.")) return;
    const { error } = await clearTryoutPool(seasonId);
    if (error) { setMsg(error); return; }
    await load(); onChanged?.();
  }

  const active = players.filter(p => p.status === "active");
  const cut = players.filter(p => p.status === "cut");
  // A name with no teams set shows under every filter rather than
  // disappearing — it needs finding, not hiding.
  const shown = [...active, ...cut].filter(p =>
    !filterRosterId || (p.roster_ids ?? []).length === 0 || (p.roster_ids ?? []).includes(filterRosterId));

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>Tryout pool</h3>
          <button onClick={onClose} style={btn}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
          Coaches only — players never see this list. Names here can be put into groups on any tryout practice, and don't appear on regular practices.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            placeholder="Add a name"
            style={{ ...input, flex: 1 }}
          />
          <button onClick={handleAdd} style={primary}>Add</button>
          <button onClick={() => setBulkOpen(v => !v)} style={btn}>Paste list</button>
        </div>

        {bulkOpen && (
          <div style={{ marginBottom: 12 }}>
            <textarea
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder={"One name per line —\nConnor Houle\nDevin Dufresne\n…"}
              rows={6}
              style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical" }}
            />
            <button onClick={handleBulk} style={{ ...primary, marginTop: 6 }}>Add all</button>
          </div>
        )}

        {msg && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{msg}</div>}

        {loading ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>
        ) : active.length === 0 && cut.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Nobody in the pool yet.</div>
        ) : (
          <>
            {rosters.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {[{ id: null as string | null, name: "All" }, ...rosters.map(r => ({ id: r.id as string | null, name: r.name }))].map(r => (
                  <button key={r.id ?? "all"} onClick={() => setFilterRosterId(r.id)}
                    style={{
                      fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                      border: `1px solid ${filterRosterId === r.id ? "var(--gold)" : "var(--border)"}`,
                      background: filterRosterId === r.id ? "rgba(240,192,64,0.12)" : "transparent",
                      color: filterRosterId === r.id ? "var(--gold)" : "var(--muted)",
                    }}>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              {shown.filter(p => p.status !== "cut").length} in the pool{cut.length > 0 ? ` · ${cut.length} cut` : ""}
            </div>
            {shown.map(p => (
              <div key={p.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0", opacity: p.status === "cut" ? 0.5 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, textDecoration: p.status === "cut" ? "line-through" : "none" }}>
                      {p.name}
                    </div>
                    {/* Which teams they're up for. Tap to change — someone
                        pulled up to the varsity tryout is just in
                        contention for both. */}
                    {rosters.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
                        {rosters.map(r => {
                          const on = (p.roster_ids ?? []).includes(r.id);
                          return (
                            <button key={r.id}
                              onClick={async () => {
                                const next = on
                                  ? (p.roster_ids ?? []).filter(id => id !== r.id)
                                  : [...(p.roster_ids ?? []), r.id];
                                await updateTryoutPlayer(p.id, { roster_ids: next });
                                await load(); onChanged?.();
                              }}
                              style={{
                                fontSize: 10, padding: "2px 7px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit",
                                border: `1px solid ${on ? "rgba(240,192,64,0.5)" : "var(--border)"}`,
                                background: on ? "rgba(240,192,64,0.14)" : "transparent",
                                color: on ? "var(--gold)" : "var(--muted)",
                              }}>
                              {r.name}
                            </button>
                          );
                        })}
                        {(p.roster_ids ?? []).length === 0 && (
                          <span style={{ fontSize: 10, color: "#ff9b9b" }}>no teams set</span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => { setNotesFor(notesFor === p.id ? null : p.id); setNotesDraft(p.notes ?? ""); }}
                    style={{ ...btn, padding: "4px 9px" }}
                    title="Evaluation notes"
                  >
                    {p.notes ? "📝*" : "📝"}
                  </button>
                  <button onClick={() => toggleCut(p)} style={{ ...btn, padding: "4px 9px" }}>
                    {p.status === "cut" ? "Restore" : "Cut"}
                  </button>
                  <button onClick={() => handleDelete(p)} style={{ ...btn, padding: "4px 9px", color: "var(--muted)" }}>✕</button>
                </div>
                {notesFor === p.id && (
                  <div style={{ marginTop: 6 }}>
                    <textarea
                      value={notesDraft}
                      onChange={e => setNotesDraft(e.target.value)}
                      rows={3}
                      placeholder="What you noticed — shooting, motor, attitude, whatever matters at cuts."
                      style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                    />
                    <button onClick={() => saveNotes(p.id)} style={{ ...primary, marginTop: 6 }}>Save note</button>
                  </div>
                )}
                {p.notes && notesFor !== p.id && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{p.notes}</div>
                )}
              </div>
            ))}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <button onClick={() => setShowCut(v => !v)} style={btn}>
            {showCut ? "Hide cut players" : "Show cut players"}
          </button>
          <button onClick={handleClearPool} style={{ ...btn, color: "#b8342e" }}>Clear pool</button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16,
};
const panel: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
  padding: 18, width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto",
};
const input: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none",
};
const btn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)",
  borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
};
const primary: React.CSSProperties = {
  background: "var(--royal)", border: "none", color: "#fff",
  borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
