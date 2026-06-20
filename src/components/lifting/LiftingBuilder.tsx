// src/components/lifting/LiftingBuilder.tsx v2
import { useState, useEffect, useRef } from "react";
import { LiftingProgram, LiftingDay, DayExercise, BankExercise, MuscleGroup, saveProgram, saveDays, saveDayExercises, getAssignedPlayers, saveAssignments } from "./lifting";
import ExercisePicker from "./ExercisePicker";
import { supabase } from "../../lib/supabase";

const isMobile = () => window.innerWidth < 768 || ('ontouchstart' in window);

interface Props {
  playerId: string;
  editProgram?: LiftingProgram | null;
  editDays?: LiftingDay[];
  editDayExercises?: Record<string, (DayExercise & { exercise: BankExercise })[]>;
  isPersonal?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

interface BuilderDay {
  name: string;
  is_rest_day: boolean;
  exercises: BuilderExercise[];
}

interface BuilderExercise {
  bank_exercise_id: string;
  exercise: BankExercise;
  target_sets: number;
  target_reps: number;
  target_weight: string;
  rest_secs: number;
  superset_group?: number;
  sort_order: number;
  notes: string;
}

// ── AHS Program IDs ───────────────────────────────────────────
const AHS_PROGRAMS = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    icon: '🏋️',
    title: 'AHS Summer 2025 — Advanced (10 Week)',
    desc: 'Hang cleans, push jerk, front squat. For experienced lifters ready to push heavy weight.',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    icon: '🏀',
    title: 'AHS Summer 2025 — Beginner (10 Week)',
    desc: 'DB bench, KB deadlift, goblet squat. Perfect for players new to lifting or returning after a break.',
  },
];



// ── WeekGroup component ───────────────────────────────────────
interface WeekGroupProps {
  weekNum: number;
  label: string;
  weekDays: { day: any; di: number }[];
  updateDay: (i: number, field: string, val: any) => void;
  copyDay: (i: number) => void;
  removeDay: (i: number) => void;
  updateEx: (di: number, ei: number, field: string, val: any) => void;
  removeExFromDay: (di: number, ei: number) => void;
  markSuperset: (di: number, ei: number) => void;
  addExerciseToDay: (di: number, ex: BankExercise) => void;
  moveEx: (di: number, ei: number, dir: "up" | "down") => void;
  mobile: boolean;
  handleDragStart: (di: number, ei: number) => void;
  handleDragEnter: (di: number, ei: number) => void;
  handleDragEnd: (di: number) => void;
  playerId: string;
  totalDays: number;
  defaultOpen: boolean;
}

function WeekGroup({ weekNum, label, weekDays, updateDay, copyDay, removeDay, updateEx, removeExFromDay, markSuperset, addExerciseToDay, moveEx, mobile, handleDragStart, handleDragEnter, handleDragEnd, playerId, totalDays, defaultOpen }: WeekGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const activeDays = weekDays.filter(({ day }) => !day.is_rest_day).length;
  const totalEx = weekDays.reduce((sum, { day }) => sum + day.exercises.length, 0);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      {/* Week header */}
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: open ? "rgba(26,63,168,0.1)" : "var(--surface2)", userSelect: "none" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{label}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {weekDays.length} days · {activeDays} training · {totalEx} exercises
          </div>
        </div>
        <span style={{ fontSize: 16, color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Days within week */}
      {open && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)" }}>
          {weekDays.map(({ day, di }) => (
            <div key={di} style={{ background: "var(--surface2)", border: `1px solid ${day.is_rest_day ? "var(--border)" : "rgba(26,63,168,0.3)"}`, borderRadius: 10, overflow: "hidden" }}>
              {/* Day header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: day.is_rest_day ? "rgba(0,0,0,0.1)" : "rgba(26,63,168,0.06)" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, minWidth: 44 }}>Day {di + 1}</div>
                <input value={day.name} onChange={e => updateDay(di, "name", e.target.value)}
                  placeholder={day.is_rest_day ? "Rest Day" : "e.g. Push Day"}
                  style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={day.is_rest_day} onChange={e => updateDay(di, "is_rest_day", e.target.checked)} />
                  💤
                </label>
                <button onClick={() => copyDay(di)} title="Copy day" style={{ background: "none", border: "none", color: "#93b4ff", cursor: "pointer", fontSize: 13, padding: "2px 3px" }}>⧉</button>
                {totalDays > 1 && <button onClick={() => removeDay(di)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 14, padding: "2px 3px" }}>×</button>}
              </div>

              {/* Exercises */}
              {!day.is_rest_day && (
                <div style={{ padding: "8px 12px" }}>
                  {day.exercises.map((ex: any, ei: number) => (
                    <div key={ei} style={{ marginBottom: 8, padding: 8, background: ex.superset_group != null ? "rgba(147,92,255,0.06)" : "var(--surface)", border: `1px solid ${ex.superset_group != null ? "rgba(147,92,255,0.25)" : "var(--border)"}`, borderRadius: 8, cursor: mobile ? "default" : "grab" }}
                      draggable={!mobile}
                      onDragStart={() => !mobile && handleDragStart(di, ei)}
                      onDragEnter={() => !mobile && handleDragEnter(di, ei)}
                      onDragEnd={() => !mobile && handleDragEnd(di)}
                      onDragOver={e => e.preventDefault()}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                        {!mobile && <span style={{ fontSize: 13, color: "var(--muted)", cursor: "grab", flexShrink: 0 }}>⠿</span>}
                        {mobile && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
                            <button onClick={() => moveEx(di, ei, "up")} disabled={ei === 0} style={{ background: "none", border: "none", color: ei === 0 ? "var(--border)" : "var(--muted)", cursor: "pointer", fontSize: 11, padding: "0 2px", lineHeight: 1 }}>▲</button>
                            <button onClick={() => moveEx(di, ei, "down")} disabled={ei === day.exercises.length - 1} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11, padding: "0 2px", lineHeight: 1 }}>▼</button>
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, minWidth: 16 }}>{ei + 1}</div>
                        <div style={{ flex: 1, fontWeight: 600, fontSize: 12, color: "var(--text)" }}>{ex.exercise.name}</div>
                        <div style={{ fontSize: 9, color: "var(--muted)" }}>{ex.exercise.muscle_group}</div>
                        {ex.superset_group != null && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 4, background: "rgba(147,92,255,0.2)", color: "#9b6dff" }}>SS</span>}
                        <button onClick={() => markSuperset(di, ei)} style={{ background: "none", border: "none", color: ex.superset_group != null ? "#9b6dff" : "var(--muted)", cursor: "pointer", fontSize: 11, padding: "1px 3px" }}>⚡</button>
                        <button onClick={() => removeExFromDay(di, ei)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 13, padding: "1px 3px" }}>×</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
                        {[
                          { lbl: "Sets", val: ex.target_sets.toString(), field: "target_sets", type: "int" },
                          { lbl: "Reps", val: ex.target_reps.toString(), field: "target_reps", type: "int" },
                          { lbl: "Wt (lbs)", val: ex.target_weight, field: "target_weight", type: "float" },
                          { lbl: "Rest (s)", val: ex.rest_secs.toString(), field: "rest_secs", type: "int" },
                        ].map(f => (
                          <div key={f.field}>
                            <div style={{ fontSize: 8, color: "var(--muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.3 }}>{f.lbl}</div>
                            <input type="number" value={f.val} placeholder={f.field === "target_weight" ? "opt." : ""}
                              onChange={e => updateEx(di, ei, f.field, f.type === "int" ? parseInt(e.target.value) || 0 : e.target.value)}
                              style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 4px", color: "var(--text)", fontSize: 11, fontFamily: "inherit", outline: "none", textAlign: "center", boxSizing: "border-box" }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 5 }}>
                        <input value={ex.notes} onChange={e => updateEx(di, ei, "notes", e.target.value)} placeholder='Notes (e.g. "each leg")'
                          style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                      </div>
                    </div>
                  ))}
                  <ExercisePicker playerId={playerId} onSelect={ex => addExerciseToDay(di, ex)} placeholder="+ Add exercise…" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LiftingBuilder({ playerId, editProgram, editDays, editDayExercises, isPersonal, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(editProgram?.title ?? "");
  const [desc, setDesc] = useState(editProgram?.description ?? "");
  const [visibility, setVisibility] = useState<"public" | "assigned" | "personal" | "draft">(editProgram?.visibility ?? (isPersonal ? "personal" : "draft"));
  const [startDate, setStartDate] = useState(editProgram?.start_date ?? "");
  const [days, setDays] = useState<BuilderDay[]>([]);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [assignedPlayers, setAssignedPlayers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [bank, setBank] = useState<BankExercise[]>([]);
  const [nextSuperset, setNextSuperset] = useState(1);
  const [mobile, setMobile] = useState(isMobile());
  const dragItem = useRef<{ dayIdx: number; exIdx: number } | null>(null);
  const dragOver = useRef<{ dayIdx: number; exIdx: number } | null>(null);

  useEffect(() => {
    const handler = () => setMobile(isMobile());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  function moveEx(dayIdx: number, exIdx: number, dir: "up" | "down") {
    setDays(prev => prev.map((d, i) => {
      if (i !== dayIdx) return d;
      const exs = [...d.exercises];
      const target = dir === "up" ? exIdx - 1 : exIdx + 1;
      if (target < 0 || target >= exs.length) return d;
      [exs[exIdx], exs[target]] = [exs[target], exs[exIdx]];
      return { ...d, exercises: exs.map((e, j) => ({ ...e, sort_order: j })) };
    }));
  }

  function handleDragStart(dayIdx: number, exIdx: number) {
    dragItem.current = { dayIdx, exIdx };
  }

  function handleDragEnter(dayIdx: number, exIdx: number) {
    dragOver.current = { dayIdx, exIdx };
  }

  function handleDragEnd(dayIdx: number) {
    if (!dragItem.current || !dragOver.current) return;
    if (dragItem.current.dayIdx !== dayIdx || dragOver.current.dayIdx !== dayIdx) return;
    const from = dragItem.current.exIdx;
    const to = dragOver.current.exIdx;
    if (from === to) return;
    setDays(prev => prev.map((d, i) => {
      if (i !== dayIdx) return d;
      const exs = [...d.exercises];
      const [moved] = exs.splice(from, 1);
      exs.splice(to, 0, moved);
      return { ...d, exercises: exs.map((e, j) => ({ ...e, sort_order: j })) };
    }));
    dragItem.current = null;
    dragOver.current = null;
  }

  useEffect(() => {
    loadPlayers();
    if (editProgram && editDays && editDayExercises) {
      const builtDays: BuilderDay[] = editDays.map(d => ({
        name: d.name,
        is_rest_day: d.is_rest_day,
        exercises: (editDayExercises[d.id] ?? []).map(de => ({
          bank_exercise_id: de.bank_exercise_id,
          exercise: de.exercise,
          target_sets: de.target_sets ?? 3,
          target_reps: de.target_reps ?? 8,
          target_weight: de.target_weight?.toString() ?? "",
          rest_secs: de.rest_secs ?? 90,
          superset_group: de.superset_group,
          sort_order: de.sort_order,
          notes: de.notes ?? "",
        })),
      }));
      setDays(builtDays);
      getAssignedPlayers(editProgram.id).then(setAssignedPlayers);
    } else {
      setDays([{ name: "Day 1", is_rest_day: false, exercises: [] }]);
    }
  }, []);

  async function loadPlayers() {
    const { data } = await supabase.from("profiles").select("id,name").eq("role", "player").order("name");
    setAllPlayers(data ?? []);
  }

  async function loadAHSProgram(programId: string, programTitle: string) {
    if (!window.confirm(`Load "${programTitle}"? This will replace your current days with all 72 days (pre-test + 10 weeks + post-test).`)) return;
    try {
      const { data: progDays } = await supabase
        .from("lifting_days")
        .select("*")
        .eq("program_id", programId)
        .order("day_number");
      if (!progDays || progDays.length === 0) {
        alert("Program not found in database. Make sure you ran the SQL file in Supabase.");
        return;
      }
      const dayIds = progDays.map((d: any) => d.id);
      const { data: dayExs } = await supabase
        .from("lifting_day_exercises")
        .select("*, exercise:lifting_exercise_bank(*)")
        .in("day_id", dayIds)
        .order("sort_order");
      const exsByDay: Record<string, any[]> = {};
      (dayExs ?? []).forEach((de: any) => {
        if (!exsByDay[de.day_id]) exsByDay[de.day_id] = [];
        exsByDay[de.day_id].push(de);
      });
      const builtDays: BuilderDay[] = progDays.map((d: any) => ({
        name: d.name,
        is_rest_day: d.is_rest_day,
        exercises: (exsByDay[d.id] ?? []).map((de: any) => ({
          bank_exercise_id: de.bank_exercise_id,
          exercise: de.exercise,
          target_sets: de.target_sets ?? 3,
          target_reps: de.target_reps ?? 8,
          target_weight: "",
          rest_secs: de.rest_secs ?? 90,
          sort_order: de.sort_order,
          notes: de.notes ?? "",
        })),
      }));
      setDays(builtDays);
      setTitle(programTitle);
      setDesc("Attleboro High School Basketball 10-week summer program.");
    } catch (e: any) { alert("Error loading program: " + e.message); }
  }

  function addDay() {
    setDays(prev => [...prev, { name: `Day ${prev.length + 1}`, is_rest_day: false, exercises: [] }]);
  }

  function copyDay(i: number) {
    const src = days[i];
    setDays(prev => {
      const next = [...prev];
      next.splice(i + 1, 0, { ...src, name: `${src.name} (copy)`, exercises: src.exercises.map(e => ({ ...e })) });
      return next;
    });
  }

  function removeDay(i: number) { setDays(prev => prev.filter((_, idx) => idx !== i)); }

  function updateDay(i: number, field: string, val: any) {
    setDays(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d));
  }

  function addExerciseToDay(dayIdx: number, ex: BankExercise) {
    setDays(prev => prev.map((d, i) => i !== dayIdx ? d : {
      ...d,
      exercises: [...d.exercises, {
        bank_exercise_id: ex.id,
        exercise: ex,
        target_sets: 3,
        target_reps: 8,
        target_weight: "",
        rest_secs: ex.default_rest_secs,
        sort_order: d.exercises.length,
        notes: ex.default_notes ?? "",
      }],
    }));
  }

  function removeExFromDay(dayIdx: number, exIdx: number) {
    setDays(prev => prev.map((d, i) => i !== dayIdx ? d : {
      ...d, exercises: d.exercises.filter((_, j) => j !== exIdx),
    }));
  }

  function updateEx(dayIdx: number, exIdx: number, field: string, val: any) {
    setDays(prev => prev.map((d, i) => i !== dayIdx ? d : {
      ...d, exercises: d.exercises.map((e, j) => j !== exIdx ? e : { ...e, [field]: val }),
    }));
  }

  function markSuperset(dayIdx: number, exIdx: number) {
    const ex = days[dayIdx].exercises[exIdx];
    if (ex.superset_group != null) {
      // Remove from superset
      updateEx(dayIdx, exIdx, "superset_group", undefined);
    } else {
      // Check if next exercise has a group
      const nextEx = days[dayIdx].exercises[exIdx + 1];
      const group = nextEx?.superset_group ?? nextSuperset;
      if (!nextEx?.superset_group) setNextSuperset(n => n + 1);
      updateEx(dayIdx, exIdx, "superset_group", group);
      if (nextEx && !nextEx.superset_group) updateEx(dayIdx, exIdx + 1, "superset_group", group);
    }
  }

  async function handleSave() {
    if (!title.trim()) { setError("Please enter a program title."); return; }
    const activeDays = days.filter(d => !d.is_rest_day);
    if (activeDays.length === 0) { setError("Please add at least one non-rest day."); return; }
    setSaving(true); setError("");
    try {
      const finalVisibility = isPersonal ? "personal" : visibility;
      const programId = await saveProgram(editProgram?.id ?? null, {
        title, description: desc || undefined, visibility: finalVisibility,
        start_date: startDate || undefined,
      }, playerId);

      // Resolve template exercise bank IDs (for template-loaded exercises with empty bank_exercise_id)
      const { data: bankData } = await supabase.from("lifting_exercise_bank").select("id,name");
      const bankByName: Record<string, string> = {};
      (bankData ?? []).forEach((e: any) => { bankByName[e.name.toLowerCase()] = e.id; });

      // Save days
      const savedDays = await saveDays(programId, days.map((d, i) => ({
        name: d.name, day_number: i + 1, is_rest_day: d.is_rest_day,
      })));

      // Save exercises for each day
      for (let i = 0; i < savedDays.length; i++) {
        const day = days[i];
        if (day.is_rest_day) continue;
        const exs = day.exercises.map((e, j) => {
          const resolvedId = e.bank_exercise_id || bankByName[e.exercise.name.toLowerCase()] || "";
          return {
            bank_exercise_id: resolvedId,
            target_sets: e.target_sets || null,
            target_reps: e.target_reps || null,
            target_weight: parseFloat(e.target_weight) || null,
            rest_secs: e.rest_secs,
            superset_group: e.superset_group ?? null,
            sort_order: j,
            notes: e.notes || null,
          };
        }).filter(e => e.bank_exercise_id);
        await saveDayExercises(savedDays[i].id, exs as any);
      }

      if (finalVisibility === "assigned") await saveAssignments(programId, assignedPlayers);
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="panel active">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={onCancel} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 13, color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
        <div className="section-title" style={{ margin: 0 }}>{editProgram ? "Edit Program" : isPersonal ? "My Personal Program" : "New Lifting Program"}</div>
      </div>

      <div className="builder-form">
        {/* Basic info */}
        <div>
          <label>Program Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Summer Strength Phase 1" />
        </div>
        <div>
          <label>Description (optional)</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What's this program for?" rows={2} />
        </div>
        <div>
          <label>Start Date (optional)</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          {startDate && <div style={{ fontSize: 11, color: "#93b4ff", marginTop: 4 }}>📅 Today's day will be highlighted automatically for players</div>}
        </div>

        {/* Visibility (coaches only) */}
        {!isPersonal && (
          <div>
            <label>Visibility</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
              {([
                { val: "draft", icon: "📝", label: "Draft", sub: "Only coaches see this" },
                { val: "public", icon: "🌐", label: "Everyone", sub: "All players see this" },
                { val: "assigned", icon: "👤", label: "Specific Players", sub: "Assigned players only" },
              ] as const).map(opt => (
                <div key={opt.val} onClick={() => setVisibility(opt.val)} style={{ padding: 12, borderRadius: 10, cursor: "pointer", border: `2px solid ${visibility === opt.val ? "var(--royal-light)" : "var(--border)"}`, background: visibility === opt.val ? "rgba(26,63,168,0.15)" : "var(--surface2)" }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{opt.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 3 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{opt.sub}</div>
                </div>
              ))}
            </div>
            {visibility === "draft" && (
              <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--gold)" }}>
                📝 Draft — players cannot see this program. Change to Everyone or Specific Players when ready to share.
              </div>
            )}
          </div>
        )}

        {!isPersonal && visibility === "assigned" && (
          <div>
            <label>Assign to Players</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              {allPlayers.map(p => (
                <div key={p.id} onClick={() => setAssignedPlayers(prev => prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id])}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, cursor: "pointer", background: assignedPlayers.includes(p.id) ? "rgba(26,63,168,0.1)" : "transparent" }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${assignedPlayers.includes(p.id) ? "var(--royal)" : "var(--border)"}`, background: assignedPlayers.includes(p.id) ? "var(--royal)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {assignedPlayers.includes(p.id) && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isPersonal && (
          <div style={{ padding: "10px 14px", background: "rgba(26,63,168,0.08)", border: "1px solid rgba(26,63,168,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)" }}>
            🔒 Private — only you can see this program.
          </div>
        )}

        {/* AHS Summer Program Loader */}
        {!editProgram && (
          <div>
            <label>Quick Start <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {AHS_PROGRAMS.map(prog => (
                <div key={prog.id} onClick={() => loadAHSProgram(prog.id, prog.title)}
                  style={{ padding: 16, borderRadius: 12, cursor: "pointer", border: "1px solid rgba(26,63,168,0.4)", background: "rgba(26,63,168,0.08)", display: "flex", alignItems: "center", gap: 14, transition: "all .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,63,168,0.18)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "rgba(26,63,168,0.08)")}>
                  <div style={{ fontSize: 36 }}>{prog.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 3 }}>{prog.title}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{prog.desc}</div>
                  </div>
                  <div style={{ fontSize: 20, color: "#93b4ff", flexShrink: 0 }}>→</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Days — grouped by week */}
        <div>
          <label>Days</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {(() => {
              // Group by "Week X" in name, or fall back to chunks of 7
              const weekMap: Record<string, { weekNum: number; label: string; days: { day: typeof days[0]; di: number }[] }> = {};
              let fallbackWeek = 0;

              // Check if any day has "Week" in its name
              const hasWeekNames = days.some(d => /week\s*\d+/i.test(d.name));

              days.forEach((day, di) => {
                let key: string;
                let label: string;
                let weekNum: number;

                if (hasWeekNames) {
                  const match = day.name.match(/week\s*(\d+)/i);
                  if (match) {
                    weekNum = parseInt(match[1]);
                    key = `week-${weekNum}`;
                    label = `Week ${weekNum}`;
                  } else {
                    // Pre/post test days or unnamed — put in their own group
                    key = `special-${di}`;
                    label = day.name || `Day ${di + 1}`;
                    weekNum = di === 0 ? 0 : 999;
                  }
                } else {
                  weekNum = Math.floor(di / 7) + 1;
                  key = `week-${weekNum}`;
                  label = `Week ${weekNum}`;
                }

                if (!weekMap[key]) weekMap[key] = { weekNum, label, days: [] };
                weekMap[key].days.push({ day, di });
              });

              const sorted = Object.values(weekMap).sort((a, b) => a.weekNum - b.weekNum);

              return sorted.map(({ weekNum, label, days: weekDays }, idx) => (
                <WeekGroup
                  key={label}
                  weekNum={weekNum}
                  label={label}
                  weekDays={weekDays}
                  updateDay={updateDay}
                  copyDay={copyDay}
                  removeDay={removeDay}
                  updateEx={updateEx}
                  removeExFromDay={removeExFromDay}
                  markSuperset={markSuperset}
                  addExerciseToDay={addExerciseToDay}
                  moveEx={moveEx}
                  mobile={mobile}
                  handleDragStart={handleDragStart}
                  handleDragEnter={handleDragEnter}
                  handleDragEnd={handleDragEnd}
                  playerId={playerId}
                  totalDays={days.length}
                  defaultOpen={idx === 0}
                />
              ));
            })()}
            <button onClick={addDay} style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}>
              + Add Day
            </button>
          </div>
        </div>
        {error && <div className="error-msg">{error}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ flex: 1 }}>
            {saving ? "Saving…" : editProgram ? "Save Changes" : isPersonal ? "Save My Program" : "Publish Program"}
          </button>
          <button onClick={onCancel} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
