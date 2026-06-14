// src/components/lifting/LiftingResults.tsx
import { useState, useEffect } from "react";
import { LiftingProgram, LiftingDay, DayExercise, getBestSet, calcVolume, getAllLogsForProgram } from "./lifting";
import { supabase } from "../../lib/supabase";

interface Props {
  program: LiftingProgram;
  days: Record<string, LiftingDay[]>;
  dayExercises: Record<string, (DayExercise & { exercise: any })[]>;
  onClose: () => void;
}

export default function LiftingResults({ program, days, dayExercises, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [playerResults, setPlayerResults] = useState<any[]>([]);

  useEffect(() => { loadResults(); }, []);

  async function loadResults() {
    setLoading(true);
    try {
      // Get all bank exercise IDs across all days
      const allExIds: string[] = [];
      Object.values(dayExercises).forEach(exs => exs.forEach(ex => { if (ex.exercise?.id) allExIds.push(ex.exercise.id); }));
      const uniqueExIds = [...new Set(allExIds)];
      if (uniqueExIds.length === 0) { setLoading(false); return; }

      const logs = await getAllLogsForProgram([], uniqueExIds);
      if (logs.length === 0) { setLoading(false); return; }

      // Group by player
      const byPlayer: Record<string, { player: any; logsByEx: Record<string, any[]> }> = {};
      logs.forEach((log: any) => {
        const pid = log.player_id;
        if (!byPlayer[pid]) byPlayer[pid] = { player: log.player, logsByEx: {} };
        if (!byPlayer[pid].logsByEx[log.exercise_id]) byPlayer[pid].logsByEx[log.exercise_id] = [];
        byPlayer[pid].logsByEx[log.exercise_id].push(log);
      });

      // Build results per player
      const results = Object.values(byPlayer).map(({ player, logsByEx }) => {
        const exerciseResults = uniqueExIds.map(exId => {
          const exLogs = logsByEx[exId] ?? [];
          if (exLogs.length === 0) return { exId, hasData: false };
          const firstLog = exLogs[exLogs.length - 1];
          const lastLog = exLogs[0];
          const firstBest = getBestSet(firstLog.sets_data);
          const lastBest = getBestSet(lastLog.sets_data);
          const growth = (lastBest?.weight ?? 0) - (firstBest?.weight ?? 0);
          const totalVol = exLogs.reduce((sum: number, l: any) => sum + calcVolume(l.sets_data), 0);
          return {
            exId, hasData: true,
            firstWeight: firstBest?.weight ?? 0,
            lastWeight: lastBest?.weight ?? 0,
            growth, sessions: exLogs.length, totalVol,
            lastNote: lastLog.notes,
            lastDate: lastLog.logged_at,
          };
        }).filter(r => r.hasData);
        return { player, exerciseResults };
      }).filter(r => r.exerciseResults.length > 0);

      setPlayerResults(results);
    } finally { setLoading(false); }
  }

  // Build exercise name lookup
  const exNameById: Record<string, string> = {};
  const exMuscleById: Record<string, string> = {};
  Object.values(dayExercises).forEach(exs => exs.forEach(ex => {
    if (ex.exercise) { exNameById[ex.exercise.id] = ex.exercise.name; exMuscleById[ex.exercise.id] = ex.exercise.muscle_group; }
  }));

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="log-modal" style={{ maxWidth: 640, width: "95vw", maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title" style={{ marginBottom: 2 }}>📊 Player Results</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>{program.title}</div>

        {loading ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0" }}>Loading…</div>
        ) : playerResults.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0", fontSize: 14 }}>
            No players have logged sessions yet.
          </div>
        ) : (
          <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
            {playerResults.map(({ player, exerciseResults }) => {
              const initials = player.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
              return (
                <div key={player.id} style={{ background: "var(--surface2)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
                  {/* Player header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "rgba(0,0,0,0.1)" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", overflow: "hidden", border: "2px solid var(--border)", background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {player.avatar_url
                        ? <img src={player.avatar_url} alt={player.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>{initials}</span>}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{player.name}</div>
                    <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                      {exerciseResults.length} exercise{exerciseResults.length !== 1 ? "s" : ""} logged
                    </div>
                  </div>

                  {/* Table header */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 70px 55px", gap: 4, padding: "6px 14px", fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    <div>Exercise</div>
                    <div style={{ textAlign: "center" }}>First</div>
                    <div style={{ textAlign: "center" }}>Latest</div>
                    <div style={{ textAlign: "center" }}>Growth</div>
                    <div style={{ textAlign: "center" }}>Sessions</div>
                  </div>

                  {exerciseResults.map((r: any) => {
                    const growthColor = r.growth > 0 ? "#5de098" : r.growth < 0 ? "#ff7b7b" : "var(--muted)";
                    const growthLabel = r.growth > 0 ? `+${r.growth} lbs` : r.growth === 0 ? "—" : `${r.growth} lbs`;
                    return (
                      <div key={r.exId} style={{ borderTop: "1px solid var(--border)", padding: "8px 14px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 70px 55px", gap: 4, alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{exNameById[r.exId] ?? r.exId}</div>
                            <div style={{ fontSize: 10, color: "var(--muted)" }}>{exMuscleById[r.exId]}</div>
                          </div>
                          <div style={{ textAlign: "center", fontSize: 12, color: "var(--silver-light)" }}>{r.firstWeight > 0 ? `${r.firstWeight} lbs` : "—"}</div>
                          <div style={{ textAlign: "center", fontSize: 12, color: "var(--silver-light)", fontWeight: 600 }}>{r.lastWeight > 0 ? `${r.lastWeight} lbs` : "—"}</div>
                          <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: growthColor }}>{growthLabel}</div>
                          <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)" }}>{r.sessions}</div>
                        </div>
                        {r.lastNote && (
                          <div style={{ marginTop: 4, fontSize: 11, color: "var(--muted)", fontStyle: "italic", paddingLeft: 2 }}>
                            💬 "{r.lastNote}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
