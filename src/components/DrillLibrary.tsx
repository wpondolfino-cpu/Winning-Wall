// src/components/DrillLibrary.tsx
// Browsable catalog of every drill ever created — separate from "this
// period's assigned workouts" so players can practice extra drills, and
// coaches/admins can manage the full drill catalog independent of any
// specific workout group.

import { useState, useEffect } from "react";
import { supabase, Workout, getWorkouts } from "../lib/supabase";
import { getCategories } from "../lib/categories";
import WorkoutBuilder from "./coach/WorkoutBuilder";
import RandomDrillModal from "./RandomDrillModal";
import CategoryManagerModal from "./CategoryManagerModal";

interface Props {
  canManage: boolean;
  // player: deep-link into the Workouts tab's scoring modal. filters is set
  // when the drill came from the Random Drill Generator, so the Workouts
  // tab knows to offer "same filters" on the next reroll.
  onPractice?: (workoutId: string, filters?: { category: string; tags: string[] }) => void;
  onChanged?: () => void; // coach/admin: let the parent refresh its own workouts list
  // Bumped by the parent to force the Random Drill modal open (used when a
  // player picks "Change filters" after logging a score from a previous
  // random-drill round, to bring them back here).
  openRandomDrillSignal?: number;
}

export default function DrillLibrary({ canManage, onPractice, onChanged, openRandomDrillSignal }: Props) {
  const [drills, setDrills] = useState<Workout[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
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
  const [showRandomModal, setShowRandomModal] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [viewDrill, setViewDrill] = useState<Workout | null>(null);

  useEffect(() => {
    if (openRandomDrillSignal) setShowRandomModal(true);
  }, [openRandomDrillSignal]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [usageModal, setUsageModal] = useState<{ drill: Workout; counts: Record<string, number> } | null>(null);

  useEffect(() => { load(); loadCategories(); }, []);

  async function load() {
    setLoading(true);
    try { setDrills(await getWorkouts()); } finally { setLoading(false); }
  }

  async function loadCategories() {
    setCategories((await getCategories()).map(c => c.name));
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

  const grouped = categories.reduce((acc, cat) => {
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
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowRandomModal(true)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            🎲 Random Drill
          </button>
          {canManage && (
            <button onClick={() => setShowBuilder(true)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              + Add Drill
            </button>
          )}
          {canManage && (
            <button onClick={() => setShowCategoryManager(true)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              🏷️ Manage Categories
            </button>
          )}
        </div>
      </div>
      <div className="section-sub" style={{ marginBottom: 16 }}>
        {filtered.length} drill{filtered.length !== 1 ? "s" : ""} · {canManage ? "Click ✏️ to edit, 📦 to archive, 🗑 to delete" : "Tap a drill to practice — 1 point per drill per day, personal bests always count"}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search drills…"
        style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: availableTags.length > 0 ? 6 : (canManage ? 10 : 16) }}>
        {["All", ...categories].map(c => (
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
                      onClick={() => canManage ? setViewDrill(d) : onPractice?.(d.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10, border: "1px solid var(--border)", opacity: (d as any).library_archived ? 0.6 : 1, cursor: "pointer" }}>
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

      {viewDrill && (
        <div onClick={() => setViewDrill(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(460px, 96vw)", padding: 22, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1 }}>{viewDrill.emoji ?? "🏀"} {viewDrill.title}</div>
              <button onClick={() => setViewDrill(null)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{viewDrill.category}</span>
              {((viewDrill as any).tags ?? []).map((t: string) => (
                <span key={t} style={{ fontSize: 10, color: "var(--gold)" }}>🏷️ {t}</span>
              ))}
              {(viewDrill as any).library_archived && <span style={{ fontSize: 10, color: "var(--muted)" }}>📦 Archived</span>}
            </div>

            {(() => {
              const vid = getYouTubeId(viewDrill.video_url);
              if (!vid) return null;
              return (
                <div style={{ borderRadius: 10, overflow: "hidden", marginBottom: 16, background: "#000", position: "relative", paddingTop: "56.25%" }}>
                  <iframe src={`https://www.youtube.com/embed/${vid}?rel=0&modestbranding=1`} title={viewDrill.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
                </div>
              );
            })()}

            {(viewDrill as any).resource_url && (
              <a href={(viewDrill as any).resource_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "rgba(26,63,168,0.1)", border: "1px solid rgba(26,63,168,0.25)", borderRadius: 10, marginBottom: 14, textDecoration: "none" }}>
                <span style={{ fontSize: 20 }}>📄</span>
                <span style={{ flex: 1, fontSize: 13, color: "#93b4ff", fontWeight: 600 }}>View Program / Resource</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>↗</span>
              </a>
            )}

            {viewDrill.description && (
              <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 13, color: "var(--silver-light)", lineHeight: 1.7, marginBottom: 16, whiteSpace: "pre-wrap" }}>
                {viewDrill.description}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setEditDrill(viewDrill); setViewDrill(null); }}
                style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                ✏️ Edit
              </button>
              <button onClick={() => setViewDrill(null)}
                style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showCategoryManager && (
        <CategoryManagerModal
          onClose={() => setShowCategoryManager(false)}
          onChanged={() => { loadCategories(); load(); }}
        />
      )}

      {showRandomModal && (
        <RandomDrillModal
          drills={drills}
          canManage={canManage}
          onClose={() => setShowRandomModal(false)}
          onLogScore={(id, filters) => onPractice?.(id, filters)}
        />
      )}
    </div>
  );
}
