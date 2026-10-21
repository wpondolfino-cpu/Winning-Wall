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
//
// Accounts can be in the pool too (linked_profile_id): a returning player
// is "trying out" like everyone else. An account entry is still a pool row
// -- notes, cut, groups all work the same -- but shows the account's name,
// and removing it never touches the account. Names that look like an
// existing account are only ever TAGGED; the coach confirms with "Swap
// for account". Two kids can share a name.

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { GRADE_COLORS, GRADE_LABELS, gradeFromGradYear } from "../../lib/teamDesigner";
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

/** Fr/So/Jr/Sr in the Team Designer colours. Tap the chosen one again to clear it. */
function GradePicker({ value, onChange, small }: { value: number | null; onChange: (g: number | null) => void; small?: boolean }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, flexShrink: 0 }}>
      {[9, 10, 11, 12].map(g => {
        const on = value === g;
        return (
          <button key={g} type="button" title={`${g}th grade`} onClick={() => onChange(on ? null : g)}
            style={{
              fontSize: small ? 10 : 11, fontWeight: 700, padding: small ? "1px 6px" : "5px 8px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${on ? GRADE_COLORS[g] : "var(--border)"}`,
              background: on ? GRADE_COLORS[g] + "33" : "transparent",
              color: on ? GRADE_COLORS[g] : "var(--muted)",
            }}>
            {GRADE_LABELS[g]}
          </button>
        );
      })}
    </span>
  );
}

interface Account { id: string; name: string; home_roster_id: string | null; graduation_year: number | null; }

/** Same last name and same first initial ("Jacob Smith" ~ "Jake Smith"). Only ever used to TAG a possible match. */
function nameMatch(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/[^a-z\s'-]/g, "").trim().split(/\s+/).filter(Boolean);
  const y = b.toLowerCase().replace(/[^a-z\s'-]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  return x.length > 1 && y.length > 1 && x[x.length - 1] === y[y.length - 1] && x[0][0] === y[0][0];
}

export default function TryoutPoolManager({ seasonId, onClose, onChanged, defaultRosterIds, rosters = [] }: Props) {
  // Which teams to show. Null is everyone, including names nobody has
  // assigned yet.
  const [filterRosterId, setFilterRosterId] = useState<string | null>(null);
  const [players, setPlayers] = useState<TryoutPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCut, setShowCut] = useState(false);
  const [newName, setNewName] = useState("");
  // Grade drives the Team Designer colour (Fr blue, So green, Jr amber, Sr violet).
  const [newGrade, setNewGrade] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  // Every pool row, cut ones included, so an account already in the pool
  // (even cut) can't be added a second time.
  const [allRows, setAllRows] = useState<TryoutPlayer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctQuery, setAcctQuery] = useState("");

  useEffect(() => { load(); }, [seasonId, showCut]);
  useEffect(() => {
    // Profiles are already limited to this program by the database.
    supabase.from("profiles").select("id,name,home_roster_id,graduation_year").eq("role", "player").order("name")
      .then(({ data }) => setAccounts((data ?? []) as Account[]));
  }, []);

  async function load() {
    setLoading(true);
    const all = await getTryoutPlayers(seasonId, true);
    setAllRows(all);
    setPlayers(showCut ? all : all.filter(p => p.status === "active"));
    setLoading(false);
  }

  const accountById = new Map(accounts.map(a => [a.id, a]));
  const linkedIds = new Set(allRows.map(r => r.linked_profile_id).filter(Boolean) as string[]);
  const rosterName = (id: string | null) => (id ? rosters.find(r => r.id === id)?.name : null) ?? null;
  const displayName = (p: TryoutPlayer) => (p.linked_profile_id ? accountById.get(p.linked_profile_id)?.name : null) ?? p.name;
  /** Accounts this typed name could be: same last name and first initial. Never linked automatically. */
  function matchesFor(p: TryoutPlayer): Account[] {
    if (p.linked_profile_id) return [];
    return accounts.filter(a => !linkedIds.has(a.id) && nameMatch(a.name, p.name));
  }
  function matchNote(names: string[]): string {
    const hits = names.filter(n => accounts.some(a => !linkedIds.has(a.id) && nameMatch(a.name, n)));
    return hits.length
      ? ` ${hits.length} look${hits.length === 1 ? "s" : ""} like an existing account (${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ", …" : ""}). Check the amber tags.`
      : "";
  }

  async function addAccount(a: Account) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("tryout_players").insert({
      season_id: seasonId, name: a.name, linked_profile_id: a.id,
      roster_ids: defaultRosterIds ?? [], created_by: user?.id,
    });
    if (error) { setMsg(error.message); return; }
    setMsg(`Added ${a.name}.`);
    await load(); onChanged?.();
  }

  async function swapForAccount(p: TryoutPlayer, a: Account) {
    const { error } = await updateTryoutPlayer(p.id, { linked_profile_id: a.id, name: a.name });
    if (error) { setMsg(error); return; }
    setMsg(`${p.name} is now ${a.name}'s account. Notes and groups kept.`);
    await load(); onChanged?.();
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    const typed = newName.trim();
    const { error } = await addTryoutPlayer(seasonId, newName, newGrade, null, defaultRosterIds ?? []);
    if (error) { setMsg(error); return; }
    setNewName("");
    setMsg(matchNote([typed]).trim() || null);
    await load(); onChanged?.();
  }

  async function handleBulk() {
    const names = bulkText.split("\n").map(l => (l.split(/[,\t]/)[0] ?? "").trim()).filter(Boolean);
    const { added, error } = await addTryoutPlayersBulk(seasonId, bulkText);
    if (error) { setMsg(error); return; }
    setBulkText(""); setBulkOpen(false);
    setMsg(`Added ${added} ${added === 1 ? "player" : "players"}.${matchNote(names)}`);
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
    if (!window.confirm(p.linked_profile_id
      ? `Take ${displayName(p)} out of the tryout pool? Their account isn't touched; the notes and tryout groups for this entry go.`
      : `Delete ${p.name}? Their notes and group placements go too. Use Cut instead if you might want the record.`)) return;
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
          <GradePicker value={newGrade} onChange={setNewGrade} />
          <button onClick={handleAdd} style={primary}>Add</button>
          <button onClick={() => setBulkOpen(v => !v)} style={btn}>Paste list</button>
          <button onClick={() => { setAcctOpen(v => !v); setAcctQuery(""); }}
            style={{ ...btn, border: "1px solid var(--royal)", color: "var(--info-text)", fontWeight: 600 }}>
            🔎 Add account
          </button>
        </div>

        {acctOpen && (
          <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <input autoFocus value={acctQuery} onChange={e => setAcctQuery(e.target.value)}
              placeholder="Search your players" style={{ ...input, width: "100%", boxSizing: "border-box", marginBottom: 6 }} />
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {accounts
                .filter(a => !acctQuery.trim() || a.name.toLowerCase().includes(acctQuery.trim().toLowerCase()))
                .slice(0, 30)
                .map(a => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid var(--border)" }}>
                    <span style={{ flex: 1, fontSize: 13 }}>
                      {a.name}
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {" · "}{rosterName(a.home_roster_id) ?? "no roster"}{a.graduation_year ? ` · ${a.graduation_year}` : ""}
                      </span>
                    </span>
                    {linkedIds.has(a.id)
                      ? <span style={{ fontSize: 11, color: "var(--muted)" }}>In pool</span>
                      : <button onClick={() => addAccount(a)} style={{ ...primary, padding: "4px 10px" }}>Add</button>}
                  </div>
                ))}
              {accounts.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No player accounts yet.</div>}
            </div>
          </div>
        )}

        {bulkOpen && (
          <div style={{ marginBottom: 12 }}>
            <textarea
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              placeholder={"One per line, grade after a comma (optional) —\nConnor Houle, 9\nDevin Dufresne, 11\n…"}
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
                      color: filterRosterId === r.id ? "var(--gold-text)" : "var(--muted)",
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
                      {displayName(p)}
                      {p.linked_profile_id && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 5, marginLeft: 6, background: "rgba(147,180,255,0.15)", color: "var(--info-text)" }}>Account</span>
                      )}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      {p.linked_profile_id ? (() => {
                        const g = gradeFromGradYear(accountById.get(p.linked_profile_id!)?.graduation_year ?? null);
                        return g && GRADE_COLORS[g]
                          ? <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 5, background: GRADE_COLORS[g] + "33", color: GRADE_COLORS[g] }}>{GRADE_LABELS[g]} · from account</span>
                          : <span style={{ fontSize: 10, color: "var(--muted)" }}>no class year on the account</span>;
                      })() : (
                        <GradePicker small value={p.grade} onChange={async g => {
                          await updateTryoutPlayer(p.id, { grade: g });
                          await load(); onChanged?.();
                        }} />
                      )}
                    </div>
                    {matchesFor(p).slice(0, 2).map(a => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 5, background: "rgba(240,192,64,0.14)", color: "var(--gold-text)" }}>
                          Possible match: {a.name}{a.home_roster_id ? ` (${rosterName(a.home_roster_id) ?? "roster"})` : ""}
                        </span>
                        <button onClick={() => swapForAccount(p, a)} style={{ ...btn, padding: "2px 8px", fontSize: 11 }}>Swap for account</button>
                      </div>
                    ))}
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
                                color: on ? "var(--gold-text)" : "var(--muted)",
                              }}>
                              {r.name}
                            </button>
                          );
                        })}
                        {(p.roster_ids ?? []).length === 0 && (
                          <span style={{ fontSize: 10, color: "var(--tx-ff9b9b)" }}>no teams set</span>
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
