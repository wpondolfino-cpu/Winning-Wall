// src/components/LiftingPanel.tsx
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  isCoach?: boolean;
  isAdmin?: boolean;
}

interface Program {
  id: string;
  title: string;
  description?: string;
  visibility: "public" | "assigned";
  is_active: boolean;
  created_by: string;
  created_at: string;
}

interface Exercise {
  id: string;
  program_id: string;
  name: string;
  video_url?: string;
  target_sets?: number;
  target_reps?: number;
  target_weight?: number;
  sort_order: number;
  hof_eligible: boolean;
}

interface SetEntry { reps: string; weight: string; }

// Epley 1RM formula
function calc1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function getYouTubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  return match ? match[1] : null;
}

export default function LiftingPanel({ playerId, playerName, avatarUrl, isCoach = false, isAdmin = false }: Props) {
  const canManage = isCoach || isAdmin;

  // ── view state ──
  const [view, setView] = useState<"programs" | "builder">("programs");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [exercises, setExercises] = useState<Record<string, Exercise[]>>({});
  const [expandedProgram, setExpandedProgram] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── log modal ──
  const [logExercise, setLogExercise] = useState<Exercise | null>(null);
  const [sets, setSets] = useState<SetEntry[]>([{ reps: "", weight: "" }]);
  const [logSaving, setLogSaving] = useState(false);
  const [logToast, setLogToast] = useState("");

  // ── recent logs per exercise ──
  const [recentLogs, setRecentLogs] = useState<Record<string, any[]>>({});

  // ── builder state ──
  const [bTitle, setBTitle] = useState("");
  const [bDesc, setBDesc] = useState("");
  const [bVisibility, setBVisibility] = useState<"public" | "assigned">("public");
  const [bExercises, setBExercises] = useState<Omit<Exercise, "id" | "program_id">[]>([
    { name: "", video_url: "", target_sets: 3, target_reps: 8, target_weight: undefined, sort_order: 0, hof_eligible: false }
  ]);
  const [bSaving, setBSaving] = useState(false);
  const [bError, setBError] = useState("");
  const [editProgram, setEditProgram] = useState<Program | null>(null);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [assignedPlayers, setAssignedPlayers] = useState<string[]>([]);
  const [deletingProgram, setDeletingProgram] = useState<string | null>(null);

  useEffect(() => { loadPrograms(); }, []);

  async function loadPrograms() {
    setLoading(true);
    try {
      // Load programs visible to this user
      let query = supabase.from("lifting_programs").select("*").eq("is_active", true).order("created_at", { ascending: false });
      const { data: progs } = await query;
      if (!progs) { setLoading(false); return; }

      let visible: Program[] = [];
      if (canManage) {
        visible = progs;
      } else {
        // Players see public programs + assigned programs
        const { data: assignments } = await supabase
          .from("lifting_program_assignments")
          .select("program_id")
          .eq("player_id", playerId);
        const assignedIds = new Set((assignments ?? []).map((a: any) => a.program_id));
        visible = progs.filter(p => p.visibility === "public" || assignedIds.has(p.id));
      }
      setPrograms(visible);

      // Load exercises for all visible programs
      if (visible.length > 0) {
        const { data: exs } = await supabase
          .from("lifting_exercises")
          .select("*")
          .in("program_id", visible.map(p => p.id))
          .order("sort_order");
        const byProgram: Record<string, Exercise[]> = {};
        (exs ?? []).forEach((e: Exercise) => {
          if (!byProgram[e.program_id]) byProgram[e.program_id] = [];
          byProgram[e.program_id].push(e);
        });
        setExercises(byProgram);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentLogs(exerciseIds: string[]) {
    if (exerciseIds.length === 0) return;
    const { data } = await supabase
      .from("lifting_logs")
      .select("*")
      .eq("player_id", playerId)
      .in("exercise_id", exerciseIds)
      .order("logged_at", { ascending: false });
    const byEx: Record<string, any[]> = {};
    (data ?? []).forEach((log: any) => {
      if (!byEx[log.exercise_id]) byEx[log.exercise_id] = [];
      if (byEx[log.exercise_id].length < 3) byEx[log.exercise_id].push(log);
    });
    setRecentLogs(prev => ({ ...prev, ...byEx }));
  }

  async function loadAllPlayers() {
    const { data } = await supabase.from("profiles").select("id,name").eq("role", "player").order("name");
    setAllPlayers(data ?? []);
  }

  function openLog(ex: Exercise) {
    setLogExercise(ex);
    setSets([{ reps: "", weight: "" }]);
  }

  function addSet() { setSets(prev => [...prev, { reps: "", weight: "" }]); }
  function removeSet(i: number) { setSets(prev => prev.filter((_, idx) => idx !== i)); }
  function updateSet(i: number, field: "reps" | "weight", val: string) {
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  }

  async function saveLog() {
    if (!logExercise) return;
    const validSets = sets.filter(s => s.reps.trim() && s.weight.trim());
    if (validSets.length === 0) { showLogToast("Enter at least one set."); return; }
    setLogSaving(true);
    try {
      const setsData = validSets.map(s => ({ reps: parseInt(s.reps), weight: parseFloat(s.weight) }));
      await supabase.from("lifting_logs").insert({
        player_id: playerId,
        exercise_id: logExercise.id,
        logged_at: new Date().toISOString(),
        sets_data: setsData,
      });

      // Update personal record if eligible
      if (logExercise.hof_eligible) {
        const best = setsData.reduce((max, s) => {
          const rm = calc1RM(s.weight, s.reps);
          return rm > max.rm ? { rm, weight: s.weight } : max;
        }, { rm: 0, weight: 0 });

        const { data: existing } = await supabase
          .from("lifting_records")
          .select("*")
          .eq("player_id", playerId)
          .eq("exercise_id", logExercise.id)
          .single();

        if (!existing || best.rm > existing.best_1rm) {
          await supabase.from("lifting_records").upsert({
            player_id: playerId,
            exercise_id: logExercise.id,
            player_name: playerName,
            avatar_url: avatarUrl ?? null,
            best_weight: best.weight,
            best_1rm: best.rm,
            achieved_at: new Date().toISOString(),
          }, { onConflict: "player_id,exercise_id" });
        }
      }

      setLogExercise(null);
      await loadRecentLogs([logExercise.id]);
      showLogToast("✅ Session logged!");
    } catch (e: any) {
      showLogToast("Error: " + e.message);
    } finally {
      setLogSaving(false);
    }
  }

  function showLogToast(msg: string) { setLogToast(msg); setTimeout(() => setLogToast(""), 3000); }

  // ── Builder helpers ──
  function openBuilder(prog?: Program) {
    if (prog) {
      setEditProgram(prog);
      setBTitle(prog.title);
      setBDesc(prog.description ?? "");
      setBVisibility(prog.visibility);
      const exs = exercises[prog.id] ?? [];
      setBExercises(exs.length > 0 ? exs.map(e => ({
        name: e.name, video_url: e.video_url ?? "", target_sets: e.target_sets,
        target_reps: e.target_reps, target_weight: e.target_weight,
        sort_order: e.sort_order, hof_eligible: e.hof_eligible,
      })) : [{ name: "", video_url: "", target_sets: 3, target_reps: 8, target_weight: undefined, sort_order: 0, hof_eligible: false }]);
      // Load assignments
      supabase.from("lifting_program_assignments").select("player_id").eq("program_id", prog.id).then(({ data }) => {
        setAssignedPlayers((data ?? []).map((a: any) => a.player_id));
      });
    } else {
      setEditProgram(null);
      setBTitle(""); setBDesc(""); setBVisibility("public");
      setBExercises([{ name: "", video_url: "", target_sets: 3, target_reps: 8, target_weight: undefined, sort_order: 0, hof_eligible: false }]);
      setAssignedPlayers([]);
    }
    loadAllPlayers();
    setView("builder");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addExercise() {
    setBExercises(prev => [...prev, { name: "", video_url: "", target_sets: 3, target_reps: 8, target_weight: undefined, sort_order: prev.length, hof_eligible: false }]);
  }

  function removeExercise(i: number) { setBExercises(prev => prev.filter((_, idx) => idx !== i)); }

  function updateExercise(i: number, field: string, val: any) {
    setBExercises(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  }

  async function saveProgram() {
    if (!bTitle.trim()) { setBError("Please enter a program title."); return; }
    if (bExercises.filter(e => e.name.trim()).length === 0) { setBError("Please add at least one exercise."); return; }
    setBSaving(true); setBError("");
    try {
      let programId: string;
      if (editProgram) {
        await supabase.from("lifting_programs").update({ title: bTitle, description: bDesc || null, visibility: bVisibility }).eq("id", editProgram.id);
        programId = editProgram.id;
        // Delete old exercises and replace
        await supabase.from("lifting_exercises").delete().eq("program_id", programId);
        // Delete old assignments
        await supabase.from("lifting_program_assignments").delete().eq("program_id", programId);
      } else {
        const { data, error } = await supabase.from("lifting_programs").insert({
          created_by: playerId,
          title: bTitle,
          description: bDesc || null,
          visibility: bVisibility,
          is_active: true,
        }).select().single();
        if (error) throw error;
        programId = data.id;
      }

      // Insert exercises
      const validExercises = bExercises.filter(e => e.name.trim()).map((e, i) => ({
        program_id: programId,
        name: e.name.trim(),
        video_url: e.video_url?.trim() || null,
        target_sets: e.target_sets || null,
        target_reps: e.target_reps || null,
        target_weight: e.target_weight || null,
        sort_order: i,
        hof_eligible: e.hof_eligible,
      }));
      await supabase.from("lifting_exercises").insert(validExercises);

      // Insert assignments
      if (bVisibility === "assigned" && assignedPlayers.length > 0) {
        await supabase.from("lifting_program_assignments").insert(
          assignedPlayers.map(pid => ({ program_id: programId, player_id: pid }))
        );
      }

      setView("programs");
      await loadPrograms();
    } catch (e: any) { setBError(e.message); }
    finally { setBSaving(false); }
  }

  async function deleteProgram(prog: Program) {
    if (!window.confirm(`Delete "${prog.title}"?\n\nAll exercise logs for this program will also be deleted.`)) return;
    setDeletingProgram(prog.id);
    try {
      await supabase.from("lifting_programs").update({ is_active: false }).eq("id", prog.id);
      await loadPrograms();
    } finally { setDeletingProgram(null); }
  }

  // ── Render ──
  if (loading) return <div className="panel active" style={{ textAlign: "center", color: "var(--muted)", padding: "60px 0" }}>Loading…</div>;

  // ── Program Builder (coach/admin) ──
  if (view === "builder") {
    return (
      <div className="panel active">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => setView("programs")} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
          <div className="section-title" style={{ margin: 0 }}>{editProgram ? "Edit Program" : "New Lifting Program"}</div>
        </div>

        <div className="builder-form">
          <div>
            <label>Program Title</label>
            <input value={bTitle} onChange={e => setBTitle(e.target.value)} placeholder="e.g. Summer Strength Phase 1" />
          </div>
          <div>
            <label>Description (optional)</label>
            <textarea value={bDesc} onChange={e => setBDesc(e.target.value)} placeholder="What's this program for? Any notes for players…" rows={2} />
          </div>

          {/* Visibility */}
          <div>
            <label>Visibility</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              {([
                { val: "public", icon: "🌐", label: "Everyone", sub: "All players can see this program" },
                { val: "assigned", icon: "👤", label: "Specific Players", sub: "Only assigned players see it" },
              ] as const).map(opt => (
                <div key={opt.val} onClick={() => setBVisibility(opt.val)} style={{ padding: 12, borderRadius: 10, cursor: "pointer", border: `2px solid ${bVisibility === opt.val ? "var(--royal-light)" : "var(--border)"}`, background: bVisibility === opt.val ? "rgba(26,63,168,0.15)" : "var(--surface2)" }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{opt.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 3 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{opt.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Player assignment */}
          {bVisibility === "assigned" && (
            <div>
              <label>Assign to Players</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
                {allPlayers.map(p => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: assignedPlayers.includes(p.id) ? "rgba(26,63,168,0.1)" : "transparent" }}>
                    <input type="checkbox" checked={assignedPlayers.includes(p.id)}
                      onChange={e => setAssignedPlayers(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
                    <span style={{ fontSize: 13, color: "var(--text)" }}>{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Exercises */}
          <div>
            <label>Exercises</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
              {bExercises.map((ex, i) => (
                <div key={i} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, minWidth: 20 }}>{i + 1}</div>
                    <input value={ex.name} onChange={e => updateExercise(i, "name", e.target.value)} placeholder="Exercise name (e.g. Bench Press)"
                      style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                    {bExercises.length > 1 && (
                      <button onClick={() => removeExercise(i)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 18, padding: "2px 6px" }}>×</button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Sets</div>
                      <input type="number" value={ex.target_sets ?? ""} onChange={e => updateExercise(i, "target_sets", parseInt(e.target.value) || undefined)} placeholder="3"
                        style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Reps</div>
                      <input type="number" value={ex.target_reps ?? ""} onChange={e => updateExercise(i, "target_reps", parseInt(e.target.value) || undefined)} placeholder="8"
                        style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Weight (lbs)</div>
                      <input type="number" value={ex.target_weight ?? ""} onChange={e => updateExercise(i, "target_weight", parseFloat(e.target.value) || undefined)} placeholder="135"
                        style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                    </div>
                  </div>
                  <input value={ex.video_url ?? ""} onChange={e => updateExercise(i, "video_url", e.target.value)} placeholder="YouTube demo URL (optional)"
                    style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                    <input type="checkbox" checked={ex.hof_eligible} onChange={e => updateExercise(i, "hof_eligible", e.target.checked)} />
                    🏆 Track personal records for Hall of Fame
                  </label>
                </div>
              ))}
              <button onClick={addExercise} style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}>
                + Add Exercise
              </button>
            </div>
          </div>

          {bError && <div className="error-msg">{bError}</div>}

          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-primary" onClick={saveProgram} disabled={bSaving} style={{ flex: 1 }}>
              {bSaving ? "Saving…" : editProgram ? "Save Changes" : "Publish Program"}
            </button>
            <button onClick={() => setView("programs")} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Programs List ──
  return (
    <div className="panel active">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="section-title" style={{ margin: 0 }}>💪 Lifting</div>
        {canManage && (
          <button onClick={() => openBuilder()} className="coach-add-btn">+ New Program</button>
        )}
      </div>
      <div className="section-sub" style={{ marginBottom: 20 }}>
        {canManage ? "Create and manage lifting programs for your players" : "Log your sets, reps, and weight for each exercise"}
      </div>

      {programs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💪</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No lifting programs yet</div>
          <div style={{ fontSize: 13 }}>{canManage ? "Create your first program above." : "Your coach hasn't added any programs yet."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {programs.map(prog => {
            const exs = exercises[prog.id] ?? [];
            const isExpanded = expandedProgram === prog.id;
            return (
              <div key={prog.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                {/* Program header */}
                <div
                  onClick={() => {
                    const next = isExpanded ? null : prog.id;
                    setExpandedProgram(next);
                    if (next && exs.length > 0) loadRecentLogs(exs.map(e => e.id));
                  }}
                  style={{ padding: "16px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{prog.title}</div>
                    {prog.description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{prog.description}</div>}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                      {exs.length} exercise{exs.length !== 1 ? "s" : ""}
                      {" · "}
                      <span style={{ color: prog.visibility === "public" ? "#5de098" : "#93b4ff" }}>
                        {prog.visibility === "public" ? "🌐 Everyone" : "👤 Assigned"}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {canManage && (
                      <>
                        <button onClick={e => { e.stopPropagation(); openBuilder(prog); }}
                          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit</button>
                        <button onClick={e => { e.stopPropagation(); deleteProgram(prog); }}
                          disabled={deletingProgram === prog.id}
                          style={{ background: "var(--surface)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                          {deletingProgram === prog.id ? "…" : "🗑"}
                        </button>
                      </>
                    )}
                    <span style={{ color: "var(--muted)", fontSize: 16 }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* Exercises */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    {exs.length === 0 ? (
                      <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No exercises added yet.</div>
                    ) : (
                      <div>
                        {/* Spreadsheet header */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 80px 90px", gap: 8, padding: "10px 18px", background: "rgba(0,0,0,0.15)", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                          <div>Exercise</div>
                          <div style={{ textAlign: "center" }}>Sets</div>
                          <div style={{ textAlign: "center" }}>Reps</div>
                          <div style={{ textAlign: "center" }}>Weight</div>
                          <div style={{ textAlign: "center" }}>Last Log</div>
                        </div>
                        {exs.map(ex => {
                          const logs = recentLogs[ex.id] ?? [];
                          const lastLog = logs[0];
                          const lastSets = lastLog?.sets_data ?? [];
                          const bestSet = lastSets.reduce((max: any, s: any) => calc1RM(s.weight, s.reps) > calc1RM(max?.weight ?? 0, max?.reps ?? 0) ? s : max, null);
                          const vid = getYouTubeId(ex.video_url);
                          return (
                            <div key={ex.id} style={{ borderTop: "1px solid var(--border)" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 80px 90px", gap: 8, padding: "12px 18px", alignItems: "center" }}>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                                    {ex.name}
                                    {ex.hof_eligible && <span title="HOF eligible" style={{ fontSize: 10 }}>🏆</span>}
                                  </div>
                                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                                    {vid && (
                                      <a href={`https://youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer"
                                        style={{ fontSize: 10, color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}>📹 Demo ↗</a>
                                    )}
                                  </div>
                                </div>
                                <div style={{ textAlign: "center", fontSize: 13, color: "var(--silver-light)", fontWeight: 600 }}>{ex.target_sets ?? "—"}</div>
                                <div style={{ textAlign: "center", fontSize: 13, color: "var(--silver-light)", fontWeight: 600 }}>{ex.target_reps ?? "—"}</div>
                                <div style={{ textAlign: "center", fontSize: 13, color: "var(--silver-light)", fontWeight: 600 }}>{ex.target_weight ? `${ex.target_weight} lbs` : "—"}</div>
                                <div style={{ textAlign: "center" }}>
                                  {bestSet ? (
                                    <div>
                                      <div style={{ fontSize: 12, fontWeight: 700, color: "#5de098" }}>{bestSet.weight} lbs</div>
                                      <div style={{ fontSize: 10, color: "var(--muted)" }}>×{bestSet.reps} reps</div>
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Not logged</div>
                                  )}
                                </div>
                              </div>
                              {/* Log button — players only */}
                              {!canManage && (
                                <div style={{ padding: "0 18px 12px" }}>
                                  <button onClick={() => openLog(ex)}
                                    style={{ width: "100%", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                                    + Log Session
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Log Modal */}
      {logExercise && (
        <div className="modal-overlay open" onClick={() => setLogExercise(null)}>
          <div className="log-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setLogExercise(null)}>✕</button>
            <div className="modal-title" style={{ marginBottom: 4 }}>Log Session</div>
            <div style={{ fontSize: 14, color: "#93b4ff", fontWeight: 600, marginBottom: 16 }}>{logExercise.name}</div>

            {/* Demo video */}
            {(() => {
              const vid = getYouTubeId(logExercise.video_url);
              if (!vid) return null;
              return (
                <div style={{ borderRadius: 10, overflow: "hidden", marginBottom: 16, background: "#000", position: "relative", paddingTop: "56.25%" }}>
                  <iframe src={`https://www.youtube.com/embed/${vid}?rel=0&modestbranding=1`} title={logExercise.name} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
                </div>
              );
            })()}

            {/* Target */}
            {(logExercise.target_sets || logExercise.target_reps || logExercise.target_weight) && (
              <div style={{ padding: "10px 14px", background: "rgba(26,63,168,0.1)", border: "1px solid rgba(26,63,168,0.25)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 16, lineHeight: 1.6 }}>
                🎯 Target: <strong style={{ color: "#93b4ff" }}>
                  {[logExercise.target_sets && `${logExercise.target_sets} sets`, logExercise.target_reps && `${logExercise.target_reps} reps`, logExercise.target_weight && `${logExercise.target_weight} lbs`].filter(Boolean).join(" × ")}
                </strong>
              </div>
            )}

            {/* Sets input */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Your Sets</div>
            <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 1fr auto", gap: 8, marginBottom: 6, padding: "0 2px" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", paddingTop: 2 }}>#</div>
              <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center" }}>REPS</div>
              <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center" }}>WEIGHT (lbs)</div>
              <div />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {sets.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 1fr 1fr auto", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, textAlign: "center" }}>{i + 1}</div>
                  <input type="number" inputMode="numeric" value={s.reps} onChange={e => updateSet(i, "reps", e.target.value)} placeholder="0"
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px", color: "var(--text)", fontSize: 16, fontWeight: 600, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                  <input type="number" inputMode="decimal" value={s.weight} onChange={e => updateSet(i, "weight", e.target.value)} placeholder="0"
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px", color: "var(--text)", fontSize: 16, fontWeight: 600, fontFamily: "inherit", outline: "none", textAlign: "center" }} />
                  {sets.length > 1 && (
                    <button onClick={() => removeSet(i)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 18, padding: "4px" }}>×</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addSet} style={{ width: "100%", background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "9px", fontSize: 13, color: "var(--muted)", cursor: "pointer", fontFamily: "inherit", marginBottom: 16 }}>
              + Add Set
            </button>

            {/* Estimated 1RM preview */}
            {(() => {
              const validSets = sets.filter(s => s.reps.trim() && s.weight.trim());
              if (validSets.length === 0) return null;
              const best = validSets.reduce((max, s) => {
                const rm = calc1RM(parseFloat(s.weight), parseInt(s.reps));
                return rm > max ? rm : max;
              }, 0);
              return best > 0 ? (
                <div style={{ padding: "10px 14px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Estimated 1RM</span>
                  <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{best} lbs</span>
                </div>
              ) : null;
            })()}

            <button className="btn-primary" onClick={saveLog} disabled={logSaving}>
              {logSaving ? "Saving…" : "Save Session"}
            </button>
          </div>
        </div>
      )}

      {logToast && <div className="toast show">{logToast}</div>}
    </div>
  );
}
