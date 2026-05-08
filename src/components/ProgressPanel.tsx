// src/components/ProgressPanel.tsx
import { Profile, Score, Workout } from "../lib/supabase";

interface Props {
  profile: Profile;
  myScores: Score[];
  workouts: Workout[];
}

export default function ProgressPanel({ profile, myScores, workouts }: Props) {
  const totalPoints = myScores.reduce((sum, s) => sum + (s.points ?? 0), 0);
  const totalMade   = myScores.reduce((sum, s) => sum + s.made, 0);
  const totalAtt    = myScores.reduce((sum, s) => sum + s.attempts, 0);
  const shotPct     = totalAtt > 0 ? Math.round(totalMade / totalAtt * 100) : 0;

  // Sort by date for the history list
  const sorted = [...myScores].sort((a, b) =>
    new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime()
  );

  return (
    <div className="panel active">
      <div className="section-head">
        <div className="section-title">My Progress</div>
        <div className="section-sub">Track your growth this offseason, {profile.name.split(" ")[0]}</div>
      </div>

      {/* Top stats */}
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Points</div><div className="stat-value gold">{totalPoints}</div></div>
        <div className="stat-card"><div className="stat-label">Shot %</div><div className="stat-value blue">{shotPct}%</div></div>
        <div className="stat-card"><div className="stat-label">Workouts Logged</div><div className="stat-value">{myScores.length}</div></div>
      </div>

      {/* History table */}
      <div className="card">
        <div className="card-title">Workout History</div>
        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: 24 }}>
            No workouts logged yet. Head to Workouts to get started! 🏀
          </div>
        ) : (
          <>
            <div className="history-row" style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", paddingBottom: 8 }}>
              <div>Workout</div>
              <div style={{ textAlign: "center" }}>Score</div>
              <div style={{ textAlign: "center" }}>Points</div>
              <div style={{ textAlign: "center" }}>Date</div>
            </div>
            {sorted.map(s => {
              const w = workouts.find(x => x.id === s.workout_id);
              const parts = [
                s.made > 0 && `${s.made}/${s.attempts}`,
                s.sprint_secs > 0 && `${s.sprint_secs}s`,
                s.reps > 0 && `${s.reps} reps`,
              ].filter(Boolean).join(" · ");

              return (
                <div className="history-row" key={s.id}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>{w?.title ?? "Unknown Workout"}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{w?.category}</div>
                  </div>
                  <div style={{ textAlign: "center", fontWeight: 600, color: "var(--silver-light)", fontSize: 13 }}>{parts || "—"}</div>
                  <div style={{ textAlign: "center", fontWeight: 700, color: "var(--gold)", fontSize: 15 }}>{s.points}</div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                    {new Date(s.logged_at).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// src/components/PlayersPanel.tsx  (Coach view)
// ─────────────────────────────────────────────────────────────
import { Score as ScoreType, Workout as WorkoutType } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface PlayersPanelProps {
  allScores: ScoreType[];
  workouts: WorkoutType[];
}

export function PlayersPanel({ allScores, workouts }: PlayersPanelProps) {
  const { leaderboard, loading } = useLeaderboard();

  if (loading) return <div className="loading">Loading player data…</div>;

  // Identify players who haven't logged anything in 14+ days
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

  return (
    <div className="panel active">
      <div className="section-head">
        <div className="section-title">Player Data</div>
        <div className="section-sub">All player activity and performance</div>
      </div>

      {inactiveCount > 0 && (
        <div className="notif-banner">
          <div className="notif-icon">🔔</div>
          <div className="notif-text">
            <strong>{inactiveCount} player{inactiveCount > 1 ? "s have" : " has"}</strong> not logged in 14+ days.
            Push notifications and emails will be sent automatically by the nightly Edge Function.
          </div>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Active Players</div><div className="stat-value" style={{ color: "#5de098" }}>{playersWithStatus.filter(p => !p.isInactive).length}</div></div>
        <div className="stat-card"><div className="stat-label">Needs Attention</div><div className="stat-value" style={{ color: "#ff7b7b" }}>{inactiveCount}</div></div>
        <div className="stat-card"><div className="stat-label">Workouts Posted</div><div className="stat-value blue">{workouts.length}</div></div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="player-table">
          <thead>
            <tr>
              <th>Player</th>
              <th style={{ textAlign: "center" }}>Rank</th>
              <th style={{ textAlign: "center" }}>Points</th>
              <th style={{ textAlign: "center" }}>Logged</th>
              <th>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {playersWithStatus.map(p => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  {p.jersey && <span style={{ color: "var(--muted)", fontSize: 12 }}> #{p.jersey} · {p.position}</span>}
                </td>
                <td style={{ textAlign: "center" }}>
                  <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)" }}>#{p.rank}</span>
                </td>
                <td style={{ textAlign: "center" }}>
                  <span style={{ fontWeight: 600, color: "var(--silver-light)" }}>{p.total_points}</span>
                </td>
                <td style={{ textAlign: "center" }}>{p.workoutsLogged}/{workouts.length}</td>
                <td>
                  <span className={`status-dot ${p.isInactive ? "status-inactive" : p.daysInactive !== null && p.daysInactive > 7 ? "status-warn" : "status-active"}`} />
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    {p.daysInactive === null ? "Never" : p.daysInactive === 0 ? "Today" : `${p.daysInactive}d ago`}
                  </span>
                  {p.isInactive && (
                    <span className="alert-badge" style={{ marginLeft: 8 }}>⚠ Notify</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PlayersPanel;
