// src/components/lifting/LiftingDay.tsx
import { useState } from "react";
import { LiftingDay, DayExercise, LiftingLog, getBestSet, calcVolume, estimateDuration, getYouTubeId } from "./lifting";
import LiftingLogModal from "./LiftingLogModal";

interface Props {
  day: LiftingDay;
  exercises: (DayExercise & { exercise: any })[];
  logs: LiftingLog[]; // this player's logs for these exercises
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  isToday?: boolean;
  canManage?: boolean;
  onLogged: () => void;
}

export default function LiftingDayCard({ day, exercises, logs, playerId, playerName, avatarUrl, isToday, canManage, onLogged }: Props) {
  const [expanded, setExpanded] = useState(isToday ?? false);
  const [logExercise, setLogExercise] = useState<(DayExercise & { exercise: any }) | null>(null);

  // Group exercises by superset_group
  const groups: (DayExercise & { exercise: any })[][] = [];
  const seen = new Set<string>();
  exercises.forEach(ex => {
    if (seen.has(ex.id)) return;
    if (ex.superset_group != null) {
      const group = exercises.filter(e => e.superset_group === ex.superset_group);
      group.forEach(e => seen.add(e.id));
      groups.push(group);
    } else {
      seen.add(ex.id);
      groups.push([ex]);
    }
  });

  // Logs indexed by bank_exercise_id
  const logsByEx: Record<string, LiftingLog[]> = {};
  logs.forEach(log => {
    if (!logsByEx[log.exercise_id]) logsByEx[log.exercise_id] = [];
    logsByEx[log.exercise_id].push(log);
  });

  const estMins = Math.round(estimateDuration(exercises));
  const totalVolume = logs.reduce((sum, log) => sum + calcVolume(log.sets_data), 0);
  const loggedToday = logs.some(l => new Date(l.logged_at).toDateString() === new Date().toDateString());

  if (day.is_rest_day) {
    return (
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px", display: "flex", alignItems: "center", gap: 14, opacity: 0.7 }}>
        <div style={{ fontSize: 32 }}>💤</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--muted)" }}>Day {day.day_number} — {day.name || "Rest Day"}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Recovery day — no lifting scheduled</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ background: "var(--surface2)", border: `1px solid ${isToday ? "rgba(26,63,168,0.5)" : "var(--border)"}`, borderRadius: 14, overflow: "hidden", boxShadow: isToday ? "0 0 0 2px rgba(26,63,168,0.3)" : "none" }}>
        {/* Header */}
        <div onClick={() => setExpanded(e => !e)} style={{ padding: "16px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Day {day.day_number} — {day.name}</div>
              {isToday && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "var(--royal)", color: "#fff" }}>TODAY</span>}
              {loggedToday && !isToday && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "rgba(40,180,80,0.15)", color: "#5de098" }}>✓ LOGGED</span>}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, display: "flex", gap: 10 }}>
              <span>{exercises.length} exercise{exercises.length !== 1 ? "s" : ""}</span>
              <span>~{estMins} min</span>
              {totalVolume > 0 && <span style={{ color: "#93b4ff" }}>{Math.round(totalVolume).toLocaleString()} lbs total vol</span>}
            </div>
          </div>
          <span style={{ color: "var(--muted)", fontSize: 16 }}>{expanded ? "▲" : "▼"}</span>
        </div>

        {/* Exercises */}
        {expanded && (
          <div style={{ borderTop: "1px solid var(--border)" }}>
            {/* Spreadsheet header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 48px 70px 80px 65px", gap: 4, padding: "8px 16px", background: "rgba(0,0,0,0.15)", fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              <div>Exercise</div>
              <div style={{ textAlign: "center" }}>Sets</div>
              <div style={{ textAlign: "center" }}>Reps</div>
              <div style={{ textAlign: "center" }}>Target</div>
              <div style={{ textAlign: "center" }}>Last Log</div>
              <div style={{ textAlign: "center" }}>Growth</div>
            </div>

            {groups.map((group, gi) => {
              const isSuperset = group.length > 1;
              return (
                <div key={gi} style={{ borderTop: "1px solid var(--border)", background: isSuperset ? "rgba(147,92,255,0.04)" : "transparent" }}>
                  {isSuperset && (
                    <div style={{ padding: "4px 16px", fontSize: 9, fontWeight: 700, color: "#9b6dff", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      ⚡ Superset
                    </div>
                  )}
                  {group.map((dex, ei) => {
                    const exLogs = logsByEx[dex.exercise?.id ?? ""] ?? [];
                    const lastLog = exLogs[0];
                    const firstLog = exLogs[exLogs.length - 1];
                    const lastBest = lastLog ? getBestSet(lastLog.sets_data) : null;
                    const firstBest = firstLog && firstLog.id !== lastLog?.id ? getBestSet(firstLog.sets_data) : null;
                    const growth = lastBest && firstBest ? lastBest.weight - firstBest.weight : null;
                    const vid = getYouTubeId(dex.exercise?.video_url);
                    return (
                      <div key={dex.id} style={{ borderTop: ei > 0 ? "1px dashed rgba(147,92,255,0.2)" : "none" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 48px 70px 80px 65px", gap: 4, padding: "10px 16px", alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{dex.exercise?.name ?? "Unknown"}</div>
                            <div style={{ display: "flex", gap: 8, marginTop: 3, alignItems: "center" }}>
                              {vid && <a href={`https://youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 10, color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}>📹 Demo</a>}
                              <span style={{ fontSize: 10, color: "var(--muted)" }}>{dex.rest_secs}s rest</span>
                            </div>
                          </div>
                          <div style={{ textAlign: "center", fontSize: 12, color: "var(--silver-light)", fontWeight: 600 }}>{dex.target_sets ?? "—"}</div>
                          <div style={{ textAlign: "center", fontSize: 12, color: "var(--silver-light)", fontWeight: 600 }}>{dex.target_reps ?? "—"}</div>
                          <div style={{ textAlign: "center", fontSize: 12, color: "var(--silver-light)", fontWeight: 600 }}>{dex.target_weight ? `${dex.target_weight} lbs` : "—"}</div>
                          <div style={{ textAlign: "center" }}>
                            {lastBest ? (
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#5de098" }}>{lastBest.weight} lbs</div>
                                <div style={{ fontSize: 10, color: "var(--muted)" }}>×{lastBest.reps} reps</div>
                              </div>
                            ) : <div style={{ fontSize: 11, color: "var(--muted)" }}>—</div>}
                          </div>
                          <div style={{ textAlign: "center" }}>
                            {growth !== null ? (
                              <div style={{ fontSize: 12, fontWeight: 700, color: growth > 0 ? "#5de098" : growth < 0 ? "#ff7b7b" : "var(--muted)" }}>
                                {growth > 0 ? `+${growth}` : growth === 0 ? "—" : growth} lbs
                              </div>
                            ) : <div style={{ fontSize: 11, color: "var(--muted)" }}>—</div>}
                          </div>
                        </div>
                        {!canManage && (
                          <div style={{ padding: "0 16px 10px" }}>
                            <button onClick={() => setLogExercise(dex)} style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "8px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                              + Log Session
                            </button>
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

      {logExercise && (
        <LiftingLogModal
          dayExercise={logExercise}
          playerId={playerId}
          playerName={playerName}
          avatarUrl={avatarUrl}
          recentLogs={logsByEx[logExercise.exercise?.id ?? ""] ?? []}
          hofEligible={false}
          onClose={() => setLogExercise(null)}
          onSaved={onLogged}
        />
      )}
    </>
  );
}
