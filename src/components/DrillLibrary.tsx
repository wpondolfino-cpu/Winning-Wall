// src/components/DrillLibrary.tsx
// Browsable catalog of every drill ever created — separate from "this
// period's assigned workouts" so players can practice extra drills, and
// coaches/admins can manage the full drill catalog independent of any
// specific workout group.

import { useState, useEffect } from "react";
import { supabase, Workout, getWorkouts } from "../lib/supabase";
import WorkoutBuilder from "./coach/WorkoutBuilder";

interface Props {
  canManage: boolean;
  onPractice?: (workoutId: string) => void; // player: deep-link into the Workouts tab's scoring modal
  onChanged?: () => void; // coach/admin: let the parent refresh its own workouts list
}

const CATEGORIES = ["Dribbling", "Finishing", "Shooting", "Competing", "Strength"] as const;

export default function DrillLibrary({ canManage, onPractice, onChanged }: Props) {
  const [drills, setDrills] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagSearchOpen, setTagSearchOpen] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editDrill, setEditDrill] = useState<Workout | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [usageModal, setUsageModal] = useState<{ drill: Workout; counts: Record<string, number> } | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setDrills(await getWorkouts()); } finally { setLoading(false); }
  }

  const filtered = drills.filter(d => {
    const matchArchived = showArchived ? (d as any).library_archived === true : (d as any).library_archived !== true;
    const matchCategory = categoryFilter === "All" || d.category === categoryFilter;
    const matchTag = !tagFilter || ((d as any).tags ?? []).includes(tagFilter);
    const matchSearch = search === "" || d.title.toLowerCase().includes(search.toLowerCase());
    return matchArchived && matchCategory && matchTag && matchSearch;
  });

  // Scoped to the current category so irrelevant tags (e.g. "1v1" while
  // viewing Dribbling) never show up as options — except on "All", where
  // we show the full set via the collapsed search instead of flat chips.
  const availableTags = [...new Set(
    drills
      .filter(d => categoryFilter === "All" || d.category === categoryFilter)
      .flatMap(d => (d as any).tags ?? [])
  )].sort();

  const grouped = CATEGORIES.reduce((acc, cat) => {
    const ds = filtered.filter(d => d.category === cat).sort((a, b) => a.title.localeCompare(b.title));
    if (ds.length > 0) acc[cat] = ds;
    return acc;
  }, {} as Record<string, Workout[]>);

  async function toggleArchive(d: Workout) {
    setArchiving(d.id);
    try {
      await supabase.from("workouts").update({ library_archived: !(d as any).library_archived }).eq("id", d.id);
      await load(); onChanged?.();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setArchiving(null); }
  }

  async function checkUsage(d: Workout): Promise<Record<string, number>> {
    const [scores, attempts, pbs, challenges, bonuses] = await Promise.all([
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("workout_id", d.id),
      supabase.from("score_attempts").select("id", { count: "exact", head: true }).eq("workout_id", d.id),
      supabase.from("personal_bests").select("id", { count: "exact", head: true }).eq("workout_id", d.id),
      supabase.from("challenges").select("id", { count: "exact", head: true }).eq("workout_id", d.id),
      supabase.from("streak_bonuses").select("id", { count: "exact", head: true }).eq("workout_id", d.id),
    ]);
    return {
      "Player scores": scores.count ?? 0,
      "Score attempts": attempts.count ?? 0,
      "Personal bests": pbs.count ?? 0,
      "H2H challenges": challenges.count ?? 0,
      "Bonus records": bonuses.count ?? 0,
    };
  }

  async function handleDeleteClick(d: Workout) {
    const counts = await checkUsage(d);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > 0) {
      setUsageModal({ drill: d, counts });
    } else {
      if (window.confirm(`Delete "${d.title}"? This drill has no history, so this is fully safe.`)) {
        await doDelete(d.id);
      }
    }
  }

  async function doDelete(id: string) {
    setDeleting(id);
    try {
      const { error } = await supabase.from("workouts").delete().eq("id", id);
      if (error) throw error;
      setUsageModal(null);
      await load(); onChanged?.();
    } catch (e: any) { alert("Error deleting: " + e.message); }
    finally { setDeleting(null); }
  }

  function getYouTubeId(url?: string): string | null {
    if (!url) return null;
    const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/\s]+)/);
    return match ? match[1] : null;
  }

  if (showBuilder || editDrill) {
    return (
      <WorkoutBuilder
        editWorkout={editDrill}
        defaultIsActive={false}
        onSaved={() => { setShowBuilder(false); setEditDrill(null); load(); onChanged?.(); }}
        onCancel={() => { setShowBuilder(false); setEditDrill(null); }}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="section-title" style={{ margin: 0 }}>📚 Drill Library</div>
        {canManage && (
          <button onClick={() => setShowBuilder(true)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            + Add Drill
          </button>
        )}
      </div>
      <div className="section-sub" style={{ marginBottom: 16 }}>
        {filtered.length} drill{filtered.length !== 1 ? "s" : ""} · {canManage ? "Click ✏️ to edit, 📦 to archive, 🗑 to delete" : "Tap a drill to practice — 1 point per drill per day, personal bests always count"}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search drills…"
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: availableTags.length > 0 ? 6 : (canManage ? 10 : 16) }}>
        {(["All", ...CATEGORIES] as const).map(c => (
          <button key={c} onClick={() => { setCategoryFilter(c); setTagFilter(null); setTagSearchOpen(false); setTagSearchQuery(""); }}
            style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: categoryFilter === c ? "var(--royal)" : "var(--surface2)", color: categoryFilter === c ? "#fff" : "var(--muted)" }}>
            {c}
          </button>
        ))}
      </div>

      {availableTags.length > 0 && categoryFilter === "All" && (
        <div style={{ marginBottom: canManage ? 10 : 16, paddingLeft: 8 }}>
          {tagFilter ? (
            <button onClick={() => setTagFilter(null)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, background: "var(--gold)", color: "#1a1a1a" }}>
              🏷️ {tagFilter} ✕
            </button>
          ) : !tagSearchOpen ? (
            <button onClick={() => setTagSearchOpen(true)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, background: "transparent", color: "var(--muted)" }}>
              🏷️ Filter by tag
            </button>
          ) : (
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 8, maxWidth: 320 }}>
              <input value={tagSearchQuery} onChange={e => setTagSearchQuery(e.target.value)} placeholder="Search tags…" autoFocus
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 9px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {availableTags.filter(t => t.toLowerCase().includes(tagSearchQuery.toLowerCase())).map(t => (
                  <button key={t} onClick={() => { setTagFilter(t); setTagSearchOpen(false); setTagSearchQuery(""); }}
                    style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, background: "transparent", color: "var(--muted)" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {availableTags.length > 0 && categoryFilter !== "All" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: canManage ? 10 : 16, paddingLeft: 8 }}>
          {availableTags.map(t => (
            <button key={t} onClick={() => setTagFilter(f => f === t ? null : t)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, background: tagFilter === t ? "var(--gold)" : "transparent", color: tagFilter === t ? "#1a1a1a" : "var(--muted)" }}>
              🏷️ {t}
            </button>
          ))}
        </div>
      )}

      {canManage && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button onClick={() => setShowArchived(false)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: !showArchived ? "var(--royal)" : "var(--surface2)", color: !showArchived ? "#fff" : "var(--muted)" }}>Active</button>
          <button onClick={() => setShowArchived(true)} style={{ padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, background: showArchived ? "var(--royal)" : "var(--surface2)", color: showArchived ? "#fff" : "var(--muted)" }}>📦 Archived</button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Object.entries(grouped).map(([cat, ds]) => (
            <div key={cat}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid var(--border)" }}>
                {cat} ({ds.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {ds.map(d => {
                  const vid = getYouTubeId(d.video_url);
                  const isArchiving = archiving === d.id;
                  const isDeleting = deleting === d.id;
                  return (
                    <div key={d.id}
                      onClick={() => !canManage && onPractice?.(d.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)", opacity: (d as any).library_archived ? 0.6 : 1, cursor: !canManage ? "pointer" : "default" }}>
                      <span style={{ fontSize: 18 }}>{d.emoji ?? "🏀"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{d.title}</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          {((d as any).tags ?? []).map((t: string) => (
                            <span key={t} style={{ fontSize: 10, color: "var(--gold)" }}>🏷️ {t}</span>
                          ))}
                          {(d as any).library_archived && <span style={{ fontSize: 10, color: "var(--muted)" }}>📦 Archived</span>}
                        </div>
                      </div>
                      {vid && <span style={{ fontSize: 11, color: "var(--gold)" }}>📹</span>}
                      {canManage && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); setEditDrill(d); }}
                            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>✏️</button>
                          <button onClick={(e) => { e.stopPropagation(); toggleArchive(d); }} disabled={isArchiving}
                            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", opacity: isArchiving ? 0.6 : 1 }}>
                            {isArchiving ? "…" : (d as any).library_archived ? "♻️" : "📦"}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteClick(d); }} disabled={isDeleting}
                            style={{ background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", color: "#ff3c3c", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", opacity: isDeleting ? 0.6 : 1 }}>
                            {isDeleting ? "…" : "🗑"}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0", fontSize: 13 }}>No drills match.</div>
          )}
        </div>
      )}

      {usageModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setUsageModal(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(480px, 96vw)", padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#ff3c3c", marginBottom: 6 }}>⚠️ Drill Has History</div>
            <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 16 }}>
              <strong>{usageModal.drill.title}</strong> has real player history attached:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
              {Object.entries(usageModal.counts).filter(([, c]) => c > 0).map(([label, count]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>{count}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#ff7b7b", marginBottom: 16, padding: "10px 12px", background: "rgba(255,60,60,0.08)", borderRadius: 8, border: "1px solid rgba(255,60,60,0.2)" }}>
              Deleting this drill will permanently erase all of the above. We'd recommend archiving instead — it hides the drill from the library without losing any history.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => doDelete(usageModal.drill.id)} disabled={deleting === usageModal.drill.id}
                style={{ flex: 1, background: "rgba(255,60,60,0.15)", border: "1px solid rgba(255,60,60,0.4)", color: "#ff3c3c", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {deleting === usageModal.drill.id ? "Deleting…" : "Delete Anyway"}
              </button>
              <button onClick={() => { toggleArchive(usageModal.drill); setUsageModal(null); }}
                style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                📦 Archive Instead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
