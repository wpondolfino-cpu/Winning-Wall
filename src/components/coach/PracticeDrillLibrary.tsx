// src/components/coach/PracticeDrillLibrary.tsx
// Standalone library screen (render with no onPick for full management)
// or an in-context picker modal (pass onPick + onClose, used from
// PracticeBuilder's "Add drill" button). Same underlying data either way.

import { useState, useEffect, useCallback } from "react";
import {
  PracticeDrillCategory, PracticeDrillLibraryDrill, getPracticeDrillCategories,
  createPracticeDrillCategory, getPracticeDrillTags, getPracticeDrillLibrary,
  createPracticeDrill, updatePracticeDrill, deletePracticeDrill, toggleDrillStar,
  getRecentlyUsedDrills, getPlaysForLinking,
} from "../../lib/practicePlanner";

interface Props {
  canManage?: boolean;
  onPick?: (drill: PracticeDrillLibraryDrill) => void;
  onClose?: () => void;
}

function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/)([^&?/\s]+)/);
  return match ? match[1] : null;
}

export default function PracticeDrillLibrary({ canManage = true, onPick, onClose }: Props) {
  const isPicker = !!onPick;
  const [categories, setCategories] = useState<PracticeDrillCategory[]>([]);
  const [allTags, setAllTags]       = useState<string[]>([]);
  const [drills, setDrills]         = useState<PracticeDrillLibraryDrill[]>([]);
  const [tagsByDrill, setTagsByDrill] = useState<Record<string, string[]>>({});
  const [recent, setRecent]         = useState<PracticeDrillLibraryDrill[]>([]);
  const [plays, setPlays]           = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading]       = useState(true);

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter]   = useState<string[]>([]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [search, setSearch]         = useState("");

  const [viewDrill, setViewDrill]   = useState<PracticeDrillLibraryDrill | null>(null);
  const [editDrill, setEditDrill]   = useState<Partial<PracticeDrillLibraryDrill> & { tags?: string[] } | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [cats, tags, lib, rec, playList] = await Promise.all([
      getPracticeDrillCategories(), getPracticeDrillTags(),
      getPracticeDrillLibrary({ categoryName: categoryFilter, tags: tagFilter, starredOnly, search: search || undefined }),
      isPicker ? getRecentlyUsedDrills() : Promise.resolve([]),
      canManage ? getPlaysForLinking() : Promise.resolve([]),
    ]);
    setCategories(cats); setAllTags(tags);
    setDrills(lib.drills); setTagsByDrill(lib.tagsByDrill);
    setRecent(rec); setPlays(playList);
    setLoading(false);
  }, [categoryFilter, tagFilter, starredOnly, search]);

  useEffect(() => { load(); }, [load]);

  async function handleToggleStar(d: PracticeDrillLibraryDrill, e: React.MouseEvent) {
    e.stopPropagation();
    await toggleDrillStar(d.id, !d.is_starred);
    await load();
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    await createPracticeDrillCategory(newCategoryName);
    setNewCategoryName(""); setShowNewCategory(false);
    await load();
  }

  function startNewDrill() {
    setEditDrill({ title: "", category_name: categoryFilter ?? undefined, tags: [] });
  }

  async function startEditDrill(d: PracticeDrillLibraryDrill) {
    setEditDrill({ ...d, tags: tagsByDrill[d.id] ?? [] });
    setViewDrill(null);
  }

  async function saveDrill() {
    if (!editDrill || !editDrill.title?.trim()) return;
    if (editDrill.id) {
      await updatePracticeDrill(editDrill.id, {
        title: editDrill.title, description: editDrill.description ?? null, video_url: editDrill.video_url ?? null,
        category_name: editDrill.category_name ?? null, default_duration_minutes: editDrill.default_duration_minutes ?? null,
        default_group_size: editDrill.default_group_size ?? null, default_num_groups: editDrill.default_num_groups ?? null,
        linked_play_id: editDrill.linked_play_id ?? null, tags: editDrill.tags ?? [],
      });
    } else {
      await createPracticeDrill({
        title: editDrill.title, description: editDrill.description ?? undefined, video_url: editDrill.video_url ?? undefined,
        category_name: editDrill.category_name ?? null, default_duration_minutes: editDrill.default_duration_minutes ?? null,
        default_group_size: editDrill.default_group_size ?? null, default_num_groups: editDrill.default_num_groups ?? null,
        linked_play_id: editDrill.linked_play_id ?? null, tags: editDrill.tags ?? [],
      });
    }
    setEditDrill(null);
    await load();
  }

  async function handleDeleteDrill(d: PracticeDrillLibraryDrill) {
    if (!window.confirm(`Delete "${d.title}"? Practices that already used it keep it in their schedule, just unlinked from the library.`)) return;
    await deletePracticeDrill(d.id);
    setViewDrill(null);
    await load();
  }

  function DrillCard({ d }: { d: PracticeDrillLibraryDrill }) {
    const vid = getYouTubeId(d.video_url);
    return (
      <div onClick={() => isPicker ? onPick!(d) : setViewDrill(d)}
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, cursor: "pointer", display: "flex", gap: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: 8, background: vid ? `url(https://img.youtube.com/vi/${vid}/default.jpg) center/cover` : "var(--surface2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
          {!vid && "🏀"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>
            {[d.category_name, d.default_duration_minutes ? `${d.default_duration_minutes}m` : null, d.default_group_size && d.default_num_groups ? `${d.default_group_size}v${Array(d.default_num_groups).fill(d.default_group_size).join("v")}` : null].filter(Boolean).join(" · ")}
          </div>
          {(tagsByDrill[d.id] ?? []).length > 0 && (
            <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
              {(tagsByDrill[d.id] ?? []).map(t => <span key={t} style={{ fontSize: 9, background: "var(--surface2)", color: "var(--muted)", padding: "1px 6px", borderRadius: 4 }}>{t}</span>)}
            </div>
          )}
        </div>
        <button onClick={e => handleToggleStar(d, e)} style={{ background: "none", border: "none", fontSize: 16, cursor: "pointer", color: d.is_starred ? "var(--gold)" : "var(--muted)" }}>
          {d.is_starred ? "★" : "☆"}
        </button>
      </div>
    );
  }

  const content = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>
          {isPicker ? "Add a drill" : "Practice Drill Library"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canManage && !isPicker && <button onClick={startNewDrill} style={primaryBtn}>+ New drill</button>}
          {isPicker && <button onClick={onClose} style={smallBtn}>Cancel</button>}
        </div>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search drills…" style={{ ...inputStyle, width: "100%", marginBottom: 10, boxSizing: "border-box" }} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <button onClick={() => setCategoryFilter(null)} style={categoryFilter === null ? chipActive : chip}>All</button>
        {categories.map(c => (
          <button key={c.name} onClick={() => setCategoryFilter(c.name)} style={categoryFilter === c.name ? chipActive : chip}>{c.name}</button>
        ))}
        {canManage && (showNewCategory ? (
          <span style={{ display: "flex", gap: 4 }}>
            <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder="Category name" style={{ ...inputStyle, width: 120 }} />
            <button onClick={handleCreateCategory} style={smallBtn}>Add</button>
          </span>
        ) : (
          <button onClick={() => setShowNewCategory(true)} style={chip}>+ Category</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <button onClick={() => setStarredOnly(s => !s)} style={starredOnly ? chipActive : chip}>★ Starred</button>
        {allTags.map(t => (
          <button key={t} onClick={() => setTagFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
            style={tagFilter.includes(t) ? chipActive : chip}>{t}</button>
        ))}
      </div>

      {isPicker && recent.length > 0 && !search && !categoryFilter && tagFilter.length === 0 && !starredOnly && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Recently used</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recent.map(d => <DrillCard key={d.id} d={d} />)}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {drills.map(d => <DrillCard key={d.id} d={d} />)}
          {drills.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", padding: "12px 0" }}>No drills match. {canManage && !isPicker && "Create one to get started."}</div>}
        </div>
      )}

      {/* ── View modal ── */}
      {viewDrill && (
        <div style={overlayStyle} onClick={() => setViewDrill(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{viewDrill.title}</div>
              <button onClick={() => setViewDrill(null)} style={smallBtn}>Close</button>
            </div>
            {getYouTubeId(viewDrill.video_url) && (
              <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, marginBottom: 10, borderRadius: 8, overflow: "hidden" }}>
                <iframe src={`https://www.youtube.com/embed/${getYouTubeId(viewDrill.video_url)}?rel=0&modestbranding=1`} title={viewDrill.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
              </div>
            )}
            {viewDrill.description && <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 10 }}>{viewDrill.description}</div>}
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
              {[viewDrill.category_name, viewDrill.default_duration_minutes ? `Default ${viewDrill.default_duration_minutes} min` : null,
                viewDrill.default_group_size && viewDrill.default_num_groups ? `${viewDrill.default_group_size}v${Array(viewDrill.default_num_groups).fill(viewDrill.default_group_size).join("v")}` : null]
                .filter(Boolean).join(" · ")}
            </div>
            {viewDrill.linked_play_id && plays.find(p => p.id === viewDrill.linked_play_id) && (
              <div style={{ fontSize: 12, color: "var(--gold)", marginBottom: 10 }}>🏀 Linked play: {plays.find(p => p.id === viewDrill.linked_play_id)?.title}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              {isPicker && <button onClick={() => onPick!(viewDrill)} style={primaryBtn}>Add to practice</button>}
              {canManage && <button onClick={() => startEditDrill(viewDrill)} style={smallBtn}>Edit</button>}
              {canManage && <button onClick={() => handleDeleteDrill(viewDrill)} style={dangerSmallBtn}>Delete</button>}
            </div>
          </div>
        </div>
      )}

      {/* ── Create/edit modal ── */}
      {editDrill && (
        <div style={overlayStyle} onClick={() => setEditDrill(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{editDrill.id ? "Edit drill" : "New drill"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input value={editDrill.title ?? ""} onChange={e => setEditDrill({ ...editDrill, title: e.target.value })} placeholder="Title" style={inputStyle} />
              <textarea value={editDrill.description ?? ""} onChange={e => setEditDrill({ ...editDrill, description: e.target.value })} placeholder="Description" rows={3} style={{ ...inputStyle, resize: "vertical" as const }} />
              <input value={editDrill.video_url ?? ""} onChange={e => setEditDrill({ ...editDrill, video_url: e.target.value })} placeholder="YouTube URL (optional)" style={inputStyle} />
              <select value={editDrill.category_name ?? ""} onChange={e => setEditDrill({ ...editDrill, category_name: e.target.value || null })} style={inputStyle}>
                <option value="">No category</option>
                {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <input value={(editDrill.tags ?? []).join(", ")} onChange={e => setEditDrill({ ...editDrill, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })} placeholder="Tags, comma separated" style={inputStyle} />
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" min={1} value={editDrill.default_duration_minutes ?? ""} onChange={e => setEditDrill({ ...editDrill, default_duration_minutes: e.target.value ? parseInt(e.target.value) : null })} placeholder="Default min" style={{ ...inputStyle, flex: 1 }} />
                <input type="number" min={1} value={editDrill.default_group_size ?? ""} onChange={e => setEditDrill({ ...editDrill, default_group_size: e.target.value ? parseInt(e.target.value) : null })} placeholder="Group size" style={{ ...inputStyle, flex: 1 }} />
                <input type="number" min={1} value={editDrill.default_num_groups ?? ""} onChange={e => setEditDrill({ ...editDrill, default_num_groups: e.target.value ? parseInt(e.target.value) : null })} placeholder="# groups" style={{ ...inputStyle, flex: 1 }} />
              </div>
              {plays.length > 0 && (
                <select value={editDrill.linked_play_id ?? ""} onChange={e => setEditDrill({ ...editDrill, linked_play_id: e.target.value || null })} style={inputStyle}>
                  <option value="">No linked play</option>
                  {plays.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={saveDrill} style={primaryBtn}>Save</button>
                <button onClick={() => setEditDrill(null)} style={smallBtn}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isPicker) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={{ ...modalStyle, width: "min(480px, 96vw)" }} onClick={e => e.stopPropagation()}>{content}</div>
      </div>
    );
  }
  return content;
}

const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalStyle: React.CSSProperties = { background: "var(--surface)", borderRadius: 16, width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 20 };
const inputStyle: React.CSSProperties = {
  width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
const dangerSmallBtn: React.CSSProperties = {
  background: "rgba(226,75,74,0.08)", border: "1px solid rgba(226,75,74,0.2)", color: "#ff7b7b", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
const chip: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 999,
  padding: "4px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
const chipActive: React.CSSProperties = { ...chip, background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" };
