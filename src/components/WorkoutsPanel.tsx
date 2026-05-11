// src/components/WorkoutsPanel.tsx
import { useState } from "react";
import { Workout, Score, submitScore, getVideoId, updateStreak, STREAK_BONUS_DAYS, STREAK_BONUS_PTS } from "../lib/supabase";

interface Props {
  workouts: Workout[];
  myScores: Score[];
  playerId: string;
  onScoreLogged: () => void;
}

export default function WorkoutsPanel({ workouts, myScores, playerId, onScoreLogged }: Props) {
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [made, setMade] = useState("");
  const [reps, setReps] = useState("");
  const [sprintSecs, setSprintSecs] = useState("");
  const [selfPoints, setSelfPoints] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [streakInfo, setStreakInfo] = useState<{ streak: number; bonus: boolean } | null>(null);

  const scoreFor = (wid: string) => myScores.find(s => s.workout_id === wid);

  function openLog(w: Workout) {
    const existing = scoreFor(w.id);
    setActiveWorkout(w);
    setMade(existing?.made?.toString() ?? "");
    setReps(existing?.reps?.toString() ?? "");
    setSprintSecs(existing?.sprint_secs?.toString() ?? "");
    setSelfPoints(existing?.self_points?.toString() ?? "");
  }

  async function submitScore() {
    if (!activeWorkout) return;
    setSaving(true);
    try {
      // For flat scoring, self_points = flat_points value from workout
      const finalSelfPoints =
        activeWorkout.scoring_type === "flat"
          ? (activeWorkout.flat_points ?? 0)
          : parseInt(selfPoints) || 0;

      const { isPersonalBest, previousBest } = await submitScore({
        player_id: playerId,
        workout_id: activeWorkout.id,
        made: parseInt(made) || 0,
        attempts: 0,
        sprint_secs: parseFloat(sprintSecs) || 0,
        reps: parseInt(reps) || 0,
        self_points: finalSelfPoints,
      });

      // Update streak — always counts regardless of personal best
      const { newStreak, bonusAwarded } = await updateStreak(playerId);
      setStreakInfo({ streak: newStreak, bonus: bonusAwarded });

      setActiveWorkout(null);
      onScoreLogged();

      // Build toast message
      let msg = "";
      if (bonusAwarded) {
        msg = `🔥 ${STREAK_BONUS_DAYS}-day streak! You earned ${STREAK_BONUS_PTS} bonus points!`;
      } else if (isPersonalBest && previousBest !== null) {
        msg = `🏆 New personal best! Your score was saved to the leaderboard.`;
      } else if (isPersonalBest && previousBest === null) {
        msg = `Score logged! 🏀 ${newStreak > 1 ? `🔥 ${newStreak}-day streak!` : "Keep grinding!"}`;
      } else {
        msg = `Attempt logged! Your best score (${previousBest}) stays on the leaderboard. ${newStreak >= 2 ? `🔥 ${newStreak}-day streak!` : "Keep grinding!"}`;
      }
      showToast(msg);

    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const TAG_COLORS: Record<string, string> = {
    Shooting: "tag-blue", Conditioning: "tag-red", Strength: "tag-green", Skills: "tag-gold",
  };

  function getLogFields(w: Workout) {
    // ── Flat: just show confirmation ──
    if (w.scoring_type === "flat") {
      return (
        <div style={{
          padding: "20px", background: "rgba(40,180,80,0.1)",
          border: "1px solid rgba(40,180,80,0.25)", borderRadius: 10,
          textAlign: "center", marginBottom: 16,
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--text)", marginBottom: 6 }}>
            Complete this workout to earn
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: "#5de098", letterSpacing: 1 }}>
            {w.flat_points} pts
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            Tap "Log My Score" below to confirm you completed this drill.
          </div>
        </div>
      );
    }

    // ── Self Reported ──
    if (w.scoring_type === "self_reported") {
      return (
        <div className="score-grid" style={{ gridTemplateColumns: "1fr", marginBottom: 0 }}>
          <div className="score-input-wrap">
            <label>Points Earned</label>
            <input
              type="number" value={selfPoints}
              onChange={e => setSelfPoints(e.target.value)}
              placeholder="Enter points your coach assigned" min="0"
            />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
              Check the workout description for how many points this drill is worth.
            </div>
          </div>
        </div>
      );
    }

    // ── Competitive ──
    const metric = w.scoring_metric ?? "shots made";
    const isTime = metric.toLowerCase().includes("fastest") || metric.toLowerCase().includes("second");

    return (
      <>
        <div style={{
          padding: "10px 14px", background: "rgba(240,192,64,0.08)",
          border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8,
          fontSize: 12, color: "var(--silver-light)", marginBottom: 14, lineHeight: 1.6,
        }}>
          🏆 <strong style={{ color: "var(--gold)" }}>Competitive</strong> — ranked within your grade group.
          <br />1st = 3 pts · 2nd = 2 pts · 3rd = 1 pt
        </div>
        <div className="score-grid">
          {isTime ? (
            <div className="score-input-wrap" style={{ gridColumn: "1 / -1" }}>
              <label>Your Time (seconds)</label>
              <input type="number" value={sprintSecs} onChange={e => setSprintSecs(e.target.value)} placeholder="e.g. 4.5" step="0.1" />
            </div>
          ) : (
            <>
              <div className="score-input-wrap">
                <label>{metric.charAt(0).toUpperCase() + metric.slice(1)}</label>
                <input type="number" value={made} onChange={e => setMade(e.target.value)} placeholder="0" min="0" />
              </div>
              <div className="score-input-wrap">
                <label>Reps / Count</label>
                <input type="number" value={reps} onChange={e => setReps(e.target.value)} placeholder="0" min="0" />
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="panel active">
        <div className="section-title">Workouts</div>
        <div className="section-sub">Tap a card to log your score</div>

        {/* Group label — show current group name if all workouts share one */}
        {(() => {
          const activeWorkouts = workouts.filter(w => w.is_active !== false);
          const groupNames = Array.from(new Set(activeWorkouts.map(w => w.group_name).filter(Boolean)));
          return groupNames.length === 1 ? (
            <div style={{ marginBottom: 16, padding: "8px 14px", background: "rgba(26,63,168,0.15)", borderRadius: 8, fontSize: 13, color: "#93b4ff", fontWeight: 600, border: "1px solid rgba(26,63,168,0.25)" }}>
              📁 {groupNames[0]}
            </div>
          ) : null;
        })()}

        <div className="workout-grid">
          {workouts.filter(w => w.is_active !== false).map(w => {
            const vid = getVideoId(w.video_url);
            const logged = scoreFor(w.id);
            const scoringLabel =
              w.scoring_type === "competitive" ? "🏆 Ranked by group" :
              w.scoring_type === "flat" ? `✅ ${w.flat_points} pts` :
              "✏️ Self-reported";
            const scoringColor =
              w.scoring_type === "competitive" ? { bg: "rgba(240,192,64,0.15)", color: "var(--gold)" } :
              w.scoring_type === "flat" ? { bg: "rgba(40,180,80,0.15)", color: "#5de098" } :
              { bg: "rgba(26,63,168,0.2)", color: "#93b4ff" };

            return (
              <div className="workout-card clickable" key={w.id} onClick={() => openLog(w)}>
                {vid ? (
                  <div className="workout-thumb-player">
                    <img src={`https://img.youtube.com/vi/${vid}/hqdefault.jpg`} alt={w.title} />
                    <div className="thumb-tag-bar">
                      <span className={`tag ${TAG_COLORS[w.category] ?? "tag-blue"}`}>{w.category}</span>
                    </div>
                  </div>
                ) : (
                  <div className="emoji-thumb">{w.emoji}</div>
                )}
                <div className="workout-info">
                  <div className="workout-title">{w.title}</div>
                  <div style={{ marginTop: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: scoringColor.bg, color: scoringColor.color }}>
                      {scoringLabel}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
                    {w.description?.slice(0, 80)}…
                  </div>
                  {vid && (
                    <div className="video-strip" onClick={e => e.stopPropagation()}>
                      <span>📹</span>
                      <span style={{ flex: 1 }}>Drill video</span>
                      <a href={`https://www.youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer"
                        style={{ color: "var(--gold)", fontWeight: 600, textDecoration: "none", fontSize: 11 }}>Watch ↗</a>
                    </div>
                  )}
                  {logged ? (
                    <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                      <div className="score-badge" style={{ flex: 1 }}>
                        ✓ {w.scoring_type === "flat"
                          ? `${w.flat_points} pts earned`
                          : w.scoring_type === "self_reported"
                          ? `${logged.self_points} pts logged`
                          : [
                              logged.made > 0 && `${logged.made} ${w.scoring_metric ?? "made"}`,
                              logged.sprint_secs > 0 && `${logged.sprint_secs}s`,
                            ].filter(Boolean).join(" · ")
                        }
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); openLog(w); }}
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "4px 9px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
                      >✏️ Update</button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Log Score Modal */}
      {activeWorkout && (
        <div className="modal-overlay open" onClick={() => setActiveWorkout(null)}>
          <div className="log-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setActiveWorkout(null)}>✕</button>
            <div className="modal-title">Log Attempt</div>
    <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{activeWorkout.title}</div>
    {scoreFor(activeWorkout.id) && (() => {
      const s = scoreFor(activeWorkout.id)!;
      const best = s.self_points > 0 ? s.self_points : (s.made + s.reps);
      return (
        <div style={{ padding: "10px 14px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 14, lineHeight: 1.6 }}>
          🏆 <strong style={{ color: "var(--gold)" }}>Your personal best: {best}</strong><br />
          <span style={{ color: "var(--muted)" }}>
            Log today's attempt — if you beat your best it updates the leaderboard.
            If not, your best stays and your streak still counts! 🔥
          </span>
        </div>
      );
    })()}
            {getLogFields(activeWorkout)}
            <button className="btn-primary" onClick={submitScore} disabled={saving} style={{ marginTop: 16 }}>
              {saving ? "Saving…" : "Log My Score"}
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </>
  );
}
