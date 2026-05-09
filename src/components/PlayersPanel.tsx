// src/components/PlayersPanel.tsx
import { Score, Workout } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  allScores: Score[];
  workouts: Workout[];
}

export default function PlayersPanel({ allScores, workouts }: Props) {
  const { leaderboard, loading } = useLeaderboard();

  if (loading) return <div className="loading">Loading player data…</div>;

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
      <div className="section-title">Player Data</div>
      <div className="section-sub">Full roster — activity, rankings, and alerts</div>

      {inactiveCount > 0 && (
        <div className="notif-banner">
          <span style={{ fontSize: 20 }}>🔔</span>
          <div>
            <strong style={{ color: "var(--gold)" }}>
              {inactiveCount} player{inactiveCount > 1 ? "s have" : " has"}
            </strong>{" "}
            not logged in 14+ days. Push notifications and emails will be sent automatically.
          </div>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Active (7d)</div><div className="stat-value" style={{ color: "#5de098" }}>{playersWithStatus.filter(p => !p.isInactive).length}</div></div>
        <div className="stat-card"><div className="stat-label">Needs Nudge</div><div className="stat-value" style={{ color: "#ff7b7b" }}>{inactiveCount}</div></div>
        <div className="stat-card"><div className="stat-label">Workouts Up</div><div className="stat-value blue">{workouts.length}</div></div>
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
                  {p.isInactive && <span className="alert-badge" style={{ marginLeft: 8 }}>⚠ Notify</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
