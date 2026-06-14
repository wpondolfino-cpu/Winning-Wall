// src/components/lifting/ExercisePicker.tsx
import { useState, useEffect } from "react";
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
  const [loadError, setLoadError] = useState("");

  useEffect(() => { loadBank(); }, []);

  async function loadBank() {
    try {
      const data = await getExerciseBank();
      setBank(data);
    } catch (e: any) {
      setLoadError(e.message);
    }
  }

  const filtered = bank.filter(ex => {
    const matchName = query === "" || ex.name.toLowerCase().includes(query.toLowerCase());
    const matchMuscle = muscleFilter === "All" || ex.muscle_group === muscleFilter;
    return matchName && matchMuscle;
  });

  function handleSelect(ex: BankExercise) {
    onSelect(ex);
    setOpen(false);
    setQuery("");
    setAdding(false);
  }

  async function addNew() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const ex = await upsertBankExercise(newName.trim(), newMuscle, newVideo || null, parseInt(newRest) || 90, playerId);
      await loadBank();
      handleSelect(ex);
      setNewName(""); setNewMuscle("Other"); setNewVideo(""); setNewRest("90");
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: "relative", marginTop: 8 }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: "var(--surface)", border: "1px dashed var(--border)",
          borderRadius: 8, padding: "10px 14px", color: "var(--muted)", fontSize: 13,
          fontFamily: "inherit", cursor: "pointer", textAlign: "left",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <span>{placeholder}</span>
        <span style={{ fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </button>

      {loadError && <div style={{ fontSize: 11, color: "#ff7b7b", marginTop: 4 }}>Failed to load bank: {loadError}</div>}

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 9999,
          background: "#1a1d2e", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
          maxHeight: 380, display: "flex", flexDirection: "column",
        }}>
          {/* Search */}
          <div style={{ padding: "10px 10px 6px" }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search exercises…"
              autoFocus
              style={{
                width: "100%", background: "var(--surface2)", border: "1px solid var(--border)",
                borderRadius: 7, padding: "8px 10px", color: "var(--text)", fontSize: 13,
                fontFamily: "inherit", outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Muscle group filter */}
          <div style={{ display: "flex", gap: 4, padding: "0 10px 8px", overflowX: "auto", flexShrink: 0 }}>
            {(["All", ...MUSCLE_GROUPS] as const).map(g => (
              <button
                key={g}
                onClick={() => setMuscleFilter(g as any)}
                style={{
                  padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                  background: muscleFilter === g ? "var(--royal)" : "var(--surface2)",
                  color: muscleFilter === g ? "#fff" : "var(--muted)", flexShrink: 0,
                }}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Exercise list */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {bank.length === 0 && (
              <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                Loading exercises…
              </div>
            )}
            {bank.length > 0 && filtered.length === 0 && (
              <div style={{ padding: "16px 14px", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
                No match — add it below
              </div>
            )}
            {filtered.slice(0, 30).map(ex => (
              <div
                key={ex.id}
                onClick={() => handleSelect(ex)}
                style={{
                  padding: "10px 14px", cursor: "pointer",
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  display: "flex", alignItems: "center", gap: 10,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,63,168,0.2)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{ex.name}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
                    {ex.muscle_group} · {ex.default_rest_secs}s rest
                  </div>
                </div>
                {ex.video_url && <span style={{ fontSize: 11, color: "var(--gold)" }}>📹</span>}
              </div>
            ))}
          </div>

          {/* Add new exercise */}
          <div style={{ borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            {!adding ? (
              <div
                onClick={() => { setAdding(true); setNewName(query); }}
                style={{ padding: "10px 14px", fontSize: 13, color: "#93b4ff", cursor: "pointer", fontWeight: 600 }}
              >
                + Add new exercise to bank
              </div>
            ) : (
              <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Exercise name"
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <select value={newMuscle} onChange={e => setNewMuscle(e.target.value as MuscleGroup)}
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                    {MUSCLE_GROUPS.map(g => <option key={g}>{g}</option>)}
                  </select>
                  <input type="number" value={newRest} onChange={e => setNewRest(e.target.value)} placeholder="Rest (secs)"
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                </div>
                <input value={newVideo} onChange={e => setNewVideo(e.target.value)} placeholder="YouTube URL (optional)"
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={addNew} disabled={saving || !newName.trim()}
                    style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "7px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                    {saving ? "Saving…" : "Add & Select"}
                  </button>
                  <button onClick={() => setAdding(false)}
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "7px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Close */}
          <div style={{ borderTop: "1px solid var(--border)", padding: "6px 14px", flexShrink: 0 }}>
            <button onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", fontFamily: "inherit", width: "100%", textAlign: "center" }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
