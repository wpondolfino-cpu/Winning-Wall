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
  const [inactiveTab, setInactiveTab]       = useState(false);
  const [addCoachName, setAddCoachName]     = useState("");
  const [addCoachEmail, setAddCoachEmail]   = useState("");
  const [addCoachPass, setAddCoachPass]     = useState("");
  const [addCoachSaving, setAddCoachSaving] = useState(false);
  const [showAddCoach, setShowAddCoach]     = useState(false);
  const [inviteCoachEmail, setInviteCoachEmail] = useState("");
  const [showInviteCoach, setShowInviteCoach]   = useState(false);
  const [editCoach, setEditCoach]               = useState<{id:string;name:string;role:string} | null>(null);
  const [editCoachSaving, setEditCoachSaving]   = useState(false);
  const [removingCoach, setRemovingCoach]       = useState<string | null>(null);
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
  useState(() => { loadPending(); loadCoaches(); });

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


  async function removeCoach(id: string, name: string) {
    if (!window.confirm(`Remove coach access for "${name}"? They will be set to inactive.`)) return;
    setRemovingCoach(id);
    try {
      await supabase.from("profiles").update({ role: "inactive" as any }).eq("id", id);
      await loadCoaches();
    } catch(e: any) { alert("Error: " + e.message); }
    finally { setRemovingCoach(null); }
  }

  async function deleteCoach(id: string, name: string) {
    if (!window.confirm(`PERMANENTLY DELETE coach "${name}"? This cannot be undone.`)) return;
    setRemovingCoach(id);
    try {
      await supabase.from("profiles").delete().eq("id", id);
      await loadCoaches();
    } catch(e: any) { alert("Error: " + e.message); }
    finally { setRemovingCoach(null); }
  }

  async function saveCoachEdit() {
    if (!editCoach) return;
    setEditCoachSaving(true);
    try {
      await supabase.from("profiles").update({ name: editCoach.name, role: editCoach.role }).eq("id", editCoach.id);
      setEditCoach(null);
      await loadCoaches();
    } catch(e: any) { alert("Error: " + e.message); }
    finally { setEditCoachSaving(false); }
  }

  async function reactivatePlayer(id: string) {
    await supabase.from("profiles").update({ role: "player" }).eq("id", id);
    loadPending();
  }

  async function approvePlayer(id: string) { await handleApprove(id, "player"); }
  async function rejectPlayer(id: string) { await handleReject(id, ""); }

  async function sendInvite() { await invitePlayer(); }

  async function loadCoaches() {
    const { data } = await supabase.from("profiles")
      .select("id,name,email,role,avatar_url")
      .in("role", ["coach","admin"])
      .order("name");
    setCoaches(data ?? []);
  }

  async function addCoach() {
    if (!addCoachName.trim() || !addCoachEmail.trim() || !addCoachPass.trim()) {
      alert("Please fill in name, email and password."); return;
    }
    setAddCoachSaving(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: addCoachEmail, password: addCoachPass,
        options: { data: { name: addCoachName, role: "coach" } },
      });
      if (error) throw error;
      setShowAddCoach(false); setAddCoachName(""); setAddCoachEmail(""); setAddCoachPass("");
      await loadCoaches();
    } catch (e: any) { alert(e.message); }
    finally { setAddCoachSaving(false); }
  }

  async function handleApproveCoach(id: string) {
    setApprovingCoach(id);
    await supabase.from("profiles").update({ role: "coach" }).eq("id", id);
    loadPending();
    setApprovingCoach(null);
  }

  async function handleRejectCoach(id: string) {
    if (!window.confirm("Reject and delete this coach request?")) return;
    await supabase.from("profiles").delete().eq("id", id);
    loadPending();
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

      {/* ══ PLAYERS TAB ══ */}
      {activeTab === "players" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
            <button onClick={() => { setShowAdd(a => !a); setShowInvite(false); }} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>➕ Add Player</button>
            <button onClick={() => { setShowInvite(a => !a); setShowAdd(false); }} style={{ background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✉️ Invite by Email</button>
          </div>

          {showAdd && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title">Add Player Manually</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                  <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Player name" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade</label>
                  <select value={addGrade} onChange={e => setAddGrade(e.target.value as any)} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>
                    {GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label>
                  <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="player@school.edu" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Temp Password</label>
                  <input type="password" value={addPass} onChange={e => setAddPass(e.target.value)} placeholder="••••••••" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
              </div>
              {addError && <div style={{ color: "#ff7b7b", fontSize: 12, marginBottom: 10 }}>{addError}</div>}
              <button onClick={addPlayer} disabled={addSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {addSaving ? "Adding…" : "Add Player"}
              </button>
            </div>
          )}

          {showInvite && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title">Invite by Email</div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <input type="email" value={inviteEmail || ""} onChange={e => setInviteEmail(e.target.value)} placeholder="player@school.edu" style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} />
                <button onClick={sendInvite} disabled={inviteSending} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{inviteSending ? "Sending…" : "Send Invite"}</button>
              </div>
              {inviteMsg && <div style={{ marginTop: 10, fontSize: 13, color: inviteMsg.startsWith("✓") ? "#5de098" : "#ff7b7b" }}>{inviteMsg}</div>}
            </div>
          )}

          {/* Pending Approvals */}
          {(pendingPlayers.length > 0 || pendingCoaches.length > 0) && (
            <div style={{ background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 14 }}>
                ⏳ Pending Approvals ({pendingPlayers.length + pendingCoaches.length})
              </div>
              {pendingPlayers.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, marginBottom: 8, border: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.email} · {p.grade_category}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => approvePlayer(p.id)} style={{ background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✅ Approve</button>
                    <button onClick={() => rejectPlayer(p.id)} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✕ Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Active Players */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
            <button onClick={() => setInactiveTab(false)} style={{ background: !inactiveTab ? "var(--royal)" : "var(--surface2)", color: !inactiveTab ? "#fff" : "var(--muted)", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Active</button>
            <button onClick={() => setInactiveTab(true)} style={{ background: inactiveTab ? "var(--royal)" : "var(--surface2)", color: inactiveTab ? "#fff" : "var(--muted)", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Inactive</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {playersWithStatus.filter(p => inactiveTab ? p.isInactive : !p.isInactive).map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)", flexWrap: "wrap" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {p.avatar_url ? <img src={p.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>{p.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#93b4ff", textDecoration: "underline dotted", cursor: "pointer" }} onClick={() => setViewingPlayer({ id: p.id, name: p.name })}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.grade_category}{p.daysInactive ? ` · ${p.daysInactive}d ago` : ""}</div>
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button onClick={() => openEditPlayer(p)} style={{ background: "rgba(26,63,168,0.15)", border: "1px solid rgba(26,63,168,0.3)", color: "#93b4ff", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                  <button onClick={() => openEditScores(p.id)} style={{ background: "rgba(147,92,255,0.1)", border: "1px solid rgba(147,92,255,0.3)", color: "#b07aff", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>📊 Scores</button>
                  {inactiveTab ? (
                    <button onClick={() => reactivatePlayer(p.id)} style={{ background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>↩️ Restore</button>
                  ) : (
                    <button onClick={() => removePlayer(p.id, p.name)} disabled={removing === p.id} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🚫 Remove</button>
                  )}
                  <button onClick={() => deletePlayer(p.id, p.name)} disabled={removing === p.id} style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🗑 Delete</button>
                </div>
              </div>
            ))}
            {playersWithStatus.filter(p => inactiveTab ? p.isInactive : !p.isInactive).length === 0 && (
              <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 0" }}>{inactiveTab ? "No inactive players." : "No active players."}</div>
            )}
          </div>
        </div>
      )}

      {/* ══ COACHES TAB ══ */}
      {activeTab === "coaches" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={() => { setShowAddCoach(a => !a); setShowInviteCoach(false); }} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>➕ Add Coach</button>
            <button onClick={() => { setShowInviteCoach(a => !a); setShowAddCoach(false); }} style={{ background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✉️ Invite by Email</button>
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
                <input type="email" value={inviteCoachEmail} onChange={e => setInviteCoachEmail(e.target.value)} placeholder="coach@school.edu" style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} />
                <button onClick={async () => { await supabase.auth.resetPasswordForEmail(inviteCoachEmail); setInviteCoachEmail(""); setShowInviteCoach(false); alert("Invite sent!"); }} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Send Invite</button>
              </div>
            </div>
          )}

          {/* Pending Coach Approvals */}
          {pendingCoaches.length > 0 && (
            <div style={{ background: "rgba(147,92,255,0.08)", border: "1px solid rgba(147,92,255,0.3)", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#b07aff", letterSpacing: 1, marginBottom: 14 }}>
                🏀 Pending Coach Approvals ({pendingCoaches.length})
              </div>
              {pendingCoaches.map(c => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, marginBottom: 8, border: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.email}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleApproveCoach(c.id)} disabled={approvingCoach === c.id} style={{ background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                      {approvingCoach === c.id ? "Approving…" : "✅ Approve"}
                    </button>
                    <button onClick={() => handleRejectCoach(c.id)} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✕ Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {coaches.map(c => (
              <div key={c.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {c.avatar_url ? <img src={c.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>{c.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{c.email} · <span style={{ color: c.role === "admin" ? "var(--gold)" : "#93b4ff" }}>{c.role}</span></div>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={() => setEditCoach({ id: c.id, name: c.name, role: c.role })} style={{ background: "rgba(26,63,168,0.15)", border: "1px solid rgba(26,63,168,0.3)", color: "#93b4ff", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                  <button onClick={() => removeCoach(c.id, c.name)} disabled={removingCoach === c.id} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🚫 Remove</button>
                  <button onClick={() => deleteCoach(c.id, c.name)} disabled={removingCoach === c.id} style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🗑 Delete</button>
                </div>
              </div>
              {editCoach?.id === c.id && (
                <div style={{ marginTop: 10, padding: "12px 14px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                      <input value={editCoach.name} onChange={e => setEditCoach({ ...editCoach, name: e.target.value })}
                        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                    <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Role</label>
                      <select value={editCoach.role} onChange={e => setEditCoach({ ...editCoach, role: e.target.value })}
                        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>
                        <option value="coach">Coach</option>
                        <option value="admin">Admin</option>
                      </select></div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={saveCoachEdit} disabled={editCoachSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{editCoachSaving ? "Saving…" : "Save"}</button>
                    <button onClick={() => setEditCoach(null)} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
            </div>
            ))}
            {coaches.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 0" }}>No coaches yet.</div>}
          </div>
        </div>
      )}

      {/* ── Edit Player Modal ── */}
      {editPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setEditPlayer(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(400px, 96vw)", padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", marginBottom: 16 }}>✏️ Edit Player</div>
            <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
              <input value={editPlayer.name} onChange={e => setEditPlayer({ ...editPlayer, name: e.target.value })}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 14, boxSizing: "border-box" as const }} /></div>
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade</label>
              <select value={editPlayer.grade_category} onChange={e => setEditPlayer({ ...editPlayer, grade_category: e.target.value })}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 14 }}>
                {GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}
              </select></div>
            {editError && <div style={{ color: "#ff7b7b", fontSize: 12, marginBottom: 10 }}>{editError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={savePlayerEdit} disabled={editSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{editSaving ? "Saving…" : "Save"}</button>
              <button onClick={() => setEditPlayer(null)} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Scores Modal ── */}
      {editScoresFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "20px 0" }} onClick={() => setEditScoresFor(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(560px, 96vw)", padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", marginBottom: 16 }}>📊 Edit Scores</div>
            {playerScores.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No scores to edit.</div>}
            {playerScores.map(sc => (
              <div key={sc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
                <div style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{sc.workout_title}</div>
                <input type="number" value={sc.made} onChange={e => setPlayerScores(ps => ps.map(s => s.id === sc.id ? { ...s, made: +e.target.value } : s))}
                  onBlur={() => saveScore(sc)} placeholder="Score"
                  style={{ width: 70, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, textAlign: "center" }} />
                <button onClick={() => deleteScore(sc.id)} style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>🗑</button>
              </div>
            ))}
            <button onClick={() => setEditScoresFor(null)} style={{ marginTop: 16, background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>Close</button>
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
              <ProgressPanel overrideUserId={viewingPlayer.id} profile={{ id: viewingPlayer.id, name: viewingPlayer.name, role: "player", grade_category: undefined, avatar_url: undefined } as any} myScores={[]} workouts={workouts} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
