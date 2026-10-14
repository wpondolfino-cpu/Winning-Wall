// src/components/coach/PlaybookManager.tsx
// Coach-facing playbook manager. Mirrors GroupManager.tsx's draft/active/
// archived pattern and visual style, applied to Playbooks instead of
// Workout Groups.

import { supabase } from "../../lib/supabase";
import { useState, useEffect } from "react";
import { getYouTubeId } from "../../lib/youtube";
import VideoUrlNote from "../shared/VideoUrlNote";
import PlayPrintView from "../plays/PlayPrintView";
import PlaylistPlayer from "../plays/PlaylistPlayer";
import RosterShareRows from "../shared/RosterShareRows";
import {
  Playbook, Play, RosterPlayer,
  getPlaybooks, createPlaybook, updatePlaybook, setPlaybookStatus, deletePlaybook,
  getPlaybookPlays, addPlayToPlaybook, removePlayFromPlaybook,
  setPlaybookPlayHidden, savePlaybookLayout, groupBySection, type PlaybookPlay,
  getPlaybookShares, publishPlaybookTo, unassignPlaybookFrom,
  getMyPlays, getRoster,
} from "../../lib/plays";

const STATUS_COLOR: Record<string, { bg: string; color: string; label: string }> = {
  draft:    { bg: "rgba(240,192,64,0.12)",  color: "var(--gold)",  label: "📝 Draft"    },
  active:   { bg: "rgba(40,180,80,0.12)",   color: "#5de098",      label: "🌐 Live"     },
  archived: { bg: "rgba(255,255,255,0.06)", color: "var(--muted)", label: "📦 Archived" },
};

const NEW_SECTION = "__new__";
const miniBtn = { background: "none", border: "none", color: "var(--muted)", fontSize: 11, cursor: "pointer", padding: "0 2px" } as const;
const arrowBtn = { background: "none", border: "none", color: "var(--muted)", fontSize: 9, lineHeight: 1, cursor: "pointer", padding: "1px 3px" } as const;

const inputStyle = { width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const };


interface Props {
  /** Open a play from inside a playbook. The playbook id comes back too so
   *  the caller can return you to the one you were looking at. */
  onOpenPlay?: (play: Play, playbookId: string) => void;
  /** Re-open this playbook on mount — used when coming back from a play. */
  initialExpandedId?: string | null;
  /** "Make quiz" / "Open quiz": go to the Quizzes page for this playbook. */
  onMakeQuiz?: (playbook: Playbook, existingQuizId: string | null) => void;
}

export default function PlaybookManager({ onOpenPlay, initialExpandedId, onMakeQuiz }: Props = {}) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  // The playbook currently being printed, if any. Printing takes over the
  // screen the same way it does for a single play.
  const [printing, setPrinting] = useState<{ plays: Play[]; name: string } | null>(null);
  // "Play all" takes over the screen the same way.
  const [watching, setWatching] = useState<{ plays: Play[]; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(initialExpandedId ?? null);
  // Each playbook's current play quiz (live first, else a draft), so the
  // button can say "Open quiz" instead of making a second one.
  const [quizFor, setQuizFor] = useState<Record<string, string>>({});

  useEffect(() => {
    load();
    getRoster().then(setRoster).catch(console.error);
  }, []);
  async function load() {
    setLoading(true);
    const list = await getPlaybooks();
    setPlaybooks(list);
    setLoading(false);
    if (!onMakeQuiz || !list.length) return;
    const { data } = await supabase.from("quizzes").select("id, playbook_id, status")
      .in("playbook_id", list.map(p => p.id)).neq("status", "archived");
    const map: Record<string, string> = {};
    for (const q of (data ?? []) as { id: string; playbook_id: string; status: string }[]) {
      if (!map[q.playbook_id] || q.status === "published") map[q.playbook_id] = q.id;
    }
    setQuizFor(map);
  }

  if (printing) {
    const rosterMap: Record<string, RosterPlayer> = Object.fromEntries(roster.map((r) => [r.id, r]));
    return <PlayPrintView plays={printing.plays} playbookName={printing.name} roster={rosterMap} onBack={() => setPrinting(null)} />;
  }
  if (watching) {
    const rosterMap: Record<string, RosterPlayer> = Object.fromEntries(roster.map((r) => [r.id, r]));
    return <PlaylistPlayer title={watching.name} plays={watching.plays} roster={rosterMap} onClose={() => setWatching(null)} />;
  }

  async function createNew() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await createPlaybook(newName.trim(), newDesc.trim() || undefined, newVideoUrl.trim() || undefined);
      setNewName(""); setNewDesc(""); setNewVideoUrl(""); setShowForm(false);
      await load();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  async function publish(id: string) {
    if (!window.confirm("Publish this playbook? It'll become visible to whoever it's assigned to.")) return;
    await setPlaybookStatus(id, "active");
    await load();
  }
  /** Take it back off players so it can be worked on. Distinct from
   *  archiving: unpublish means "I'm coming back to this", archive means
   *  "I'm finished with it". */
  async function unpublish(id: string) {
    if (!window.confirm("Unpublish this playbook? It goes back to draft so you can edit it, and assigned players stop seeing it until you publish again.")) return;
    await setPlaybookStatus(id, "draft");
    await load();
  }
  async function archive(id: string) {
    if (!window.confirm("Archive this playbook? It'll be hidden from assigned players but not deleted.")) return;
    await setPlaybookStatus(id, "archived");
    await load();
  }
  /** Archiving used to be a dead end — this is the way back. */
  async function restoreToDraft(id: string) {
    await setPlaybookStatus(id, "draft");
    await load();
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete playbook "${name}"? This can't be undone.`)) return;
    await deletePlaybook(id);
    await load();
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>📋 Playbooks</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Bundle plays into a playbook, then publish it to specific players</div>
        </div>
        <button onClick={() => setShowForm((s) => !s)}
          style={{ background: showForm ? "var(--surface)" : "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {showForm ? "✕ Cancel" : "+ New Playbook"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "var(--surface)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Playbook name (e.g. Baseline out-of-bounds sets)" style={inputStyle} />
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)" style={inputStyle} />
            <input value={newVideoUrl} onChange={(e) => setNewVideoUrl(e.target.value)} placeholder="🎬 Walkthrough video — YouTube link" style={inputStyle} />
            <VideoUrlNote url={newVideoUrl} />
            <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 10px", background: "rgba(240,192,64,0.06)", borderRadius: 8, border: "1px solid rgba(240,192,64,0.15)" }}>
              📝 Playbooks start as <strong style={{ color: "var(--gold)" }}>Draft</strong> — add plays and assign players, then hit <strong style={{ color: "#5de098" }}>Publish</strong>.
            </div>
            <button onClick={createNew} disabled={saving || !newName.trim()}
              style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {saving ? "Creating…" : "Create Playbook"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>Loading…</div>
      ) : playbooks.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>No playbooks yet. Create one above to get started.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {playbooks.map((pb) => {
            const sc = STATUS_COLOR[pb.status] ?? STATUS_COLOR.draft;
            const isOpen = expanded === pb.id;
            return (
              <div key={pb.id} style={{ background: "var(--surface)", border: `1px solid ${pb.status === "active" ? "rgba(40,180,80,0.3)" : "var(--border)"}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : pb.id)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{pb.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: sc.bg, color: sc.color }}>{sc.label}</span>
                    </div>
                    {pb.description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{pb.description}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {onMakeQuiz && (
                      <button onClick={() => onMakeQuiz(pb, quizFor[pb.id] ?? null)}
                        title={quizFor[pb.id] ? "Open this playbook's quiz" : "Make a play quiz from this playbook"}
                        style={{ background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                        📝 {quizFor[pb.id] ? "Open quiz" : "Make quiz"}
                      </button>
                    )}
                    {pb.status === "draft" && (
                      <button onClick={() => publish(pb.id)}
                        style={{ background: "rgba(40,180,80,0.12)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                        🌐 Publish
                      </button>
                    )}
                    {pb.status === "active" && (
                      <button onClick={() => unpublish(pb.id)} title="Back to draft so you can edit it"
                        style={{ background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                        ↩ Unpublish
                      </button>
                    )}
                    {pb.status === "active" && (
                      <button onClick={() => archive(pb.id)} title="Done with this one — hide it without deleting"
                        style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.25)", color: "#ff7b7b", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                        📦 Archive
                      </button>
                    )}
                    {pb.status === "archived" && (
                      <button onClick={() => restoreToDraft(pb.id)} title="Bring it back as a draft"
                        style={{ background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                        ↩ Restore to draft
                      </button>
                    )}
                    {pb.status !== "active" && (
                      <button onClick={() => remove(pb.id, pb.name)}
                        style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <PlaybookDetail
                    playbook={pb}
                    onChanged={load}
                    onPrint={(plays) => setPrinting({ plays, name: pb.name })}
                    onWatch={(plays) => setWatching({ plays, name: pb.name })}
                    onOpenPlay={onOpenPlay ? (play) => onOpenPlay(play, pb.id) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlaybookDetail({ playbook, onChanged, onPrint, onWatch, onOpenPlay }: {
  playbook: Playbook;
  onChanged: () => void;
  onPrint: (plays: Play[]) => void;
  onWatch: (plays: Play[]) => void;
  onOpenPlay?: (play: Play) => void;
}) {
  const [plays, setPlays] = useState<PlaybookPlay[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [myPlays, setMyPlays] = useState<Play[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [shares, setShares] = useState<any[]>([]);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editingVideo, setEditingVideo] = useState(false);
  const [videoDraft, setVideoDraft] = useState(playbook.video_url ?? "");
  const [savingVideo, setSavingVideo] = useState(false);

  async function saveVideo() {
    setSavingVideo(true);
    try {
      await updatePlaybook(playbook.id, { video_url: videoDraft.trim() || null });
      setEditingVideo(false);
      onChanged();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSavingVideo(false); }
  }

  useEffect(() => { refresh(); }, [playbook.id]);

  async function refresh() {
    const [pp, mp, sh, r] = await Promise.all([
      getPlaybookPlays(playbook.id), getMyPlays(), getPlaybookShares(playbook.id), getRoster(),
    ]);
    setPlays(pp); setMyPlays(mp); setShares(sh); setRoster(r);
    setPicked(new Set(sh.map((s: any) => s.shared_with)));
  }

  async function addPlay(playId: string) {
    await addPlayToPlaybook(playbook.id, playId, plays.length);
    setShowAdd(false);
    refresh();
  }
  async function removePlay(playId: string) {
    await removePlayFromPlaybook(playbook.id, playId);
    refresh();
  }

  function togglePick(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function saveAssignments() {
    const currentIds = new Set(shares.map((s: any) => s.shared_with));
    const toAdd = [...picked].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !picked.has(id));
    if (toAdd.length) await publishPlaybookTo(playbook.id, toAdd);
    for (const id of toRemove) await unassignPlaybookFrom(playbook.id, id);
    setShowAssign(false);
    refresh();
    onChanged();
  }

  const availablePlays = myPlays.filter((p) => !plays.some((pp) => pp.id === p.id));
  const visiblePlays = plays.filter((p) => !p.hidden);
  const sections = [...new Set(plays.map((p) => p.section).filter((x): x is string => !!x))];

  // ── Organizing ──
  // Every change is shown straight away and saved in the background; if
  // the save fails, the list reloads from the database so it never shows
  // an order that isn't really saved.
  async function commit(next: PlaybookPlay[]) {
    setPlays(next);
    setLayoutError(null);
    try { await savePlaybookLayout(playbook.id, next.map((p) => ({ playId: p.id, section: p.section }))); }
    catch (e: any) { setLayoutError("Couldn't save the new order: " + (e?.message ?? e)); refresh(); }
  }
  /** ▲▼: swap with the neighbour -- or, at the edge of a section, step
   *  across into the next section instead of jumping past its first play. */
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= plays.length) return;
    const next = plays.slice();
    if ((next[j].section ?? null) !== (next[i].section ?? null)) {
      next[i] = { ...next[i], section: next[j].section };
    } else {
      [next[i], next[j]] = [next[j], next[i]];
    }
    commit(next);
  }
  /** Drag and drop: the dragged play lands just above the one it's dropped
   *  on, joining that play's section. */
  function dropBefore(dragged: string, target: string) {
    const from = plays.findIndex((p) => p.id === dragged);
    if (from < 0) return;
    const moving = plays[from];
    const rest = plays.filter((p) => p.id !== dragged);
    const to = rest.findIndex((p) => p.id === target);
    if (to < 0) return;
    rest.splice(to, 0, { ...moving, section: rest[to].section });
    commit(rest);
  }
  /** Picking a section moves the play to the end of that section (a new
   *  section starts at the bottom of the playbook). */
  function pickSection(playId: string, value: string) {
    let section: string | null = value || null;
    if (value === NEW_SECTION) {
      const name = window.prompt("Name the new section (e.g. Sets, BLOB, 2026)")?.trim();
      if (!name) return;
      section = name.slice(0, 60);
    }
    const moving = plays.find((p) => p.id === playId);
    if (!moving) return;
    const rest = plays.filter((p) => p.id !== playId);
    let at = rest.length;
    if (section) {
      const lastInSection = rest.map((p) => p.section).lastIndexOf(section);
      if (lastInSection >= 0) at = lastInSection + 1;
    }
    rest.splice(at, 0, { ...moving, section });
    commit(rest);
  }
  function renameSection(old: string) {
    const name = window.prompt("Rename section", old)?.trim();
    if (!name || name === old) return;
    commit(plays.map((p) => (p.section === old ? { ...p, section: name.slice(0, 60) } : p)));
  }
  function clearSection(old: string) {
    if (!window.confirm(`Remove the "${old}" heading? Its plays stay in the playbook, just without a heading.`)) return;
    commit(plays.map((p) => (p.section === old ? { ...p, section: null } : p)));
  }
  async function toggleHidden(p: PlaybookPlay) {
    setPlays((list) => list.map((x) => (x.id === p.id ? { ...x, hidden: !p.hidden } : x)));
    try { await setPlaybookPlayHidden(playbook.id, p.id, !p.hidden); }
    catch (e: any) { setLayoutError("Couldn't change that: " + (e?.message ?? e)); refresh(); }
  }

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>🎬 Walkthrough video</span>
          <button onClick={() => { setVideoDraft(playbook.video_url ?? ""); setEditingVideo((v) => !v); }}
            style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>
            {editingVideo ? "✕ Cancel" : playbook.video_url ? "Edit" : "+ Add video"}
          </button>
        </div>
        {editingVideo ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input value={videoDraft} onChange={(e) => setVideoDraft(e.target.value)} placeholder="YouTube URL" style={inputStyle} />
            <button onClick={saveVideo} disabled={savingVideo} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
              {savingVideo ? "Saving…" : "Save"}
            </button>
          </div>
        ) : getYouTubeId(playbook.video_url) ? (
          <div style={{ position: "relative", paddingTop: "56.25%", background: "#000", borderRadius: 10, overflow: "hidden" }}>
            <iframe src={`https://www.youtube.com/embed/${getYouTubeId(playbook.video_url)}?rel=0&modestbranding=1`} title={playbook.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>No video added yet.</div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Plays in this playbook</div>
        {visiblePlays.length > 0 && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onWatch(visiblePlays)} style={{ background: "var(--royal)", border: "none", color: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              ▶ Play all
            </button>
            <button onClick={() => onPrint(visiblePlays)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: "pointer" }}>
              🖨️ Print / export
            </button>
          </div>
        )}
      </div>
      {plays.length > 1 && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
          Drag a play (or use ▲▼) to reorder. 👁 hides a play from players until you're ready. Pick a section to group plays under a heading.
        </div>
      )}
      {layoutError && <div style={{ fontSize: 12, color: "#ff7b7b", marginBottom: 6 }}>{layoutError}</div>}
      {(() => {
        let n = 0;
        return groupBySection(plays).map((g, gi) => (
          <div key={`${g.section ?? ""}-${gi}`} style={{ marginBottom: 4 }}>
            {g.section && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 0 2px" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--gold)" }}>{g.section}</span>
                <button onClick={() => renameSection(g.section!)} title="Rename this section" style={miniBtn}>✎</button>
                <button onClick={() => clearSection(g.section!)} title="Remove this heading (the plays stay)" style={miniBtn}>✕</button>
              </div>
            )}
            {g.plays.map((p) => {
              const i = plays.indexOf(p);
              n += 1;
              return (
                <div key={p.id}
                  draggable
                  onDragStart={() => setDragId(p.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => { if (dragId && dragId !== p.id) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (dragId) dropBefore(dragId, p.id); setDragId(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", fontSize: 13, color: "var(--text)",
                    borderTop: "1px solid var(--border)", opacity: dragId === p.id ? 0.4 : 1 }}>
                  <span title="Drag to reorder" style={{ cursor: "grab", color: "var(--muted)", fontSize: 13, userSelect: "none" }}>⋮⋮</span>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" style={arrowBtn}>▲</button>
                    <button onClick={() => move(i, 1)} disabled={i === plays.length - 1} aria-label="Move down" style={arrowBtn}>▼</button>
                  </div>
                  <span style={{ width: 18, fontSize: 11, color: "var(--muted)", textAlign: "right" }}>{p.hidden ? "–" : n}</span>
                  <div style={{ flex: 1, minWidth: 0, opacity: p.hidden ? 0.5 : 1 }}>
                    {onOpenPlay ? (
                      // Checking a play is the thing you most want to do while building
                      // a playbook, so the title opens it rather than being dead text.
                      <button onClick={() => onOpenPlay(p)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", font: "inherit", fontSize: 13, color: "var(--text)", cursor: "pointer", textDecoration: p.hidden ? "line-through" : "underline", textDecorationColor: "var(--border)", textUnderlineOffset: 3 }}>
                        {p.title}
                      </button>
                    ) : (
                      <span style={{ textDecoration: p.hidden ? "line-through" : "none" }}>{p.title}</span>
                    )}
                    {p.hidden && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 5, padding: "0 5px" }}>HIDDEN</span>}
                  </div>
                  <select value={p.section ?? ""} onChange={(e) => pickSection(p.id, e.target.value)} title="Section"
                    style={{ maxWidth: 110, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--muted)", fontSize: 11, padding: "3px 4px", fontFamily: "inherit" }}>
                    <option value="">No section</option>
                    {sections.map((sec) => <option key={sec} value={sec}>{sec}</option>)}
                    <option value={NEW_SECTION}>+ New section…</option>
                  </select>
                  <button onClick={() => toggleHidden(p)} title={p.hidden ? "Hidden from players — tap to show" : "Visible to players — tap to hide"}
                    aria-label={p.hidden ? "Show to players" : "Hide from players"}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 6px", fontSize: 13, cursor: "pointer", opacity: p.hidden ? 0.55 : 1 }}>
                    {p.hidden ? "🙈" : "👁"}
                  </button>
                  <button onClick={() => removePlay(p.id)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>Remove</button>
                </div>
              );
            })}
          </div>
        ));
      })()}
      {plays.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No plays added yet.</div>}

      <button onClick={() => setShowAdd((v) => !v)} style={{ marginTop: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
        {showAdd ? "✕ Cancel" : "+ Add a play"}
      </button>
      {showAdd && (
        <div style={{ marginTop: 6 }}>
          {availablePlays.map((p) => (
            <button key={p.id} onClick={() => addPlay(p.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", marginBottom: 4, cursor: "pointer" }}>
              {p.title}
            </button>
          ))}
          {availablePlays.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No more of your plays to add.</div>}
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", margin: "14px 0 6px" }}>Assigned to</div>
      {shares.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>Not assigned to anyone yet.</div>}
      {playbook.status !== "active" && shares.length > 0 && (
        // Assigning while it's a draft looks like a finished action, and the
        // only hint otherwise was buried in the Publish confirmation.
        <div style={{ fontSize: 11.5, color: "var(--gold)", marginBottom: 4 }}>
          {playbook.status === "draft"
            ? "They can't see it yet — publish to make it visible."
            : "They can't see it — this playbook is archived."}
        </div>
      )}
      {shares.map((s: any) => (
        <div key={s.id} style={{ fontSize: 12, color: "var(--text)", padding: "3px 0" }}>
          {s.profiles?.name ?? "Player"} {s.viewed_at ? "· viewed" : "· not viewed yet"}
        </div>
      ))}
      <button onClick={() => setShowAssign((v) => !v)} style={{ marginTop: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
        {showAssign ? "✕ Cancel" : "Manage assignments"}
      </button>
      {showAssign && (
        <div style={{ marginTop: 6 }}>
          {/* Team rows tick and untick the checkboxes below rather than
              saving — this picker stages its changes behind Save. */}
          <RosterShareRows
            sharedWithIds={[...picked]}
            onAdd={(ids) => setPicked((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; })}
            onRemove={(ids) => setPicked((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; })}
          />
          {roster.map((r) => (
            <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12, color: "var(--text)" }}>
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} />
              {r.name}{r.jersey != null ? ` (#${r.jersey})` : ""}
            </label>
          ))}
          <button onClick={saveAssignments} style={{ marginTop: 8, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Save assignments
          </button>
        </div>
      )}
    </div>
  );
}
