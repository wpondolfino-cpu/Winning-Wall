// src/components/CoachPanel.tsx
import { useState } from "react";
import { Workout, createWorkout, getEmbedUrl, getVideoId, ScoringType,
         BiweeklyChampion, getBiweeklyChampions, crownBiweeklyWinners,
         currentPeriodStart, currentPeriodEnd, LeaderboardEntry } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  workouts: Workout[];
  onPublished: () => void;
}

type Category = "Shooting" | "Conditioning" | "Strength" | "Skills";

export default function CoachPanel({ workouts, onPublished }: Props) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Shooting");
  const [desc, setDesc] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [emoji, setEmoji] = useState("🏀");
  const [scoringType, setScoringType] = useState<ScoringType>("competitive");
  const [scoringMetric, setScoringMetric] = useState("shots made");
  const [flatPoints, setFlatPoints] = useState("50");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewWorkout, setPreviewWorkout] = useState<Workout | null>(null);
  const [champions, setChampions] = useState<BiweeklyChampion[]>([]);
  const [showChampions, setShowChampions] = useState(false);
  const [crowning, setCrowning] = useState(false);
  const { leaderboard } = useLeaderboard();

  const embedPreview = getEmbedUrl(videoUrl);
  const periodStart = currentPeriodStart();
  const periodEnd = currentPeriodEnd();

  async function publish() {
    if (!title.trim()) { setError("Please enter a workout title."); return; }
    if (scoringType === "flat" && (!flatPoints || parseInt(flatPoints) <= 0)) {
      setError("Please enter a point value greater than 0."); return;
    }
    setSaving(true); setError("");
    try {
      await createWorkout({
        title, category, description: desc,
        video_url: videoUrl || undefined, emoji,
        scoring_type: scoringType,
        scoring_metric: scoringType === "competitive" ? scoringMetric : undefined,
        flat_points: scoringType === "flat" ? parseInt(flatPoints) : undefined,
      });
      setTitle(""); setDesc(""); setVideoUrl(""); setEmoji("🏀");
      setScoringType("competitive"); setScoringMetric("shots made"); setFlatPoints("50");
      setShowBuilder(false);
      onPublished();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function loadChampions() {
    const data = await getBiweeklyChampions();
    setChampions(data);
    setShowChampions(true);
  }

  async function handleCrownWinners() {
    setCrowning(true);
    try {
      await crownBiweeklyWinners(leaderboard);
      await loadChampions();
      alert("👑 Biweekly champions have been crowned!");
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setCrowning(false);
    }
  }

  const EMOJIS = ["🏀","🎯","⚡","💪","🏆","🔥","🎽","⏱️"];
  const TAG_COLORS: Record<string, string> = {
    Shooting: "tag-blue", Conditioning: "tag-red", Strength: "tag-green", Skills: "tag-gold",
  };

  return (
    <div className="panel active">

      {/* ── Biweekly Champions Banner ── */}
      <div style={{
        background: "linear-gradient(135deg, rgba(26,63,168,0.3), rgba(240,192,64,0.1))",
        border: "1px solid rgba(240,192,64,0.3)", borderRadius: 14,
        padding: "16px 20px", marginBottom: 24,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>
            👑 Biweekly Champions
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
            Current period: {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={loadChampions} style={{
            background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600,
            fontFamily: "inherit", cursor: "pointer",
          }}>View History</button>
          <button onClick={handleCrownWinners} disabled={crowning} style={{
            background: "var(--gold)", color: "#0a0c14", border: "none",
            borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700,
            fontFamily: "inherit", cursor: "pointer",
          }}>{crowning ? "Crowning…" : "Crown Winners Now"}</button>
        </div>
      </div>

      {/* Champions history modal */}
      {showChampions && (
        <div className="modal-overlay open" onClick={() => setShowChampions(false)}>
          <div className="log-modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowChampions(false)}>✕</button>
            <div className="modal-title">👑 Champion History</div>
            {champions.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 14, padding: "20px 0" }}>
                No champions crowned yet. Hit "Crown Winners Now" at the end of a period!
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
                {champions.map(c => (
                  <div key={c.id} style={{
                    background: "var(--surface2)", borderRadius: 10, padding: "12px 14px",
                    border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>
                        👑 {c.player_name}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {c.grade_category} · {new Date(c.period_start).toLocaleDateString()} – {new Date(c.period_end).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>
                      {c.points} pts
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Header + New Workout button ── */}
      <div className="flex-between">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <div className="section-title">Manage Workouts</div>
          <div className="section-sub">Post drills for players to complete</div>
        </div>
        <button className="coach-add-btn" onClick={() => setShowBuilder(s => !s)}>
          {showBuilder ? "✕ Cancel" : "+ New Workout"}
        </button>
      </div>

      {/* ── Workout Builder ── */}
      {showBuilder && (
        <div className="card" style={{ marginTop: 20, marginBottom: 28 }}>
          <div className="card-title">New Workout</div>
          <div className="builder-form">

            <div className="builder-row">
              <div>
                <label>Workout Title</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Ball Handling Series" />
              </div>
              <div>
                <label>Category</label>
                <select value={category} onChange={e => setCategory(e.target.value as Category)}>
                  {(["Shooting","Conditioning","Strength","Skills"] as Category[]).map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label>Emoji Icon</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => setEmoji(e)} style={{
                    background: emoji === e ? "var(--royal)" : "var(--surface2)",
                    border: `1px solid ${emoji === e ? "var(--royal-light)" : "var(--border)"}`,
                    borderRadius: 8, padding: "6px 10px", fontSize: 20, cursor: "pointer",
                  }}>{e}</button>
                ))}
              </div>
            </div>

            <div>
              <label>Description / Instructions</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Describe the drill and what players should do…" />
            </div>

            {/* ── SCORING TYPE — 3 options ── */}
            <div>
              <label>Scoring Type</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>

                {/* Competitive */}
                <div onClick={() => setScoringType("competitive")} style={{
                  padding: 12, borderRadius: 10, cursor: "pointer", transition: "all .2s",
                  border: `2px solid ${scoringType === "competitive" ? "var(--royal-light)" : "var(--border)"}`,
                  background: scoringType === "competitive" ? "rgba(26,63,168,0.15)" : "var(--surface2)",
                }}>
                  <div style={{ fontSize: 22, marginBottom: 5 }}>🏆</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 4 }}>Competitive</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
                    Ranked within grade group.<br />
                    <span style={{ color: "var(--gold)" }}>1st=3 · 2nd=2 · 3rd=1</span>
                  </div>
                </div>

                {/* Flat */}
                <div onClick={() => setScoringType("flat")} style={{
                  padding: 12, borderRadius: 10, cursor: "pointer", transition: "all .2s",
                  border: `2px solid ${scoringType === "flat" ? "var(--royal-light)" : "var(--border)"}`,
                  background: scoringType === "flat" ? "rgba(26,63,168,0.15)" : "var(--surface2)",
                }}>
                  <div style={{ fontSize: 22, marginBottom: 5 }}>✅</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 4 }}>Flat Points</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
                    Everyone who completes it earns the same fixed points.
                  </div>
                </div>

                {/* Self Reported */}
                <div onClick={() => setScoringType("self_reported")} style={{
                  padding: 12, borderRadius: 10, cursor: "pointer", transition: "all .2s",
                  border: `2px solid ${scoringType === "self_reported" ? "var(--royal-light)" : "var(--border)"}`,
                  background: scoringType === "self_reported" ? "rgba(26,63,168,0.15)" : "var(--surface2)",
                }}>
                  <div style={{ fontSize: 22, marginBottom: 5 }}>✏️</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 4 }}>Self-Reported</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
                    Player types in how many points they earned.
                  </div>
                </div>
              </div>
            </div>

            {/* Flat: point value input */}
            {scoringType === "flat" && (
              <div>
                <label>Points Awarded for Completion</label>
                <input
                  type="number" value={flatPoints}
                  onChange={e => setFlatPoints(e.target.value)}
                  placeholder="e.g. 100" min="1"
                  style={{ maxWidth: 180 }}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                  Every player who logs this workout receives exactly {flatPoints || "?"} points.
                </div>
              </div>
            )}

            {/* Competitive: metric selector */}
            {scoringType === "competitive" && (
              <div>
                <label>What are players measuring?</label>
                <select value={scoringMetric} onChange={e => setScoringMetric(e.target.value)}>
                  <option value="shots made">Shots Made</option>
                  <option value="reps completed">Reps Completed</option>
                  <option value="seconds (fastest wins)">Time — Fastest Wins</option>
                  <option value="points scored">Points Scored</option>
                </select>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                  Players ranked #1 in their grade group = 3 pts, #2 = 2 pts, #3 = 1 pt.
                </div>
              </div>
            )}

            {/* Self reported: coach tip */}
            {scoringType === "self_reported" && (
              <div style={{
                padding: "10px 14px", background: "rgba(240,192,64,0.08)",
                border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8,
                fontSize: 12, color: "var(--silver-light)", lineHeight: 1.6,
              }}>
                💡 Tell players in the description how many points they can earn and how to earn them. Example: "Complete all 5 stations = 5 points."
              </div>
            )}

            <div>
              <label>YouTube Video URL (optional)</label>
              <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
              {embedPreview && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#5de098" }}>✓ Valid YouTube URL</div>
              )}
            </div>

            {error && <div className="error-msg">{error}</div>}
            <button className="btn-primary" onClick={publish} disabled={saving}>
              {saving ? "Publishing…" : "Publish Workout"}
            </button>
          </div>
        </div>
      )}

      {/* ── Workout Cards ── */}
      <div className="workout-grid">
        {workouts.map(w => {
          const vid = getVideoId(w.video_url);
          const scoringLabel =
            w.scoring_type === "competitive" ? "🏆 Competitive" :
            w.scoring_type === "flat" ? `✅ ${w.flat_points} pts each` :
            "✏️ Self-Reported";
          const scoringColor =
            w.scoring_type === "competitive" ? { bg: "rgba(240,192,64,0.15)", color: "var(--gold)" } :
            w.scoring_type === "flat" ? { bg: "rgba(40,180,80,0.15)", color: "#5de098" } :
            { bg: "rgba(26,63,168,0.2)", color: "#93b4ff" };

          return (
            <div className="workout-card" key={w.id}>
              {vid ? (
                <div className="workout-thumb-coach" onClick={() => setPreviewWorkout(w)}>
                  <img src={`https://img.youtube.com/vi/${vid}/hqdefault.jpg`} alt={w.title} />
                  <div className="thumb-overlay"><div className="play-btn" /></div>
                  <div className="thumb-tag-bar">
                    <span className={`tag ${TAG_COLORS[w.category] ?? "tag-blue"}`}>{w.category}</span>
                  </div>
                </div>
              ) : (
                <div className="emoji-thumb">{w.emoji}</div>
              )}
              <div className="workout-info">
                <div className="workout-title">{w.title}</div>
                <div className="workout-meta">{w.category}</div>
                <div style={{ marginTop: 8 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                    background: scoringColor.bg, color: scoringColor.color,
                  }}>{scoringLabel}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Video preview modal */}
      {previewWorkout && (
        <div className="modal-overlay open" onClick={() => setPreviewWorkout(null)}>
          <div className="video-modal" onClick={e => e.stopPropagation()}>
            <div className="video-modal-header">
              <div>
                <div className="video-modal-title">{previewWorkout.title}</div>
              </div>
              <button className="modal-close" style={{ position: "static", marginLeft: 12 }} onClick={() => setPreviewWorkout(null)}>✕</button>
            </div>
            <div className="video-container">
              <iframe
                src={`${getEmbedUrl(previewWorkout.video_url)}&autoplay=1&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="video-modal-body">
              <p className="video-desc">{previewWorkout.description}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
