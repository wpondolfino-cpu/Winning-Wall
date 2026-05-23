// src/components/CoachPanel.tsx
import { useState, useEffect } from "react";
import { supabase, Workout, createWorkout, getEmbedUrl, getVideoId, ScoringType,
         BiweeklyChampion, getBiweeklyChampions, crownBiweeklyWinners,
         currentPeriodStart, currentPeriodEnd } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  workouts: Workout[];
  onPublished: () => void;
}

type Category = "Dribbling" | "Finishing" | "Shooting" | "Competing" | "Strength";
const CATEGORIES: Category[] = ["Dribbling", "Finishing", "Shooting", "Competing", "Strength"];

const TAG_COLORS: Record<string, string> = {
  Dribbling: "tag-gold",
  Finishing:  "tag-red",
  Shooting:   "tag-blue",
  Competing:  "tag-green",
  Strength:   "tag-blue",
};

export default function CoachPanel({ workouts, onPublished }: Props) {
  // ── builder state ──
  const [showBuilder, setShowBuilder]   = useState(false);
  const [editWorkout, setEditWorkout]   = useState<Workout | null>(null);
  const [title, setTitle]               = useState("");
  const [category, setCategory]         = useState<Category>("Shooting");
  const [desc, setDesc]                 = useState("");
  const [videoUrl, setVideoUrl]         = useState("");
  const [emoji, setEmoji]               = useState("🏀");
  const [scoringType, setScoringType]   = useState<ScoringType>("competitive");
  const [scoringMetric, setScoringMetric] = useState("shots made");
  const [firstPts, setFirstPts]   = useState("5");
  const [secondPts, setSecondPts] = useState("3");
  const [thirdPts, setThirdPts]   = useState("1");
  const [flatPoints, setFlatPoints]     = useState("50");
  const [groupName, setGroupName]       = useState("");   // e.g. "Week 1 & 2"
  const [isActive, setIsActive]         = useState(true); // visible to players?
  const [deadline, setDeadline]           = useState(""); // ISO date string

  // ── announcements ──
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showAnnounce, setShowAnnounce]   = useState(false);
  const [newMsg, setNewMsg]               = useState("");
  const [isPinned, setIsPinned]           = useState(false);
  const [postingSave, setPostingSave]     = useState(false);
  const [coachProfile, setCoachProfile]   = useState<any>(null);
  const [saving, setSaving]             = useState(false);
  const [deleting, setDeleting]         = useState<string | null>(null);
  const [error, setError]               = useState("");

  // ── video preview ──
  const [previewWorkout, setPreviewWorkout] = useState<Workout | null>(null);

  // ── champions ──
  const [champions, setChampions]       = useState<BiweeklyChampion[]>([]);
  const [showChampions, setShowChampions] = useState(false);
  const [crowning, setCrowning]         = useState(false);

  // ── group filter (coach view) ──
  const [selectedGroup, setSelectedGroup] = useState<string>("all");

  const { leaderboard } = useLeaderboard();
  const embedPreview = getEmbedUrl(videoUrl);

  useEffect(() => { loadAnnouncements(); loadCoachProfile(); }, []);

  async function loadCoachProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("profiles").select("name").eq("id", user.id).single();
    setCoachProfile(data);
  }

  async function loadAnnouncements() {
    const { data } = await supabase.from("announcements").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(20);
    setAnnouncements(data ?? []);
  }

  async function postAnnouncement() {
    if (!newMsg.trim()) return;
    setPostingSave(true);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("announcements").insert({
      coach_id: user!.id,
      coach_name: coachProfile?.name ?? "Coach",
      message: newMsg.trim(),
      is_pinned: isPinned,
    });
    setNewMsg(""); setIsPinned(false);
    loadAnnouncements();
    setPostingSave(false);
  }

  async function deleteAnnouncement(id: string) {
    await supabase.from("announcements").delete().eq("id", id);
    loadAnnouncements();
  }

  async function togglePin(ann: any) {
    await supabase.from("announcements").update({ is_pinned: !ann.is_pinned }).eq("id", ann.id);
    loadAnnouncements();
  }
  const periodStart  = currentPeriodStart();
  const periodEnd    = currentPeriodEnd();

  // ── derive unique group names from existing workouts ──
  const groups = ["all", ...Array.from(new Set(workouts.map(w => w.group_name).filter(Boolean))) as string[]];

  const filteredWorkouts = selectedGroup === "all"
    ? workouts
    : workouts.filter(w => w.group_name === selectedGroup);

  // ── open builder for new workout ──
  function openNew() {
    setEditWorkout(null);
    setTitle(""); setDesc(""); setVideoUrl(""); setEmoji("🏀");
    setCategory("Shooting"); setScoringType("competitive");
    setScoringMetric("shots made"); setFlatPoints("50");
    setGroupName(""); setIsActive(true); setDeadline(""); setError("");
    setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── open builder pre-filled for editing ──
  function openEdit(w: Workout) {
    setEditWorkout(w);
    setTitle(w.title);
    setCategory((w.category as Category) ?? "Shooting");
    setDesc(w.description ?? "");
    setVideoUrl(w.video_url ?? "");
    setEmoji(w.emoji ?? "🏀");
    setScoringType(w.scoring_type ?? "competitive");
    setScoringMetric(w.scoring_metric ?? "shots made");
    setFirstPts(w.first_place_pts?.toString() ?? "3");
    setSecondPts(w.second_place_pts?.toString() ?? "2");
    setThirdPts(w.third_place_pts?.toString() ?? "1");
    setFlatPoints(w.flat_points?.toString() ?? "50");
    setGroupName(w.group_name ?? "");
    setIsActive(w.is_active ?? true);
    setDeadline(w.deadline ? new Date(w.deadline).toISOString().split("T")[0] : "");
    setError("");
    setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelBuilder() {
    setShowBuilder(false); setEditWorkout(null); setError("");
  }

  // ── publish new workout ──
  async function publish() {
    if (!title.trim()) { setError("Please enter a workout title."); return; }
    if (scoringType === "flat" && parseInt(flatPoints) <= 0) {
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
        first_place_pts: scoringType === "competitive" ? parseInt(firstPts) || 3 : undefined,
        second_place_pts: scoringType === "competitive" ? parseInt(secondPts) || 2 : undefined,
        third_place_pts: scoringType === "competitive" ? parseInt(thirdPts) || 1 : undefined,
        group_name: groupName.trim() || undefined,
        is_active: isActive,
        deadline: deadline ? new Date(deadline + "T23:59:59").toISOString() : undefined,
      });
      cancelBuilder(); onPublished();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  // ── save edits ──
  async function saveEdit() {
    if (!editWorkout) return;
    if (!title.trim()) { setError("Please enter a workout title."); return; }
    setSaving(true); setError("");
    try {
      const { error: err } = await supabase.from("workouts").update({
        title, category, description: desc,
        video_url: videoUrl || null, emoji,
        scoring_type: scoringType,
        scoring_metric: scoringType === "competitive" ? scoringMetric : null,
        flat_points: scoringType === "flat" ? parseInt(flatPoints) : null,
        first_place_pts: scoringType === "competitive" ? parseInt(firstPts) || 3 : null,
        second_place_pts: scoringType === "competitive" ? parseInt(secondPts) || 2 : null,
        third_place_pts: scoringType === "competitive" ? parseInt(thirdPts) || 1 : null,
        group_name: groupName.trim() || null,
        is_active: isActive,
        deadline: deadline ? new Date(deadline + "T23:59:59").toISOString() : null,
      }).eq("id", editWorkout.id);
      if (err) throw err;
      cancelBuilder(); onPublished();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  // ── delete workout ──
  async function deleteWorkout(w: Workout) {
    if (!window.confirm(`Delete "${w.title}"?\n\nAll player scores for this workout will also be deleted. This cannot be undone.`)) return;
    setDeleting(w.id);
    try {
      const { error: err } = await supabase.from("workouts").delete().eq("id", w.id);
      if (err) throw err;
      onPublished();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setDeleting(null); }
  }

  // ── toggle active/hidden without deleting ──
  async function toggleActive(w: Workout) {
    await supabase.from("workouts").update({ is_active: !w.is_active }).eq("id", w.id);
    onPublished();
  }

  // ── champions ──
  async function loadChampions() {
    const data = await getBiweeklyChampions();
    setChampions(data); setShowChampions(true);
  }
  async function handleCrownWinners() {
    setCrowning(true);
    try {
      await crownBiweeklyWinners(leaderboard);
      await loadChampions();
      alert("👑 Biweekly champions have been crowned!");
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setCrowning(false); }
  }

  const EMOJIS = ["🏀","🎯","⚡","💪","🏆","🔥","🎽","⏱️"];

  // ── shared builder form JSX ──
  const builderForm = (
    <div className="card" style={{ marginTop: 20, marginBottom: 28 }}>
      <div className="card-title">{editWorkout ? "✏️ Edit Workout" : "New Workout"}</div>
      <div className="builder-form">

        {/* Title + Category */}
        <div className="builder-row">
          <div>
            <label>Workout Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Crossover Series" />
          </div>
          <div>
            <label>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as Category)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Group Name */}
        <div>
          <label>Workout Group <span style={{ color: "var(--muted)", fontWeight: 400 }}>(e.g. "Week 1 & 2" — groups drills together)</span></label>
          <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Week 1 & 2" />
        </div>

        {/* Deadline */}
        <div style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Deadline (optional)
          </label>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          {deadline && (
            <div style={{ fontSize: 11, color: "var(--gold)", marginTop: 4 }}>
              ⏰ Players will see a countdown to this date
            </div>
          )}
        </div>

        {/* Active toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>Visible to Players</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              When off, players cannot see this workout. Points already earned are kept.
            </div>
          </div>
          <div
            onClick={() => setIsActive(a => !a)}
            style={{
              width: 46, height: 26, borderRadius: 13, cursor: "pointer", flexShrink: 0,
              background: isActive ? "var(--royal)" : "var(--surface3)",
              position: "relative", transition: "background .2s",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{
              position: "absolute", top: 3, left: isActive ? 22 : 3,
              width: 18, height: 18, borderRadius: "50%", background: "#fff",
              transition: "left .2s",
            }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? "#5de098" : "var(--muted)" }}>
            {isActive ? "On" : "Off"}
          </span>
        </div>

        {/* Emoji */}
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

        {/* Description */}
        <div>
          <label>Description / Instructions</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Describe the drill and what players should do…" />
        </div>

        {/* Scoring type */}
        <div>
          <label>Scoring Type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
            {([
              { type: "competitive", icon: "🏆", label: "Competitive", sub: "Ranked in grade group. 1st=3 · 2nd=2 · 3rd=1" },
              { type: "flat",        icon: "✅", label: "Flat Points", sub: "Everyone who logs it gets the same points." },
              { type: "self_reported", icon: "✏️", label: "Self-Reported", sub: "Player types in how many points they earned." },
            ] as const).map(opt => (
              <div key={opt.type} onClick={() => setScoringType(opt.type)} style={{
                padding: 12, borderRadius: 10, cursor: "pointer", transition: "all .2s",
                border: `2px solid ${scoringType === opt.type ? "var(--royal-light)" : "var(--border)"}`,
                background: scoringType === opt.type ? "rgba(26,63,168,0.15)" : "var(--surface2)",
              }}>
                <div style={{ fontSize: 22, marginBottom: 5 }}>{opt.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 4 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{opt.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Flat points value */}
        {scoringType === "flat" && (
          <div>
            <label>Points Awarded for Completion</label>
            <input type="number" value={flatPoints} onChange={e => setFlatPoints(e.target.value)} placeholder="e.g. 100" min="1" style={{ maxWidth: 180 }} />
          </div>
        )}

        {/* Competitive metric */}
        {scoringType === "competitive" && (
          <div>
            <label>What are players measuring?</label>
            <select value={scoringMetric} onChange={e => setScoringMetric(e.target.value)}>
              <option value="shots made">Shots Made</option>
              <option value="reps completed">Reps Completed</option>
              <option value="seconds (fastest wins)">Time — Fastest Wins</option>
              <option value="points scored">Points Scored</option>
            </select>
          </div>
        )}

        {/* Custom rank points — only show for competitive */}
        {scoringType === "competitive" && (
          <div>
            <label>Points Per Rank <span style={{ color: "var(--muted)", fontWeight: 400 }}>(customize what each place earns)</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--gold)", fontWeight: 700, marginBottom: 5 }}>🥇 1st Place</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="number" value={firstPts} min="0" onChange={e => setFirstPts(e.target.value)}
                    style={{ width: "100%", background: "var(--surface2)", border: "1px solid rgba(240,192,64,0.4)", borderRadius: 8, padding: "9px 12px", color: "var(--gold)", fontSize: 16, fontWeight: 700, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>pts</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--silver)", fontWeight: 700, marginBottom: 5 }}>🥈 2nd Place</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="number" value={secondPts} min="0" onChange={e => setSecondPts(e.target.value)}
                    style={{ width: "100%", background: "var(--surface2)", border: "1px solid rgba(176,184,200,0.3)", borderRadius: 8, padding: "9px 12px", color: "var(--silver-light)", fontSize: 16, fontWeight: 700, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>pts</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#cd7f32", fontWeight: 700, marginBottom: 5 }}>🥉 3rd Place</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="number" value={thirdPts} min="0" onChange={e => setThirdPts(e.target.value)}
                    style={{ width: "100%", background: "var(--surface2)", border: "1px solid rgba(205,127,50,0.3)", borderRadius: 8, padding: "9px 12px", color: "#cd7f32", fontSize: 16, fontWeight: 700, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>pts</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              Everyone else gets 0 pts. Defaults are 5 / 3 / 1.
            </div>
          </div>
        )}

        {/* Self reported tip */}
        {scoringType === "self_reported" && (
          <div style={{ padding: "10px 14px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", lineHeight: 1.6 }}>
            💡 Tell players in the description how many points they can earn and how. Example: "Complete all 5 stations = 5 points."
          </div>
        )}

        {/* Video URL */}
        <div>
          <label>YouTube Video URL (optional)</label>
          <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
          {embedPreview && <div style={{ marginTop: 6, fontSize: 11, color: "#5de098" }}>✓ Valid YouTube URL</div>}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={editWorkout ? saveEdit : publish} disabled={saving} style={{ flex: 1 }}>
            {saving ? "Saving…" : editWorkout ? "Save Changes" : "Publish Workout"}
          </button>
          <button onClick={cancelBuilder} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="panel active">

      {/* ── Announcements ── */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#93b4ff", letterSpacing: 1 }}>📢 Announcements</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Post messages players see when they open the app</div>
          </div>
          <button onClick={() => setShowAnnounce(s => !s)} style={{ background: showAnnounce ? "var(--surface)" : "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            {showAnnounce ? "✕ Cancel" : "+ Post"}
          </button>
        </div>
        {showAnnounce && (
          <div style={{ marginBottom: 16, padding: "14px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)}
              placeholder="Write your announcement here... (e.g. 'Great work this week! 🔥 Remember workouts close Friday.')"
              rows={3}
              style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} />
                📌 Pin to top
              </label>
              <button onClick={postAnnouncement} disabled={postingSave || !newMsg.trim()} style={{ marginLeft: "auto", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {postingSave ? "Posting…" : "Post Announcement"}
              </button>
            </div>
          </div>
        )}
        {announcements.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>No announcements yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {announcements.map(ann => (
              <div key={ann.id} style={{ padding: "12px 14px", background: ann.is_pinned ? "rgba(240,192,64,0.08)" : "var(--surface)", borderRadius: 10, border: `1px solid ${ann.is_pinned ? "rgba(240,192,64,0.25)" : "var(--border)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    {ann.is_pinned && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gold)", marginRight: 6 }}>📌 PINNED</span>}
                    <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{ann.message}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{ann.coach_name} · {new Date(ann.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => togglePin(ann)} title={ann.is_pinned ? "Unpin" : "Pin"} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: ann.is_pinned ? "var(--gold)" : "var(--muted)" }}>📌</button>
                    <button onClick={() => deleteAnnouncement(ann.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#ff7b7b" }}>🗑</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Biweekly Champions Banner ── */}
      <div style={{
        background: "linear-gradient(135deg, rgba(26,63,168,0.3), rgba(240,192,64,0.1))",
        border: "1px solid rgba(240,192,64,0.3)", borderRadius: 14,
        padding: "16px 20px", marginBottom: 24,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
      }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>👑 Biweekly Champions</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
            Current period: {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={loadChampions} style={{ background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>View History</button>
          <button onClick={handleCrownWinners} disabled={crowning} style={{ background: "var(--gold)", color: "#0a0c14", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
            {crowning ? "Crowning…" : "Crown Winners Now"}
          </button>
        </div>
      </div>

      {/* Champions history modal */}
      {showChampions && (
        <div className="modal-overlay open" onClick={() => setShowChampions(false)}>
          <div className="log-modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowChampions(false)}>✕</button>
            <div className="modal-title">👑 Champion History</div>
            {champions.length === 0
              ? <div style={{ color: "var(--muted)", fontSize: 14, padding: "20px 0" }}>No champions crowned yet.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
                  {champions.map(c => (
                    <div key={c.id} style={{ background: "var(--surface2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>👑 {c.player_name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                          {c.grade_category} · {new Date(c.period_start).toLocaleDateString()} – {new Date(c.period_end).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{c.points} pts</div>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex-between">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <div className="section-title">Manage Workouts</div>
          <div className="section-sub">Post and manage drills for players</div>
        </div>
        {!showBuilder && (
          <button className="coach-add-btn" onClick={openNew}>+ New Workout</button>
        )}
      </div>

      {/* Builder */}
      {showBuilder && builderForm}

      {/* ── Group filter tabs ── */}
      {groups.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20, background: "var(--surface2)", padding: 6, borderRadius: 12, border: "1px solid var(--border)" }}>
          {groups.map(g => (
            <button key={g} onClick={() => setSelectedGroup(g)} style={{
              padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600,
              background: selectedGroup === g ? "var(--royal)" : "transparent",
              color: selectedGroup === g ? "#fff" : "var(--muted)", transition: "all .2s",
            }}>
              {g === "all" ? "All Groups" : g}
            </button>
          ))}
        </div>
      )}

      {/* ── Workout Cards ── */}
      <div className="workout-grid">
        {filteredWorkouts.map(w => {
          const vid = getVideoId(w.video_url);
          const p1 = w.first_place_pts ?? 3;
          const p2 = w.second_place_pts ?? 2;
          const p3 = w.third_place_pts ?? 1;
          const scoringLabel =
            w.scoring_type === "competitive" ? `🏆 ${p1}/${p2}/${p3} pts` :
            w.scoring_type === "flat" ? `✅ ${w.flat_points} pts` : "✏️ Self-Reported";
          const scoringColor =
            w.scoring_type === "competitive" ? { bg: "rgba(240,192,64,0.15)", color: "var(--gold)" } :
            w.scoring_type === "flat" ? { bg: "rgba(40,180,80,0.15)", color: "#5de098" } :
            { bg: "rgba(26,63,168,0.2)", color: "#93b4ff" };

          return (
            <div className="workout-card" key={w.id} style={{ opacity: w.is_active ? 1 : 0.55 }}>
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
                {/* Title + group badge */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                  <div className="workout-title">{w.title}</div>
                  {!w.is_active && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "rgba(255,107,107,0.15)", color: "#ff7b7b", flexShrink: 0, whiteSpace: "nowrap" }}>HIDDEN</span>
                  )}
                </div>
                {w.group_name && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>📁 {w.group_name}</div>
                )}
                {w.deadline && (() => {
                  const days = Math.ceil((new Date(w.deadline).getTime() - Date.now()) / 86400000);
                  return (
                    <div style={{ fontSize: 11, fontWeight: 600, color: days <= 2 ? "#ff7b7b" : days <= 5 ? "var(--gold)" : "var(--muted)", marginBottom: 4 }}>
                      ⏰ {days <= 0 ? "Deadline passed" : `${days} day${days !== 1 ? "s" : ""} left`}
                    </div>
                  );
                })()}
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: scoringColor.bg, color: scoringColor.color }}>{scoringLabel}</span>
                </div>

                {/* ── Edit / Hide / Delete buttons ── */}
                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                  <button
                    onClick={() => openEdit(w)}
                    style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
                  >✏️ Edit</button>
                  <button
                    onClick={() => toggleActive(w)}
                    style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: w.is_active ? "var(--gold)" : "#5de098", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
                  >{w.is_active ? "👁 Hide" : "👁 Show"}</button>
                  <button
                    onClick={() => deleteWorkout(w)}
                    disabled={deleting === w.id}
                    style={{ flex: 1, background: "var(--surface)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
                  >{deleting === w.id ? "…" : "🗑 Delete"}</button>
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
              <div><div className="video-modal-title">{previewWorkout.title}</div></div>
              <button className="modal-close" style={{ position: "static", marginLeft: 12 }} onClick={() => setPreviewWorkout(null)}>✕</button>
            </div>
            <div className="video-container">
              <iframe
                src={`${getEmbedUrl(previewWorkout.video_url)}&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="video-modal-body"><p className="video-desc">{previewWorkout.description}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
