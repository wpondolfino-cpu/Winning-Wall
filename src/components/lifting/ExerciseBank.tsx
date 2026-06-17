// src/components/lifting/ExerciseBank.tsx
import { useState, useEffect } from "react";
import { BankExercise, MuscleGroup, MUSCLE_GROUPS, getExerciseBank, upsertBankExercise } from "./lifting";
import { supabase } from "../../lib/supabase";

interface Props {
  playerId: string;
  canManage: boolean;
}

export default function ExerciseBank({ playerId, canManage }: Props) {
  const [bank, setBank] = useState<BankExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [muscleFilter, setMuscleFilter] = useState<MuscleGroup | "All">("All");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BankExercise | null>(null);
  const [editName, setEditName] = useState("");
  const [editMuscle, setEditMuscle] = useState<MuscleGroup>("Other");
  const [editVideo, setEditVideo] = useState("");
  const [editRest, setEditRest] = useState("90");
  const [editDefaultNotes, setEditDefaultNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [usageModal, setUsageModal] = useState<{ ex: BankExercise; usages: UsageInfo[] } | null>(null);
  const [checkingUsage, setCheckingUsage] = useState<string | null>(null);

  interface UsageInfo {
    programTitle: string;
    dayName: string;
    dayNumber: number;
  }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setBank(await getExerciseBank()); }
    finally { setLoading(false); }
  }

  async function checkUsage(ex: BankExercise): Promise<UsageInfo[]> {
    const { data } = await supabase
      .from("lifting_day_exercises")
      .select("day_id, lifting_days(id, name, day_number, program_id, lifting_programs(id, title))")
      .eq("bank_exercise_id", ex.id);
    if (!data) return [];
    return data.map((row: any) => ({
      programTitle: row.lifting_days?.lifting_programs?.title ?? "Unknown Program",
      dayName: row.lifting_days?.name ?? "Unknown Day",
      dayNumber: row.lifting_days?.day_number ?? 0,
    }));
  }

  async function handleDeleteClick(ex: BankExercise) {
    setCheckingUsage(ex.id);
    try {
      const usages = await checkUsage(ex);
      if (usages.length > 0) {
        setUsageModal({ ex, usages });
      } else {
        // Not used anywhere — confirm and delete directly
        if (window.confirm(`Delete "${ex.name}" from the exercise bank?\n\nThis exercise is not used in any programs.`)) {
          await doDelete(ex.id);
        }
      }
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setCheckingUsage(null); }
  }

  async function doDelete(id: string) {
    setDeleting(id);
    try {
      const { error } = await supabase.from("lifting_exercise_bank").delete().eq("id", id);
      if (error) throw error;
      setUsageModal(null);
      await load();
    } catch (e: any) { alert("Error deleting: " + e.message); }
    finally { setDeleting(null); }
  }

  function openEdit(ex: BankExercise) {
    setEditing(ex);
    setEditName(ex.name);
    setEditMuscle(ex.muscle_group as MuscleGroup);
    setEditVideo(ex.video_url ?? "");
    setEditRest(ex.default_rest_secs.toString());
    setEditDefaultNotes(ex.default_notes ?? "");
    setShowAdd(false);
  }

  function openAdd() {
    setEditing(null);
    setEditName(""); setEditMuscle("Other"); setEditVideo(""); setEditRest("90"); setEditDefaultNotes("");
    setShowAdd(true);
  }

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        // Update existing exercise by id
        const { error } = await supabase
          .from("lifting_exercise_bank")
          .update({
            name: editName.trim(),
            muscle_group: editMuscle,
            video_url: editVideo || null,
            default_rest_secs: parseInt(editRest) || 90,
            default_notes: editDefaultNotes || null,
          })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        // Add new exercise
        await upsertBankExercise(editName.trim(), editMuscle, editVideo || null, parseInt(editRest) || 90, playerId, editDefaultNotes || undefined);
      }
      await load();
      setEditing(null); setShowAdd(false);
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  const filtered = bank.filter(ex => {
    const matchMuscle = muscleFilter === "All" || ex.muscle_group === muscleFilter;
    const matchSearch = search === "" || ex.name.toLowerCase().includes(search.toLowerCase());
    return matchMuscle && matchSearch;
  });

  const grouped = MUSCLE_GROUPS.reduce((acc, mg) => {
    const exs = filtered.filter(e => e.muscle_group === mg);
    if (exs.length > 0) acc[mg] = exs;
    return acc;
  }, {} as Record<string, BankExercise[]>);

  function getYouTubeId(url?: string): string | null {
    if (!url) return null;
    const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/\s]+)/);
    return match ? match[1] : null;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="section-title" style={{ margin: 0 }}>📚 Exercise Bank</div>
        {canManage && (
          <button onClick={openAdd} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            + Add Exercise
          </button>
        )}
      </div>
      <div className="section-sub" style={{ marginBottom: 16 }}>
        {bank.length} exercises · {canManage ? "Click ✏️ to edit, 🗑 to delete" : "Tap 📹 to watch a demo"}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search exercises…"
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {(["All", ...MUSCLE_GROUPS] as const).map(g => (
          <button key={g} onClick={() => setMuscleFilter(g as any)}
            style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: muscleFilter === g ? "var(--royal)" : "var(--surface2)", color: muscleFilter === g ? "#fff" : "var(--muted)" }}>
            {g}
          </button>
        ))}
      </div>

      {showAdd && canManage && (
        <div style={{ background: "var(--surface2)", border: "1px solid rgba(26,63,168,0.4)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 12 }}>New Exercise</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Exercise name"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <select value={editMuscle} onChange={e => setEditMuscle(e.target.value as MuscleGroup)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                {MUSCLE_GROUPS.map(g => <option key={g}>{g}</option>)}
              </select>
              <input type="number" value={editRest} onChange={e => setEditRest(e.target.value)} placeholder="Rest (secs)"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            </div>
            <input value={editVideo} onChange={e => setEditVideo(e.target.value)} placeholder="YouTube URL (optional)"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            <input value={editDefaultNotes} onChange={e => setEditDefaultNotes(e.target.value)} placeholder='Default notes (e.g. "each leg", "slow tempo") — auto-fills when added to a program'
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSave} disabled={saving || !editName.trim()}
                style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {saving ? "Saving…" : "Add to Bank"}
              </button>
              <button onClick={() => setShowAdd(false)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Object.entries(grouped).map(([muscle, exercises]) => (
            <div key={muscle}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid var(--border)" }}>
                {muscle} ({exercises.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {exercises.map(ex => {
                  const isEditing = editing?.id === ex.id;
                  const vid = getYouTubeId(ex.video_url);
                  const isDeleting = deleting === ex.id;
                  const isChecking = checkingUsage === ex.id;
                  return (
                    <div key={ex.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: isEditing ? "rgba(26,63,168,0.1)" : "var(--surface2)", borderRadius: isEditing ? "10px 10px 0 0" : 10, border: `1px solid ${isEditing ? "rgba(26,63,168,0.4)" : "var(--border)"}`, borderBottom: isEditing ? "none" : undefined }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{ex.name}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span>{ex.default_rest_secs}s rest</span>
                            {ex.default_notes && <span style={{ color: "#93b4ff", fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "rgba(26,63,168,0.15)" }}>{ex.default_notes}</span>}
                          </div>
                        </div>
                        {vid ? (
                          <a href={ex.video_url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: "var(--gold)", textDecoration: "none", fontWeight: 600, padding: "4px 8px", borderRadius: 6, background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.2)" }}>
                            📹 Demo
                          </a>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--muted)", padding: "4px 8px" }}>No video</span>
                        )}
                        {canManage && (
                          <>
                            <button onClick={() => isEditing ? setEditing(null) : openEdit(ex)}
                              style={{ background: isEditing ? "var(--royal)" : "var(--surface)", border: "1px solid var(--border)", color: isEditing ? "#fff" : "var(--muted)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
                              {isEditing ? "Cancel" : "✏️"}
                            </button>
                            <button onClick={() => handleDeleteClick(ex)} disabled={isDeleting || isChecking}
                              style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", opacity: isDeleting || isChecking ? 0.6 : 1 }}>
                              {isChecking ? "…" : isDeleting ? "…" : "🗑"}
                            </button>
                          </>
                        )}
                      </div>

                      {isEditing && (
                        <div style={{ padding: 12, background: "rgba(26,63,168,0.06)", border: "1px solid rgba(26,63,168,0.4)", borderTop: "none", borderRadius: "0 0 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                          <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Exercise name"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <select value={editMuscle} onChange={e => setEditMuscle(e.target.value as MuscleGroup)}
                              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                              {MUSCLE_GROUPS.map(g => <option key={g}>{g}</option>)}
                            </select>
                            <input type="number" value={editRest} onChange={e => setEditRest(e.target.value)} placeholder="Rest (secs)"
                              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          </div>
                          <input value={editVideo} onChange={e => setEditVideo(e.target.value)} placeholder="YouTube URL"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          <input value={editDefaultNotes} onChange={e => setEditDefaultNotes(e.target.value)} placeholder='Default notes (e.g. "each leg") — auto-fills in programs'
                            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          {editVideo && getYouTubeId(editVideo) && (
                            <div style={{ fontSize: 11, color: "#5de098" }}>✓ Valid YouTube URL</div>
                          )}
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={handleSave} disabled={saving}
                              style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                              {saving ? "Saving…" : "Save Changes"}
                            </button>
                            <button onClick={() => setEditing(null)}
                              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "7px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0", fontSize: 13 }}>No exercises match your search.</div>
          )}
        </div>
      )}

      {/* Usage warning modal */}
      {usageModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setUsageModal(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(480px, 96vw)", padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#ff3c3c", marginBottom: 6 }}>⚠️ Exercise In Use</div>
            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 16 }}>
              <strong>{usageModal.ex.name}</strong> is currently used in {usageModal.usages.length} place{usageModal.usages.length !== 1 ? "s" : ""}:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20, maxHeight: 240, overflowY: "auto" }}>
              {usageModal.usages.map((u, i) => (
                <div key={i} style={{ padding: "10px 12px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{u.programTitle}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    Day {u.dayNumber} — {u.dayName}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#ff7b7b", marginBottom: 16, padding: "10px 12px", background: "rgba(255,60,60,0.08)", borderRadius: 8, border: "1px solid rgba(255,60,60,0.2)" }}>
              Deleting this exercise will remove it from all the programs and days listed above. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => doDelete(usageModal.ex.id)} disabled={deleting === usageModal.ex.id}
                style={{ flex: 1, background: "rgba(255,60,60,0.15)", border: "1px solid rgba(255,60,60,0.4)", color: "#ff3c3c", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {deleting === usageModal.ex.id ? "Deleting…" : "Delete Anyway"}
              </button>
              <button onClick={() => setUsageModal(null)}
                style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                Cancel — Keep It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
