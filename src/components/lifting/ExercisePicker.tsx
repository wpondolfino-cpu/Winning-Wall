// src/components/lifting/ExercisePicker.tsx
// Searchable, filterable exercise picker backed by the shared bank
import { useState, useEffect, useRef } from "react";
import { BankExercise, MuscleGroup, MUSCLE_GROUPS, getExerciseBank, upsertBankExercise } from "./lifting";

interface Props {
  playerId: string;
  onSelect: (ex: BankExercise) => void;
  placeholder?: string;
}

export default function ExercisePicker({ playerId, onSelect, placeholder = "Search or add exercise…" }: Props) {
  const [bank, setBank] = useState<BankExercise[]>([]);
  const [query, setQuery] = useState("");
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | "All">("All");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMuscle, setNewMuscle] = useState<MuscleGroup>("Other");
  const [newVideo, setNewVideo] = useState("");
  const [newRest, setNewRest] = useState("90");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { loadBank(); }, []);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function loadBank() {
    try { setBank(await getExerciseBank()); } catch (e) { console.error(e); }
  }

  const filtered = bank.filter(ex => {
    const matchName = ex.name.toLowerCase().includes(query.toLowerCase());
    const matchMuscle = muscleFilter === "All" || ex.muscle_group === muscleFilter;
    return matchName && matchMuscle;
  });

  async function addNew() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const ex = await upsertBankExercise(newName.trim(), newMuscle, newVideo || null, parseInt(newRest) || 90, playerId);
      await loadBank();
      onSelect(ex);
      setAdding(false); setOpen(false);
      setNewName(""); setNewMuscle("Other"); setNewVideo(""); setNewRest("90");
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
      />
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", maxHeight: 320, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Muscle group filter */}
          <div style={{ display: "flex", gap: 4, padding: "8px 8px 4px", overflowX: "auto", flexShrink: 0 }}>
            {(["All", ...MUSCLE_GROUPS] as const).map(g => (
              <button key={g} onClick={() => setMuscleFilter(g as any)} style={{ padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", background: muscleFilter === g ? "var(--royal)" : "var(--surface)", color: muscleFilter === g ? "#fff" : "var(--muted)", flexShrink: 0 }}>
                {g}
              </button>
            ))}
          </div>

          {/* Results */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.slice(0, 20).map(ex => (
              <div key={ex.id} onClick={() => { onSelect(ex); setOpen(false); setQuery(""); }}
                style={{ padding: "10px 14px", cursor: "pointer", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,63,168,0.15)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{ex.name}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>{ex.muscle_group} · {ex.default_rest_secs}s rest</div>
                </div>
                {ex.video_url && <span style={{ fontSize: 10, color: "var(--gold)" }}>📹</span>}
              </div>
            ))}
            {filtered.length === 0 && !adding && (
              <div style={{ padding: "16px 14px", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
                No match — add it as a new exercise below
              </div>
            )}
          </div>

          {/* Add new */}
          {!adding ? (
            <div onClick={() => { setAdding(true); setNewName(query); }}
              style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", fontSize: 13, color: "#93b4ff", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
              + Add "{query || "new exercise"}" to bank
            </div>
          ) : (
            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Exercise name"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select value={newMuscle} onChange={e => setNewMuscle(e.target.value as MuscleGroup)}
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                  {MUSCLE_GROUPS.map(g => <option key={g}>{g}</option>)}
                </select>
                <input type="number" value={newRest} onChange={e => setNewRest(e.target.value)} placeholder="Rest (secs)"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              </div>
              <input value={newVideo} onChange={e => setNewVideo(e.target.value)} placeholder="YouTube URL (optional)"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={addNew} disabled={saving || !newName.trim()} style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                  {saving ? "Saving…" : "Add to Bank & Select"}
                </button>
                <button onClick={() => setAdding(false)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
