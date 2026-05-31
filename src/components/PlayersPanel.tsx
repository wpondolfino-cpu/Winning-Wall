// src/components/PlayersPanel.tsx  (Coach view — manage players)
import { useState } from "react";
import ProgressPanel from "./ProgressPanel";
import { supabase, Score, Workout, GRADE_CATEGORIES, GradeCategory, approveUser, rejectUser } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  allScores: Score[];
  workouts: Workout[];
}

interface EditPlayer {
  id: string;
  name: string;
  grade_category: string;
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

export default function PlayersPanel({ allScores, workouts }: Props) {
  const { leaderboard, loading, refresh } = useLeaderboard();

  // ── Add player manually ──
  const [showAdd, setShowAdd]         = useState(false);
  const [addName, setAddName]         = useState("");
  const [addEmail, setAddEmail]       = useState("");
  const [addPass, setAddPass]         = useState("");
  const [addGrade, setAddGrade]       = useState<GradeCategory>(GRADE_CATEGORIES[0]);
  const [addSaving, setAddSaving]     = useState(false);
  const [addError, setAddError]       = useState("");

  // ── Invite by email ──
  const [activeTab, setActiveTab]     = useState<"players"|"coaches">("players");
  const [showInvite, setShowInvite]   = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg]     = useState("");

  // ── Edit player ──
  const [editPlayer, setEditPlayer]   = useState<EditPlayer | null>(null);
  const [editSaving, setEditSaving]   = useState(false);
  const [editError, setEditError]     = useState("");
  const [removing, setRemoving]         = useState<string | null>(null);
  const [pendingCoaches, setPendingCoaches] = useState<any[]>([]);
  const [approvingCoach, setApprovingCoach] = useState<string | null>(null);
  const [coaches, setCoaches]               = useState<any[]>([]);
  const [addCoachName, setAddCoachName]     = useState("");
  const [addCoachEmail, setAddCoachEmail]   = useState("");
  const [addCoachPass, setAddCoachPass]     = useState("");
  const [addCoachSaving, setAddCoachSaving] = useState(false);
  const [showAddCoach, setShowAddCoach]     = useState(false);
  const [inviteCoachEmail, setInviteCoachEmail] = useState("");
  const [showInviteCoach, setShowInviteCoach]   = useState(false);
  const [viewingPlayer, setViewingPlayer] = useState<{id:string;name:string} | null>(null);
  const [pendingPlayers, setPendingPlayers] = useState<any[]>([]);
  const [approving, setApproving]         = useState<string | null>(null);

  // ── Remove / delete player ──
  async function removePlayer(id: string, name: string) {
    if (!window.confirm(
      `Remove access for "${name}"?\n\nTheir scores will stay on the leaderboard but they will no longer be able to log in. You can restore them later by editing their account.`
    )) return;
    setRemoving(id);
    try {
      const { error } = await supabase.from("profiles").update({ role: "inactive" as any }).eq("id", id);
      if (error) throw error;
      refresh();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setRemoving(null); }
  }

  async function deletePlayer(id: string, name: string) {
    if (!window.confirm(
      `PERMANENTLY DELETE "${name}"?\n\nThis removes them AND all their scores. This cannot be undone.`
    )) return;
    setRemoving(id);
    try {
      await supabase.from("scores").delete().eq("player_id", id);
      const { error } = await supabase.from("profiles").delete().eq("id", id);
      if (error) throw error;
      refresh();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setRemoving(null); }
  }

  // ── Edit scores ──
  const [editScoresFor, setEditScoresFor] = useState<string | null>(null); // player id
  const [playerScores, setPlayerScores]   = useState<EditScore[]>([]);
  const [scoreSaving, setScoreSaving]     = useState(false);

  const now = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

  const playersWithStatus = leaderboard.map(entry => {
    const lastLog = entry.last_logged_at ? new Date(entry.last_logged_at).getTime() : 0;
    const daysInactive = lastLog > 0 ? Math.round((now - lastLog) / 86400000) : null;
    const isInactive = !lastLog || (now - lastLog) > FOURTEEN_DAYS;
    const workoutsLogged = allScores.filter(s => s.player_id === entry.id).length;
    return { ...entry, daysInactive, isInactive, workoutsLogged };
  });

  const inactiveCount = playersWithStatus.filter(p => p.isInactive).length;

  // ── Load pending users ──
  useState(() => { loadPending(); });

  async function loadPending() {
    const { data } = await supabase.from("profiles")
      .select("id,name,role,grade_category,created_at,email")
      .in("role", ["pending_player", "pending_coach"])
      .order("created_at", { ascending: true });
    const all = data ?? [];
    setPendingPlayers(all.filter(p => p.role === "pending_player"));
    setPendingCoaches(all.filter(p => p.role === "pending_coach"));
  }

  async function handleApprove(id: string, role: "player" | "coach") {
    setApproving(id);
    try {
      await approveUser(id, role);
      await loadPending();
      refresh();
    } catch (e: any) {
      alert("Approval failed: " + e.message + "\n\nMake sure you ran 013_approval_rls.sql in Supabase.");
    } finally { setApproving(null); }
  }

  async function handleReject(id: string, name: string) {
    if (!window.confirm(`Reject "${name}"? This will delete their account.`)) return;
    setApproving(id);
    try {
      await rejectUser(id);
      await loadPending();
    } catch (e: any) {
      alert("Rejection failed: " + e.message + "\n\nMake sure you ran 013_approval_rls.sql in Supabase.");
    } finally { setApproving(null); }
  }

  // ── Add player manually ──
  async function addPlayer() {
    if (!addName.trim() || !addEmail.trim() || !addPass.trim()) {
      setAddError("Please fill in name, email, and password."); return;
    }
    setAddSaving(true); setAddError("");
    try {
      // Create auth user via admin API (uses service role via edge function in prod;
      // for now uses signUp which works on free tier)
      const { data, error } = await supabase.auth.signUp({
        email: addEmail,
        password: addPass,
        options: { data: { name: addName, role: "player", grade_category: addGrade, must_change_password: true } },
      });
      // Coach-added players are pre-approved — must change their temp password on first login
      if (error) throw error;
      setShowAdd(false); setAddName(""); setAddEmail(""); setAddPass("");
      setAddGrade(GRADE_CATEGORIES[0]);
      refresh();
    } catch (e: any) { setAddError(e.message); }
    finally { setAddSaving(false); }
  }

  // ── Invite player by email ──
  async function invitePlayer() {
    if (!inviteEmail.trim()) return;
    setInviteSending(true); setInviteMsg("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(inviteEmail, {
        redirectTo: window.location.origin,
      });
      // We use resetPasswordForEmail as a proxy — in production wire up
      // supabase.auth.admin.inviteUserByEmail via an Edge Function
      if (error) throw error;
      setInviteMsg(`✓ Invite sent to ${inviteEmail}`);
      setInviteEmail("");
    } catch (e: any) { setInviteMsg("Error: " + e.message); }
    finally { setInviteSending(false); }
  }

  // ── Open edit player ──
  function openEditPlayer(p: typeof playersWithStatus[0]) {
    setEditPlayer({ id: p.id, name: p.name, grade_category: p.grade_category ?? GRADE_CATEGORIES[0] });
    setEditError("");
  }

  // ── Save player edits ──
  async function savePlayerEdit() {
    if (!editPlayer) return;
    setEditSaving(true); setEditError("");
    try {
      const { error } = await supabase.from("profiles").update({
        name: editPlayer.name,
        grade_category: editPlayer.grade_category,
      }).eq("id", editPlayer.id);
      if (error) throw error;
      setEditPlayer(null);
      refresh();
    } catch (e: any) { setEditError(e.message); }
    finally { setEditSaving(false); }
  }

  // ── Open score editor for a player ──
  async function openEditScores(playerId: string) {
    const scores = allScores.filter(s => s.player_id === playerId);
    const mapped: EditScore[] = scores.map(s => ({
      id: s.id,
      workout_id: s.workout_id,
      workout_title: workouts.find(w => w.id === s.workout_id)?.title ?? "Unknown",
      made: s.made,
      reps: s.reps,
      sprint_secs: s.sprint_secs,
      self_points: s.self_points,
    }));
    setPlayerScores(mapped);
    setEditScoresFor(playerId);
  }

  // ── Save score edits ──
  async function saveScore(sc: EditScore) {
    setScoreSaving(true);
    try {
      const { error } = await supabase.from("scores").update({
        made: sc.made, reps: sc.reps,
        sprint_secs: sc.sprint_secs, self_points: sc.self_points,
      }).eq("id", sc.id);
      if (error) throw error;
    } catch (e: any) { alert("Error saving score: " + e.message); }
    finally { setScoreSaving(false); }
  }

  async function deleteScore(scoreId: string) {
    if (!window.confirm("Delete this score entry?")) return;
    const { error } = await supabase.from("scores").delete().eq("id", scoreId);
    if (error) { alert("Error: " + error.message); return; }
    setPlayerScores(ps => ps.filter(s => s.id !== scoreId));
  }

  if (loading) return <div className="loading">Loading player data…</div>;

  return (
    <div className="panel active">
      <div className="section-title">Players & Coaches</div>
      {/* ── Tabs ── */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 10, padding: 4, marginBottom: 16, border: "1px solid var(--border)", width: "fit-content" }}>
        <button onClick={() => setActiveTab("players")} style={{ padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: activeTab === "players" ? "var(--royal)" : "transparent", color: activeTab === "players" ? "#fff" : "var(--muted)" }}>👥 Players</button>
        <button onClick={() => setActiveTab("coaches")} style={{ padding: "7px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: activeTab === "coaches" ? "var(--royal)" : "transparent", color: activeTab === "coaches" ? "#fff" : "var(--muted)" }}>🏀 Coaches</button>
      </div>
      <div className="section-sub">Manage your roster — add, edit, and invite players</div>

      {/* ── Action buttons ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => { setShowAdd(a => !a); setShowInvite(false); }} style={{
          background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
          padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>➕ Add Player</button>
        <button onClick={() => { setShowInvite(a => !a); setShowAdd(false); }} style={{
          background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>✉️ Invite by Email</button>
      </div>

      {/* ── Add Player Form ── */}
      {showAdd && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Add Player Manually</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Full Name</label>
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. Marcus Johnson"
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade / Level</label>
                <select value={addGrade} onChange={e => setAddGrade(e.target.value as GradeCategory)}
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                  {GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label>
                <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="player@email.com"
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Temporary Password</label>
                <input type="text" value={addPass} onChange={e => setAddPass(e.target.value)} placeholder="Min 6 characters"
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              💡 Share the email and temporary password with the player. They can change their password after signing in.
            </div>
            {addError && <div className="error-msg">{addError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={addPlayer} disabled={addSaving} className="btn-primary" style={{ flex: 1 }}>
                {addSaving ? "Adding…" : "Add Player"}
              </button>
              <button onClick={() => setShowAdd(false)} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite by Email ── */}
      {showInvite && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Invite Player by Email</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
            Enter the player's email address. They'll receive a link to set up their account on AHS Winning Wall.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="player@email.com"
              style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            <button onClick={invitePlayer} disabled={inviteSending} style={{
              background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8,
              padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            }}>{inviteSending ? "Sending…" : "Send Invite"}</button>
          </div>
          {inviteMsg && <div style={{ marginTop: 10, fontSize: 13, color: inviteMsg.startsWith("✓") ? "#5de098" : "#ff7b7b" }}>{inviteMsg}</div>}
        </div>
      )}

      {activeTab === "players" && (
        <div>

      {/* ── Pending Approvals ── */}
      {(pendingPlayers.length > 0 || pendingCoaches.length > 0) && (
        <div style={{ background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 14 }}>
            ⏳ Pending Approvals ({pendingPlayers.length + pendingCoaches.length})
          </div>

          {pendingCoaches.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>
                🏀 Coach Requests — Admin Approval Required
              </div>
              {pendingCoaches.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface2)", borderRadius: 10, marginBottom: 6, border: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.email} · Requested coach access · {new Date(p.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "#ff7b7b", fontStyle: "italic" }}>Admin only</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pendingPlayers.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>
                ⚡ Player Requests
              </div>
              {pendingPlayers.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface2)", borderRadius: 10, marginBottom: 6, border: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.email} · {p.grade_category} · Requested {new Date(p.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleApprove(p.id, "player")} disabled={approving === p.id}
                      style={{ background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                      ✓ Approve
                    </button>
                    <button onClick={() => handleReject(p.id, p.name)} disabled={approving === p.id}
                      style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                      ✕ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Stats ── */}
      {inactiveCount > 0 && (
        <div className="notif-banner">
          <span style={{ fontSize: 20 }}>🔔</span>
          <div><strong style={{ color: "var(--gold)" }}>{inactiveCount} player{inactiveCount > 1 ? "s have" : " has"}</strong> not logged in 14+ days.</div>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Players</div><div className="stat-value">{playersWithStatus.length}</div></div>
        <div className="stat-card"><div className="stat-label">Active (7d)</div><div className="stat-value" style={{ color: "#5de098" }}>{playersWithStatus.filter(p => !p.isInactive).length}</div></div>
        <div className="stat-card"><div className="stat-label">Needs Nudge</div><div className="stat-value" style={{ color: "#ff7b7b" }}>{inactiveCount}</div></div>
      </div>

      {/* ── Player Table ── */}
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
            {playersWithStatus.map(p => (
              <tr key={p.id}>
                <td>
                  <strong style={{ cursor: "pointer", color: "var(--royal-light)", textDecoration: "underline dotted" }} onClick={() => setViewingPlayer({id: p.id, name: p.name})}>{p.name}</strong>
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
                    <button onClick={() => openEditPlayer(p)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                    <button onClick={() => openEditScores(p.id)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "#93b4ff", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>📊 Scores</button>
                    <button onClick={() => removePlayer(p.id, p.name)} disabled={removing === p.id} style={{ background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", color: "var(--gold)", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🚫 Remove</button>
                    <button onClick={() => deletePlayer(p.id, p.name)} disabled={removing === p.id} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🗑 Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Edit Player Modal ── */}
      {editPlayer && (
        <div className="modal-overlay open" onClick={() => setEditPlayer(null)}>
          <div className="log-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditPlayer(null)}>✕</button>
            <div className="modal-title">Edit Player</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                <input value={editPlayer.name} onChange={e => setEditPlayer({ ...editPlayer, name: e.target.value })}
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade / Level</label>
                <select value={editPlayer.grade_category} onChange={e => setEditPlayer({ ...editPlayer, grade_category: e.target.value })}
                  style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }}>
                  {GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              {editError && <div className="error-msg">{editError}</div>}
              <button className="btn-primary" onClick={savePlayerEdit} disabled={editSaving}>
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
            {playerScores.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 14, padding: "20px 0" }}>No scores logged yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {playerScores.map((sc, i) => (
                  <div key={sc.id} style={{ background: "var(--surface2)", borderRadius: 10, padding: "14px", border: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "var(--text)" }}>{sc.workout_title}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                      {[
                        { label: "Made", field: "made" as keyof EditScore },
                        { label: "Reps", field: "reps" as keyof EditScore },
                        { label: "Sprint (s)", field: "sprint_secs" as keyof EditScore },
                        { label: "Self Pts", field: "self_points" as keyof EditScore },
                      ].map(({ label, field }) => (
                        <div key={field}>
                          <label style={{ fontSize: 10, color: "var(--muted)", display: "block", marginBottom: 3 }}>{label}</label>
                          <input type="number" value={(sc[field] as number) ?? 0}
                            onChange={e => {
                              const updated = [...playerScores];
                              (updated[i] as any)[field] = parseFloat(e.target.value) || 0;
                              setPlayerScores(updated);
                            }}
                            style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => saveScore(sc)} disabled={scoreSaving} style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "7px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                        {scoreSaving ? "…" : "Save"}
                      </button>
                      <button onClick={() => deleteScore(sc.id)} style={{ background: "rgba(255,107,107,0.15)", color: "#ff7b7b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {/* ── COACHES TAB ── */}
      {activeTab === "coaches" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={() => { setShowAddCoach(a => !a); setShowInviteCoach(false); }} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              ➕ Add Coach
            </button>
            <button onClick={() => { setShowInviteCoach(a => !a); setShowAddCoach(false); }} style={{ background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              ✉️ Invite by Email
            </button>
          </div>

          {showAddCoach && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Add Coach Manually</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                  <input value={addCoachName} onChange={e => setAddCoachName(e.target.value)} placeholder="Coach name" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label>
                  <input type="email" value={addCoachEmail} onChange={e => setAddCoachEmail(e.target.value)} placeholder="coach@school.edu" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Temp Password</label>
                  <input type="password" value={addCoachPass} onChange={e => setAddCoachPass(e.target.value)} placeholder="••••••••" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
              </div>
              <button onClick={addCoach} disabled={addCoachSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {addCoachSaving ? "Adding…" : "Add Coach"}
              </button>
            </div>
          )}

          {showInviteCoach && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Invite Coach by Email</div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <input type="email" value={inviteCoachEmail} onChange={e => setInviteCoachEmail(e.target.value)} placeholder="coach@school.edu"
                  style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} />
                <button onClick={async () => {
                  await supabase.auth.resetPasswordForEmail(inviteCoachEmail);
                  setInviteCoachEmail(""); setShowInviteCoach(false); alert("Invite sent!");
                }} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Send Invite</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {coaches.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {c.avatar_url ? <img src={c.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>{c.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{c.email} · <span style={{ color: c.role === "admin" ? "var(--gold)" : "#93b4ff" }}>{c.role}</span></div>
                </div>
              </div>
            ))}
            {coaches.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 0" }}>No coaches yet.</div>}
          </div>
        </div>
      )}

      {/* ── Player Progress Modal ── */}
      {viewingPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "20px 0" }} onClick={() => setViewingPlayer(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(720px, 96vw)", maxHeight: "90vh", overflowY: "auto", position: "relative" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>
                📈 {viewingPlayer.name}'s Progress
              </div>
              <button onClick={() => setViewingPlayer(null)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", padding: 0 }}>✕</button>
            </div>
            <div style={{ padding: "0 4px" }}>
              <ProgressPanel overrideUserId={viewingPlayer.id} profile={{} as any} myScores={[]} workouts={workouts} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
