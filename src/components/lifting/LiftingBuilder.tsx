// src/components/lifting/LiftingBuilder.tsx
import { useState, useEffect } from "react";
import { LiftingProgram, LiftingDay, DayExercise, BankExercise, MuscleGroup, saveProgram, saveDays, saveDayExercises, getAssignedPlayers, saveAssignments } from "./lifting";
import ExercisePicker from "./ExercisePicker";
import { supabase } from "../../lib/supabase";

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
}

// ── Templates ──────────────────────────────────────────────────
const TEMPLATES: any[] = [
  {
    name: "3-Day Strength",
    desc: "Lower power, upper push, upper pull — classic strength split",
    icon: "💪",
    days: [
      { name: "Lower Power", is_rest_day: false, exercises: [
        { name: "Trap Bar Deadlift", muscle_group: "Legs", target_sets: 4, target_reps: 5, target_weight: "", rest_secs: 180, sort_order: 0 },
        { name: "Box Squat", muscle_group: "Legs", target_sets: 4, target_reps: 5, target_weight: "", rest_secs: 180, sort_order: 1 },
        { name: "Leg Press", muscle_group: "Legs", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 120, sort_order: 2 },
        { name: "Calf Raise", muscle_group: "Legs", target_sets: 3, target_reps: 15, target_weight: "", rest_secs: 60, sort_order: 3 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Upper Push", is_rest_day: false, exercises: [
        { name: "Bench Press", muscle_group: "Chest", target_sets: 4, target_reps: 5, target_weight: "", rest_secs: 180, sort_order: 0 },
        { name: "Incline Bench Press", muscle_group: "Chest", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 1 },
        { name: "Overhead Press", muscle_group: "Shoulders", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 2 },
        { name: "Tricep Pushdown", muscle_group: "Arms", target_sets: 3, target_reps: 12, target_weight: "", rest_secs: 60, sort_order: 3 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Upper Pull", is_rest_day: false, exercises: [
        { name: "Weighted Chin-Up", muscle_group: "Back", target_sets: 4, target_reps: 6, target_weight: "", rest_secs: 150, sort_order: 0 },
        { name: "Barbell Row", muscle_group: "Back", target_sets: 4, target_reps: 6, target_weight: "", rest_secs: 150, sort_order: 1 },
        { name: "Face Pull", muscle_group: "Back", target_sets: 3, target_reps: 15, target_weight: "", rest_secs: 60, sort_order: 2 },
        { name: "Barbell Curl", muscle_group: "Arms", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 60, sort_order: 3 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Rest", is_rest_day: true, exercises: [] },
    ],
  },
  {
    name: "Push / Pull / Legs",
    desc: "Classic hypertrophy split for muscle growth",
    icon: "🏋️",
    days: [
      { name: "Push", is_rest_day: false, exercises: [
        { name: "Bench Press", muscle_group: "Chest", target_sets: 4, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 0 },
        { name: "Incline DB Press", muscle_group: "Chest", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 120, sort_order: 1 },
        { name: "Overhead Press", muscle_group: "Shoulders", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 120, sort_order: 2 },
        { name: "Lateral Raise", muscle_group: "Shoulders", target_sets: 3, target_reps: 15, target_weight: "", rest_secs: 60, sort_order: 3 },
        { name: "Tricep Pushdown", muscle_group: "Arms", target_sets: 3, target_reps: 12, target_weight: "", rest_secs: 60, sort_order: 4 },
      ]},
      { name: "Pull", is_rest_day: false, exercises: [
        { name: "Romanian Deadlift", muscle_group: "Legs", target_sets: 4, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 0 },
        { name: "Barbell Row", muscle_group: "Back", target_sets: 4, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 1 },
        { name: "Chin-Up", muscle_group: "Back", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 120, sort_order: 2 },
        { name: "Face Pull", muscle_group: "Back", target_sets: 3, target_reps: 15, target_weight: "", rest_secs: 60, sort_order: 3 },
        { name: "Barbell Curl", muscle_group: "Arms", target_sets: 3, target_reps: 12, target_weight: "", rest_secs: 60, sort_order: 4 },
      ]},
      { name: "Legs", is_rest_day: false, exercises: [
        { name: "Barbell Squat", muscle_group: "Legs", target_sets: 4, target_reps: 8, target_weight: "", rest_secs: 180, sort_order: 0 },
        { name: "Romanian Deadlift", muscle_group: "Legs", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 120, sort_order: 1 },
        { name: "Leg Press", muscle_group: "Legs", target_sets: 3, target_reps: 12, target_weight: "", rest_secs: 90, sort_order: 2 },
        { name: "Leg Curl", muscle_group: "Legs", target_sets: 3, target_reps: 12, target_weight: "", rest_secs: 60, sort_order: 3 },
        { name: "Calf Raise", muscle_group: "Legs", target_sets: 4, target_reps: 15, target_weight: "", rest_secs: 45, sort_order: 4 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
    ],
  },
  {
    name: "Athletic Performance",
    desc: "Basketball-specific — explosive power, speed, and strength",
    icon: "🏀",
    days: [
      { name: "Explosive Lower", is_rest_day: false, exercises: [
        { name: "Power Clean", muscle_group: "Athletic", target_sets: 5, target_reps: 3, target_weight: "", rest_secs: 180, sort_order: 0 },
        { name: "Box Jump", muscle_group: "Athletic", target_sets: 4, target_reps: 5, target_weight: "", rest_secs: 120, sort_order: 1 },
        { name: "Trap Bar Deadlift", muscle_group: "Legs", target_sets: 4, target_reps: 5, target_weight: "", rest_secs: 180, sort_order: 2 },
        { name: "Single Leg Press", muscle_group: "Legs", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 90, sort_order: 3 },
        { name: "Nordic Curl", muscle_group: "Legs", target_sets: 3, target_reps: 6, target_weight: "", rest_secs: 120, sort_order: 4 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Upper Strength", is_rest_day: false, exercises: [
        { name: "Bench Press", muscle_group: "Chest", target_sets: 4, target_reps: 6, target_weight: "", rest_secs: 180, sort_order: 0 },
        { name: "Weighted Chin-Up", muscle_group: "Back", target_sets: 4, target_reps: 6, target_weight: "", rest_secs: 150, sort_order: 1 },
        { name: "Dumbbell Row", muscle_group: "Back", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 90, sort_order: 2 },
        { name: "Pallof Press", muscle_group: "Core", target_sets: 3, target_reps: 12, target_weight: "", rest_secs: 60, sort_order: 3 },
        { name: "Dead Bug", muscle_group: "Core", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 45, sort_order: 4 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Speed & Power", is_rest_day: false, exercises: [
        { name: "Broad Jump", muscle_group: "Athletic", target_sets: 4, target_reps: 5, target_weight: "", rest_secs: 120, sort_order: 0 },
        { name: "Lateral Band Walk", muscle_group: "Athletic", target_sets: 3, target_reps: 20, target_weight: "", rest_secs: 60, sort_order: 1 },
        { name: "Hip Thrust", muscle_group: "Legs", target_sets: 4, target_reps: 10, target_weight: "", rest_secs: 90, sort_order: 2 },
        { name: "Bulgarian Split Squat", muscle_group: "Legs", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 90, sort_order: 3 },
        { name: "Medicine Ball Slam", muscle_group: "Athletic", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 60, sort_order: 4 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Rest", is_rest_day: true, exercises: [] },
    ],
  },
  {
    name: "Full Body 3x",
    desc: "3 rotating full-body sessions — great for beginners or in-season",
    icon: "🔄",
    days: [
      { name: "Full Body A", is_rest_day: false, exercises: [
        { name: "Box Squat", muscle_group: "Legs", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 0 },
        { name: "Bench Press", muscle_group: "Chest", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 1 },
        { name: "Barbell Row", muscle_group: "Back", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 120, sort_order: 2 },
        { name: "Plank", muscle_group: "Core", target_sets: 3, target_reps: 30, target_weight: "", rest_secs: 45, sort_order: 3 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Full Body B", is_rest_day: false, exercises: [
        { name: "Romanian Deadlift", muscle_group: "Legs", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 0 },
        { name: "Incline Bench Press", muscle_group: "Chest", target_sets: 3, target_reps: 8, target_weight: "", rest_secs: 150, sort_order: 1 },
        { name: "Lat Pulldown", muscle_group: "Back", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 90, sort_order: 2 },
        { name: "Ab Wheel Rollout", muscle_group: "Core", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 60, sort_order: 3 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Full Body C", is_rest_day: false, exercises: [
        { name: "Goblet Squat", muscle_group: "Legs", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 90, sort_order: 0 },
        { name: "Dumbbell Bench Press", muscle_group: "Chest", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 120, sort_order: 1 },
        { name: "Dumbbell Row", muscle_group: "Back", target_sets: 3, target_reps: 10, target_weight: "", rest_secs: 90, sort_order: 2 },
        { name: "Hanging Leg Raise", muscle_group: "Core", target_sets: 3, target_reps: 12, target_weight: "", rest_secs: 60, sort_order: 3 },
      ]},
      { name: "Rest", is_rest_day: true, exercises: [] },
      { name: "Rest", is_rest_day: true, exercises: [] },
    ],
  },
];

export default function LiftingBuilder({ playerId, editProgram, editDays, editDayExercises, isPersonal, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(editProgram?.title ?? "");
  const [desc, setDesc] = useState(editProgram?.description ?? "");
  const [visibility, setVisibility] = useState<"public" | "assigned" | "personal">(editProgram?.visibility ?? (isPersonal ? "personal" : "public"));
  const [startDate, setStartDate] = useState(editProgram?.start_date ?? "");
  const [days, setDays] = useState<BuilderDay[]>([]);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [assignedPlayers, setAssignedPlayers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [bank, setBank] = useState<BankExercise[]>([]);
  const [nextSuperset, setNextSuperset] = useState(1);

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

  function applyTemplate(tpl: typeof TEMPLATES[0]) {
    if (!window.confirm(`Load "${tpl.name}" template? This will replace your current days.`)) return;
    // We need to resolve bank exercise IDs from names — we'll do a best-effort lookup
    // and set exercises with name only; bank lookup happens on save
    setDays(tpl.days.map(d => ({
      name: d.name,
      is_rest_day: d.is_rest_day,
      exercises: d.exercises.map((ex: any, i) => ({
        bank_exercise_id: "", // will resolve on save
        exercise: { id: "", name: ex.name, muscle_group: ex.muscle_group, default_rest_secs: ex.rest_secs, created_at: "" } as BankExercise,
        target_sets: ex.target_sets,
        target_reps: ex.target_reps,
        target_weight: ex.target_weight,
        rest_secs: ex.rest_secs,
        sort_order: i,
      })),
    })));
    setTitle(tpl.name);
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              {([{ val: "public", icon: "🌐", label: "Everyone", sub: "All players see this" }, { val: "assigned", icon: "👤", label: "Specific Players", sub: "Assigned players only" }] as const).map(opt => (
                <div key={opt.val} onClick={() => setVisibility(opt.val)} style={{ padding: 12, borderRadius: 10, cursor: "pointer", border: `2px solid ${visibility === opt.val ? "var(--royal-light)" : "var(--border)"}`, background: visibility === opt.val ? "rgba(26,63,168,0.15)" : "var(--surface2)" }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{opt.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 3 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{opt.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isPersonal && visibility === "assigned" && (
          <div>
            <label>Assign to Players</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              {allPlayers.map(p => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", background: assignedPlayers.includes(p.id) ? "rgba(26,63,168,0.1)" : "transparent" }}>
                  <input type="checkbox" checked={assignedPlayers.includes(p.id)} onChange={e => setAssignedPlayers(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{p.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {isPersonal && (
          <div style={{ padding: "10px 14px", background: "rgba(26,63,168,0.08)", border: "1px solid rgba(26,63,168,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)" }}>
            🔒 Private — only you can see this program.
          </div>
        )}

        {/* Templates */}
        {!editProgram && (
          <div>
            <label>Quick Start — Load a Template <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
              {TEMPLATES.map(tpl => (
                <div key={tpl.name} onClick={() => applyTemplate(tpl)} style={{ padding: 12, borderRadius: 10, cursor: "pointer", border: "1px solid var(--border)", background: "var(--surface2)", transition: "all .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--royal-light)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}>
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{tpl.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text)", marginBottom: 3 }}>{tpl.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{tpl.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Days */}
        <div>
          <label>Days</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {days.map((day, di) => (
              <div key={di} style={{ background: "var(--surface2)", border: `1px solid ${day.is_rest_day ? "var(--border)" : "rgba(26,63,168,0.3)"}`, borderRadius: 12, overflow: "hidden" }}>
                {/* Day header */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", background: day.is_rest_day ? "rgba(0,0,0,0.1)" : "rgba(26,63,168,0.08)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, minWidth: 50 }}>Day {di + 1}</div>
                  <input value={day.name} onChange={e => updateDay(di, "name", e.target.value)}
                    placeholder={day.is_rest_day ? "Rest Day" : "e.g. Push Day"}
                    style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={day.is_rest_day} onChange={e => updateDay(di, "is_rest_day", e.target.checked)} />
                    💤 Rest
                  </label>
                  <button onClick={() => copyDay(di)} title="Copy this day" style={{ background: "none", border: "none", color: "#93b4ff", cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>⧉</button>
                  {days.length > 1 && <button onClick={() => removeDay(di)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 16, padding: "2px 4px" }}>×</button>}
                </div>

                {/* Exercises for this day */}
                {!day.is_rest_day && (
                  <div style={{ padding: "10px 14px" }}>
                    {day.exercises.map((ex, ei) => (
                      <div key={ei} style={{ marginBottom: 10, padding: 10, background: ex.superset_group != null ? "rgba(147,92,255,0.06)" : "var(--surface)", border: `1px solid ${ex.superset_group != null ? "rgba(147,92,255,0.25)" : "var(--border)"}`, borderRadius: 9 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, minWidth: 18 }}>{ei + 1}</div>
                          <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{ex.exercise.name}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)" }}>{ex.exercise.muscle_group}</div>
                          {ex.superset_group != null && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "rgba(147,92,255,0.2)", color: "#9b6dff" }}>SS{ex.superset_group}</span>}
                          <button onClick={() => markSuperset(di, ei)} title="Toggle superset" style={{ background: "none", border: "none", color: ex.superset_group != null ? "#9b6dff" : "var(--muted)", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}>⚡</button>
                          <button onClick={() => removeExFromDay(di, ei)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>×</button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                          {[
                            { lbl: "Sets", val: ex.target_sets.toString(), field: "target_sets", type: "int" },
                            { lbl: "Reps", val: ex.target_reps.toString(), field: "target_reps", type: "int" },
                            { lbl: "Weight (lbs)", val: ex.target_weight, field: "target_weight", type: "float" },
                            { lbl: "Rest (secs)", val: ex.rest_secs.toString(), field: "rest_secs", type: "int" },
                          ].map(f => (
                            <div key={f.field}>
                              <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.3 }}>{f.lbl}</div>
                              <input type="number" value={f.val} placeholder={f.lbl === "Weight (lbs)" ? "opt." : ""}
                                onChange={e => updateEx(di, ei, f.field, f.type === "int" ? parseInt(e.target.value) || 0 : e.target.value)}
                                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 8px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", textAlign: "center", boxSizing: "border-box" }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <ExercisePicker playerId={playerId} onSelect={ex => addExerciseToDay(di, ex)} placeholder="+ Add exercise from bank…" />
                  </div>
                )}
              </div>
            ))}
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
