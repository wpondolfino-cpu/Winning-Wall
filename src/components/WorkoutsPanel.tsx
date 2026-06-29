// src/components/WorkoutsPanel.tsx
import { useState, useEffect, useRef } from "react";
import { supabase, Workout, Score, submitScore as _submitScore, getVideoId, updateStreak, STREAK_BONUS_DAYS, STREAK_BONUS_PTS } from "../lib/supabase";
import DrillTimer, { Stopwatch } from "./DrillTimer";

interface Props {
  workouts: Workout[];
  myScores: Score[];
  playerId: string;
  onScoreLogged: () => void;
}

export default function WorkoutsPanel({ workouts, myScores, playerId, onScoreLogged }: Props) {
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [rankedCompletion, setRankedCompletion] = useState({ completed: 0, total: 0, bonusEarned: false });
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const modalDragY = useRef(0);
  const [modalOffset, setModalOffset] = useState(0);

  useEffect(() => { loadAnnouncements(); }, []);
  useEffect(() => { if (workouts.length > 0) loadRankedCompletion(); }, [workouts]);

  async function loadRankedCompletion() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const activeWorkouts = workouts.filter(w => w.is_active !== false && (!(w as any).publish_date || (w as any).publish_date <= new Date().toISOString().split('T')[0]));
    const groupNames = Array.from(new Set(activeWorkouts.map(w => w.group_name).filter(Boolean)));
    const currentGroup = groupNames.length === 1 ? groupNames[0] : null;
    const rankedWorkouts = activeWorkouts.filter(w =>
      (w.scoring_type === "competitive" || w.scoring_type === "multi_spot") &&
      w.leaderboard_active !== false &&
      (currentGroup ? w.group_name === currentGroup : true)
    );
    if (rankedWorkouts.length === 0) { setRankedCompletion({ completed: 0, total: 0, bonusEarned: false }); return; }
    const today = new Date().toISOString().split("T")[0];
    const { data: todayAttempts } = await supabase.from("score_attempts").select("workout_id").eq("player_id", user.id).gte("attempted_at", today + "T00:00:00.000Z").lte("attempted_at", today + "T23:59:59.999Z");
    const loggedToday = new Set((todayAttempts ?? []).map((a: any) => a.workout_id));
    const completed = rankedWorkouts.filter(w => loggedToday.has(w.id)).length;
    const total = rankedWorkouts.length;
    const { data: bonusToday } = await supabase.from("streak_bonuses").select("id").eq("player_id", user.id).eq("reason", "daily_completion").gte("awarded_at", today + "T00:00:00.000Z").single();
    const bonusEarned = !!bonusToday;
    if (completed >= total && total > 0 && !bonusEarned) {
      try {
        await supabase.from("streak_bonuses").insert({ player_id: user.id, points: 1, streak_length: 0, awarded_at: new Date().toISOString(), reason: "daily_completion" });
      } catch (e) { console.warn(e); }
    }
    setRankedCompletion({ completed, total, bonusEarned: bonusEarned || (completed >= total && total > 0) });
  }

  async function loadAnnouncements() {
    const { data } = await supabase.from("announcements").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(5);
    setAnnouncements(data ?? []);
  }

  const [made, setMade] = useState("");
  const [reps, setReps] = useState("");
  const [sprintSecs, setSprintSecs] = useState("");
  const [selfPoints, setSelfPoints] = useState("");
  const [spotScores, setSpotScores] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const scoreFor = (wid: string) => myScores.find(s => s.workout_id === wid);

  function openLog(w: Workout) {
    const existing = scoreFor(w.id);
    setActiveWorkout(w);
    setMade(existing?.made?.toString() ?? "");
    setReps(existing?.reps?.toString() ?? "");
    setSprintSecs(existing?.sprint_secs?.toString() ?? "");
    setSelfPoints(existing?.self_points?.toString() ?? "");
    setSpotScores({});
  }

  function multiSpotTotal(): number {
    if (!activeWorkout) return 0;
    const spots: string[] = (activeWorkout as any).spot_config ?? [];
    return spots.reduce((sum, _, i) => sum + (parseInt(spotScores[i] ?? "") || 0), 0);
  }

  async function handleSubmitScore() {
    if (!activeWorkout) return;
    setSaving(true);
    try {
      let finalMade = parseInt(made) || 0;
      let finalReps = parseInt(reps) || 0;
      const finalSelfPoints = activeWorkout.scoring_type === "flat" ? (activeWorkout.flat_points ?? 0) : parseInt(selfPoints) || 0;
      if (activeWorkout.scoring_type === "multi_spot") { finalMade = multiSpotTotal(); finalReps = 0; }

      // Guard: don't submit if all values are zero (nothing entered)
      const finalSprints = parseFloat(sprintSecs) || 0;
      if (activeWorkout.scoring_type !== "flat" && finalMade === 0 && finalReps === 0 && finalSprints === 0 && finalSelfPoints === 0) {
        showToast("Please enter a score before submitting.");
        setSaving(false);
        return;
      }
      const localDate = new Date().toLocaleDateString("en-CA");
      const result = await _submitScore({ player_id: playerId, workout_id: activeWorkout.id, made: finalMade, attempts: 0, sprint_secs: parseFloat(sprintSecs) || 0, reps: finalReps, self_points: finalSelfPoints, local_date: localDate } as any);
      const isPersonalBest: boolean = result.isPersonalBest;
      const previousBest: number | null = result.previousBest;
      const { newStreak, bonusAwarded } = await updateStreak(playerId);
      setActiveWorkout(null);
      onScoreLogged();
      let msg = "";
      if (bonusAwarded) { msg = `🔥 ${STREAK_BONUS_DAYS}-day streak! You earned ${STREAK_BONUS_PTS} bonus points!`; }
      else if (isPersonalBest && previousBest !== null) { msg = `🏆 New personal best! Your score was saved to the leaderboard.`; }
      else if (isPersonalBest && previousBest === null) { msg = `Score logged! 🏀 ${newStreak > 1 ? `🔥 ${newStreak}-day streak!` : "Keep grinding!"}`; }
      else { msg = `Attempt logged! Your best score (${previousBest}) stays on the leaderboard. ${newStreak >= 2 ? `🔥 ${newStreak}-day streak!` : "Keep grinding!"}`; }
      showToast(msg);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setSaving(false); }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3500); }

  const TAG_COLORS: Record<string, string> = { Shooting: "tag-blue", Conditioning: "tag-red", Strength: "tag-green", Skills: "tag-gold" };

  function getLogFields(w: Workout) {
    if (w.scoring_type === "flat") {
      return (
        <div style={{ padding: "20px", background: "rgba(40,180,80,0.1)", border: "1px solid rgba(40,180,80,0.25)", borderRadius: 10, textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 16, color: "var(--text)", marginBottom: 6 }}>Complete this workout to earn</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: "#5de098", letterSpacing: 1 }}>{w.flat_points} pts</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Tap "Log My Score" below to confirm you completed this drill.</div>
        </div>
      );
    }
    if (w.scoring_type === "self_reported") {
      return (
        <div className="score-grid" style={{ gridTemplateColumns: "1fr", marginBottom: 0 }}>
          <div className="score-input-wrap">
            <label>Points Earned</label>
            <input type="number" inputMode="numeric" value={selfPoints} onChange={e => setSelfPoints(e.target.value)} placeholder="Enter points your coach assigned" min="0" />
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Check the workout description for how many points this drill is worth.</div>
          </div>
        </div>
      );
    }
    if (w.scoring_type === "multi_spot") {
      const spots: string[] = (w as any).spot_config ?? [];
      const total = multiSpotTotal();
      return (
        <>
          <div style={{ padding: "10px 14px", background: "rgba(26,63,168,0.1)", border: "1px solid rgba(26,63,168,0.25)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 14, lineHeight: 1.6 }}>
            🎯 <strong style={{ color: "#93b4ff" }}>Multi-Spot</strong> — enter your score at each spot. Total is ranked in your grade group.
            <br />
            <span style={{ color: "var(--gold)" }}>🥇 1st = {w.first_place_pts ?? 3} pts</span>{" · "}
            <span style={{ color: "var(--silver)" }}>🥈 2nd = {w.second_place_pts ?? 2} pts</span>{" · "}
            <span style={{ color: "#cd7f32" }}>🥉 3rd = {w.third_place_pts ?? 1} pts</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {spots.map((spotName, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, fontSize: 14, color: "var(--text)", fontWeight: 500 }}>{spotName}</div>
                <input type="number" inputMode="numeric" value={spotScores[i] ?? ""} onChange={e => setSpotScores(prev => ({ ...prev, [i]: e.target.value }))} placeholder="0" min="0"
                  style={{ width: 80, textAlign: "center", fontSize: 18, fontWeight: 600, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 8px", color: "var(--text)", fontFamily: "inherit", outline: "none" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.25)", borderRadius: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>Total score</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: "var(--gold)", lineHeight: 1 }}>{total}</div>
          </div>
        </>
      );
    }
    // Competitive
    const metric = w.scoring_metric ?? "shots made";
    const isTime = metric.toLowerCase().includes("fastest") || metric.toLowerCase().includes("second");
    const category = w.category ?? "";
    let inputLabel = "", inputValue = made, inputSetter = setMade, inputPlaceholder = "0";
    if (!isTime) {
      if (category === "Shooting") { inputLabel = "Shots Made"; inputValue = made; inputSetter = setMade; inputPlaceholder = "e.g. 18"; }
      else if (category === "Finishing") { inputLabel = "Points Scored"; inputValue = made; inputSetter = setMade; inputPlaceholder = "e.g. 12"; }
      else if (category === "Dribbling") { inputLabel = "Reps Completed"; inputValue = reps; inputSetter = setReps; inputPlaceholder = "e.g. 25"; }
      else if (category === "Strength") { inputLabel = "Reps Completed"; inputValue = reps; inputSetter = setReps; inputPlaceholder = "e.g. 20"; }
      else if (category === "Competing") { inputLabel = "Points Scored"; inputValue = made; inputSetter = setMade; inputPlaceholder = "e.g. 15"; }
      else { inputLabel = metric.charAt(0).toUpperCase() + metric.slice(1); inputValue = made; inputSetter = setMade; }
    }
    return (
      <>
        <div style={{ padding: "10px 14px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 14, lineHeight: 1.6 }}>
          🏆 <strong style={{ color: "var(--gold)" }}>Competitive</strong> — ranked within your grade group.
          <br />
          <span style={{ color: "var(--gold)" }}>🥇 1st = {w.first_place_pts ?? 3} pts</span>{" · "}
          <span style={{ color: "var(--silver)" }}>🥈 2nd = {w.second_place_pts ?? 2} pts</span>{" · "}
          <span style={{ color: "#cd7f32" }}>🥉 3rd = {w.third_place_pts ?? 1} pts</span>
        </div>
        <div className="score-grid" style={{ gridTemplateColumns: "1fr" }}>
          {isTime ? (
            <div className="score-input-wrap">
              <Stopwatch onUseTime={(secs) => setSprintSecs(secs.toString())} />
              <label>Your Time (seconds)</label>
              <input type="number" inputMode="decimal" value={sprintSecs} onChange={e => setSprintSecs(e.target.value)} placeholder="e.g. 4.5" step="0.1" />
            </div>
          ) : (
            <div className="score-input-wrap">
              <label>{inputLabel}</label>
              <input type="number" inputMode="numeric" value={inputValue} onChange={e => inputSetter(e.target.value)} placeholder={inputPlaceholder} min="0" style={{ fontSize: 20, textAlign: "center", fontWeight: 600 }} />
            </div>
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

        {announcements.length > 0 && (
          <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {announcements.map(ann => (
              <div key={ann.id} style={{ padding: "12px 16px", borderRadius: 12, background: ann.is_pinned ? "linear-gradient(135deg, rgba(240,192,64,0.15), rgba(240,100,50,0.1))" : "rgba(147,92,255,0.1)", border: `1px solid ${ann.is_pinned ? "rgba(240,192,64,0.5)" : "rgba(147,92,255,0.4)"}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ fontSize: 20, flexShrink: 0 }}>{ann.is_pinned ? "📌" : "📣"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: ann.is_pinned ? 600 : 400, color: ann.is_pinned ? "var(--gold)" : "#d4b4ff", lineHeight: 1.5 }}>{ann.message}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{ann.coach_name} · {new Date(ann.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(() => {
          const allVisible = workouts.filter(w => w.is_active !== false && (!(w as any).publish_date || (w as any).publish_date <= new Date().toISOString().split('T')[0]));
          // Get all unique groups from visible workouts, most recent first
          const groupNames = Array.from(new Set(allVisible.map(w => w.group_name).filter(Boolean))) as string[];
          const ungrouped = allVisible.filter(w => !w.group_name);
          // Default to first group (current active)
          const activeGroup = selectedGroup ?? (groupNames[0] ?? null);
          const displayWorkouts = activeGroup
            ? allVisible.filter(w => w.group_name === activeGroup)
            : ungrouped.length > 0 ? ungrouped : allVisible;

          return (
            <>
              {/* Group tab bar — only show if multiple groups */}
              {groupNames.length > 1 && (
                <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
                  {groupNames.map((g, i) => (
                    <button key={g} onClick={() => setSelectedGroup(g)}
                      style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 20, border: `1px solid ${(activeGroup === g) ? "var(--royal)" : "var(--border)"}`, background: (activeGroup === g) ? "var(--royal)" : "var(--surface2)", color: (activeGroup === g) ? "#fff" : "var(--muted)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
                      {i === 0 ? `📁 ${g}` : g}
                    </button>
                  ))}
                </div>
              )}
              {/* Single group label */}
              {groupNames.length === 1 && (
                <div style={{ marginBottom: 16, padding: "8px 14px", background: "rgba(26,63,168,0.15)", borderRadius: 8, fontSize: 13, color: "#93b4ff", fontWeight: 600, border: "1px solid rgba(26,63,168,0.25)" }}>📁 {groupNames[0]}</div>
              )}

              {rankedCompletion.total > 0 && (
                <div style={{ marginBottom: 16, padding: "12px 16px", background: rankedCompletion.bonusEarned ? "rgba(40,180,80,0.08)" : "rgba(26,63,168,0.1)", border: `1px solid ${rankedCompletion.bonusEarned ? "rgba(40,180,80,0.3)" : "rgba(26,63,168,0.35)"}`, borderRadius: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: rankedCompletion.bonusEarned ? "#5de098" : "var(--gold)" }}>
                      {rankedCompletion.bonusEarned ? "✅ Bonus point earned today!" : `🏆 Ranked Workouts: ${rankedCompletion.completed}/${rankedCompletion.total}`}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {rankedCompletion.bonusEarned ? "+1 pt" : rankedCompletion.completed === rankedCompletion.total - 1 ? "1 more to earn +1 pt!" : `${rankedCompletion.total - rankedCompletion.completed} more to earn +1 pt`}
                    </div>
                  </div>
                  <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 6, background: rankedCompletion.bonusEarned ? "#5de098" : "var(--royal)", width: `${Math.min(100, (rankedCompletion.completed / rankedCompletion.total) * 100)}%`, transition: "width 0.4s ease" }} />
                  </div>
                </div>
              )}

              <div className="workout-grid">
                {[...displayWorkouts].sort((a, b) => {
                  const ranked = (t: string) => t === "competitive" || t === "multi_spot" ? 0 : 1;
                  return ranked(a.scoring_type) - ranked(b.scoring_type);
                }).map(w => {
            const vid = getVideoId(w.video_url);
            const logged = scoreFor(w.id);
            const resourceUrl = (w as any).resource_url;
            const scoringLabel =
              w.scoring_type === "competitive" ? "🏆 Ranked by group" :
              w.scoring_type === "multi_spot"  ? `🎯 Multi-spot · ${((w as any).spot_config?.length ?? 0)} spots` :
              w.scoring_type === "flat"        ? `✅ ${w.flat_points} pts` : "✏️ Self-reported";
            const scoringColor =
              w.scoring_type === "competitive" ? { bg: "rgba(240,192,64,0.15)", color: "var(--gold)" } :
              w.scoring_type === "multi_spot"  ? { bg: "rgba(26,63,168,0.2)", color: "#93b4ff" } :
              w.scoring_type === "flat"        ? { bg: "rgba(40,180,80,0.15)", color: "#5de098" } :
              { bg: "rgba(26,63,168,0.2)", color: "#93b4ff" };

            return (
              <div className="workout-card clickable" key={w.id} onClick={() => openLog(w)}>
                {vid ? (
                  <div className="workout-thumb-player">
                    <img src={`https://img.youtube.com/vi/${vid}/hqdefault.jpg`} alt={w.title} />
                    <div className="thumb-tag-bar"><span className={`tag ${TAG_COLORS[w.category] ?? "tag-blue"}`}>{w.category}</span></div>
                  </div>
                ) : (
                  <div className="emoji-thumb">{w.emoji}</div>
                )}
                <div className="workout-info">
                  <div className="workout-title">{w.title}</div>
                  <div style={{ marginTop: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: scoringColor.bg, color: scoringColor.color }}>{scoringLabel}</span>
                  </div>
                  {w.deadline && (() => {
                    const days = Math.ceil((new Date(w.deadline).getTime() - Date.now()) / 86400000);
                    if (days < 0) return null;
                    return <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: days <= 2 ? "#ff7b7b" : days <= 5 ? "var(--gold)" : "#93b4ff" }}>⏰ {days === 0 ? "Due today!" : `${days} day${days !== 1 ? "s" : ""} left`}</div>;
                  })()}
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>{w.description?.slice(0, 80)}…</div>
                  {vid && (
                    <div className="video-strip" onClick={e => e.stopPropagation()}>
                      <span>📹</span><span style={{ flex: 1 }}>Drill video</span>
                      <a href={`https://www.youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer" style={{ color: "var(--gold)", fontWeight: 600, textDecoration: "none", fontSize: 11 }}>Watch ↗</a>
                    </div>
                  )}
                  {resourceUrl && (
                    <div className="video-strip" onClick={e => e.stopPropagation()}>
                      <span>📄</span><span style={{ flex: 1 }}>Program / resource</span>
                      <a href={resourceUrl} target="_blank" rel="noreferrer" style={{ color: "#93b4ff", fontWeight: 600, textDecoration: "none", fontSize: 11 }}>View ↗</a>
                    </div>
                  )}
                  {logged ? (
                    <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                      <div className="score-badge" style={{ flex: 1 }}>
                        ✓ {w.scoring_type === "flat" ? `${w.flat_points} pts earned`
                          : w.scoring_type === "self_reported" ? `${logged.self_points} pts logged`
                          : w.scoring_type === "multi_spot" ? `${logged.made} total`
                          : [logged.made > 0 && `${logged.made} ${w.scoring_metric ?? "made"}`, logged.sprint_secs > 0 && `${logged.sprint_secs}s`].filter(Boolean).join(" · ")
                        }
                      </div>
                      <button onClick={e => { e.stopPropagation(); openLog(w); }} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "4px 9px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>✏️ Update</button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
            </>
          );
        })()}
      </div>

      {activeWorkout && (
        <div className="modal-overlay open" onClick={() => setActiveWorkout(null)}>
          <div className="log-modal" onClick={e => e.stopPropagation()}
            style={{ transform: `translateY(${modalOffset}px)`, transition: modalOffset === 0 ? "transform 0.2s ease" : "none" }}
            onTouchStart={e => { modalDragY.current = e.touches[0].clientY; }}
            onTouchMove={e => { const dy = e.touches[0].clientY - modalDragY.current; if (dy > 0) setModalOffset(dy); }}
            onTouchEnd={e => { const dy = e.changedTouches[0].clientY - modalDragY.current; if (dy > 100) { setModalOffset(0); setActiveWorkout(null); } else setModalOffset(0); }}>
            <div style={{ width: 40, height: 4, background: "var(--border)", borderRadius: 2, margin: "-12px auto 16px", opacity: 0.6 }} />
            <button className="modal-close" onClick={() => setActiveWorkout(null)}>✕</button>

            <div className="modal-title" style={{ marginBottom: 4 }}>{activeWorkout.title}</div>
            {activeWorkout.category && (
              <span className={`tag ${TAG_COLORS[activeWorkout.category] ?? "tag-blue"}`} style={{ fontSize: 11, marginBottom: 14, display: "inline-block" }}>{activeWorkout.category}</span>
            )}

            {/* Video */}
            {(() => {
              const vid = getVideoId(activeWorkout.video_url);
              if (!vid) return null;
              return (
                <div style={{ borderRadius: 10, overflow: "hidden", marginBottom: 16, marginTop: 10, background: "#000", position: "relative", paddingTop: "56.25%" }}>
                  <iframe src={`https://www.youtube.com/embed/${vid}?rel=0&modestbranding=1`} title={activeWorkout.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
                </div>
              );
            })()}

            {/* Resource link */}
            {(activeWorkout as any).resource_url && (
              <a href={(activeWorkout as any).resource_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "rgba(26,63,168,0.1)", border: "1px solid rgba(26,63,168,0.25)", borderRadius: 10, marginBottom: 14, textDecoration: "none" }}>
                <span style={{ fontSize: 20 }}>📄</span>
                <span style={{ flex: 1, fontSize: 13, color: "#93b4ff", fontWeight: 600 }}>View Program / Resource</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>↗</span>
              </a>
            )}

            {activeWorkout.description && (
              <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13, color: "var(--silver-light)", lineHeight: 1.7, marginBottom: 16, whiteSpace: "pre-wrap" }}>
                {activeWorkout.description}
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0 16px", opacity: 0.5 }} />

            {/* Drill Timer — shown if coach enabled it for this workout */}
            {(activeWorkout as any).timer_duration && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>⏱ Drill Timer</div>
                <DrillTimer defaultSeconds={(activeWorkout as any).timer_duration} compact={true} />
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>📊 Log Your Score</div>

            {scoreFor(activeWorkout.id) && activeWorkout.scoring_type !== "multi_spot" && (() => {
              const s = scoreFor(activeWorkout.id)!;
              const best = s.self_points > 0 ? s.self_points : (s.made + s.reps);
              return (
                <div style={{ padding: "10px 14px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 14, lineHeight: 1.6 }}>
                  🏆 <strong style={{ color: "var(--gold)" }}>Your personal best: {best}</strong><br />
                  <span style={{ color: "var(--muted)" }}>Log today's attempt — if you beat your best it updates the leaderboard. If not, your best stays and your streak still counts! 🔥</span>
                </div>
              );
            })()}

            {getLogFields(activeWorkout)}
            <button className="btn-primary" onClick={handleSubmitScore} disabled={saving} style={{ marginTop: 16 }}>
              {saving ? "Saving…" : "Log My Score"}
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </>
  );
}
