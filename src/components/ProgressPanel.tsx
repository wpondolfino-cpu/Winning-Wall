// src/components/ProgressPanel.tsx
import { useState, useEffect } from "react";
import { supabase, Profile, Score, Workout, ScoreAttempt, getMyAttempts } from "../lib/supabase";
import { Badge, getActiveBadges, checkBadge, PlayerStats } from "../lib/badges";

interface Props {
  profile: Profile;
  myScores: Score[];    // personal bests
  workouts: Workout[];
}

export default function ProgressPanel({ profile, myScores, workouts }: Props) {
  const [attempts, setAttempts] = useState<ScoreAttempt[]>([]);
  const [view, setView] = useState<"bests" | "history" | "badges">("bests");
  const [allBadges, setAllBadges] = useState<Badge[]>([]);

  useEffect(() => {
    loadAttempts();
    loadBadges();
  }, []);

  async function loadBadges() {
    const data = await getActiveBadges();
    setAllBadges(data);
  }

  async function loadAttempts() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const data = await getMyAttempts(user.id);
    setAttempts(data);
  }

  const totalPoints = myScores.reduce((sum, s) => sum + (s.points ?? 0), 0);
  const totalMade   = myScores.reduce((sum, s) => sum + s.made, 0);
  const totalAtt    = myScores.reduce((sum, s) => sum + s.attempts, 0);
  const shotPct     = totalAtt > 0 ? Math.round(totalMade / totalAtt * 100) : 0;
  const totalAttempts = attempts.length;

  const tabBtn = (t: "bests" | "history" | "badges", label: string) => (
    <button onClick={() => setView(t)} style={{
      flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer",
      fontFamily: "inherit", fontSize: 13, fontWeight: 600,
      background: view === t ? "var(--royal)" : "transparent",
      color: view === t ? "#fff" : "var(--muted)", transition: "all .2s",
    }}>{label}</button>
  );

  return (
    <div className="panel active">
      <div className="section-title">My Progress</div>
      <div className="section-sub">Track your growth this offseason, {profile.name.split(" ")[0]}</div>

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Points</div><div className="stat-value gold">{totalPoints}</div></div>
        <div className="stat-card"><div className="stat-label">Workouts Done</div><div className="stat-value blue">{myScores.length}</div></div>
        <div className="stat-card"><div className="stat-label">Total Attempts</div><div className="stat-value">{totalAttempts}</div></div>
      </div>

      {/* Tab toggle */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 10, padding: 4, marginBottom: 20, border: "1px solid var(--border)" }}>
        {tabBtn("bests", "🏆 Personal Bests")}
        {tabBtn("history", "📋 All Attempts")}
        {tabBtn("badges", "🏅 Badges")}
      </div>

      {/* ── PERSONAL BESTS ── */}
      {view === "bests" && (
        <div className="card">
          <div className="card-title">Your Best Score Per Workout</div>
          {myScores.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: 24 }}>
              No workouts logged yet. Head to Workouts to get started! 🏀
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px", padding: "6px 0", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                <div>Workout</div><div style={{ textAlign: "center" }}>Best Score</div><div style={{ textAlign: "center" }}>Points</div>
              </div>
              {myScores.map(s => {
                const w = workouts.find(x => x.id === s.workout_id);
                const bestDisplay = s.self_points > 0 ? `${s.self_points} pts`
                  : s.sprint_secs > 0 ? `${s.sprint_secs}s`
                  : `${s.made + s.reps}`;
                const attemptCount = attempts.filter(a => a.workout_id === s.workout_id).length;
                return (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px", padding: "12px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{w?.title ?? "Unknown"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {w?.category} · {attemptCount} attempt{attemptCount !== 1 ? "s" : ""}
                      </div>
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

      {/* ── ALL ATTEMPTS (full history) ── */}
      {view === "history" && (
        <div className="card">
          <div className="card-title">Every Attempt — Full History</div>
          {attempts.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: 24 }}>
              No attempts yet. Log a workout to start tracking! 🏀
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 80px", padding: "6px 0", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                <div>Workout</div><div style={{ textAlign: "center" }}>Score</div><div style={{ textAlign: "center" }}>Date</div><div style={{ textAlign: "center" }}>PB?</div>
              </div>
              {attempts.map(a => {
                const w = workouts.find(x => x.id === a.workout_id);
                const scoreDisplay = a.self_points > 0 ? `${a.self_points} pts`
                  : a.sprint_secs > 0 ? `${a.sprint_secs}s`
                  : `${a.made + a.reps}`;
                return (
                  <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 80px", padding: "11px 0", borderBottom: "1px solid rgba(176,184,200,0.06)", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{w?.title ?? "Unknown"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{w?.category}</div>
                    </div>
                    <div style={{ textAlign: "center", fontWeight: 600, color: a.is_personal_best ? "var(--gold)" : "var(--silver-light)", fontSize: 14 }}>
                      {scoreDisplay}
                    </div>
                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                      {new Date(a.attempted_at).toLocaleDateString()}
                    </div>
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
      {/* ── BADGES ── */}
      {view === "badges" && (() => {
        const stats: PlayerStats = {
          totalPoints: totalPoints,
          totalWorkouts: myScores.length,
          currentStreak: 0,
          longestStreak: 0,
          isGroupChampion: (profile as any).is_period_champion ?? false,
          hasPerfectScore: myScores.some(s => (s.points ?? 0) >= 5),
          daysActive: attempts.length,
          challengesWon: 0,
        };
        const earned = allBadges.filter(b => checkBadge(b, stats));
        const notEarned = allBadges.filter(b => !checkBadge(b, stats));
        return (
          <div className="card">
            <div className="card-title">Your Badges — {earned.length}/{allBadges.length} earned</div>
            {earned.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "#5de098", fontWeight: 600, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>✅ Earned</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {earned.map(b => (
                    <div key={b.id} style={{ background: "rgba(40,180,80,0.1)", border: "1px solid rgba(40,180,80,0.25)", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 24 }}>{b.icon}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{b.description}</div>
                      </div>
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
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{b.description}</div>
                      </div>
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
