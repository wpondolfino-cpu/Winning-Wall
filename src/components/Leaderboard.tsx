// src/components/Leaderboard.tsx
import { useLeaderboard } from "../hooks/useLeaderboard";
import { LeaderboardEntry } from "../lib/supabase";

interface Props {
  currentUserId?: string;
}

export default function Leaderboard({ currentUserId }: Props) {
  const { leaderboard, loading, lastUpdated } = useLeaderboard();

  if (loading) return <div className="loading">Loading leaderboard…</div>;

  const shotPct = (entry: LeaderboardEntry) =>
    entry.total_attempts > 0
      ? Math.round((entry.total_made / entry.total_attempts) * 100) + "%"
      : "—";

  const rankClass = (r: number) =>
    r === 1 ? "gold" : r === 2 ? "silver" : r === 3 ? "bronze" : "";

  return (
    <div className="panel">
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="section-title">Leaderboard</div>
          <div className="section-sub">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Syncing…"}
          </div>
        </div>
        <span className="live-badge">
          <span className="live-dot" /> LIVE
        </span>
      </div>

      {/* Personal stats strip (players only) */}
      {currentUserId && (() => {
        const me = leaderboard.find(e => e.id === currentUserId);
        if (!me) return null;
        return (
          <div className="stats-row">
            <div className="stat-card"><div className="stat-label">Your Rank</div><div className="stat-value gold">#{me.rank}</div></div>
            <div className="stat-card"><div className="stat-label">Total Points</div><div className="stat-value blue">{me.total_points}</div></div>
            <div className="stat-card"><div className="stat-label">Workouts Done</div><div className="stat-value">{me.workouts_completed}</div></div>
          </div>
        );
      })()}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="lb-header-row">
          <div>RNK</div>
          <div>PLAYER</div>
          <div style={{ textAlign: "center" }}>SHOT%</div>
          <div style={{ textAlign: "center" }}>SPRINT</div>
          <div style={{ textAlign: "center" }}>WORKOUTS</div>
          <div style={{ textAlign: "center" }}>PTS</div>
        </div>

        {leaderboard.map(entry => (
          <div
            key={entry.id}
            className={`lb-row ${entry.id === currentUserId ? "me" : ""}`}
          >
            <div className={`lb-rank ${rankClass(entry.rank)}`}>{entry.rank}</div>
            <div>
              <div className="lb-name">
                {entry.name}
                {entry.id === currentUserId && (
                  <span style={{ fontSize: 11, color: "#93b4ff", marginLeft: 6 }}>(you)</span>
                )}
              </div>
              <div className="lb-pos">
                {entry.jersey ? `#${entry.jersey}` : ""} {entry.position ?? ""}
              </div>
            </div>
            <div className="lb-cell">{shotPct(entry)}</div>
            <div className="lb-cell">
              {entry.best_sprint > 0 ? `${entry.best_sprint}s` : "—"}
            </div>
            <div className="lb-cell">{entry.workouts_completed}</div>
            <div className="lb-cell highlight">{entry.total_points}</div>
          </div>
        ))}

        {leaderboard.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
            No scores logged yet. Be the first on the board! 🏀
          </div>
        )}
      </div>
    </div>
  );
}
