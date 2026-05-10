// src/components/AdminPanel.tsx
import { useState, useEffect } from "react";
import { supabase, GRADE_CATEGORIES, GradeCategory, Profile, Score, Workout } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  allScores: Score[];
  workouts: Workout[];
}

interface EditScore {
  id: string;
  workout_id: string;
  workout_title: string;
  made: number;
  reps: number;
  sprint_secs: number;
  self_points: number;
}

export default function AdminPanel({ allScores, workouts }: Props) {
  const { leaderboard, loading: lbLoading, refresh: refreshLb } = useLeaderboard();
  const [coaches, setCoaches]     = useState<Profile[]>([]);
  const [loadingCoaches, setLoadingCoaches] = useState(true);
  const [activeTab, setActiveTab] = useState<"players" | "coaches">("players");

  // ── shared add form ──
  const [showAdd, setShowAdd]     = useState(false);
  const [addName, setAddName]     = useState("");
  const [addEmail, setAddEmail]   = useState("");
  const [addPass, setAddPass]     = useState("");
  const [addGrade, setAddGrade]   = useState<GradeCategory>(GRADE_CATEGORIES[0]);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError]   = useState("");

  // ── shared invite ──
  const [showInvite, setShowInvite]       = useState(false);
  const [inviteEmail, setInviteEmail]     = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg]         = useState("");

  // ── edit person ──
  const [editPerson, setEditPerson]   = useState<Profile | null>(null);
  const [editSaving, setEditSaving]   = useState(false);
  const [editError, setEditError]     = useState("");
  const [removing, setRemoving]       = useState<string | null>(null);

  // ── edit scores ──
  const [editScoresFor, setEditScoresFor] = useState<string | null>(null);
  const [playerScores, setPlayerScores]   = useState<EditScore[]>([]);
  const [scoreSaving, setScoreSaving]     = useState(false);

  useEffect(() => { loadCoaches(); }, []);

  async function loadCoaches() {
    setLoadingCoaches(true);
    const { data } = await supabase.from("profiles").select("*")
      .in("role", ["coach", "admin"]).order("name");
    setCoaches(data ?? []);
    setLoadingCoaches(false);
  }

  // ── Add person ──
  async function addPerson() {
    if (!addName.trim() || !addEmail.trim() || !addPass.trim()) {
      setAddError("Please fill in name, email, and password."); return;
    }
    setAddSaving(true); setAddError("");
    try {
      const role = activeTab === "coaches" ? "coach" : "player";
      const { error } = await supabase.auth.signUp({
        email: addEmail,
        password: addPass,
        options: {
          data: {
            name: addName,
            role,
            grade_category: activeTab === "players" ? addGrade : undefined,
            temp_password: addPass,
          },
        },
      });
      if (error) throw error;
      setShowAdd(false); setAddName(""); setAddEmail(""); setAddPass("");
      if (activeTab === "coaches") loadCoaches();
      else refreshLb();
    } catch (e: any) { setAddError(e.message); }
    finally { setAddSaving(false); }
  }

  // ── Invite ──
  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviteSending(true); setInviteMsg("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(inviteEmail, { redirectTo: window.location.origin });
      if (error) throw error;
      setInviteMsg(`✓ Invite sent to ${inviteEmail}`);
      setInviteEmail("");
    } catch (e: any) { setInviteMsg("Error: " + e.message); }
    finally { setInviteSending(false); }
  }

  // ── Edit person ──
  async function saveEdit() {
    if (!editPerson) return;
    setEditSaving(true); setEditError("");
    try {
      const { error } = await supabase.from("profiles").update({
        name: editPerson.name, role: editPerson.role,
        grade_category: editPerson.grade_category,
      }).eq("id", editPerson.id);
      if (error) throw error;
      setEditPerson(null);
      loadCoaches(); refreshLb();
    } catch (e: any) { setEditError(e.message); }
    finally { setEditSaving(false); }
  }

  // ── Remove / Delete ──
  async function removePerson(id: string, name: string) {
    if (!window.confirm(`Remove access for "${name}"?\n\nTheir scores stay on the leaderboard but they cannot log in. You can restore them by editing their account.`)) return;
    setRemoving(id);
    try {
      await supabase.from("profiles").update({ role: "inactive" as any }).eq("id", id);
      loadCoaches(); refreshLb();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setRemoving(null); }
  }

  async function deletePerson(id: string, name: string) {
    if (!window.confirm(`PERMANENTLY DELETE "${name}"?\n\nThis removes them AND all their scores. This cannot be undone.`)) return;
    setRemoving(id);
    try {
      await supabase.from("scores").delete().eq("player_id", id);
      await supabase.from("profiles").delete().eq("id", id);
      loadCoaches(); refreshLb();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setRemoving(null); }
  }

  // ── Edit scores ──
  async function openEditScores(playerId: string) {
    const scores = allScores.filter(s => s.player_id === playerId);
    setPlayerScores(scores.map(s => ({
      id: s.id, workout_id: s.workout_id,
      workout_title: workouts.find(w => w.id === s.workout_id)?.title ?? "Unknown",
      made: s.made, reps: s.reps, sprint_secs: s.sprint_secs, self_points: s.self_points,
    })));
    setEditScoresFor(playerId);
  }

  async function saveScore(sc: EditScore) {
    setScoreSaving(true);
    try {
      await supabase.from("scores").update({ made: sc.made, reps: sc.reps, sprint_secs: sc.sprint_secs, self_points: sc.self_points }).eq("id", sc.id);
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setScoreSaving(false); }
  }

  async function deleteScore(scoreId: string) {
    if (!window.confirm("Delete this score?")) return;
    await supabase.from("scores").delete().eq("id", scoreId);
    setPlayerScores(ps => ps.filter(s => s.id !== scoreId));
  }

  // ── Helpers ──
  const btnStyle = (active: boolean) => ({
    padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer" as const,
    fontFamily: "inherit", fontSize: 13, fontWeight: 600,
    background: active ? "var(--royal)" : "transparent",
    color: active ? "#fff" : "var(--muted)", transition: "all .2s",
  });

  const inputStyle = {
    width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13,
    fontFamily: "inherit", outline: "none",
  } as const;

  const now = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
  const players = leaderboard.map(entry => {
    const lastLog = entry.last_logged_at ? new Date(entry.last_logged_at).getTime() : 0;
    const daysInactive = lastLog > 0 ? Math.round((now - lastLog) / 86400000) : null;
    const isInactive = !lastLog || (now - lastLog) > FOURTEEN_DAYS;
    const workoutsLogged = allScores.filter(s => s.player_id === entry.id).length;
    return { ...entry, daysInactive, isInactive, workoutsLogged };
  });

  return (
    <div className="panel active">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div className="section-title">Admin Panel</div>
        <span style={{ background: "rgba(240,192,64,0.2)", color: "var(--gold)", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid rgba(240,192,64,0.3)" }}>ADMIN</span>
      </div>
      <div className="section-sub">Full control — manage players, coaches, and accounts</div>

      {/* ── Player / Coach tabs ── */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 10, padding: 4, marginBottom: 20, border: "1px solid var(--border)", width: "fit-content" }}>
        <button style={btnStyle(activeTab === "players")} onClick={() => { setActiveTab("players"); setShowAdd(false); setShowInvite(false); }}>👥 Players</button>
        <button style={btnStyle(activeTab === "coaches")} onClick={() => { setActiveTab("coaches"); setShowAdd(false); setShowInvite(false); }}>🏀 Coaches & Admins</button>
      </div>

      {/* ── Action buttons ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setShowAdd(a => !a); setShowInvite(false); setAddError(""); }} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          ➕ Add {activeTab === "coaches" ? "Coach" : "Player"}
        </button>
        <button onClick={() => { setShowInvite(a => !a); setShowAdd(false); setInviteMsg(""); }} style={{ background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          ✉️ Invite by Email
        </button>
      </div>

      {/* ── Add Form ── */}
      {showAdd && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Add {activeTab === "coaches" ? "Coach" : "Player"} Manually</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: activeTab === "players" ? "1fr 1fr" : "1fr 1fr 1fr", gap: 12 }}>
              <div><label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Full Name</label>
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Full name" style={inputStyle} /></div>
              {activeTab === "players" && (
                <div><label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade / Level</label>
                  <select value={addGrade} onChange={e => setAddGrade(e.target.value as GradeCategory)} style={inputStyle}>
                    {GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select></div>
              )}
              <div><label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label>
                <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="email@example.com" style={inputStyle} /></div>
              <div><label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Temporary Password</label>
                <input type="text" value={addPass} onChange={e => setAddPass(e.target.value)} placeholder="Min 6 characters" style={inputStyle} /></div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>💡 Share these credentials with them. They'll be prompted to set their own password on first login.</div>
            {addError && <div className="error-msg">{addError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={addPerson} disabled={addSaving} className="btn-primary" style={{ flex: 1 }}>
                {addSaving ? "Adding…" : `Add ${activeTab === "coaches" ? "Coach" : "Player"}`}
              </button>
              <button onClick={() => setShowAdd(false)} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Form ── */}
      {showInvite && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Invite by Email</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Send an invitation link. They'll receive an email to set up their account.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@example.com"
              style={{ flex: 1, ...inputStyle }} />
            <button onClick={sendInvite} disabled={inviteSending} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {inviteSending ? "Sending…" : "Send Invite"}
            </button>
          </div>
          {inviteMsg && <div style={{ marginTop: 10, fontSize: 13, color: inviteMsg.startsWith("✓") ? "#5de098" : "#ff7b7b" }}>{inviteMsg}</div>}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Players</div><div className="stat-value">{players.length}</div></div>
        <div className="stat-card"><div className="stat-label">Coaches</div><div className="stat-value blue">{coaches.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active (7d)</div><div className="stat-value" style={{ color: "#5de098" }}>{players.filter(p => !p.isInactive).length}</div></div>
      </div>

      {/* ── PLAYERS TABLE ── */}
      {activeTab === "players" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="player-table">
            <thead>
              <tr>
                <th>Player</th>
                <th style={{ textAlign: "center" }}>Rank</th>
                <th style={{ textAlign: "center" }}>Points</th>
                <th style={{ textAlign: "center" }}>Logged</th>
                <th>Last Active</th>
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.map(p => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.grade_category ?? "—"}</div>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)" }}>#{p.rank}</span>
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 600, color: "var(--silver-light)" }}>{p.total_points}</td>
                  <td style={{ textAlign: "center" }}>{p.workoutsLogged}/{workouts.length}</td>
                  <td>
                    <span className={`status-dot ${p.isInactive ? "status-inactive" : p.daysInactive !== null && p.daysInactive > 7 ? "status-warn" : "status-active"}`} />
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {p.daysInactive === null ? "Never" : p.daysInactive === 0 ? "Today" : `${p.daysInactive}d ago`}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 5, justifyContent: "center", flexWrap: "wrap" }}>
                      <button onClick={() => { setEditPerson({ id: p.id, name: p.name, role: "player", grade_category: p.grade_category, created_at: "" }); setEditError(""); }}
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                      <button onClick={() => openEditScores(p.id)}
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "#93b4ff", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>📊 Scores</button>
                      <button onClick={() => removePerson(p.id, p.name)} disabled={removing === p.id}
                        style={{ background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", color: "var(--gold)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🚫 Remove</button>
                      <button onClick={() => deletePerson(p.id, p.name)} disabled={removing === p.id}
                        style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🗑 Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {players.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24, fontSize: 14 }}>No players yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── COACHES TABLE ── */}
      {activeTab === "coaches" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="player-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ textAlign: "center" }}>Role</th>
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {coaches.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: c.role === "admin" ? "rgba(240,192,64,0.2)" : "rgba(26,63,168,0.2)", color: c.role === "admin" ? "var(--gold)" : "#93b4ff" }}>
                      {c.role === "admin" ? "👑 Admin" : "🏀 Coach"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
                      <button onClick={() => { setEditPerson(c); setEditError(""); }}
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                      <button onClick={() => removePerson(c.id, c.name)} disabled={removing === c.id}
                        style={{ background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", color: "var(--gold)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🚫 Remove</button>
                      <button onClick={() => deletePerson(c.id, c.name)} disabled={removing === c.id}
                        style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🗑 Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {coaches.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 24, fontSize: 14 }}>No coaches yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Edit Person Modal ── */}
      {editPerson && (
        <div className="modal-overlay open" onClick={() => setEditPerson(null)}>
          <div className="log-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditPerson(null)}>✕</button>
            <div className="modal-title">Edit Account</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                <input value={editPerson.name} onChange={e => setEditPerson({ ...editPerson, name: e.target.value })} style={{ ...inputStyle, fontSize: 14 }} /></div>
              <div><label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Role</label>
                <select value={editPerson.role} onChange={e => setEditPerson({ ...editPerson, role: e.target.value as any })} style={{ ...inputStyle, fontSize: 14 }}>
                  <option value="player">Player</option>
                  <option value="coach">Coach</option>
                  <option value="admin">Admin</option>
                </select></div>
              {editPerson.role === "player" && (
                <div><label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade / Level</label>
                  <select value={editPerson.grade_category ?? ""} onChange={e => setEditPerson({ ...editPerson, grade_category: e.target.value as GradeCategory })} style={{ ...inputStyle, fontSize: 14 }}>
                    {GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select></div>
              )}
              {editError && <div className="error-msg">{editError}</div>}
              <button className="btn-primary" onClick={saveEdit} disabled={editSaving}>
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Scores Modal ── */}
      {editScoresFor && (
        <div className="modal-overlay open" onClick={() => setEditScoresFor(null)}>
          <div className="log-modal" style={{ width: 560, maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditScoresFor(null)}>✕</button>
            <div className="modal-title">Edit Scores</div>
            {playerScores.length === 0
              ? <div style={{ color: "var(--muted)", fontSize: 14, padding: "20px 0" }}>No scores logged yet.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {playerScores.map((sc, i) => (
                    <div key={sc.id} style={{ background: "var(--surface2)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "var(--text)" }}>{sc.workout_title}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                        {([["Made", "made"], ["Reps", "reps"], ["Sprint (s)", "sprint_secs"], ["Self Pts", "self_points"]] as [string, keyof EditScore][]).map(([label, field]) => (
                          <div key={field}>
                            <label style={{ fontSize: 10, color: "var(--muted)", display: "block", marginBottom: 3 }}>{label}</label>
                            <input type="number" value={(sc[field] as number) ?? 0}
                              onChange={e => { const u = [...playerScores]; (u[i] as any)[field] = parseFloat(e.target.value) || 0; setPlayerScores(u); }}
                              style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => saveScore(sc)} disabled={scoreSaving}
                          style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: 7, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                          {scoreSaving ? "…" : "Save"}
                        </button>
                        <button onClick={() => deleteScore(sc.id)}
                          style={{ background: "rgba(255,107,107,0.15)", color: "#ff7b7b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      )}
    </div>
  );
}
