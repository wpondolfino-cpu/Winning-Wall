// src/components/plays/PlayViewer.tsx
// Mobile-optimized viewer (player primary use). Browses "My plays",
// "Shared with me", and "My playbooks", then plays back a single play
// frame-by-frame. No drawing tools live here — see PlayEditor for that.

import { useState, useEffect, lazy, Suspense, Component, type ComponentType, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { getProfile } from "../../lib/auth";
import PlayCanvas from "./PlayCanvas";
import PlayPrintView from "./PlayPrintView";
import {
  Play, RosterPlayer, getMyPlays, getPlaysSharedWithMe, getMyAssignedPlaybooks,
  getPlaybookPlays, getPlayShares, revokePlayShare, markPlayViewed, markPlaybookViewed,
  forkPlay, getRoster, Playbook, deletePlay, getStaff, sharePlay, PlayShareTarget,
} from "../../lib/plays";

// Lazy-loaded: three.js is a large dependency, and most people watching a
// play never open the 3D view — this keeps it out of everyone's initial
// page load and only fetches it the first time "Watch in 3D" is clicked.
// Typed explicitly (rather than relying on lazy()'s inference through the
// dynamic import) since that inference wasn't resolving Play3DViewer's
// actual props correctly.
const Play3DViewer = lazy(() => import("./Play3DViewer")) as unknown as ComponentType<{
  play: Play;
  roster: Record<string, RosterPlayer>;
  onBack: () => void;
  selfOverride?: { playerId: string; avatarUrl: string | null } | null;
}>;

interface Props {
  currentUserRole?: "player" | "coach" | "admin";
  onEdit?: (play: Play) => void;
  onCreateNew?: () => void;
}

type Tab = "mine" | "shared" | "playbooks";

// Catches any runtime error inside the 3D viewer and shows it directly,
// instead of an unexplained blank/wrong screen if something in there throws.
const STALE_CHUNK_RELOAD_KEY = "ww_3d_stale_chunk_reload";

function isStaleChunkError(message: string): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(message || "");
}

class ThreeDErrorBoundary extends Component<{ children: ReactNode; onBack: () => void }, { error: Error | null }> {
  constructor(props: { children: ReactNode; onBack: () => void }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) {
    console.error("3D viewer crashed:", error, info);
    // A stale chunk means the page was open from before a newer deploy
    // replaced this file's build output — the fix is just a fresh page
    // load, not a real error. Reload once automatically; the sessionStorage
    // flag survives that reload, so if the same error comes right back
    // we know reloading didn't help and fall through to the real error
    // message instead of looping forever.
    if (isStaleChunkError(error.message) && !sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, "1");
      window.location.reload();
    }
  }
  render() {
    if (this.state.error) {
      if (isStaleChunkError(this.state.error.message) && !sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) {
        // componentDidCatch already kicked off the reload — this only shows
        // for the brief moment before the browser actually navigates.
        return (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            Updating to the latest version…
          </div>
        );
      }
      return (
        <div style={{ padding: 20 }}>
          <button onClick={this.props.onBack} style={{ padding: "8px 14px", marginBottom: 12 }}>← Back to 2D</button>
          <p style={{ color: "#ff7b7b", fontSize: 13 }}>The 3D view hit an error: {this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function filterPlays<T extends { title: string; tags: string[] }>(plays: T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return plays;
  return plays.filter((p) => p.title.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)));
}

export default function PlayViewer({ currentUserRole, onEdit, onCreateNew }: Props) {
  const [tab, setTab] = useState<Tab>("mine");
  const [myPlays, setMyPlays] = useState<Play[]>([]);
  const [sharedPlays, setSharedPlays] = useState<(Play & { share_id: string; shared_by: string })[]>([]);
  const [playbooks, setPlaybooks] = useState<(Playbook & { share_id: string; viewed_at: string | null })[]>([]);
  const [openPlay, setOpenPlay] = useState<Play | null>(null);
  const [openIn3D, setOpenIn3D] = useState(false);
  const [sharePopupPlay, setSharePopupPlay] = useState<Play | null>(null);
  const [openShareId, setOpenShareId] = useState<string | null>(null);
  const [openPlaybook, setOpenPlaybook] = useState<{ pb: Playbook & { share_id: string }; plays: Play[] } | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [toast, setToast] = useState("");

  const [printPlays, setPrintPlays] = useState<{ plays: Play[]; playbookName?: string } | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => { load(); getRoster().then(setRoster).catch(console.error); }, []);

  async function load() {
    const [mine, shared, pbs] = await Promise.all([getMyPlays(), getPlaysSharedWithMe(), getMyAssignedPlaybooks()]);
    setMyPlays(mine); setSharedPlays(shared); setPlaybooks(pbs);
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  async function openSharedPlay(p: Play & { share_id: string }) {
    setOpenPlay(p);
    setOpenShareId(p.share_id);
    markPlayViewed(p.share_id);
  }

  async function openPlaybookDetail(pb: Playbook & { share_id: string; viewed_at: string | null }) {
    const plays = await getPlaybookPlays(pb.id);
    setOpenPlaybook({ pb, plays });
    if (!pb.viewed_at) markPlaybookViewed(pb.share_id);
  }

  async function handleFork(p: Play) {
    try {
      const copy = await forkPlay(p);
      showToast("Duplicated to My Plays");
      await load();
      onEdit?.(copy);
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  async function handleDeleteFromList(p: Play) {
    if (!window.confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    try {
      await deletePlay(p.id);
      await load();
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  const rosterMap: Record<string, RosterPlayer> = Object.fromEntries(roster.map((r) => [r.id, r]));

  if (printPlays) {
    return <PlayPrintView plays={printPlays.plays} playbookName={printPlays.playbookName} roster={rosterMap} onBack={() => setPrintPlays(null)} />;
  }

  if (openPlay) {
    return (
      <PlayDetail
        play={openPlay}
        shareId={openShareId}
        rosterMap={rosterMap}
        canManageShares={myPlays.some((p) => p.id === openPlay.id)}
        startIn3D={openIn3D}
        onBack={() => { setOpenPlay(null); setOpenShareId(null); setOpenIn3D(false); }}
        onEdit={onEdit}
        onFork={handleFork}
        onPrint={() => setPrintPlays({ plays: [openPlay] })}
        onDeleted={async () => {
          try {
            await deletePlay(openPlay.id);
            await load();
            setOpenPlay(null);
            setOpenShareId(null);
          } catch (e: any) { showToast("Error: " + e.message); }
        }}
      />
    );
  }

  if (openPlaybook) {
    return (
      <div>
        <button onClick={() => setOpenPlaybook(null)} style={{ marginBottom: 10 }}>← Back</button>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>{openPlaybook.pb.name}</h2>
        {openPlaybook.pb.description && <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{openPlaybook.pb.description}</p>}
        {openPlaybook.plays.length > 0 && (
          <button onClick={() => setPrintPlays({ plays: openPlaybook.plays, playbookName: openPlaybook.pb.name })} style={{ marginBottom: 10, padding: "6px 12px" }}>
            🖨️ Print / export this playbook
          </button>
        )}
        {openPlaybook.plays.map((p) => (
          <button key={p.id} onClick={() => setOpenPlay(p)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 6, border: "1px solid var(--border)", borderRadius: "8px" }}>
            {p.title}
          </button>
        ))}
        {openPlaybook.plays.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No plays in this playbook yet.</p>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 12, padding: 5, marginBottom: 20, border: "1px solid var(--border)" }}>
        <button onClick={() => setTab("mine")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: tab === "mine" ? "var(--royal)" : "transparent", color: tab === "mine" ? "#fff" : "var(--muted)", transition: "all .2s" }}>My plays</button>
        <button onClick={() => setTab("shared")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: tab === "shared" ? "var(--royal)" : "transparent", color: tab === "shared" ? "#fff" : "var(--muted)", transition: "all .2s" }}>Shared with me</button>
        {currentUserRole !== "coach" && currentUserRole !== "admin" && (
          <button onClick={() => setTab("playbooks")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: tab === "playbooks" ? "var(--royal)" : "transparent", color: tab === "playbooks" ? "#fff" : "var(--muted)", transition: "all .2s" }}>Playbooks</button>
        )}
      </div>

      {(tab === "mine" || tab === "shared") && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or tag (inbounds, press break, BLOB...)"
          style={{ width: "100%", marginBottom: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
        />
      )}

      {tab === "mine" && (
        <>
          {onCreateNew && <button onClick={onCreateNew} className="coach-add-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}>+ Draw a new play</button>}
          {filterPlays(myPlays, search).map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, border: "1px solid var(--border)", borderRadius: 8 }}>
              <button onClick={() => setOpenPlay(p)} style={{ flex: 1, textAlign: "left", padding: "10px 12px", background: "none", border: "none", color: "var(--text)", cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>
                {p.title}
                {p.tags.length > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    {p.tags.map((tag) => (
                      <span
                        key={tag}
                        onClick={(e) => { e.stopPropagation(); setSearch(tag); }}
                        style={{ fontSize: 11, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px", marginRight: 4, cursor: "pointer" }}
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              <button title="Watch live" onClick={() => { setOpenPlay(p); setOpenIn3D(true); }} style={{ padding: "8px 10px", fontSize: 15, marginRight: 2 }}>🧊</button>
              <button title="Share" onClick={() => setSharePopupPlay(p)} style={{ padding: "8px 10px", fontSize: 15, marginRight: 2, display: "inline-flex", alignItems: "center" }}><ShareIcon /></button>
              <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "4px 4px" }} />
              {onEdit && <button title="Edit" onClick={() => onEdit(p)} style={{ padding: "8px 10px", fontSize: 15, marginRight: 2 }}>✏️</button>}
              <button title="Delete" onClick={() => handleDeleteFromList(p)} style={{ padding: "8px 10px", fontSize: 15, marginRight: 6 }}>🗑</button>
            </div>
          ))}
          {myPlays.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No plays yet.</p>}
          {myPlays.length > 0 && filterPlays(myPlays, search).length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No plays match "{search}".</p>}
        </>
      )}

      {tab === "shared" && (
        <>
          {filterPlays(sharedPlays, search).map((p) => (
            <button key={p.share_id} onClick={() => openSharedPlay(p)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 6, border: "1px solid var(--border)", borderRadius: "8px" }}>
              {p.title}
            </button>
          ))}
          {sharedPlays.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Nothing shared with you yet.</p>}
        </>
      )}

      {tab === "playbooks" && (
        <>
          {playbooks.map((pb) => (
            <button key={pb.share_id} onClick={() => openPlaybookDetail(pb)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 6, border: "1px solid var(--border)", borderRadius: "8px" }}>
              {pb.name} {!pb.viewed_at && <span style={{ fontSize: 11, color: "var(--gold)" }}>● new</span>}
            </button>
          ))}
          {playbooks.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No playbooks assigned yet.</p>}
        </>
      )}

      {toast && <p style={{ fontSize: 13, color: "var(--gold)", marginTop: 8 }}>{toast}</p>}
      {sharePopupPlay && <SharePopup play={sharePopupPlay} onClose={() => setSharePopupPlay(null)} />}
    </div>
  );
}

function PlayDetail({ play, shareId, rosterMap, canManageShares, onBack, onEdit, onFork, onPrint, onDeleted, startIn3D }: {
  play: Play; shareId: string | null; rosterMap: Record<string, RosterPlayer>; canManageShares: boolean;
  onBack: () => void; onEdit?: (p: Play) => void; onFork: (p: Play) => void; onPrint: () => void; onDeleted: () => void;
  startIn3D?: boolean;
}) {
  const [frameIdx, setFrameIdx] = useState(0);
  const [playSignal, setPlaySignal] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [show3D, setShow3D] = useState(!!startIn3D);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(() => {
    try { return localStorage.getItem(`ww_self_${play.id}`); } catch { return null; }
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      getProfile(data.user.id).then((p) => setMyAvatarUrl(p?.avatar_url ?? null));
    });
  }, []);

  function chooseSelf(playerId: string | null) {
    setSelfPlayerId(playerId);
    try {
      if (playerId) localStorage.setItem(`ww_self_${play.id}`, playerId);
      else localStorage.removeItem(`ww_self_${play.id}`);
    } catch { /* localStorage unavailable — the choice just won't persist across visits */ }
  }
  const selfOverride = selfPlayerId ? { playerId: selfPlayerId, avatarUrl: myAvatarUrl } : null;
  const [showSharePopup, setShowSharePopup] = useState(false);
  const frame = play.data.frames[frameIdx];

  function playAll() {
    // Simple sequential playback: play current beat, then auto-advance.
    setPlaySignal((s) => s + 1);
  }

  function handleAnimDone() {
    if (frameIdx < play.data.frames.length - 1) {
      setFrameIdx((i) => i + 1);
      setTimeout(() => setPlaySignal((s) => s + 1), 150 / speed);
    }
  }

  if (show3D) {
    return (
      <ThreeDErrorBoundary onBack={() => setShow3D(false)}>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading 3D view…</div>}>
          <Play3DViewer play={play} roster={rosterMap} onBack={() => setShow3D(false)} selfOverride={selfOverride} />
        </Suspense>
      </ThreeDErrorBoundary>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{play.title}</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <button onClick={onBack} style={{ padding: "8px 10px", fontSize: 13, flexShrink: 0 }}>← Back</button>
        <button onClick={() => { setFrameIdx(0); playAll(); }} className="coach-add-btn" style={{ flex: 1, justifyContent: "center", padding: "8px 6px", fontSize: 13 }}>▶ Watch play</button>
        <button onClick={() => setShow3D(true)} className="coach-add-btn" style={{ flex: 1, justifyContent: "center", padding: "8px 6px", fontSize: 13 }}>🧊 Watch live</button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Speed</span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          style={{ padding: "5px 8px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "inherit", outline: "none" }}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </div>

      <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
        <PlayCanvas
          frame={frame}
          courtTemplate={play.court_template}
          avatarsDefault={play.data.avatarsDefault}
          roster={rosterMap}
          edit={false}
          playSignal={playSignal}
          onPlayDone={handleAnimDone}
          speed={speed}
          selfOverride={selfOverride}
        />
      </div>

      {play.data.frames.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {play.data.frames.map((_, i) => (
            <button key={i} onClick={() => setFrameIdx(i)} style={{ padding: "6px 10px", border: i === frameIdx ? "2px solid var(--gold)" : "1px solid var(--border)" }}>
              Step {i + 1}
            </button>
          ))}
        </div>
      )}

      {(play.data.frames[0]?.players.length ?? 0) > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>🙋 Watch as yourself — pick which player is you (only changes what you see)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => chooseSelf(null)} style={{ padding: "6px 10px", fontSize: 12, border: !selfPlayerId ? "2px solid var(--gold)" : "1px solid var(--border)" }}>None</button>
            {play.data.frames[0].players.map((p) => p.id && (
              <button key={p.id} onClick={() => chooseSelf(p.id!)} style={{ padding: "6px 10px", fontSize: 12, border: selfPlayerId === p.id ? "2px solid var(--gold)" : "1px solid var(--border)" }}>
                #{p.num}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onFork(play)} style={{ padding: "8px 12px" }}>Duplicate as my own</button>
        <button onClick={onPrint} style={{ padding: "8px 12px" }}>🖨️ Print / export</button>
        {onEdit && canManageShares && <button onClick={() => onEdit(play)} style={{ padding: "8px 12px" }}>Edit</button>}
        {canManageShares && <button onClick={() => setShowSharePopup(true)} style={{ padding: "8px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}><ShareIcon /> Manage sharing</button>}
        {canManageShares && (
          <button
            onClick={() => { if (window.confirm(`Delete "${play.title}"? This can't be undone.`)) onDeleted(); }}
            style={{ padding: "8px 12px", color: "#ff7b7b" }}
          >
            🗑 Delete play
          </button>
        )}
      </div>

      {showSharePopup && <SharePopup play={play} onClose={() => setShowSharePopup(false)} />}
    </div>
  );
}

// A "person + plus" glyph, clearer than a chain-link for "share/add someone".
function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
      <circle cx="10" cy="7" r="4" />
      <path d="M2 20c0-4 3.5-7 8-7s8 3 8 7" />
      <circle cx="19" cy="17" r="4.5" fill="var(--surface2)" stroke="currentColor" strokeWidth="1.6" />
      <path d="M19 14.7v4.6M16.7 17h4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// A Google-Docs-style share dialog — pick people to add, see who already has
// access, remove them — without navigating away from wherever you are.
function SharePopup({ play, onClose }: { play: Play; onClose: () => void }) {
  const [shares, setShares] = useState<any[]>([]);
  const [targets, setTargets] = useState<PlayShareTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([getPlayShares(play.id), getStaff(), getRoster()]).then(([s, staff, roster]) => {
      setShares(s);
      setTargets([...staff, ...roster.map((r) => ({ id: r.id, name: r.name }))]);
      setLoading(false);
    }).catch(console.error);
  }, [play.id]);

  async function handleAdd(targetId: string) {
    try {
      await sharePlay(play.id, targetId);
      setShares(await getPlayShares(play.id));
      setQuery("");
    } catch (e: any) { console.error(e); }
  }
  async function handleRevoke(shareId: string) {
    await revokePlayShare(shareId);
    setShares((sh) => sh.filter((x) => x.id !== shareId));
  }

  const q = query.trim().toLowerCase();
  const matches = q
    ? targets.filter((t) => !shares.some((s) => s.shared_with === t.id) && t.name.toLowerCase().includes(q))
    : [];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, margin: 0, display: "flex", alignItems: "center", gap: 8 }}><ShareIcon /> Share "{play.title}"</h3>
          <button onClick={onClose} style={{ padding: "4px 10px" }}>✕</button>
        </div>

        <div style={{ position: "relative", marginBottom: 16 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a name to add someone…"
            style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
          />
          {q && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto", zIndex: 10 }}>
              {matches.map((t) => (
                <button key={t.id} onClick={() => handleAdd(t.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 13 }}>
                  {t.name}
                </button>
              ))}
              {matches.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)", padding: "8px 10px", margin: 0 }}>No matches.</p>}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, fontWeight: 600 }}>People with access</div>
        {loading && <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</p>}
        {!loading && shares.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Not shared with anyone yet.</p>}
        {shares.map((s) => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", fontSize: 13, borderBottom: "1px solid var(--border)" }}>
            <span>{s.profiles?.name ?? "Someone"} <span style={{ color: "var(--muted)", fontSize: 11 }}>{s.viewed_at ? "· viewed" : "· not viewed yet"}</span></span>
            <button onClick={() => handleRevoke(s.id)} style={{ fontSize: 12, padding: "4px 10px" }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
