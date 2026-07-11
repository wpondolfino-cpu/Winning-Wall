// src/components/coach/WorkoutBuilder.tsx
import { useState, useEffect } from "react";
import { supabase, Workout, createWorkout, getEmbedUrl, ScoringType } from "../../lib/supabase";
import { loadGroupsForBuilder } from "./GroupManager";
import LibraryDrillPicker from "./LibraryDrillPicker";

type Category = "Dribbling" | "Finishing" | "Shooting" | "Competing" | "Strength";
const CATEGORIES: Category[] = ["Dribbling", "Finishing", "Shooting", "Competing", "Strength"];
const EMOJIS = ["🏀","🎯","⚡","💪","🏆","🔥","🎽","⏱️"];

interface Props {
  editWorkout: Workout | null;
  onSaved: () => void;
  onCancel: () => void;
  defaultIsActive?: boolean; // only applies when creating a new drill (editWorkout is null)
}

export default function WorkoutBuilder({ editWorkout, onSaved, onCancel, defaultIsActive }: Props) {
  const [attaching, setAttaching] = useState(false);
  const [title, setTitle]               = useState("");
  const [category, setCategory]         = useState<Category>("Shooting");
  const [subcategory, setSubcategory]   = useState("");
  const [subcategoryOptions, setSubcategoryOptions] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("workouts").select("subcategory")
      .eq("category", category).not("subcategory", "is", null)
      .then(({ data }) => {
        const unique = [...new Set((data ?? []).map((r: any) => r.subcategory as string).filter(Boolean))].sort();
        setSubcategoryOptions(unique);
      });
  }, [category]);
  const [desc, setDesc]                 = useState("");
  const [videoUrl, setVideoUrl]         = useState("");
  const [resourceUrl, setResourceUrl]   = useState("");
  const [emoji, setEmoji]               = useState("🏀");
  const [scoringType, setScoringType]   = useState<ScoringType>("competitive");
  const [scoringMetric, setScoringMetric] = useState("shots made");
  const [firstPts, setFirstPts]         = useState("5");
  const [secondPts, setSecondPts]       = useState("3");
  const [thirdPts, setThirdPts]         = useState("1");
  const [flatPoints, setFlatPoints]     = useState("50");
  const [timerDuration, setTimerDuration] = useState<number | null>(null);
  const [publishDate, setPublishDate]   = useState("");
  const [groupName, setGroupName]       = useState("");
  const [groupId, setGroupId]           = useState<string | null>(null);
  const [isActive, setIsActive]         = useState(defaultIsActive ?? true);
  const [deadline, setDeadline]         = useState("");
  const [spotNames, setSpotNames]       = useState<string[]>(["Spot 1","Spot 2","Spot 3","Spot 4","Spot 5"]);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState("");
  const [groups, setGroups]             = useState<any[]>([]);
  const embedPreview = getEmbedUrl(videoUrl);

  useEffect(() => {
    loadGroupsForBuilder().then(setGroups);
    if (editWorkout) {
      setTitle(editWorkout.title);
      setCategory((editWorkout.category as Category) ?? "Shooting");
      setSubcategory((editWorkout as any).subcategory ?? "");
      setDesc(editWorkout.description ?? "");
      setVideoUrl(editWorkout.video_url ?? "");
      setResourceUrl((editWorkout as any).resource_url ?? "");
      setEmoji(editWorkout.emoji ?? "🏀");
      setScoringType(editWorkout.scoring_type ?? "competitive");
      setScoringMetric(editWorkout.scoring_metric ?? "shots made");
      setFirstPts(editWorkout.first_place_pts?.toString() ?? "3");
      setSecondPts(editWorkout.second_place_pts?.toString() ?? "2");
      setThirdPts(editWorkout.third_place_pts?.toString() ?? "1");
      setFlatPoints(editWorkout.flat_points?.toString() ?? "50");
      setTimerDuration((editWorkout as any).timer_duration ?? null);
      setPublishDate((editWorkout as any).publish_date ?? "");
      setGroupName(editWorkout.group_name ?? "");
      setGroupId((editWorkout as any).group_id ?? null);
      setIsActive(editWorkout.is_active ?? true);
      setDeadline(editWorkout.deadline ? new Date(editWorkout.deadline).toISOString().split("T")[0] : "");
      setSpotNames((editWorkout as any).spot_config ?? ["Spot 1","Spot 2","Spot 3","Spot 4","Spot 5"]);
    }
  }, [editWorkout]);

  function addSpot() { if (spotNames.length < 10) setSpotNames(p => [...p, `Spot ${p.length + 1}`]); }
  function removeSpot(i: number) { setSpotNames(p => p.filter((_, idx) => idx !== i)); }
  function updateSpot(i: number, val: string) { setSpotNames(p => p.map((s, idx) => idx === i ? val : s)); }

  async function attachExistingDrill(drill: Workout) {
    setAttaching(true);
    setError("");
    try {
      const { error: err } = await supabase.from("workouts").update({
        group_name: groupName.trim() || null,
        group_id: groupId ?? null,
        is_active: isActive,
        deadline: deadline ? new Date(deadline + "T23:59:59").toISOString() : null,
      }).eq("id", drill.id);
      if (err) throw err;
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "Failed to attach drill");
    } finally {
      setAttaching(false);
    }
  }

  async function handleSave() {
    if (!title.trim()) { setError("Please enter a workout title."); return; }
    if (scoringType === "flat" && parseInt(flatPoints) <= 0) { setError("Please enter a point value greater than 0."); return; }
    if (scoringType === "multi_spot" && spotNames.filter(s => s.trim()).length < 1) { setError("Please add at least one spot."); return; }
    setSaving(true); setError("");
    try {
      const base = {
        title, category, subcategory: subcategory.trim() || undefined, description: desc,
        video_url: videoUrl || undefined, emoji,
        scoring_type: scoringType,
        scoring_metric: scoringType === "competitive" ? scoringMetric : undefined,
        flat_points: scoringType === "flat" ? parseInt(flatPoints) : undefined,
        timer_duration: timerDuration,
        publish_date: publishDate || undefined,
        first_place_pts: (scoringType === "competitive" || scoringType === "multi_spot") ? parseInt(firstPts) || 3 : undefined,
        second_place_pts: (scoringType === "competitive" || scoringType === "multi_spot") ? parseInt(secondPts) || 2 : undefined,
        third_place_pts: (scoringType === "competitive" || scoringType === "multi_spot") ? parseInt(thirdPts) || 1 : undefined,
        group_name: groupName.trim() || undefined,
        group_id: groupId ?? undefined,
        is_active: isActive,
        deadline: deadline ? new Date(deadline + "T23:59:59").toISOString() : undefined,
        ...(scoringType === "multi_spot" ? { spot_config: spotNames.filter(s => s.trim()) } : {}),
        ...(resourceUrl.trim() ? { resource_url: resourceUrl.trim() } : {}),
      } as any;

      if (editWorkout) {
        const { error: err } = await supabase.from("workouts").update({
          ...base,
          subcategory: subcategory.trim() || null,
          flat_points: scoringType === "flat" ? parseInt(flatPoints) : null,
          scoring_metric: scoringType === "competitive" ? scoringMetric : null,
          first_place_pts: (scoringType === "competitive" || scoringType === "multi_spot") ? parseInt(firstPts) || 3 : null,
          second_place_pts: (scoringType === "competitive" || scoringType === "multi_spot") ? parseInt(secondPts) || 2 : null,
          third_place_pts: (scoringType === "competitive" || scoringType === "multi_spot") ? parseInt(thirdPts) || 1 : null,
          group_name: groupName.trim() || null,
          group_id: groupId ?? null,
          video_url: videoUrl.trim() || null,
          deadline: deadline ? new Date(deadline + "T23:59:59").toISOString() : null,
          spot_config: scoringType === "multi_spot" ? spotNames.filter(s => s.trim()) : null,
          resource_url: resourceUrl.trim() || null,
          timer_duration: timerDuration,
          publish_date: publishDate || null,
        }).eq("id", editWorkout.id);
        if (err) throw err;
      } else {
        await createWorkout(base);
      }
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="card" style={{ marginTop: 20, marginBottom: 28 }}>
      <div className="card-title">{editWorkout ? "✏️ Edit Workout" : "New Workout"}</div>
      <div className="builder-form">

        <div className="builder-row">
          <div>
            <label>Workout Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. 5-Spot Shooting" />
          </div>
          <div>
            <label>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as Category)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Subcategory (optional) <span style={{ fontWeight: 400, textTransform: "none" }}>— e.g. "1v1", "2v2" under Competing. Only organizes the Drill Library, doesn't affect Manage Workouts.</span>
          </label>
          <input value={subcategory} onChange={e => setSubcategory(e.target.value)} placeholder="e.g. 1v1" list="subcategory-options"
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          <datalist id="subcategory-options">
            {subcategoryOptions.map(opt => <option key={opt} value={opt} />)}
          </datalist>
        </div>

        <div>
          <label>Workout Group <span style={{ color: "var(--muted)", fontWeight: 400 }}>(assigns this workout to a group)</span></label>
          <select value={groupId ?? ""} onChange={e => {
            const val = e.target.value;
            setGroupId(val || null);
            const g = groups.find(g => g.id === val);
            setGroupName(g?.name ?? "");
          }} style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
            <option value="">No group (ungrouped)</option>
            {groups.filter(g => g.status !== "archived").map(g => (
              <option key={g.id} value={g.id}>{g.name} — {g.status === "active" ? "🌐 Live" : "📝 Draft"}</option>
            ))}
          </select>
          {groupId && (() => {
            const g = groups.find(g => g.id === groupId);
            if (!g) return null;
            return <div style={{ fontSize: 11, marginTop: 4, color: g.status === "active" ? "#5de098" : "var(--gold)" }}>
              {g.status === "active" ? "🌐 Visible to players immediately" : "📝 Draft — hidden until group is published"}
            </div>;
          })()}
          {!editWorkout && (
            <LibraryDrillPicker onSelect={attachExistingDrill} />
          )}
          {attaching && <div style={{ fontSize: 12, color: "var(--gold)", marginTop: 6 }}>Attaching…</div>}
        </div>

        <div style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Deadline (optional)</label>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} min={new Date().toISOString().split("T")[0]}
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          {deadline && <div style={{ fontSize: 11, color: "var(--gold)", marginTop: 4 }}>⏰ Players will see a countdown to this date</div>}
        </div>

        <div style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Publish Date (optional)</label>
          <input type="date" value={publishDate} onChange={e => setPublishDate(e.target.value)}
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          {publishDate ? <div style={{ fontSize: 11, color: "#93b4ff", marginTop: 4 }}>📅 Hidden until {new Date(publishDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
            : <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Leave blank to show immediately</div>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>Visible to Players</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>When off, players cannot see this workout. Points already earned are kept.</div>
          </div>
          <div onClick={() => setIsActive(a => !a)} style={{ width: 46, height: 26, borderRadius: 13, cursor: "pointer", flexShrink: 0, background: isActive ? "var(--royal)" : "var(--surface3)", position: "relative", transition: "background .2s", border: "1px solid var(--border)" }}>
            <div style={{ position: "absolute", top: 3, left: isActive ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? "#5de098" : "var(--muted)" }}>{isActive ? "On" : "Off"}</span>
        </div>

        <div>
          <label>Emoji Icon</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {EMOJIS.map(e => (
              <button key={e} onClick={() => setEmoji(e)} style={{ background: emoji === e ? "var(--royal)" : "var(--surface2)", border: `1px solid ${emoji === e ? "var(--royal-light)" : "var(--border)"}`, borderRadius: 8, padding: "6px 10px", fontSize: 20, cursor: "pointer" }}>{e}</button>
            ))}
          </div>
        </div>

        <div>
          <label>Description / Instructions</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Describe the drill and what players should do…" />
        </div>

        <div>
          <label>Scoring Type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
            {([
              { type: "competitive",   icon: "🏆", label: "Competitive",   sub: "Ranked in grade group. 1st/2nd/3rd earn pts." },
              { type: "multi_spot",    icon: "🎯", label: "Multi-Spot",    sub: "Player enters score per spot. Total is summed." },
              { type: "flat",          icon: "✅", label: "Flat Points",   sub: "Everyone who logs it gets the same points." },
              { type: "self_reported", icon: "✏️", label: "Self-Reported", sub: "Player types in how many points they earned." },
            ] as const).map(opt => (
              <div key={opt.type} onClick={() => setScoringType(opt.type)} style={{ padding: 12, borderRadius: 10, cursor: "pointer", transition: "all .2s", border: `2px solid ${scoringType === opt.type ? "var(--royal-light)" : "var(--border)"}`, background: scoringType === opt.type ? "rgba(26,63,168,0.15)" : "var(--surface2)" }}>
                <div style={{ fontSize: 22, marginBottom: 5 }}>{opt.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 4 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{opt.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {scoringType === "flat" && (
          <div>
            <label>Points Awarded for Completion</label>
            <input type="number" value={flatPoints} onChange={e => setFlatPoints(e.target.value)} placeholder="e.g. 100" min="1" style={{ maxWidth: 180 }} />
          </div>
        )}

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

        {(scoringType === "competitive" || scoringType === "multi_spot") && (
          <div>
            <label>Points Per Rank</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
              {[
                { label: "🥇 1st", val: firstPts, set: setFirstPts, color: "var(--gold)", border: "rgba(240,192,64,0.4)" },
                { label: "🥈 2nd", val: secondPts, set: setSecondPts, color: "var(--silver-light)", border: "rgba(176,184,200,0.3)" },
                { label: "🥉 3rd", val: thirdPts, set: setThirdPts, color: "#cd7f32", border: "rgba(205,127,50,0.3)" },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 11, color: f.color, fontWeight: 700, marginBottom: 5 }}>{f.label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="number" value={f.val} min="0" onChange={e => f.set(e.target.value)} style={{ width: "100%", background: "var(--surface2)", border: `1px solid ${f.border}`, borderRadius: 8, padding: "9px 12px", color: f.color, fontSize: 16, fontWeight: 700, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                    <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>pts</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>Everyone else gets 0 pts. Defaults are 5 / 3 / 1.</div>
          </div>
        )}

        {scoringType === "multi_spot" && (
          <div>
            <label>Spots</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {spotNames.map((spot, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, minWidth: 24, textAlign: "center" }}>{i + 1}</div>
                  <input value={spot} onChange={e => updateSpot(i, e.target.value)} placeholder={`Spot ${i + 1} name`}
                    style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                  {spotNames.length > 1 && <button onClick={() => removeSpot(i)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 18, padding: "4px 6px" }}>×</button>}
                </div>
              ))}
              {spotNames.length < 10 && <button onClick={addSpot} style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "9px 14px", fontSize: 13, color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}>+ Add spot</button>}
            </div>
          </div>
        )}

        {scoringType === "self_reported" && (
          <div style={{ padding: "10px 14px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", lineHeight: 1.6 }}>
            💡 Tell players in the description how many points they can earn and how.
          </div>
        )}

        <div>
          <label>YouTube Video URL (optional)</label>
          <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
          {embedPreview && <div style={{ marginTop: 6, fontSize: 11, color: "#5de098" }}>✓ Valid YouTube URL</div>}
        </div>

        <div>
          <label>Program / Resource Link (optional)</label>
          <input value={resourceUrl} onChange={e => setResourceUrl(e.target.value)} placeholder="https://docs.google.com/… or any link" />
          {resourceUrl.trim() && <div style={{ fontSize: 11, color: "#5de098", marginTop: 4 }}>📄 Players will see a "View Program" button</div>}
        </div>

        <div>
          <label>⏱ Drill Timer <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Show a countdown timer in the drill</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: timerDuration !== null ? 10 : 0 }}>
            <div onClick={() => setTimerDuration(timerDuration !== null ? null : 30)} style={{ width: 46, height: 26, borderRadius: 13, cursor: "pointer", flexShrink: 0, background: timerDuration !== null ? "var(--royal)" : "var(--surface2)", position: "relative", transition: "background .2s", border: "1px solid var(--border)" }}>
              <div style={{ position: "absolute", top: 3, left: timerDuration !== null ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
            </div>
            <span style={{ fontSize: 12, color: timerDuration !== null ? "#5de098" : "var(--muted)", fontWeight: 600 }}>{timerDuration !== null ? "Timer On" : "No Timer"}</span>
          </div>
          {timerDuration !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  value={Math.floor(timerDuration / 60)}
                  onChange={e => {
                    const mins = parseInt(e.target.value) || 0;
                    const secs = timerDuration % 60;
                    setTimerDuration(mins * 60 + secs);
                  }}
                  min="0" max="99" placeholder="0"
                  style={{ width: 60, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 15, fontFamily: "inherit", outline: "none", textAlign: "center" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>min</span>
              </div>
              <span style={{ color: "var(--muted)" }}>:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  value={timerDuration % 60}
                  onChange={e => {
                    const secs = Math.min(59, parseInt(e.target.value) || 0);
                    const mins = Math.floor(timerDuration / 60);
                    setTimerDuration(mins * 60 + secs);
                  }}
                  min="0" max="59" placeholder="0"
                  style={{ width: 60, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 15, fontFamily: "inherit", outline: "none", textAlign: "center" }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>sec</span>
              </div>
              <div style={{ fontSize: 12, color: "#93b4ff", marginLeft: 4 }}>
                = {timerDuration}s total
              </div>
            </div>
          )}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
            {saving ? "Saving…" : editWorkout ? "Save Changes" : "Publish Workout"}
          </button>
          <button onClick={onCancel} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
