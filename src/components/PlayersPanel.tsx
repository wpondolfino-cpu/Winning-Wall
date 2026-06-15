// src/components/PlayersPanel.tsx  (Coach view — manage players)
import { useState, useEffect } from "react";
import { supabase, Score, Workout, ScoreAttempt, GRADE_CATEGORIES, GradeCategory, approveUser, rejectUser, resetPlayerScores } from "../lib/supabase";
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
  scoring_type: string;
  made: number;
  reps: number;
  sprint_secs: number;
  self_points: number;
  first_place_pts?: number;
  second_place_pts?: number;
  third_place_pts?: number;
}

interface StreakBonus {
  id: string;
  player_id: string;
  points: number;
  reason: string;
  awarded_at: string;
}

interface PasswordResetRequest {
  id: string;
  player_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
}

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

function PlayerCalendar({ attempts }: { attempts: ScoreAttempt[] }) {
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear]   = useState(now.getFullYear());

  const loggedDays = new Set(attempts.map(a => {
    const d = new Date(a.attempted_at);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }));

  const isLogged = (day: number) => loggedDays.has(`${calYear}-${calMonth}-${day}`);
  const isToday  = (day: number) => calYear === now.getFullYear() && calMonth === now.getMonth() && day === now.getDate();
  const { firstDay, daysInMonth } = getCalendarDays(calYear, calMonth);
  const monthName = new Date(calYear, calMonth).toLocaleString("default", { month: "long", year: "numeric" });
  const loggedCount = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter(isLogged).length;

  function prevMonth() { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); } else setCalMonth(m => m-1); }
  function nextMonth() {
    if (calYear === now.getFullYear() && calMonth === now.getMonth()) return;
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); } else setCalMonth(m => m+1);
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>‹</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--text)", letterSpacing: 1 }}>{monthName}</div>
          <div style={{ fontSize: 11, color: loggedCount > 0 ? "#5de098" : "var(--muted)" }}>{loggedCount} day{loggedCount !== 1 ? "s" : ""} logged</div>
        </div>
        <button onClick={nextMonth} style={{ background: "none", border: "none", color: calYear === now.getFullYear() && calMonth === now.getMonth() ? "var(--border)" : "var(--muted)", fontSize: 18, cursor: "pointer" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i+1).map(day => (
          <div key={day} style={{
            aspectRatio: "1", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: isToday(day) ? 700 : 400,
            background: isLogged(day) ? "var(--royal)" : isToday(day) ? "rgba(26,63,168,0.2)" : "var(--surface)",
            color: isLogged(day) ? "#fff" : isToday(day) ? "#93b4ff" : "var(--muted)",
            border: isToday(day) ? "1px solid var(--royal)" : "1px solid transparent",
          }}>{day}</div>
        ))}
      </div>
    </div>
  );
}

function PlayerChart({ attempts, workouts }: { attempts: ScoreAttempt[]; workouts: Workout[] }) {
  const [sel, setSel] = useState("all");
  const workoutIds = Array.from(new Set(attempts.map(a => a.workout_id)));
  const withAttempts = workouts.filter(w => workoutIds.includes(w.id));
  const filtered = (sel === "all" ? attempts : attempts.filter(a => a.workout_id === sel))
    .slice().sort((a, b) => new Date(a.attempted_at).getTime() - new Date(b.attempted_at).getTime()).slice(-20);
  if (filtered.length < 2) return <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>Log at least 2 attempts to see the chart 📈</div>;
  const scores = filtered.map(a => a.self_points > 0 ? a.self_points : a.made + a.reps);
  const maxScore = Math.max(...scores), minScore = Math.min(...scores), range = maxScore - minScore || 1;
  const W = 300, H = 100, PAD = 16;
  const pts = scores.map((s, i) => ({ x: PAD + (i/(scores.length-1))*(W-PAD*2), y: PAD + (1-(s-minScore)/range)*(H-PAD*2) }));
  const polyline = pts.map(p => `${p.x},${p.y}`).join(" ");
  const area = `M${pts[0].x},${H} ` + pts.map(p => `L${p.x},${p.y}`).join(" ") + ` L${pts[pts.length-1].x},${H} Z`;
  const trend = scores[scores.length-1] > scores[0] ? "#5de098" : scores[scores.length-1] < scores[0] ? "#ff7b7b" : "var(--gold)";
  return (
    <div>
      {withAttempts.length > 1 && (
        <select value={sel} onChange={e => setSel(e.target.value)} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", marginBottom: 10 }}>
          <option value="all">All Drills</option>
          {withAttempts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", overflow: "visible" }}>
        <path d={area} fill={trend} fillOpacity="0.08" />
        <polyline points={polyline} fill="none" stroke={trend} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill={i === pts.length-1 ? trend : "var(--surface2)"} stroke={trend} strokeWidth="1.5" />)}
        <text x={pts[0].x} y={pts[0].y-7} textAnchor="middle" fontSize="9" fill="var(--muted)">{scores[0]}</text>
        <text x={pts[pts.length-1].x} y={pts[pts.length-1].y-7} textAnchor="middle" fontSize="9" fill={trend} fontWeight="bold">{scores[scores.length-1]}</text>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
        <span>{new Date(filtered[0].attempted_at).toLocaleDateString()}</span>
        <span style={{ color: trend, fontWeight: 600 }}>{scores[scores.length-1] > scores[0] ? "↑ Improving!" : scores[scores.length-1] < scores[0] ? "↓ Keep grinding" : "→ Consistent"}</span>
        <span>{new Date(filtered[filtered.length-1].attempted_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function PlayerProgressModal({ playerId, playerName, workouts, allScores, onClose }: {
  playerId: string; playerName: string; workouts: Workout[]; allScores: Score[]; onClose: () => void;
}) {
  const [profile, setProfile]     = useState<any>(null);
  const [attempts, setAttempts]   = useState<ScoreAttempt[]>([]);
  const [loading, setLoading]     = useState(true);
  const [view, setView]           = useState<"calendar"|"history"|"chart">("calendar");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [profRes, attRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", playerId).single(),
        supabase.from("score_attempts").select("*").eq("player_id", playerId).order("attempted_at", { ascending: false }),
      ]);
      setProfile(profRes.data);
      setAttempts(attRes.data ?? []);
      setLoading(false);
    })();
  }, [playerId]);

  const totalPoints = allScores.filter(s => s.player_id === playerId).reduce((sum, s) => sum + (s.points ?? 0), 0);
  const initials = playerName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "20px 0" }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(640px, 96vw)", position: "relative" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1, borderRadius: "16px 16px 0 0" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>📈 {playerName}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", padding: 0 }}>✕</button>
        </div>
        <div style={{ padding: 18 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "12px 14px", background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {profile?.avatar_url ? <img src={profile.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--gold)" }}>{initials}</span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{profile?.name ?? playerName}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{profile?.grade_category ?? "—"} · {attempts.length} attempts</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--gold)", lineHeight: 1 }}>{totalPoints}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>pts</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "var(--surface2)", borderRadius: 10, padding: 4, border: "1px solid var(--border)" }}>
                {(["calendar","history","chart"] as const).map(t => (
                  <button key={t} onClick={() => setView(t)} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: view === t ? "var(--royal)" : "transparent", color: view === t ? "#fff" : "var(--muted)" }}>
                    {t === "calendar" ? "📅 Calendar" : t === "history" ? "📋 History" : "📈 Chart"}
                  </button>
                ))}
              </div>
              {view === "calendar" && <PlayerCalendar attempts={attempts} />}
              {view === "history" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {attempts.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "20px 0" }}>No attempts yet.</div>
                  ) : attempts.slice(0, 30).map(a => {
                    const w = workouts.find(wk => wk.id === a.workout_id);
                    const raw = a.self_points > 0 ? a.self_points : (a.made + a.reps);
                    return (
                      <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--surface2)", borderRadius: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: "var(--text)" }}>{w?.emoji ?? "🏀"} {w?.title ?? "Unknown drill"}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)" }}>{new Date(a.attempted_at).toLocaleDateString()}</div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#93b4ff" }}>{raw}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {view === "chart" && <PlayerChart attempts={attempts} workouts={workouts} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlayersPanel({ allScores, workouts }: Props) {
  const { leaderboard, loading, refresh } = useLeaderboard();

  const [showAdd, setShowAdd]         = useState(false);
  const [addName, setAddName]         = useState("");
  const [addEmail, setAddEmail]       = useState("");
  const [addPass, setAddPass]         = useState("");
  const [addGrade, setAddGrade]       = useState<GradeCategory>(GRADE_CATEGORIES[0]);
  const [addSaving, setAddSaving]     = useState(false);
  const [addError, setAddError]       = useState("");
  const [activeTab, setActiveTab]     = useState<"players"|"coaches">("players");
  const [showInvite, setShowInvite]   = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg]     = useState("");
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
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [bulkResetting, setBulkResetting] = useState(false);
  const [pendingPlayers, setPendingPlayers] = useState<any[]>([]);
  const [approving, setApproving]         = useState<string | null>(null);

  // ── Password reset requests ──
  const [passwordResets, setPasswordResets] = useState<PasswordResetRequest[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);

  async function loadPasswordResets() {
    const { data } = await supabase
      .from("password_reset_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    setPasswordResets(data ?? []);
  }

  async function handlePasswordReset(req: PasswordResetRequest) {
    if (!window.confirm(`Reset password for ${req.name} to Bombardiers1!?\n\nThey will be prompted to change it on next login.`)) return;
    setResetting(req.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ player_id: req.player_id, request_id: req.id }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Reset failed");
      // Remove from list immediately, then reload to confirm
      setPasswordResets(prev => prev.filter(r => r.id !== req.id));
      await loadPasswordResets();
      alert(`✅ Password for ${req.name} has been reset to Bombardiers1!\n\nTell them to log in and they'll be prompted to set a new password.`);
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setResetting(null);
    }
  }

  async function dismissResetRequest(id: string) {
    await supabase.from("password_reset_requests").update({ status: "dismissed" }).eq("id", id);
    await loadPasswordResets();
  }

  async function resetPerks(playerId: string, name: string) {
    if (window.confirm(`Reset all perks for ${name}?`)) {
      await supabase.from("perk_usage").delete().eq("player_id", playerId);
      alert(`✅ Perks reset for ${name}`);
    }
  }

  async function removePlayer(id: string, name: string) {
    if (!window.confirm(`Remove access for "${name}"?\n\nTheir scores will stay on the leaderboard but they will no longer be able to log in.`)) return;
    setRemoving(id);
    try {
      await supabase.from("profiles").update({ role: "inactive" as any }).eq("id", id);
      refresh();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setRemoving(null); }
  }

  async function deletePlayer(id: string, name: string) {
    if (!window.confirm(`PERMANENTLY DELETE "${name}"?\n\nThis removes them AND all their scores. This cannot be undone.`)) return;
    setRemoving(id);
    try {
      await supabase.from("scores").delete().eq("player_id", id);
      await supabase.from("profiles").delete().eq("id", id);
      refresh();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setRemoving(null); }
  }

  const [editScoresFor, setEditScoresFor] = useState<string | null>(null);
  const [playerScores, setPlayerScores]   = useState<EditScore[]>([]);
  const [playerBonuses, setPlayerBonuses] = useState<StreakBonus[]>([]);
  const [scoreSaving, setScoreSaving]     = useState<string | null>(null);
  const [bonusDeleting, setBonusDeleting] = useState<string | null>(null);
  const [scoreToast, setScoreToast]       = useState("");

  function showScoreToast(msg: string) { setScoreToast(msg); setTimeout(() => setScoreToast(""), 3000); }

  const now = Date.now();
  const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

  const playersWithStatus = leaderboard.map(entry => {
    const lastLog = entry.last_logged_at ? new Date(entry.last_logged_at).getTime() : 0;
    const daysInactive = lastLog > 0 ? Math.round((now - lastLog) / 86400000) : null;
    const isInactive = !lastLog || (now - lastLog) > FOURTEEN_DAYS;
    return { ...entry, daysInactive, isInactive };
  });

  useState(() => { loadPending(); loadCoaches(); loadPasswordResets(); });

  async function loadPending() {
    const { data } = await supabase.from("profiles")
      .select("id,name,role,grade_category,created_at,email")
      .in("role", ["pending_player", "pending_coach"])
      .order("created_at", { ascending: true });
    const all = data ?? [];
    setPendingPlayers(all.filter((p: any) => p.role === "pending_player"));
    setPendingCoaches(all.filter((p: any) => p.role === "pending_coach"));
  }

  async function handleApprove(id: string, role: "player" | "coach") {
    setApproving(id);
    try { await approveUser(id, role); await loadPending(); refresh(); }
    catch (e: any) { alert("Approval failed: " + e.message); }
    finally { setApproving(null); }
  }

  async function handleReject(id: string, name: string) {
    if (!window.confirm(`Reject "${name}"? This will delete their account.`)) return;
    setApproving(id);
    try { await rejectUser(id); await loadPending(); }
    catch (e: any) { alert("Rejection failed: " + e.message); }
    finally { setApproving(null); }
  }

  async function addPlayer() {
    if (!addName.trim() || !addEmail.trim() || !addPass.trim()) { setAddError("Please fill in name, email, and password."); return; }
    setAddSaving(true); setAddError("");
    try {
      await supabase.auth.signUp({ email: addEmail, password: addPass, options: { data: { name: addName, role: "player", grade_category: addGrade, must_change_password: true } } });
      setShowAdd(false); setAddName(""); setAddEmail(""); setAddPass(""); setAddGrade(GRADE_CATEGORIES[0]); refresh();
    } catch (e: any) { setAddError(e.message); }
    finally { setAddSaving(false); }
  }

  async function invitePlayer() {
    if (!inviteEmail.trim()) return;
    setInviteSending(true); setInviteMsg("");
    try {
      await supabase.auth.resetPasswordForEmail(inviteEmail, { redirectTo: window.location.origin });
      setInviteMsg(`✓ Invite sent to ${inviteEmail}`); setInviteEmail("");
    } catch (e: any) { setInviteMsg("Error: " + e.message); }
    finally { setInviteSending(false); }
  }

  function openEditPlayer(p: typeof playersWithStatus[0]) {
    setEditPlayer({ id: p.id, name: p.name, grade_category: p.grade_category ?? GRADE_CATEGORIES[0] });
    setEditError("");
  }

  async function savePlayerEdit() {
    if (!editPlayer) return;
    setEditSaving(true); setEditError("");
    try {
      await supabase.from("profiles").update({ name: editPlayer.name, grade_category: editPlayer.grade_category }).eq("id", editPlayer.id);
      setEditPlayer(null); refresh();
    } catch (e: any) { setEditError(e.message); }
    finally { setEditSaving(false); }
  }

  async function openEditScores(playerId: string) {
    const scores = allScores.filter(s => s.player_id === playerId);
    const mapped: EditScore[] = scores.map(s => {
      const workout = workouts.find(w => w.id === s.workout_id);
      return { id: s.id, workout_id: s.workout_id, workout_title: workout?.title ?? "Unknown", scoring_type: workout?.scoring_type ?? "competitive", made: s.made, reps: s.reps, sprint_secs: s.sprint_secs, self_points: s.self_points, first_place_pts: workout?.first_place_pts, second_place_pts: workout?.second_place_pts, third_place_pts: workout?.third_place_pts };
    });
    setPlayerScores(mapped);
    const { data: bonuses } = await supabase.from("streak_bonuses").select("*").eq("player_id", playerId).order("awarded_at", { ascending: false });
    setPlayerBonuses(bonuses ?? []);
    setEditScoresFor(playerId);
  }

  async function saveScore(sc: EditScore) {
    setScoreSaving(sc.id);
    try {
      await supabase.from("scores").update({ made: sc.made, reps: sc.reps, sprint_secs: sc.sprint_secs, self_points: sc.self_points }).eq("id", sc.id);
      if (sc.scoring_type === "competitive") {
        await supabase.rpc("rerank_workout", { p_workout_id: sc.workout_id, p_first_pts: sc.first_place_pts ?? 3, p_second_pts: sc.second_place_pts ?? 2, p_third_pts: sc.third_place_pts ?? 1 });
      }
      showScoreToast("✅ Score saved!");
    } catch (e: any) { showScoreToast("Error: " + e.message); }
    finally { setScoreSaving(null); }
  }

  async function deleteScore(scoreId: string) {
    if (!window.confirm("Delete this score entry?")) return;
    await supabase.from("scores").delete().eq("id", scoreId);
    setPlayerScores(ps => ps.filter(s => s.id !== scoreId));
  }

  async function deleteBonus(bonusId: string) {
    if (!window.confirm("Delete this bonus?")) return;
    setBonusDeleting(bonusId);
    try {
      await supabase.from("streak_bonuses").delete().eq("id", bonusId);
      setPlayerBonuses(pb => pb.filter(b => b.id !== bonusId));
      showScoreToast("✅ Bonus deleted!");
    } catch (e: any) { showScoreToast("Error: " + e.message); }
    finally { setBonusDeleting(null); }
  }

  async function removeCoach(id: string, name: string) {
    if (!window.confirm(`Remove coach access for "${name}"?`)) return;
    setRemovingCoach(id);
    try { await supabase.from("profiles").update({ role: "inactive" as any }).eq("id", id); await loadCoaches(); }
    catch(e: any) { alert("Error: " + e.message); }
    finally { setRemovingCoach(null); }
  }

  async function deleteCoach(id: string, name: string) {
    if (!window.confirm(`PERMANENTLY DELETE coach "${name}"?`)) return;
    setRemovingCoach(id);
    try { await supabase.from("profiles").delete().eq("id", id); await loadCoaches(); }
    catch(e: any) { alert("Error: " + e.message); }
    finally { setRemovingCoach(null); }
  }

  async function saveCoachEdit() {
    if (!editCoach) return;
    setEditCoachSaving(true);
    try { await supabase.from("profiles").update({ name: editCoach.name, role: editCoach.role }).eq("id", editCoach.id); setEditCoach(null); await loadCoaches(); }
    catch(e: any) { alert("Error: " + e.message); }
    finally { setEditCoachSaving(false); }
  }

  async function bulkResetScores() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Reset scores for ${selectedIds.size} player${selectedIds.size > 1 ? "s" : ""}?`)) return;
    setBulkResetting(true);
    try {
      await resetPlayerScores(Array.from(selectedIds));
      setSelectedIds(new Set());
      alert(`✅ Scores reset for ${selectedIds.size} player${selectedIds.size > 1 ? "s" : ""}.`);
      loadPending();
    } catch(e: any) { alert("Error: " + e.message); }
    finally { setBulkResetting(false); }
  }

  async function reactivatePlayer(id: string) {
    await supabase.from("profiles").update({ role: "player" }).eq("id", id);
    refresh();
  }

  async function loadCoaches() {
    const { data } = await supabase.from("profiles").select("id,name,email,role,avatar_url").in("role", ["coach","admin"]).order("name");
    setCoaches(data ?? []);
  }

  async function addCoach() {
    if (!addCoachName.trim() || !addCoachEmail.trim() || !addCoachPass.trim()) { alert("Please fill in name, email and password."); return; }
    setAddCoachSaving(true);
    try {
      await supabase.auth.signUp({ email: addCoachEmail, password: addCoachPass, options: { data: { name: addCoachName, role: "coach" } } });
      setShowAddCoach(false); setAddCoachName(""); setAddCoachEmail(""); setAddCoachPass(""); await loadCoaches();
    } catch (e: any) { alert(e.message); }
    finally { setAddCoachSaving(false); }
  }

  async function handleApproveCoach(id: string) {
    setApprovingCoach(id);
    await supabase.from("profiles").update({ role: "coach" }).eq("id", id);
    loadPending(); setApprovingCoach(null);
  }

  async function handleRejectCoach(id: string) {
    if (!window.confirm("Reject and delete this coach request?")) return;
    await supabase.from("profiles").delete().eq("id", id);
    loadPending();
  }

  if (loading) return <div className="loading">Loading player data…</div>;

  function getScoreValue(sc: EditScore): number {
    if (sc.scoring_type === "self_reported" || sc.scoring_type === "flat") return sc.self_points;
    return sc.made > 0 ? sc.made : sc.reps;
  }

  function setScoreValue(sc: EditScore, val: number): EditScore {
    if (sc.scoring_type === "self_reported" || sc.scoring_type === "flat") return { ...sc, self_points: val };
    if (sc.reps > 0 && sc.made === 0) return { ...sc, reps: val };
    return { ...sc, made: val };
  }

  function getScoringLabel(sc: EditScore): string {
    if (sc.scoring_type === "flat") return "✅ Flat";
    if (sc.scoring_type === "self_reported") return "✏️ Self-Reported";
    return "🏆 Competitive";
  }

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
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label><input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Player name" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade</label><select value={addGrade} onChange={e => setAddGrade(e.target.value as any)} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}>{GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label><input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="player@school.edu" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Temp Password</label><input type="password" value={addPass} onChange={e => setAddPass(e.target.value)} placeholder="••••••••" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
              </div>
              {addError && <div style={{ color: "#ff7b7b", fontSize: 12, marginBottom: 10 }}>{addError}</div>}
              <button onClick={addPlayer} disabled={addSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{addSaving ? "Adding…" : "Add Player"}</button>
            </div>
          )}

          {showInvite && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title">Invite by Email</div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <input type="email" value={inviteEmail || ""} onChange={e => setInviteEmail(e.target.value)} placeholder="player@school.edu" style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} />
                <button onClick={invitePlayer} disabled={inviteSending} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{inviteSending ? "Sending…" : "Send Invite"}</button>
              </div>
              {inviteMsg && <div style={{ marginTop: 10, fontSize: 13, color: inviteMsg.startsWith("✓") ? "#5de098" : "#ff7b7b" }}>{inviteMsg}</div>}
            </div>
          )}

          {/* ── Password Reset Requests ── */}
          {passwordResets.length > 0 && (
            <div style={{ background: "rgba(255,140,66,0.08)", border: "1px solid rgba(255,140,66,0.35)", borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#ff8c42", letterSpacing: 1, marginBottom: 14 }}>
                🔑 Password Reset Requests ({passwordResets.length})
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                These players used "Forgot Password." Click Reset to set their password back to <strong style={{ color: "#ff8c42" }}>Bombardiers1!</strong> — they'll be prompted to change it on next login.
              </div>
              {passwordResets.map(req => (
                <div key={req.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, marginBottom: 8, border: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{req.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      <span style={{ color: "#93b4ff" }}>{req.email}</span>
                      <span> · {new Date(req.created_at).toLocaleDateString()} {new Date(req.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handlePasswordReset(req)}
                      disabled={resetting === req.id}
                      style={{ background: "rgba(255,140,66,0.15)", border: "1px solid rgba(255,140,66,0.4)", color: "#ff8c42", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                      {resetting === req.id ? "Resetting…" : "🔑 Reset Password"}
                    </button>
                    <button
                      onClick={() => dismissResetRequest(req.id)}
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
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
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{p.name || "Unknown"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.email && <span style={{ color: "#93b4ff" }}>{p.email}</span>}{p.grade_category && <span> · {p.grade_category}</span>}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleApprove(p.id, "player")} style={{ background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✅ Approve</button>
                    <button onClick={() => handleReject(p.id, p.name)} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✕ Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Bulk Reset Bar */}
          {selectedIds.size > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={bulkResetScores} disabled={bulkResetting} style={{ background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.4)", color: "#ff7b7b", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                {bulkResetting ? "Resetting…" : `🗑 Reset ${selectedIds.size} player${selectedIds.size > 1 ? "s" : ""}`}
              </button>
              <button onClick={() => setSelectedIds(new Set())} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Clear</button>
            </div>
          )}

          {/* Active / Inactive tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
            <button onClick={() => setInactiveTab(false)} style={{ background: !inactiveTab ? "var(--royal)" : "var(--surface2)", color: !inactiveTab ? "#fff" : "var(--muted)", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Active</button>
            <button onClick={() => setInactiveTab(true)} style={{ background: inactiveTab ? "var(--royal)" : "var(--surface2)", color: inactiveTab ? "#fff" : "var(--muted)", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Inactive</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {playersWithStatus.filter(p => inactiveTab ? p.isInactive : !p.isInactive).map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)", flexWrap: "wrap" }}>
                <input type="checkbox" checked={selectedIds.has(p.id)} onChange={e => { const next = new Set(selectedIds); e.target.checked ? next.add(p.id) : next.delete(p.id); setSelectedIds(next); }} style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }} />
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
                  <button onClick={() => resetPerks(p.id, p.name)} style={{ background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", color: "var(--gold)", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>🔄 Perks</button>
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
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label><input value={addCoachName} onChange={e => setAddCoachName(e.target.value)} placeholder="Coach name" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Email</label><input type="email" value={addCoachEmail} onChange={e => setAddCoachEmail(e.target.value)} placeholder="coach@school.edu" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Temp Password</label><input type="password" value={addCoachPass} onChange={e => setAddCoachPass(e.target.value)} placeholder="••••••••" style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
              </div>
              <button onClick={addCoach} disabled={addCoachSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{addCoachSaving ? "Adding…" : "Add Coach"}</button>
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
          {pendingCoaches.length > 0 && (
            <div style={{ background: "rgba(147,92,255,0.08)", border: "1px solid rgba(147,92,255,0.3)", borderRadius: 14, padding: "16px 20px", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#b07aff", letterSpacing: 1, marginBottom: 14 }}>🏀 Pending Coach Approvals ({pendingCoaches.length})</div>
              {pendingCoaches.map(c => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, marginBottom: 8, border: "1px solid var(--border)", flexWrap: "wrap", gap: 8 }}>
                  <div><div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>{c.email}</div></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleApproveCoach(c.id)} disabled={approvingCoach === c.id} style={{ background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{approvingCoach === c.id ? "Approving…" : "✅ Approve"}</button>
                    <button onClick={() => handleRejectCoach(c.id)} style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✕ Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {coaches.map(c => (
              <div key={c.id} style={{ marginBottom: 8 }}>
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
                      <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label><input value={editCoach?.name ?? ""} onChange={e => setEditCoach(prev => prev ? { ...prev, name: e.target.value } : null)} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }} /></div>
                      <div><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Role</label><select value={editCoach?.role ?? "coach"} onChange={e => setEditCoach(prev => prev ? { ...prev, role: e.target.value } : null)} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 13 }}><option value="coach">Coach</option><option value="admin">Admin</option></select></div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={saveCoachEdit} disabled={editCoachSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{editCoachSaving ? "Saving…" : "Save"}</button>
                      <button onClick={() => setEditCoach(null)} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {coaches.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "20px 0" }}>No coaches yet.</div>}
          </div>
        </div>
      )}

      {/* Edit Player Modal */}
      {editPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setEditPlayer(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(400px, 96vw)", padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", marginBottom: 16 }}>✏️ Edit Player</div>
            <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label><input value={editPlayer.name} onChange={e => setEditPlayer({ ...editPlayer, name: e.target.value })} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 14, boxSizing: "border-box" as const }} /></div>
            <div style={{ marginBottom: 16 }}><label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>Grade</label><select value={editPlayer.grade_category} onChange={e => setEditPlayer({ ...editPlayer, grade_category: e.target.value })} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 14 }}>{GRADE_CATEGORIES.map(g => <option key={g} value={g}>{g}</option>)}</select></div>
            {editError && <div style={{ color: "#ff7b7b", fontSize: 12, marginBottom: 10 }}>{editError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={savePlayerEdit} disabled={editSaving} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{editSaving ? "Saving…" : "Save"}</button>
              <button onClick={() => setEditPlayer(null)} style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Scores Modal */}
      {editScoresFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "20px 0" }} onClick={() => setEditScoresFor(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(600px, 96vw)", padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", marginBottom: 4 }}>📊 Edit Scores</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Edit any score and click Save. Competitive drills auto-rerank after saving.</div>
            {scoreToast && (
              <div style={{ padding: "8px 14px", background: scoreToast.startsWith("Error") ? "rgba(255,107,107,0.15)" : "rgba(40,180,80,0.15)", border: `1px solid ${scoreToast.startsWith("Error") ? "rgba(255,107,107,0.3)" : "rgba(40,180,80,0.3)"}`, borderRadius: 8, fontSize: 13, color: scoreToast.startsWith("Error") ? "#ff7b7b" : "#5de098", fontWeight: 600, marginBottom: 14 }}>
                {scoreToast}
              </div>
            )}
            {playerScores.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>No scores to edit.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {playerScores.map(sc => (
                <div key={sc.id} style={{ padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{sc.workout_title}</div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: sc.scoring_type === "competitive" ? "rgba(240,192,64,0.15)" : sc.scoring_type === "flat" ? "rgba(40,180,80,0.15)" : "rgba(26,63,168,0.2)", color: sc.scoring_type === "competitive" ? "var(--gold)" : sc.scoring_type === "flat" ? "#5de098" : "#93b4ff" }}>{getScoringLabel(sc)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 4 }}>{sc.scoring_type === "self_reported" || sc.scoring_type === "flat" ? "Points" : "Score"}</label>
                      <input type="number" value={getScoreValue(sc)} onChange={e => setPlayerScores(ps => ps.map(s => s.id === sc.id ? setScoreValue(sc, parseInt(e.target.value) || 0) : s))} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontFamily: "inherit", fontSize: 15, fontWeight: 600, textAlign: "center" }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 20 }}>
                      <button onClick={() => saveScore(sc)} disabled={scoreSaving === sc.id} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>{scoreSaving === sc.id ? "Saving…" : "💾 Save"}</button>
                      <button onClick={() => deleteScore(sc.id)} style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>🗑 Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#ff8c42", letterSpacing: 1 }}>⭐ Bonuses</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{playerBonuses.length} row{playerBonuses.length !== 1 ? "s" : ""} · {playerBonuses.reduce((s, b) => s + (b.points ?? 0), 0)} pts total</div>
              </div>
              {playerBonuses.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)", padding: "12px 0" }}>No bonuses on record.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {playerBonuses.map(b => {
                    const label = b.reason?.startsWith("personal_best") ? `🏅 Beat PB${b.reason.includes(":") ? ` — ${b.reason.split(":")[1]}` : ""}` : b.reason === "daily_completion" ? "✅ Daily Completion" : b.reason === "challenge_win" ? "⚔️ Challenge Win" : b.reason === "streak" ? "🔥 Streak Milestone" : b.reason === "team_win" ? "🏆 Team Win" : "⭐ Bonus";
                    return (
                      <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{label}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{new Date(b.awarded_at).toLocaleDateString()}</div>
                        </div>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#ff8c42", flexShrink: 0 }}>+{b.points}</div>
                        <button onClick={() => deleteBonus(b.id)} disabled={bonusDeleting === b.id} style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", flexShrink: 0 }}>{bonusDeleting === b.id ? "…" : "🗑 Delete"}</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <button onClick={() => setEditScoresFor(null)} style={{ marginTop: 16, background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>Close</button>
          </div>
        </div>
      )}

      {viewingPlayer && <PlayerProgressModal playerId={viewingPlayer.id} playerName={viewingPlayer.name} workouts={workouts} allScores={allScores} onClose={() => setViewingPlayer(null)} />}
    </div>
  );
}
