// src/components/lifting/ExerciseBank.tsx
// Full exercise bank directory — coaches can edit, players can view
import { useState, useEffect } from "react";
import { BankExercise, MuscleGroup, MUSCLE_GROUPS, getExerciseBank, upsertBankExercise } from "./lifting";

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
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setBank(await getExerciseBank()); }
    finally { setLoading(false); }
  }

  function openEdit(ex: BankExercise) {
    setEditing(ex);
    setEditName(ex.name);
    setEditMuscle(ex.muscle_group as MuscleGroup);
    setEditVideo(ex.video_url ?? "");
    setEditRest(ex.default_rest_secs.toString());
    setShowAdd(false);
  }

  function openAdd() {
    setEditing(null);
    setEditName("");
    setEditMuscle("Other");
    setEditVideo("");
    setEditRest("90");
    setShowAdd(true);
  }

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await upsertBankExercise(editName.trim(), editMuscle, editVideo || null, parseInt(editRest) || 90, playerId);
      await load();
      setEditing(null);
      setShowAdd(false);
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
    const match = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
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
        {bank.length} exercises · {canManage ? "Click ✏️ to edit YouTube links or details" : "Tap 📹 to watch a demo"}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search exercises…"
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }}
      />

      {/* Muscle group filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {(["All", ...MUSCLE_GROUPS] as const).map(g => (
          <button key={g} onClick={() => setMuscleFilter(g as any)}
            style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: muscleFilter === g ? "var(--royal)" : "var(--surface2)", color: muscleFilter === g ? "#fff" : "var(--muted)" }}>
            {g}
          </button>
        ))}
      </div>

      {/* Add form */}
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
            <input value={editVideo} onChange={e => setEditVideo(e.target.value)} placeholder="YouTube URL (e.g. https://youtube.com/watch?v=...)"
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
                  return (
                    <div key={ex.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: isEditing ? "rgba(26,63,168,0.1)" : "var(--surface2)", borderRadius: isEditing ? "10px 10px 0 0" : 10, border: `1px solid ${isEditing ? "rgba(26,63,168,0.4)" : "var(--border)"}`, borderBottom: isEditing ? "none" : undefined }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{ex.name}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{ex.default_rest_secs}s rest</div>
                        </div>
                        {vid && (
                          <a href={`https://youtube.com/watch?v=${vid}`} target="_blank" rel="noreferrer"
                            style={{ fontSize: 11, color: "var(--gold)", textDecoration: "none", fontWeight: 600, padding: "4px 8px", borderRadius: 6, background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.2)" }}>
                            📹 Demo
                          </a>
                        )}
                        {!vid && (
                          <span style={{ fontSize: 11, color: "var(--muted)", padding: "4px 8px" }}>No video</span>
                        )}
                        {canManage && (
                          <button onClick={() => isEditing ? setEditing(null) : openEdit(ex)}
                            style={{ background: isEditing ? "var(--royal)" : "var(--surface)", border: "1px solid var(--border)", color: isEditing ? "#fff" : "var(--muted)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
                            {isEditing ? "Cancel" : "✏️"}
                          </button>
                        )}
                      </div>

                      {/* Edit form */}
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
                          <input value={editVideo} onChange={e => setEditVideo(e.target.value)} placeholder="YouTube URL (e.g. https://youtube.com/watch?v=...)"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                          {editVideo && getYouTubeId(editVideo) && (
                            <div style={{ fontSize: 11, color: "#5de098" }}>✓ Valid YouTube URL detected</div>
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
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0", fontSize: 13 }}>
              No exercises match your search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
