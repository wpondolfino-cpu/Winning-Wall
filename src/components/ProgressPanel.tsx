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

  const sorted = [...myScores].sort((a, b) =>
    new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime()
  );

  return (
    <div className="panel active">
      <div className="section-title">My Progress</div>
      <div className="section-sub">Track your growth this offseason, {profile.name.split(" ")[0]}</div>

      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Points</div><div className="stat-value gold">{totalPoints}</div></div>
        <div className="stat-card"><div className="stat-label">Shot %</div><div className="stat-value blue">{shotPct}%</div></div>
        <div className="stat-card"><div className="stat-label">Workouts Logged</div><div className="stat-value">{myScores.length}</div></div>
      </div>

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
