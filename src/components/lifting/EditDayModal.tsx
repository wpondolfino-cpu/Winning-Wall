// src/components/lifting/EditDayModal.tsx
// Edit a single day's exercises without opening the full builder
import { useState, useEffect } from "react";
import { LiftingDay, DayExercise, BankExercise, saveDayExercises, getExercisesForDays } from "./lifting";
import ExercisePicker from "./ExercisePicker";
import { supabase } from "../../lib/supabase";

interface Props {
  day: LiftingDay;
  playerId: string;
  onSaved: () => void;
  onClose: () => void;
}

interface EditEx {
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

export default function EditDayModal({ day, playerId, onSaved, onClose }: Props) {
  const [exercises, setExercises] = useState<EditEx[]>([]);
  const [dayName, setDayName] = useState(day.name);
  const [isRestDay, setIsRestDay] = useState(day.is_rest_day);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const mobile = window.innerWidth < 768 || ('ontouchstart' in window);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const exs = await getExercisesForDays([day.id]);
        setExercises(exs.map((de: any) => ({
          bank_exercise_id: de.bank_exercise_id,
          exercise: de.exercise,
          target_sets: de.target_sets ?? 3,
          target_reps: de.target_reps ?? 8,
          target_weight: de.target_weight?.toString() ?? "",
          rest_secs: de.rest_secs ?? 90,
          superset_group: de.superset_group,
          sort_order: de.sort_order,
          notes: de.notes ?? "",
        })));
      } finally { setLoading(false); }
    }
    load();
  }, [day.id]);

  function addExercise(ex: BankExercise) {
    setExercises(prev => [...prev, {
      bank_exercise_id: ex.id,
      exercise: ex,
      target_sets: 3,
      target_reps: 8,
      target_weight: "",
      rest_secs: ex.default_rest_secs,
      sort_order: prev.length,
      notes: ex.default_notes ?? "",
    }]);
  }

  function removeEx(i: number) { setExercises(prev => prev.filter((_, j) => j !== i)); }

  function updateEx(i: number, field: string, val: any) {
    setExercises(prev => prev.map((e, j) => j === i ? { ...e, [field]: val } : e));
  }

  function moveEx(i: number, dir: "up" | "down") {
    setExercises(prev => {
      const exs = [...prev];
      const target = dir === "up" ? i - 1 : i + 1;
      if (target < 0 || target >= exs.length) return exs;
      [exs[i], exs[target]] = [exs[target], exs[i]];
      return exs.map((e, j) => ({ ...e, sort_order: j }));
    });
  }

  function handleDragStart(i: number) { setDragFrom(i); }
  function handleDragEnter(i: number) {
    if (dragFrom === null || dragFrom === i) return;
    setExercises(prev => {
      const exs = [...prev];
      const [moved] = exs.splice(dragFrom, 1);
      exs.splice(i, 0, moved);
      setDragFrom(i);
      return exs.map((e, j) => ({ ...e, sort_order: j }));
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Update day name and rest status
      await supabase.from("lifting_days").update({ name: dayName, is_rest_day: isRestDay }).eq("id", day.id);
      // Save exercises
      if (!isRestDay) {
        await saveDayExercises(day.id, exercises.map((e, j) => ({
          bank_exercise_id: e.bank_exercise_id,
          target_sets: e.target_sets || null,
          target_reps: e.target_reps || null,
          target_weight: parseFloat(e.target_weight) || null,
          rest_secs: e.rest_secs,
          superset_group: e.superset_group ?? null,
          sort_order: j,
          notes: e.notes || null,
        })) as any);
      }
      onSaved();
      onClose();
    } catch (err: any) { alert("Error: " + err.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "20px 0" }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(560px, 96vw)", padding: 20 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>✏️ Edit Day</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>

        {/* Day name + rest toggle */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <input value={dayName} onChange={e => setDayName(e.target.value)}
            style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={isRestDay} onChange={e => setIsRestDay(e.target.checked)} />
            💤 Rest Day
          </label>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: "30px 0" }}>Loading…</div>
        ) : isRestDay ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>Rest day — no exercises needed.</div>
        ) : (
          <>
            {/* Exercise list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              {exercises.map((ex, i) => (
                <div key={i}
                  draggable={!mobile}
                  onDragStart={() => !mobile && handleDragStart(i)}
                  onDragEnter={() => !mobile && handleDragEnter(i)}
                  onDragOver={e => e.preventDefault()}
                  onDragEnd={() => setDragFrom(null)}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", cursor: mobile ? "default" : "grab" }}>
                  {/* Row 1: drag handle / arrows, name, remove */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    {!mobile && <span style={{ fontSize: 14, color: "var(--muted)", cursor: "grab" }}>⠿</span>}
                    {mobile && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <button onClick={() => moveEx(i, "up")} disabled={i === 0} style={{ background: "none", border: "none", color: i === 0 ? "var(--border)" : "var(--muted)", cursor: i === 0 ? "default" : "pointer", fontSize: 11, padding: "0 2px", lineHeight: 1 }}>▲</button>
                        <button onClick={() => moveEx(i, "down")} disabled={i === exercises.length - 1} style={{ background: "none", border: "none", color: i === exercises.length - 1 ? "var(--border)" : "var(--muted)", cursor: "pointer", fontSize: 11, padding: "0 2px", lineHeight: 1 }}>▼</button>
                      </div>
                    )}
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{ex.exercise.name}</div>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{ex.exercise.muscle_group}</span>
                    <button onClick={() => removeEx(i)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 16, padding: "2px 4px" }}>×</button>
                  </div>
                  {/* Row 2: sets/reps/weight/rest */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
                    {[
                      { lbl: "Sets", val: ex.target_sets.toString(), field: "target_sets", type: "int" },
                      { lbl: "Reps", val: ex.target_reps.toString(), field: "target_reps", type: "int" },
                      { lbl: "Weight", val: ex.target_weight, field: "target_weight", type: "float" },
                      { lbl: "Rest (s)", val: ex.rest_secs.toString(), field: "rest_secs", type: "int" },
                    ].map(f => (
                      <div key={f.field}>
                        <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.3 }}>{f.lbl}</div>
                        <input type="number" value={f.val} placeholder={f.field === "target_weight" ? "opt." : ""}
                          onChange={e => updateEx(i, f.field, f.type === "int" ? parseInt(e.target.value) || 0 : e.target.value)}
                          style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 6px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", textAlign: "center", boxSizing: "border-box" }} />
                      </div>
                    ))}
                  </div>
                  {/* Row 3: notes */}
                  <input value={ex.notes} onChange={e => updateEx(i, "notes", e.target.value)} placeholder='Notes (e.g. "each leg", "slow tempo")'
                    style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", color: "var(--text)", fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                </div>
              ))}
            </div>

            {/* Exercise picker */}
            <ExercisePicker playerId={playerId} onSelect={addExercise} placeholder="+ Add exercise from bank…" />
          </>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={handleSave} disabled={saving} className="btn-primary" style={{ flex: 1 }}>
            {saving ? "Saving…" : "Save Day"}
          </button>
          <button onClick={onClose} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 20px", fontFamily: "inherit", fontSize: 14, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
