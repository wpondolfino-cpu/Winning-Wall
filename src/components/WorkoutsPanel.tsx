// src/components/WorkoutsPanel.tsx  (Player view)
import { useState } from "react";
import { Workout, Score, upsertScore, getVideoId } from "../lib/supabase";

interface Props {
  workouts: Workout[];
  myScores: Score[];
  playerId: string;
  onScoreLogged: () => void;
}

export default function WorkoutsPanel({ workouts, myScores, playerId, onScoreLogged }: Props) {
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [made, setMade] = useState("");
  const [attempts, setAttempts] = useState("");
  const [sprint, setSprint] = useState("");
  const [reps, setReps] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const scoreFor = (wid: string) => myScores.find(s => s.workout_id === wid);

  function openLog(w: Workout) {
    const existing = scoreFor(w.id);
    setActiveWorkout(w);
    setMade(existing?.made?.toString() ?? "");
    setAttempts(existing?.attempts?.toString() ?? "");
    setSprint(existing?.sprint_secs?.toString() ?? "");
    setReps(existing?.reps?.toString() ?? "");
  }

  async function submitScore() {
    if (!activeWorkout) return;
    setSaving(true);
    try {
      await upsertScore({
        player_id: playerId,
        workout_id: activeWorkout.id,
        made: parseInt(made) || 0,
        attempts: parseInt(attempts) || 0,
        sprint_secs: parseFloat(sprint) || 0,
        reps: parseInt(reps) || 0,
      });
      setActiveWorkout(null);
      onScoreLogged();
      showToast("Score logged! Keep grinding 💪");
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  }

  const TAG_COLORS: Record<string, string> = {
    Shooting: "tag-blue",
    Conditioning: "tag-red",
    Strength: "tag-green",
    Skills: "tag-gold",
  };

  return (
    <>
      <div className="panel active">
        <div className="section-head">
          <div className="section-title">Workouts</div>
          <div className="section-sub">Tap a card to log your score · Watch ↗ to view the drill video</div>
        </div>

        <div className="workout-grid">
          {workouts.map(w => {
            const vid = getVideoId(w.video_url);
            const logged = scoreFor(w.id);

            return (
              <div className="workout-card clickable" key={w.id} onClick={() => openLog(w)}>
                {/* Static thumbnail — players cannot play inline */}
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
                  <div className="workout-meta">{w.category} · {new Date(w.created_at).toLocaleDateString()}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
                    {w.description?.slice(0, 90)}…
                  </div>

                  {/* Video badge → opens YouTube in new tab */}
                  {vid && (
                    <div className="video-strip" onClick={e => e.stopPropagation()}>
                      <span className="video-strip-icon">📹</span>
                      <span style={{ flex: 1 }}>Drill video available</span>
                      <a
                        href={`https://www.youtube.com/watch?v=${vid}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--gold)", fontWeight: 600, textDecoration: "none", fontSize: 11 }}
                      >
                        Watch ↗
                      </a>
                    </div>
                  )}

                  {logged && (
                    <div className="score-badge">
                      ✓ {[
                        logged.made > 0 && `${logged.made}/${logged.attempts} made`,
                        logged.sprint_secs > 0 && `${logged.sprint_secs}s`,
                        logged.reps > 0 && `${logged.reps} reps`,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  )}
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
            <div className="modal-title">Log: {activeWorkout.title}</div>
            <div className="score-grid">
              <div className="score-input-wrap">
                <label>Made Shots</label>
                <input type="number" value={made} onChange={e => setMade(e.target.value)} placeholder="0" min="0" />
              </div>
              <div className="score-input-wrap">
                <label>Attempts</label>
                <input type="number" value={attempts} onChange={e => setAttempts(e.target.value)} placeholder="0" min="0" />
              </div>
              <div className="score-input-wrap">
                <label>Sprint Time (sec)</label>
                <input type="number" value={sprint} onChange={e => setSprint(e.target.value)} placeholder="0.0" step="0.1" />
              </div>
              <div className="score-input-wrap">
                <label>Reps Completed</label>
                <input type="number" value={reps} onChange={e => setReps(e.target.value)} placeholder="0" />
              </div>
            </div>
            <button className="btn-primary" onClick={submitScore} disabled={saving}>
              {saving ? "Saving…" : "Log My Score"}
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </>
  );
}
