// src/components/ProgressPanel.tsx
import { useState, useEffect } from "react";
import { supabase, Profile, Score, Workout, ScoreAttempt, getMyAttempts } from "../lib/supabase";
import { Badge, getActiveBadges, checkBadge, PlayerStats } from "../lib/badges";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  profile: Profile;
  myScores: Score[];
  workouts: Workout[];
  overrideUserId?: string;
}

// ── Streak calendar helpers ───────────────────────────────────
function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

function StreakCalendar({ attempts }: { attempts: ScoreAttempt[] }) {
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear]   = useState(now.getFullYear());

  const loggedDays = new Set(
    attempts.map(a => {
      const d = new Date(a.attempted_at);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    })
  );

  function isLogged(day: number) {
    return loggedDays.has(`${calYear}-${calMonth}-${day}`);
  }

  function isToday(day: number) {
    return calYear === now.getFullYear() && calMonth === now.getMonth() && day === now.getDate();
  }

  const { firstDay, daysInMonth } = getCalendarDays(calYear, calMonth);
  const monthName = new Date(calYear, calMonth).toLocaleString("default", { month: "long", year: "numeric" });

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  }
  function nextMonth() {
    const isCurrentMonth = calYear === now.getFullYear() && calMonth === now.getMonth();
    if (isCurrentMonth) return;
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  }

  const loggedCount = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter(isLogged).length;

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px", marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: "0 6px" }}>‹</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--text)", letterSpacing: 1 }}>{monthName}</div>
          <div style={{ fontSize: 11, color: loggedCount > 0 ? "#5de098" : "var(--muted)" }}>
            {loggedCount} day{loggedCount !== 1 ? "s" : ""} logged
          </div>
        </div>
        <button onClick={nextMonth} style={{ background: "none", border: "none", color: calYear === now.getFullYear() && calMonth === now.getMonth() ? "var(--border)" : "var(--muted)", fontSize: 18, cursor: "pointer", padding: "0 6px" }}>›</button>
      </div>
      {/* Day labels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
          <div key={day} style={{
            aspectRatio: "1", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: isToday(day) ? 700 : 400,
            background: isLogged(day) ? "var(--royal)" : isToday(day) ? "rgba(26,63,168,0.2)" : "var(--surface)",
            color: isLogged(day) ? "#fff" : isToday(day) ? "#93b4ff" : "var(--muted)",
            border: isToday(day) ? "1px solid var(--royal)" : "1px solid transparent",
            position: "relative",
          }}>
            {day}
            {isLogged(day) && (
              <div style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: "var(--gold)" }} />
            )}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginTop: 10, justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--muted)" }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--royal)" }} /> Logged
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--muted)" }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(26,63,168,0.2)", border: "1px solid var(--royal)" }} /> Today
        </div>
      </div>
    </div>
  );
}

// ── Simple line chart ─────────────────────────────────────────
function ProgressChart({ attempts, workouts }: { attempts: ScoreAttempt[]; workouts: Workout[] }) {
  const [selectedWorkout, setSelectedWorkout] = useState<string>("all");

  const workoutIds = Array.from(new Set(attempts.map(a => a.workout_id)));
  const workoutsWithAttempts = workouts.filter(w => workoutIds.includes(w.id));

  const filtered = (selectedWorkout === "all" ? attempts : attempts.filter(a => a.workout_id === selectedWorkout))
    .slice().sort((a, b) => new Date(a.attempted_at).getTime() - new Date(b.attempted_at).getTime())
    .slice(-20); // last 20 attempts

  if (filtered.length < 2) return (
    <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "30px 0" }}>
      Log at least 2 attempts to see your progress chart 📈
    </div>
  );

  const scores = filtered.map(a => a.self_points > 0 ? a.self_points : a.sprint_secs > 0 ? a.sprint_secs : a.made + a.reps);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore || 1;

  const W = 300, H = 120, PAD = 20;
  const points = scores.map((s, i) => ({
    x: PAD + (i / (scores.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (s - minScore) / range) * (H - PAD * 2),
    score: s,
    date: new Date(filtered[i].attempted_at).toLocaleDateString(),
  }));

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const area = `M${points[0].x},${H} ` + points.map(p => `L${p.x},${p.y}`).join(" ") + ` L${points[points.length-1].x},${H} Z`;
  const trend = scores[scores.length - 1] > scores[0] ? "#5de098" : scores[scores.length - 1] < scores[0] ? "#ff7b7b" : "var(--gold)";

  return (
    <div>
      {workoutsWithAttempts.length > 1 && (
        <select value={selectedWorkout} onChange={e => setSelectedWorkout(e.target.value)}
          style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 14 }}>
          <option value="all">All Drills Combined</option>
          {workoutsWithAttempts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", overflow: "visible" }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(pct => (
          <line key={pct} x1={PAD} y1={PAD + pct * (H - PAD * 2)} x2={W - PAD} y2={PAD + pct * (H - PAD * 2)}
            stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3" />
        ))}
        {/* Area fill */}
        <path d={area} fill={trend} fillOpacity="0.08" />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke={trend} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill={i === points.length - 1 ? trend : "var(--surface2)"} stroke={trend} strokeWidth="2" />
          </g>
        ))}
        {/* First + last labels */}
        <text x={points[0].x} y={points[0].y - 8} textAnchor="middle" fontSize="9" fill="var(--muted)">{scores[0]}</text>
        <text x={points[points.length-1].x} y={points[points.length-1].y - 8} textAnchor="middle" fontSize="9" fill={trend} fontWeight="bold">{scores[scores.length-1]}</text>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
        <span>{new Date(filtered[0].attempted_at).toLocaleDateString()}</span>
        <span style={{ color: trend, fontWeight: 600 }}>
          {scores[scores.length - 1] > scores[0] ? "↑ Improving!" : scores[scores.length - 1] < scores[0] ? "↓ Keep grinding" : "→ Consistent"}
        </span>
        <span>{new Date(filtered[filtered.length - 1].attempted_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export default function ProgressPanel({ profile, myScores, workouts, overrideUserId }: Props) {
  const [attempts, setAttempts]     = useState<ScoreAttempt[]>([]);
  const [overrideProfile, setOverrideProfile]   = useState<Profile | null>(null);
  const [overrideScores, setOverrideScores]     = useState<Score[] | null>(null);
  const [view, setView]             = useState<"bests" | "history" | "calendar" | "chart">("bests");
  const [allBadges, setAllBadges]   = useState<Badge[]>([]);
  const [champCount, setChampCount] = useState(0);
  const [teamWinsCount, setTeamWinsCount] = useState(0);
  const [myStreak, setMyStreak] = useState(0);
  const { leaderboard }             = useLeaderboard();

  useEffect(() => {
    loadAttempts();
    loadBadges();
    loadChampCount();
    loadTeamWins();
    loadStreak();
    if (overrideUserId) loadOverrideData();
  }, [overrideUserId]);

  async function loadStreak() {
    const uid = overrideUserId ?? (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return;
    const { data } = await supabase.from("streaks").select("current_streak").eq("player_id", uid).single();
    setMyStreak(data?.current_streak ?? 0);
  }

  async function loadOverrideData() {
    const { data: prof } = await supabase.from("profiles").select("*").eq("id", overrideUserId!).single();
    setOverrideProfile(prof);
    const { data: scores } = await supabase.from("scores").select("*").eq("player_id", overrideUserId!);
    setOverrideScores(scores ?? []);
    const { data: att } = await supabase.from("score_attempts").select("*").eq("player_id", overrideUserId!).order("attempted_at", { ascending: false });
    setAttempts(att ?? []);
  }

  async function loadBadges() { setAllBadges(await getActiveBadges()); }

  async function loadTeamWins() {
    const uid = overrideUserId ?? (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return;
    // Count past team competitions where user's team won
    const { data: comps } = await supabase.from("team_competitions")
      .select("id,winning_team_id")
      .not("winning_team_id","is",null);
    if (!comps || comps.length === 0) return;
    const compIds = comps.map((c: any) => c.id);
    const { data: myTeams } = await supabase.from("teams")
      .select("id,competition_id")
      .in("competition_id", compIds);
    const { data: myProfile } = await supabase.from("profiles")
      .select("team_id").eq("id", uid).single();
    if (!myProfile?.team_id || !myTeams) return;
    const myTeamIds = new Set((myTeams as any[]).filter(t => {
      const profs = myTeams.filter((mt: any) => mt.id === myProfile.team_id);
      return profs.length > 0;
    }).map((t: any) => t.id));
    myTeamIds.add(myProfile.team_id);
    let wins = 0;
    for (const comp of comps) {
      const teamsInComp = (myTeams as any[]).filter(t => t.competition_id === comp.id);
      const myTeamInComp = teamsInComp.find(t => myTeamIds.has(t.id));
      if (myTeamInComp && myTeamInComp.id === comp.winning_team_id) wins++;
    }
    setTeamWinsCount(wins);
  }

  async function loadChampCount() {
    const uid = overrideUserId ?? (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return;
    const { count } = await supabase
      .from("biweekly_champions")
      .select("id", { count: "exact", head: true })
      .eq("player_id", uid);
    setChampCount(count ?? 0);
  }

  async function loadAttempts() {
    if (overrideUserId) return; // handled by loadOverrideData
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setAttempts(await getMyAttempts(user.id));
  }

  const effectiveProfile = overrideProfile ?? profile;
  const effectiveScores  = overrideScores ?? myScores;

  const totalPoints   = effectiveScores.reduce((sum, s) => sum + (s.points ?? 0), 0);
  const totalMade     = effectiveScores.reduce((sum, s) => sum + s.made, 0);
  const totalAtt      = effectiveScores.reduce((sum, s) => sum + s.attempts, 0);
  const activeWorkouts = workouts.filter(w => w.is_active !== false);
  const completedCount = effectiveScores.length;
  const completionPct  = activeWorkouts.length > 0 ? Math.round((completedCount / activeWorkouts.length) * 100) : 0;

  // Rank from leaderboard
  const myEntry = leaderboard.find(e => e.id === effectiveProfile?.id);
  const myRank  = myEntry?.rank ?? null;
  const totalPlayers = leaderboard.length;

  const tabBtn = (t: typeof view, label: string) => (
    <button onClick={() => setView(t)} style={{
      flex: 1, padding: "8px 4px", borderRadius: 8, border: "none", cursor: "pointer",
      fontFamily: "inherit", fontSize: 11, fontWeight: 600,
      background: view === t ? "var(--royal)" : "transparent",
      color: view === t ? "#fff" : "var(--muted)", transition: "all .2s", whiteSpace: "nowrap",
    }}>{label}</button>
  );

  return (
    <div className="panel active">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        My Progress
        {champCount > 0 && (
          <span style={{ fontSize: 20, letterSpacing: 2 }} title={`${champCount} biweekly championship${champCount !== 1 ? "s" : ""} won`}>
            {"👑".repeat(champCount)}
          </span>
        )}
      </div>
      <div className="section-sub">Track your growth, {effectiveProfile?.name.split(" ")[0]} 🏀</div>

      {/* ── Rank Banner ── */}
      {myRank && (
        <div style={{
          padding: "14px 18px", marginBottom: 16, borderRadius: 12,
          background: myRank <= 3 ? "rgba(240,192,64,0.12)" : "rgba(26,63,168,0.12)",
          border: `1px solid ${myRank <= 3 ? "rgba(240,192,64,0.3)" : "rgba(26,63,168,0.3)"}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Your Current Rank</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: myRank <= 3 ? "var(--gold)" : "#93b4ff", lineHeight: 1 }}>
              #{myRank} <span style={{ fontSize: 14, color: "var(--muted)", fontFamily: "inherit" }}>of {totalPlayers}</span>
            </div>
          </div>
          <div style={{ fontSize: 32 }}>
            {myRank === 1 ? "👑" : myRank === 2 ? "🥈" : myRank === 3 ? "🥉" : "🔥"}
          </div>
        </div>
      )}

      {/* ── Streak Banner ── */}
      {(() => {
        const daysIntoCurrentCycle = myStreak % 7;
        const daysToNext = daysIntoCurrentCycle === 0 ? 7 : 7 - daysIntoCurrentCycle;
        const nextMilestone = myStreak + daysToNext;
        const totalBonuses = Math.floor(myStreak / 7);
        return (
          <div style={{
            marginBottom: 16, padding: "12px 16px",
            background: myStreak >= 7 ? "rgba(240,192,64,0.10)" : "rgba(26,63,168,0.08)",
            border: `1px solid ${myStreak >= 7 ? "rgba(240,192,64,0.3)" : "var(--border)"}`,
            borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: myStreak >= 7 ? "var(--gold)" : "var(--text)" }}>
                🔥 {myStreak > 0 ? `${myStreak}-Day Streak!` : "Start your streak!"}
                {totalBonuses > 0 && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--gold)" }}>+{totalBonuses * 3} bonus pts earned</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                {myStreak === 0
                  ? "Log a workout today to start a streak. Every 7 consecutive days earns +3 bonus points!"
                  : daysToNext === 1
                  ? `🏆 Log tomorrow to hit ${nextMilestone} days and earn +3 bonus points!`
                  : `${daysToNext} more day${daysToNext !== 1 ? "s" : ""} until ${nextMilestone}-day milestone (+3 pts)`
                }
              </div>
            </div>
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: myStreak >= 7 ? "var(--gold)" : "#93b4ff", lineHeight: 1 }}>{daysIntoCurrentCycle === 0 && myStreak > 0 ? 7 : daysIntoCurrentCycle}/{7}</div>
              <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>cycle</div>
            </div>
          </div>
        );
      })()}

      {/* ── Stats Row ── */}
      <div className="stats-row" style={{ marginBottom: 16 }}>
        <div className="stat-card"><div className="stat-label">Total Points</div><div className="stat-value gold">{totalPoints}</div></div>
        <div className="stat-card"><div className="stat-label">Workouts Done</div><div className="stat-value blue">{effectiveScores.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Attempts</div><div className="stat-value">{attempts.length}</div></div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 10, padding: 4, marginBottom: 20, border: "1px solid var(--border)", gap: 2 }}>
        {tabBtn("bests",    "🏆 Bests")}
        {tabBtn("history",  "📋 History")}
        {tabBtn("calendar", "📅 Calendar")}
        {tabBtn("chart",    "📈 Chart")}
      </div>

      {/* ── PERSONAL BESTS ── */}
      {view === "bests" && (
        <div className="card">
          <div className="card-title">Your Best Score Per Workout</div>
          {effectiveScores.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: 24 }}>
              No workouts logged yet. Head to Workouts to get started! 🏀
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px", padding: "6px 0", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                <div>Workout</div><div style={{ textAlign: "center" }}>Best Score</div><div style={{ textAlign: "center" }}>Points</div>
              </div>
              {effectiveScores.map(s => {
                const w = workouts.find(x => x.id === s.workout_id);
                const bestDisplay = s.self_points > 0 ? `${s.self_points} pts`
                  : s.sprint_secs > 0 ? `${s.sprint_secs}s`
                  : `${s.made + s.reps}`;
                const attemptCount = attempts.filter(a => a.workout_id === s.workout_id).length;
                return (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px", padding: "12px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{w?.title ?? "Unknown"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{w?.category} · {attemptCount} attempt{attemptCount !== 1 ? "s" : ""}</div>
                    </div>
                    <div style={{ textAlign: "center", fontWeight: 700, color: "var(--gold)", fontSize: 16 }}>{bestDisplay}</div>
                    <div style={{ textAlign: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#93b4ff" }}>{s.points}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── ALL ATTEMPTS ── */}
      {view === "history" && (
        <div className="card">
          <div className="card-title">Every Attempt — Full History</div>
          {attempts.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: 24 }}>No attempts yet. Log a workout to start tracking! 🏀</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 80px", padding: "6px 0", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                <div>Workout</div><div style={{ textAlign: "center" }}>Score</div><div style={{ textAlign: "center" }}>Date</div><div style={{ textAlign: "center" }}>PB?</div>
              </div>
              {attempts.map(a => {
                const w = workouts.find(x => x.id === a.workout_id);
                const scoreDisplay = a.self_points > 0 ? `${a.self_points} pts` : a.sprint_secs > 0 ? `${a.sprint_secs}s` : `${a.made + a.reps}`;
                return (
                  <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 80px", padding: "11px 0", borderBottom: "1px solid rgba(176,184,200,0.06)", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{w?.title ?? "Unknown"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{w?.category}</div>
                    </div>
                    <div style={{ textAlign: "center", fontWeight: 600, color: a.is_personal_best ? "var(--gold)" : "var(--silver-light)", fontSize: 14 }}>{scoreDisplay}</div>
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>{new Date(a.attempted_at).toLocaleDateString()}</div>
                    <div style={{ textAlign: "center" }}>
                      {a.is_personal_best
                        ? <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: "rgba(240,192,64,0.2)", color: "var(--gold)" }}>🏆 PB</span>
                        : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>
                      }
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── STREAK CALENDAR ── */}
      {view === "calendar" && (
        <div className="card">
          <div className="card-title">📅 Logging Calendar</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Days you logged at least one workout this month</div>
          <StreakCalendar attempts={attempts} />
        </div>
      )}

      {/* ── PROGRESS CHART ── */}
      {view === "chart" && (
        <div className="card">
          <div className="card-title">📈 Score Progress Over Time</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Your last 20 attempts — see how you're improving</div>
          <ProgressChart attempts={attempts} workouts={workouts} />
        </div>
      )}

      {/* ── BADGES ── */}
      {view === "badges" && (() => {
        const stats: PlayerStats = {
          totalPoints,
          totalWorkouts: effectiveScores.length,
          currentStreak: 0,
          longestStreak: 0,
          isGroupChampion: (profile as any).is_period_champion ?? false,
          hasPerfectScore: myScores.some(s => (s.points ?? 0) >= 5),
          daysActive: attempts.length,
          challengesWon: 0,
          teamWins: teamWinsCount,
        };
        const earned    = allBadges.filter(b => checkBadge(b, stats));
        const notEarned = allBadges.filter(b => !checkBadge(b, stats));
        return (
          <div className="card">
            <div className="card-title">Your Badges — {earned.length}/{allBadges.length} earned</div>
            {allBadges.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: 24 }}>No badges created yet. Ask your coach! 🏅</div>
            )}
            {earned.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "#5de098", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>✅ Earned</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {earned.map(b => (
                    <div key={b.id} style={{ background: "rgba(40,180,80,0.1)", border: "1px solid rgba(40,180,80,0.25)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 24 }}>{b.icon}</div>
                      <div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{b.name}</div><div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{b.description}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {notEarned.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>🔒 Not Yet Earned</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {notEarned.map(b => (
                    <div key={b.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, opacity: 0.5 }}>
                      <div style={{ fontSize: 24, filter: "grayscale(1)" }}>{b.icon}</div>
                      <div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{b.name}</div><div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{b.description}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}


    </div>
  );
}
