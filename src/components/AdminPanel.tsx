// src/components/AdminPanel.tsx
import { useState, useEffect } from "react";
import { supabase, approveUser, rejectUser, GRADE_CATEGORIES, GradeCategory, Profile, Score, Workout, TEAM_CATEGORIES, TEAM_COLORS, saveTeamCompetition, getActiveTeamCompetition, TeamCompetition, getTeams, Team, toggleTeamCompetition } from "../lib/supabase";
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
  const [toast, setToast]             = useState("");
  const [pendingCoaches, setPendingCoaches] = useState<any[]>([]);
  const [approvingCoach, setApprovingCoach] = useState<string | null>(null);
  const [resetRequests, setResetRequests] = useState<any[]>([]);
  const [resettingPw, setResettingPw] = useState<string | null>(null);

  // ── Team competition state ──
  const [teamComp, setTeamComp]           = useState<TeamCompetition | null>(null);
  const [activeTeams, setActiveTeams]     = useState<Team[]>([]);
  const [numTeams, setNumTeams]           = useState(2);
  const [teamCategory, setTeamCategory]   = useState("🏀 Basketball");
  const [bonusPoints, setBonusPoints]     = useState(10);
  const [teamStartDate, setTeamStartDate] = useState("");
  const [teamEndDate, setTeamEndDate]     = useState("");
  const [previewTeams, setPreviewTeams]   = useState<{name:string;color:string;players:Profile[]}[]>([]);
  const [teamSaving, setTeamSaving]       = useState(false);
  const [teamTogglingOff, setTeamTogglingOff] = useState(false);

  // ── edit scores ──
  const [editScoresFor, setEditScoresFor] = useState<string | null>(null);
  const [playerScores, setPlayerScores]   = useState<EditScore[]>([]);
  const [scoreSaving, setScoreSaving]     = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  useEffect(() => {
    loadPendingCoaches();
    loadResetRequests();
    loadTeamData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTeamData() {
    const comp = await getActiveTeamCompetition();
    setTeamComp(comp);
    if (comp) {
      const teams = await getTeams(comp.id);
      setActiveTeams(teams);
    }
  }

  async function randomizeTeams() {
    // Get all active players
    const { data: players } = await supabase.from("profiles")
      .select("id,name,grade_category,avatar_url")
      .eq("role", "player")
      .order("name");
    if (!players) return;

    // Split by grade
    const upper = players.filter((p:any) => p.grade_category?.includes("11") || p.grade_category?.includes("12") || p.grade_category?.includes("Upper"));
    const lower = players.filter((p:any) => !upper.includes(p));

    // Shuffle both groups
    const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);
    const shuffledUpper = shuffle(upper);
    const shuffledLower = shuffle(lower);

    // Pick random names from category
    const names = [...TEAM_CATEGORIES[teamCategory]];
    const shuffledNames = shuffle(names).slice(0, numTeams);

    // Distribute players evenly across teams with grade balance
    const teams: {name:string;color:string;players:Profile[]}[] = 
      shuffledNames.map((name, i) => ({ name, color: TEAM_COLORS[i % TEAM_COLORS.length], players: [] }));

    // Distribute upperclassmen round-robin
    shuffledUpper.forEach((p, i) => teams[i % numTeams].players.push(p as Profile));
    // Distribute underclassmen round-robin
    shuffledLower.forEach((p, i) => teams[i % numTeams].players.push(p as Profile));

    setPreviewTeams(teams);
  }

  async function confirmTeams() {
    if (previewTeams.length === 0) return;
    if (!teamStartDate || !teamEndDate) { showToast("Please set start and end dates."); return; }
    setTeamSaving(true);
    try {
      const assignments: Record<string, string[]> = {};
      previewTeams.forEach((t: any) => { assignments[t.name] = t.players.map((p: any) => p.id); });
      await saveTeamCompetition(
        numTeams, previewTeams.map(t => t.name), assignments,
        bonusPoints, teamStartDate, teamEndDate
      );
      await loadTeamData();
      setPreviewTeams([]);
      showToast("✅ Team competition started!");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setTeamSaving(false); }
  }

  async function handleToggleTeams(active: boolean) {
    setTeamTogglingOff(true);
    try {
      await supabase.from("team_competitions").update({ is_active: active })
        .eq("id", teamComp?.id ?? "");
      await loadTeamData();
      showToast(active ? "Team competition is now ON 🎯" : "Team competition is now OFF");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setTeamTogglingOff(false); }
  }

  async function loadResetRequests() {
    const { data } = await supabase
      .from("password_reset_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    setResetRequests(data ?? []);
  }

  async function handleResetPassword(req: any) {
    if (!window.confirm(`Reset ${req.name}'s password to "Bombardiers1!"?\n\nThey'll be prompted to change it on next login.`)) return;
    setResettingPw(req.id);
    try {
      // Reset password via RPC
      if (req.player_id) {
        await supabase.rpc("reset_user_password", {
          target_user_id: req.player_id,
          new_password: "Bombardiers1!"
        });
        // Set must_change_password so they get prompted
        await supabase.from("profiles")
          .update({ must_change_password: true })
          .eq("id", req.player_id);
      }
      // Mark request as done
      await supabase.from("password_reset_requests")
        .update({ status: "done" })
        .eq("id", req.id);
      await loadResetRequests();
      showToast(`✅ Password reset for ${req.name}!`);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setResettingPw(null); }
  }

  async function handleDismissRequest(id: string) {
    await supabase.from("password_reset_requests")
      .update({ status: "dismissed" })
      .eq("id", id);
    await loadResetRequests();
  }

  async function loadPendingCoaches() {
    const { data } = await supabase.from("profiles")
      .select("id,name,role,created_at,email")
      .eq("role", "pending_coach")
      .order("created_at", { ascending: true });
    setPendingCoaches(data ?? []);
  }

  async function handleApproveCoach(id: string) {
    setApprovingCoach(id);
    try {
      await approveUser(id, "coach");
      await loadPendingCoaches();
      showToast("Coach approved! 🏀");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setApprovingCoach(null); }
  }

  async function handleRejectCoach(id: string, name: string) {
    if (!window.confirm(`Reject coach request from "${name}"? This deletes their account.`)) return;
    setApprovingCoach(id);
    try {
      await rejectUser(id);
      await loadPendingCoaches();
      showToast("Request rejected.");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setApprovingCoach(null); }
  }

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
        email: addEmail, password: addPass,
        options: { data: { name: addName, role, grade_category: activeTab === "players" ? addGrade : undefined } },
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

      {/* ── Team Competition ── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1, marginBottom: 16 }}>
          🏆 Team Competition
        </div>

        {/* Active competition status */}
        {teamComp && (
          <div style={{ background: teamComp.is_active ? "rgba(40,180,80,0.08)" : "rgba(255,107,107,0.08)", border: `1px solid ${teamComp.is_active ? "rgba(40,180,80,0.3)" : "rgba(255,107,107,0.3)"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: teamComp.is_active ? "#5de098" : "#ff7b7b" }}>
                {teamComp.is_active ? "🟢 Competition Active" : "🔴 Competition Inactive"}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                {teamComp.start_date && `${teamComp.start_date} – ${teamComp.end_date} · `}
                Bonus: +{teamComp.bonus_points} pts · {activeTeams.length} teams
              </div>
            </div>
            <button onClick={() => handleToggleTeams(!teamComp.is_active)} disabled={teamTogglingOff}
              style={{ background: teamComp.is_active ? "rgba(255,107,107,0.15)" : "rgba(40,180,80,0.15)", color: teamComp.is_active ? "#ff7b7b" : "#5de098", border: `1px solid ${teamComp.is_active ? "rgba(255,107,107,0.3)" : "rgba(40,180,80,0.3)"}`, borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
              {teamTogglingOff ? "Updating…" : teamComp.is_active ? "Turn Off" : "Turn On"}
            </button>
          </div>
        )}

        {/* Setup form */}
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>
            {teamComp ? "Create New Competition" : "Set Up Team Competition"}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Number of Teams</label>
              <select value={numTeams} onChange={e => setNumTeams(Number(e.target.value))}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>
                <option value={2}>2 Teams</option>
                <option value={3}>3 Teams</option>
                <option value={4}>4 Teams</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Bonus Points (winner)</label>
              <input type="number" inputMode="numeric" value={bonusPoints} onChange={e => setBonusPoints(Number(e.target.value))} min={1}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", MozAppearance: "textfield" } as React.CSSProperties} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name Category</label>
            <select value={teamCategory} onChange={e => setTeamCategory(e.target.value)}
              style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>
              {Object.keys(TEAM_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Start Date</label>
              <input type="date" value={teamStartDate} onChange={e => setTeamStartDate(e.target.value)}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: teamStartDate ? "var(--text)" : "var(--muted)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", colorScheme: "dark" } as React.CSSProperties} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>End Date</label>
              <input type="date" value={teamEndDate} onChange={e => setTeamEndDate(e.target.value)}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: teamEndDate ? "var(--text)" : "var(--muted)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box", colorScheme: "dark" } as React.CSSProperties} />
            </div>
          </div>

          <button onClick={randomizeTeams}
            style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", marginBottom: 12 }}>
            🎲 Randomize Teams
          </button>

          {/* Preview */}
          {previewTeams.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, fontWeight: 600 }}>Preview — re-randomize or confirm:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {previewTeams.map(team => (
                  <div key={team.name} style={{ background: "var(--surface)", borderRadius: 10, padding: "12px 14px", borderLeft: `4px solid ${team.color}` }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: team.color, marginBottom: 8 }}>{team.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {team.players.map((p: any) => (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 5, background: "var(--surface2)", borderRadius: 20, padding: "3px 10px 3px 4px", fontSize: 11 }}>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", background: team.color + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: team.color }}>
                            {p.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}
                          </div>
                          <span style={{ color: "var(--text)" }}>{p.name.split(" ")[0]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={confirmTeams} disabled={teamSaving}
                style={{ width: "100%", marginTop: 12, background: "#5de098", color: "#051a0a", border: "none", borderRadius: 8, padding: "10px", fontSize: 14, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                {teamSaving ? "Saving…" : "✅ Confirm Teams"}
              </button>
            </div>
          )}
        </div>
      </div>

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
