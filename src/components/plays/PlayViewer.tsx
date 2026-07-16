// src/components/plays/PlayViewer.tsx
// Mobile-optimized viewer (player primary use). Browses "My plays",
// "Shared with me", and "My playbooks", then plays back a single play
// frame-by-frame. No drawing tools live here — see PlayEditor for that.

import { useState, useEffect, lazy, Suspense, type ComponentType } from "react";
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
}>;

interface Props {
  currentUserRole?: "player" | "coach" | "admin";
  onEdit?: (play: Play) => void;
  onCreateNew?: () => void;
}

type Tab = "mine" | "shared" | "playbooks";

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
  const [openSharesDirect, setOpenSharesDirect] = useState(false);
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
        startWithSharesOpen={openSharesDirect}
        onBack={() => { setOpenPlay(null); setOpenShareId(null); setOpenIn3D(false); setOpenSharesDirect(false); }}
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
                {p.tags.length > 0 && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>{p.tags.join(", ")}</span>}
              </button>
              <button title="Watch in 3D" onClick={() => { setOpenPlay(p); setOpenIn3D(true); }} style={{ padding: "6px 8px", fontSize: 13 }}>🧊</button>
              <button title="Share" onClick={() => { setOpenPlay(p); setOpenSharesDirect(true); }} style={{ padding: "6px 8px", fontSize: 13 }}>🔗</button>
              {onEdit && <button title="Edit" onClick={() => onEdit(p)} style={{ padding: "6px 8px", fontSize: 13 }}>✏️</button>}
              <button title="Delete" onClick={() => handleDeleteFromList(p)} style={{ padding: "6px 8px", fontSize: 13, marginRight: 4 }}>🗑</button>
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
    </div>
  );
}

function PlayDetail({ play, shareId, rosterMap, canManageShares, onBack, onEdit, onFork, onPrint, onDeleted, startIn3D, startWithSharesOpen }: {
  play: Play; shareId: string | null; rosterMap: Record<string, RosterPlayer>; canManageShares: boolean;
  onBack: () => void; onEdit?: (p: Play) => void; onFork: (p: Play) => void; onPrint: () => void; onDeleted: () => void;
  startIn3D?: boolean; startWithSharesOpen?: boolean;
}) {
  const [frameIdx, setFrameIdx] = useState(0);
  const [playSignal, setPlaySignal] = useState(0);
  const [shares, setShares] = useState<any[]>([]);
  const [showShares, setShowShares] = useState(!!startWithSharesOpen);
  const [show3D, setShow3D] = useState(!!startIn3D);
  const [shareTargets, setShareTargets] = useState<PlayShareTarget[]>([]);
  const [addingShare, setAddingShare] = useState(false);
  const frame = play.data.frames[frameIdx];

  useEffect(() => { if (canManageShares) getPlayShares(play.id).then(setShares).catch(console.error); }, [canManageShares, play.id]);

  useEffect(() => {
    if (!showShares || shareTargets.length > 0) return;
    // Anyone the play can be shared with — staff and roster players alike.
    Promise.all([getStaff(), getRoster()]).then(([staff, roster]) => {
      setShareTargets([...staff, ...roster.map((r) => ({ id: r.id, name: r.name }))]);
    }).catch(console.error);
  }, [showShares, shareTargets.length]);

  async function handleAddShare(targetId: string) {
    try {
      await sharePlay(play.id, targetId);
      const updated = await getPlayShares(play.id);
      setShares(updated);
      setAddingShare(false);
    } catch (e: any) { console.error(e); }
  }

  function playAll() {
    // Simple sequential playback: play current beat, then auto-advance.
    setPlaySignal((s) => s + 1);
  }

  function handleAnimDone() {
    if (frameIdx < play.data.frames.length - 1) {
      setFrameIdx((i) => i + 1);
      setTimeout(() => setPlaySignal((s) => s + 1), 150);
    }
  }

  if (show3D) {
    return (
      <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading 3D view…</div>}>
        <Play3DViewer play={play} roster={rosterMap} onBack={() => setShow3D(false)} />
      </Suspense>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ padding: "8px 12px" }}>← Back</button>
        <h2 style={{ fontSize: 18, margin: 0, flex: "1 1 auto", minWidth: 120 }}>{play.title}</h2>
        <button onClick={() => { setFrameIdx(0); playAll(); }} className="coach-add-btn">▶ Watch play</button>
        <button onClick={() => setShow3D(true)} className="coach-add-btn">🧊 Watch in 3D</button>
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onFork(play)} style={{ padding: "8px 12px" }}>Duplicate as my own</button>
        <button onClick={onPrint} style={{ padding: "8px 12px" }}>🖨️ Print / export</button>
        {onEdit && canManageShares && <button onClick={() => onEdit(play)} style={{ padding: "8px 12px" }}>Edit</button>}
        {canManageShares && <button onClick={() => setShowShares((v) => !v)} style={{ padding: "8px 12px" }}>Manage sharing</button>}
        {canManageShares && (
          <button
            onClick={() => { if (window.confirm(`Delete "${play.title}"? This can't be undone.`)) onDeleted(); }}
            style={{ padding: "8px 12px", color: "#ff7b7b" }}
          >
            🗑 Delete play
          </button>
        )}
      </div>

      {showShares && (
        <div style={{ marginTop: 10, padding: 10, background: "var(--surface2)", borderRadius: "8px" }}>
          {shares.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 13 }}>
              <span>{s.profiles?.name ?? "Someone"} {s.viewed_at ? "· viewed" : "· not viewed yet"}</span>
              <button onClick={async () => { await revokePlayShare(s.id); setShares((sh) => sh.filter((x) => x.id !== s.id)); }} style={{ fontSize: 12, padding: "4px 8px" }}>Revoke</button>
            </div>
          ))}
          {shares.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Not shared with anyone.</p>}

          <button onClick={() => setAddingShare((v) => !v)} style={{ fontSize: 12, padding: "5px 10px", marginTop: 6 }}>
            {addingShare ? "✕ Cancel" : "+ Share with someone"}
          </button>
          {addingShare && (
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto" }}>
              {shareTargets.filter((t) => !shares.some((s) => s.shared_with === t.id)).map((t) => (
                <button key={t.id} onClick={() => handleAddShare(t.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 12, marginBottom: 4 }}>
                  {t.name}
                </button>
              ))}
              {shareTargets.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
