// src/components/coach/CoachPanel.tsx
// Thin wrapper — layout + workout list. Logic lives in sub-components.
import { useState, useEffect } from "react";
import { supabase, Workout, getEmbedUrl, getVideoId } from "../../lib/supabase";
import GroupManager from "./GroupManager";
import WorkoutBuilder from "./WorkoutBuilder";
import FindDrillModal from "./FindDrillModal";

interface Props {
  workouts: Workout[];
  onPublished: () => void;
  coachId: string;
  coachName: string;
  isAdmin: boolean;
  openWorkoutId?: string | null;
  onDeepLinkHandled?: () => void;
}

const TAG_COLORS: Record<string, string> = {
  Dribbling: "tag-gold", Finishing: "tag-red",
  Shooting: "tag-blue", Competing: "tag-green", Strength: "tag-blue",
};

export default function CoachPanel({ workouts, onPublished, coachId, coachName, isAdmin, openWorkoutId, onDeepLinkHandled }: Props) {
  const [showBuilder, setShowBuilder]     = useState(false);
  const [editWorkout, setEditWorkout]     = useState<Workout | null>(null);
  const [previewWorkout, setPreviewWorkout] = useState<Workout | null>(null);
  const [deleting, setDeleting]           = useState<string | null>(null);
  const [deactivatingGroup, setDeactivatingGroup] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [showFindDrill, setShowFindDrill] = useState(false);

  // Deep-link support (e.g. clicking a drill from Hall of Fame) — open
  // that specific drill's read-only preview, even if it's not part of
  // the currently active/published group.
  useEffect(() => {
    if (!openWorkoutId) return;
    const match = workouts.find(w => w.id === openWorkoutId);
    if (match) setPreviewWorkout(match);
    onDeepLinkHandled?.();
  }, [openWorkoutId, workouts]);

  const groupFilters = ["all", ...Array.from(new Set(workouts.map(w => w.group_name).filter(Boolean))) as string[]];
  const filteredWorkouts = selectedGroup === "all" ? workouts : workouts.filter(w => w.group_name === selectedGroup);

  function openNew() {
    setEditWorkout(null); setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openEdit(w: Workout) {
    setEditWorkout(w); setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelBuilder() { setShowBuilder(false); setEditWorkout(null); }

  async function deleteWorkout(w: Workout) {
    if (!window.confirm(`Delete "${w.title}"?\n\nAll player scores will also be deleted. This cannot be undone.`)) return;
    setDeleting(w.id);
    try {
      const { error } = await supabase.from("workouts").delete().eq("id", w.id);
      if (error) throw error;
      onPublished();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setDeleting(null); }
  }

  async function toggleActive(w: Workout) {
    await supabase.from("workouts").update({ is_active: !w.is_active }).eq("id", w.id);
    onPublished();
  }

  async function deactivateGroupFromLeaderboard(groupName: string) {
    if (!window.confirm(`Remove "${groupName}" workouts from the leaderboard?\n\nPlayers can still log scores — they just won't count toward leaderboard points.`)) return;
    setDeactivatingGroup(true);
    try {
      await supabase.from("workouts").update({ leaderboard_active: false }).eq("group_name", groupName);
      onPublished();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setDeactivatingGroup(false); }
  }

  async function reactivateGroupOnLeaderboard(groupName: string) {
    setDeactivatingGroup(true);
    try {
      await supabase.from("workouts").update({ leaderboard_active: true }).eq("group_name", groupName);
      onPublished();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setDeactivatingGroup(false); }
  }

  return (
    <div className="panel active">

      <GroupManager workouts={workouts} onChanged={onPublished} />

      {/* Header + builder */}
      <div className="flex-between">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <div className="section-title">Manage Workouts</div>
          <div className="section-sub">Post and manage drills for players</div>
        </div>
        {!showBuilder && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="coach-add-btn" onClick={openNew}>+ New Workout</button>
            <button className="coach-add-btn" onClick={() => setShowFindDrill(true)} style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)" }}>🔍 Find Drill</button>
          </div>
        )}
        {showFindDrill && (
          <FindDrillModal onClose={() => setShowFindDrill(false)} onAttached={onPublished} />
        )}
      </div>

      {showBuilder && (
        <WorkoutBuilder
          editWorkout={editWorkout}
          onSaved={() => { cancelBuilder(); onPublished(); }}
          onCancel={cancelBuilder}
        />
      )}

      {/* Group filter */}
      {groupFilters.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, background: "var(--surface2)", padding: 6, borderRadius: 12, border: "1px solid var(--border)" }}>
            {groupFilters.map(g => (
              <button key={g} onClick={() => setSelectedGroup(g)}
                style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: selectedGroup === g ? "var(--royal)" : "transparent", color: selectedGroup === g ? "#fff" : "var(--muted)", transition: "all .2s" }}>
                {g === "all" ? "All Groups" : g}
              </button>
            ))}
          </div>
          {selectedGroup !== "all" && (() => {
            const gWorkouts = workouts.filter(w => w.group_name === selectedGroup);
            const allDeactivated = gWorkouts.length > 0 && gWorkouts.every(w => w.leaderboard_active === false);
            const someDeactivated = gWorkouts.some(w => w.leaderboard_active === false);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: allDeactivated ? "rgba(255,107,107,0.08)" : "rgba(40,180,80,0.06)", border: `1px solid ${allDeactivated ? "rgba(255,107,107,0.25)" : "rgba(40,180,80,0.2)"}`, borderRadius: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: allDeactivated ? "#ff7b7b" : "#5de098" }}>
                    {allDeactivated ? "🔴 Excluded from leaderboard" : someDeactivated ? "⚠️ Partially excluded" : "🟢 Active on leaderboard"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {allDeactivated ? "Players can still log — won't count toward leaderboard points" : "Scores count toward leaderboard rankings"}
                  </div>
                </div>
                {allDeactivated ? (
                  <button onClick={() => reactivateGroupOnLeaderboard(selectedGroup)} disabled={deactivatingGroup}
                    style={{ background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
                    {deactivatingGroup ? "Updating…" : "✓ Re-activate"}
                  </button>
                ) : (
                  <button onClick={() => deactivateGroupFromLeaderboard(selectedGroup)} disabled={deactivatingGroup}
                    style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
                    {deactivatingGroup ? "Updating…" : "🔴 Remove from Leaderboard"}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Workout cards */}
      <div className="workout-grid">
        {filteredWorkouts.map(w => {
          const vid = getVideoId(w.video_url);
          const p1 = w.first_place_pts ?? 3, p2 = w.second_place_pts ?? 2, p3 = w.third_place_pts ?? 1;
          const scoringLabel =
            w.scoring_type === "competitive" ? `🏆 ${p1}/${p2}/${p3} pts` :
            w.scoring_type === "multi_spot"  ? `🎯 ${p1}/${p2}/${p3} pts · ${((w as any).spot_config?.length ?? 0)} spots` :
            w.scoring_type === "flat"        ? `✅ ${w.flat_points} pts` : "✏️ Self-Reported";
          const scoringColor =
            w.scoring_type === "competitive" ? { bg: "rgba(240,192,64,0.15)", color: "var(--gold)" } :
            w.scoring_type === "multi_spot"  ? { bg: "rgba(26,63,168,0.2)", color: "#93b4ff" } :
            w.scoring_type === "flat"        ? { bg: "rgba(40,180,80,0.15)", color: "#5de098" } :
            { bg: "rgba(26,63,168,0.2)", color: "#93b4ff" };

          return (
            <div className="workout-card" key={w.id} style={{ opacity: w.is_active ? 1 : 0.55 }}>
              {vid ? (
                <div className="workout-thumb-coach" onClick={() => setPreviewWorkout(w)}>
                  <img src={`https://img.youtube.com/vi/${vid}/hqdefault.jpg`} alt={w.title} />
                  <div className="thumb-overlay"><div className="play-btn" /></div>
                  <div className="thumb-tag-bar"><span className={`tag ${TAG_COLORS[w.category] ?? "tag-blue"}`}>{w.category}</span></div>
                </div>
              ) : (
                <div className="emoji-thumb">{w.emoji}</div>
              )}
              <div className="workout-info">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                  <div className="workout-title">{w.title}</div>
                  {!w.is_active && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "rgba(255,107,107,0.15)", color: "#ff7b7b", flexShrink: 0 }}>HIDDEN</span>}
                </div>
                {w.group_name && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>📁 {w.group_name}</div>}
                {w.deadline && (() => {
                  const days = Math.ceil((new Date(w.deadline).getTime() - Date.now()) / 86400000);
                  return <div style={{ fontSize: 11, fontWeight: 600, color: days <= 2 ? "#ff7b7b" : days <= 5 ? "var(--gold)" : "var(--muted)", marginBottom: 4 }}>⏰ {days <= 0 ? "Deadline passed" : `${days}d left`}</div>;
                })()}
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: scoringColor.bg, color: scoringColor.color }}>{scoringLabel}</span>
                </div>
                {(w as any).resource_url && (
                  <div style={{ marginTop: 8 }}>
                    <a href={(w as any).resource_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#93b4ff", textDecoration: "none", fontWeight: 600 }}>📄 View Program ↗</a>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                  <button onClick={() => openEdit(w)} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                  <button onClick={() => toggleActive(w)} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: w.is_active ? "var(--gold)" : "#5de098", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{w.is_active ? "👁 Hide" : "👁 Show"}</button>
                  <button onClick={() => deleteWorkout(w)} disabled={deleting === w.id} style={{ flex: 1, background: "var(--surface)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 7, padding: "6px 0", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{deleting === w.id ? "…" : "🗑 Delete"}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {previewWorkout && (
        <div className="modal-overlay open" onClick={() => setPreviewWorkout(null)}>
          <div className="video-modal" onClick={e => e.stopPropagation()}>
            <div className="video-modal-header">
              <div><div className="video-modal-title">{previewWorkout.title}</div></div>
              <button className="modal-close" style={{ position: "static", marginLeft: 12 }} onClick={() => setPreviewWorkout(null)}>✕</button>
            </div>
            <div className="video-container">
              <iframe src={`${getEmbedUrl(previewWorkout.video_url)}&rel=0`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
            <div className="video-modal-body"><p className="video-desc">{previewWorkout.description}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
