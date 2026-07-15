// src/components/plays/PlayViewer.tsx
// Mobile-optimized viewer (player primary use). Browses "My plays",
// "Shared with me", and "My playbooks", then plays back a single play
// frame-by-frame. No drawing tools live here — see PlayEditor for that.

import { useState, useEffect } from "react";
import PlayCanvas from "./PlayCanvas";
import {
  Play, RosterPlayer, getMyPlays, getPlaysSharedWithMe, getMyAssignedPlaybooks,
  getPlaybookPlays, getPlayShares, revokePlayShare, markPlayViewed, markPlaybookViewed,
  forkPlay, getRoster, Playbook,
} from "../../lib/plays";

interface Props {
  onEdit?: (play: Play) => void;
  onCreateNew?: () => void;
}

type Tab = "mine" | "shared" | "playbooks";

export default function PlayViewer({ onEdit, onCreateNew }: Props) {
  const [tab, setTab] = useState<Tab>("mine");
  const [myPlays, setMyPlays] = useState<Play[]>([]);
  const [sharedPlays, setSharedPlays] = useState<(Play & { share_id: string; shared_by: string })[]>([]);
  const [playbooks, setPlaybooks] = useState<(Playbook & { share_id: string; viewed_at: string | null })[]>([]);
  const [openPlay, setOpenPlay] = useState<Play | null>(null);
  const [openShareId, setOpenShareId] = useState<string | null>(null);
  const [openPlaybook, setOpenPlaybook] = useState<{ pb: Playbook & { share_id: string }; plays: Play[] } | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [toast, setToast] = useState("");

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

  const rosterMap: Record<string, RosterPlayer> = Object.fromEntries(roster.map((r) => [r.id, r]));

  if (openPlay) {
    return (
      <PlayDetail
        play={openPlay}
        shareId={openShareId}
        rosterMap={rosterMap}
        canManageShares={myPlays.some((p) => p.id === openPlay.id)}
        onBack={() => { setOpenPlay(null); setOpenShareId(null); }}
        onEdit={onEdit}
        onFork={handleFork}
      />
    );
  }

  if (openPlaybook) {
    return (
      <div>
        <button onClick={() => setOpenPlaybook(null)} style={{ marginBottom: 10 }}>← Back</button>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>{openPlaybook.pb.name}</h2>
        {openPlaybook.pb.description && <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{openPlaybook.pb.description}</p>}
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
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button onClick={() => setTab("mine")} style={{ flex: 1, padding: 10, border: tab === "mine" ? "2px solid var(--gold)" : "1px solid var(--border)" }}>My plays</button>
        <button onClick={() => setTab("shared")} style={{ flex: 1, padding: 10, border: tab === "shared" ? "2px solid var(--gold)" : "1px solid var(--border)" }}>Shared with me</button>
        <button onClick={() => setTab("playbooks")} style={{ flex: 1, padding: 10, border: tab === "playbooks" ? "2px solid var(--gold)" : "1px solid var(--border)" }}>Playbooks</button>
      </div>

      {tab === "mine" && (
        <>
          {onCreateNew && <button onClick={onCreateNew} style={{ width: "100%", padding: 12, marginBottom: 10, border: "2px solid var(--gold)", color: "var(--gold)" }}>+ Draw a new play</button>}
          {myPlays.map((p) => (
            <button key={p.id} onClick={() => setOpenPlay(p)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: 6, border: "1px solid var(--border)", borderRadius: "8px" }}>
              {p.title}
              {p.tags.length > 0 && <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>{p.tags.join(", ")}</span>}
            </button>
          ))}
          {myPlays.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No plays yet.</p>}
        </>
      )}

      {tab === "shared" && (
        <>
          {sharedPlays.map((p) => (
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

function PlayDetail({ play, shareId, rosterMap, canManageShares, onBack, onEdit, onFork }: {
  play: Play; shareId: string | null; rosterMap: Record<string, RosterPlayer>; canManageShares: boolean;
  onBack: () => void; onEdit?: (p: Play) => void; onFork: (p: Play) => void;
}) {
  const [frameIdx, setFrameIdx] = useState(0);
  const [playSignal, setPlaySignal] = useState(0);
  const [shares, setShares] = useState<any[]>([]);
  const [showShares, setShowShares] = useState(false);
  const frame = play.data.frames[frameIdx];

  useEffect(() => { if (canManageShares) getPlayShares(play.id).then(setShares).catch(console.error); }, [canManageShares, play.id]);

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

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 10 }}>← Back</button>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>{play.title}</h2>

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

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {play.data.frames.length > 1 && play.data.frames.map((_, i) => (
          <button key={i} onClick={() => setFrameIdx(i)} style={{ padding: "6px 10px", border: i === frameIdx ? "2px solid var(--gold)" : "1px solid var(--border)" }}>
            Beat {i + 1}
          </button>
        ))}
        <button onClick={() => { setFrameIdx(0); playAll(); }} style={{ padding: "8px 14px", border: "2px solid var(--gold)", color: "var(--gold)", marginLeft: "auto" }}>▶ Watch play</button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onFork(play)} style={{ padding: "8px 12px" }}>Duplicate as my own</button>
        {onEdit && canManageShares && <button onClick={() => onEdit(play)} style={{ padding: "8px 12px" }}>Edit</button>}
        {canManageShares && <button onClick={() => setShowShares((v) => !v)} style={{ padding: "8px 12px" }}>Manage sharing</button>}
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
        </div>
      )}
    </div>
  );
}
