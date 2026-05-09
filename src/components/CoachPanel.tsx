// src/components/CoachPanel.tsx
import { useState } from "react";
import { Workout, createWorkout, getEmbedUrl, getVideoId } from "../lib/supabase";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Coach video preview modal
  const [previewWorkout, setPreviewWorkout] = useState<Workout | null>(null);

  const embedPreview = getEmbedUrl(videoUrl);

  async function publish() {
    if (!title.trim()) { setError("Please enter a workout title."); return; }
    setSaving(true); setError("");
    try {
      await createWorkout({ title, category, description: desc, video_url: videoUrl || undefined, emoji });
      setTitle(""); setDesc(""); setVideoUrl(""); setEmoji("🏀");
      setShowBuilder(false);
      onPublished();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const EMOJIS = ["🏀","🎯","⚡","💪","🏆","🔥","🎽","⏱️"];
  const TAG_COLORS: Record<string, string> = {
    Shooting: "tag-blue", Conditioning: "tag-red", Strength: "tag-green", Skills: "tag-gold",
  };

  return (
    <div className="panel active">
      <div className="flex-between">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <div className="section-title">Manage Workouts</div>
          <div className="section-sub">Post drills with embedded video for players to watch</div>
        </div>
        <button className="coach-add-btn" onClick={() => setShowBuilder(s => !s)}>
          {showBuilder ? "✕ Cancel" : "+ New Workout"}
        </button>
      </div>

      {/* Workout Builder */}
      {showBuilder && (
        <div className="card" style={{ marginTop: 24, marginBottom: 28 }}>
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
                  {(["Shooting","Conditioning","Strength","Skills"] as Category[]).map(c =>
                    <option key={c}>{c}</option>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label>Emoji Icon</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {EMOJIS.map(e => (
                  <button
                    key={e}
                    onClick={() => setEmoji(e)}
                    style={{
                      background: emoji === e ? "var(--royal)" : "var(--surface2)",
                      border: `1px solid ${emoji === e ? "var(--royal-light)" : "var(--border)"}`,
                      borderRadius: 8, padding: "6px 10px", fontSize: 20, cursor: "pointer",
                    }}
                  >{e}</button>
                ))}
              </div>
            </div>

            <div>
              <label>Description / Instructions</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Describe the drill and what players should log…" />
            </div>

            <div>
              <label>Embed YouTube Video URL (coaches only — players see thumbnail + Watch link)</label>
              <input
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
              />
              {embedPreview && (
                <div className="url-preview show" style={{ marginTop: 8 }}>
                  <span className="link">{embedPreview}</span>
                  <span style={{ color: "#5de098", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>✓ Valid YouTube URL</span>
                </div>
              )}
            </div>

            {error && <div className="error-msg">{error}</div>}
            <button className="btn-primary" onClick={publish} disabled={saving}>
              {saving ? "Publishing…" : "Publish Workout"}
            </button>
          </div>
        </div>
      )}

      {/* Workout cards — coach sees play overlay */}
      <div className="workout-grid">
        {workouts.map(w => {
          const vid = getVideoId(w.video_url);

          return (
            <div className="workout-card" key={w.id}>
              {vid ? (
                <div className="workout-thumb-coach" onClick={() => setPreviewWorkout(w)}>
                  <img src={`https://img.youtube.com/vi/${vid}/hqdefault.jpg`} alt={w.title} />
                  <div className="thumb-overlay">
                    <div className="play-btn" />
                  </div>
                  <div className="thumb-tag-bar">
                    <span className={`tag ${TAG_COLORS[w.category] ?? "tag-blue"}`}>{w.category}</span>
                  </div>
                </div>
              ) : (
                <div className="emoji-thumb">{w.emoji}</div>
              )}
              <div className="workout-info">
                <div className="workout-title">{w.title}</div>
                <div className="workout-meta">{new Date(w.created_at).toLocaleDateString()}</div>
                <div style={{ marginTop: 8, fontSize: 12, color: vid ? "#5de098" : "var(--muted)" }}>
                  {vid ? "📹 Video attached — click thumbnail to preview" : "No video attached"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Coach video preview modal — full inline embed */}
      {previewWorkout && (
        <div className="modal-overlay open" onClick={() => setPreviewWorkout(null)}>
          <div className="video-modal" onClick={e => e.stopPropagation()}>
            <div className="video-modal-header">
              <div>
                <div className="video-modal-title">{previewWorkout.title}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <span className={`tag ${TAG_COLORS[previewWorkout.category] ?? "tag-blue"}`}>{previewWorkout.category}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(previewWorkout.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <button className="modal-close" onClick={() => setPreviewWorkout(null)}>✕</button>
            </div>
            <div className="video-container">
              <iframe
                src={`${getEmbedUrl(previewWorkout.video_url)}&autoplay=1&rel=0&modestbranding=1`}
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
