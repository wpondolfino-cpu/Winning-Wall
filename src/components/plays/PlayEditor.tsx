// src/components/plays/PlayEditor.tsx
// Desktop-optimized play editor (coach/admin primary use, but also used by
// players drawing up their own plays — same component, access is governed
// by RLS on the plays table, not by role checks here).

import { useState, useEffect, useCallback } from "react";
import PlayCanvas, { CANVAS_W, CANVAS_H } from "./PlayCanvas";
import {
  Play, PlayData, PlayFrame, PlayPlayer, PlayAction, ActionType,
  CourtTemplate, COURT_TEMPLATES, COURT_TEMPLATE_LABELS,
  SavedAction, RosterPlayer, PlayShareTarget,
  emptyPlayData, createPlay, updatePlay,
  getMySavedActions, createSavedAction, deleteSavedAction,
  getRoster, getStaff, sharePlay,
} from "../../lib/plays";

interface Props {
  /** Pass an existing play to edit it; omit to start a new blank play. */
  existingPlay?: Play;
  /** "player" sees a "share with coach" option; "coach"/"admin" don't need it here (they use Playbooks instead). */
  currentUserRole: "player" | "coach" | "admin";
  onSaved?: (play: Play) => void;
  onClose?: () => void;
}

type Tool = "player" | "defender" | "ball" | ActionType | "erase" | null;

const TOOL_LABELS: { tool: Tool; label: string; icon: string }[] = [
  { tool: "player", label: "Player", icon: "⬤" },
  { tool: "defender", label: "Defender", icon: "✕" },
  { tool: "ball", label: "Ball", icon: "●" },
  { tool: "move", label: "Cut", icon: "→" },
  { tool: "pass", label: "Pass", icon: "┄" },
  { tool: "dribble", label: "Dribble", icon: "〜" },
  { tool: "screen", label: "Screen", icon: "⊥" },
  { tool: "erase", label: "Erase", icon: "⌫" },
];

function cloneFrames(frames: PlayFrame[]): PlayFrame[] { return JSON.parse(JSON.stringify(frames)); }

export default function PlayEditor({ existingPlay, currentUserRole, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(existingPlay?.title ?? "");
  const [tagsInput, setTagsInput] = useState((existingPlay?.tags ?? []).join(", "));
  const [courtTemplate, setCourtTemplate] = useState<CourtTemplate>(existingPlay?.court_template ?? "half");
  const [avatarsDefault, setAvatarsDefault] = useState(existingPlay?.data?.avatarsDefault ?? false);
  const [frames, setFrames] = useState<PlayFrame[]>(existingPlay?.data?.frames ?? emptyPlayData().frames);
  const [frameIdx, setFrameIdx] = useState(0);
  const [tool, setTool] = useState<Tool>("player");
  const [history, setHistory] = useState<PlayFrame[][]>([]);
  const [future, setFuture] = useState<PlayFrame[][]>([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [playSignal, setPlaySignal] = useState(0);

  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [savedActions, setSavedActions] = useState<SavedAction[]>([]);
  const [stampAction, setStampAction] = useState<SavedAction | null>(null);
  const [staff, setStaff] = useState<PlayShareTarget[]>([]);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => {
    getRoster().then(setRoster).catch(console.error);
    getMySavedActions().then(setSavedActions).catch(console.error);
    if (currentUserRole === "player") getStaff().then(setStaff).catch(console.error);
  }, [currentUserRole]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  const frame = frames[frameIdx];

  function pushHistory() {
    setHistory((h) => [...h.slice(-49), cloneFrames(frames)]);
    setFuture([]);
  }

  function updateFrame(mutator: (f: PlayFrame) => PlayFrame) {
    setFrames((fr) => fr.map((f, i) => (i === frameIdx ? mutator(f) : f)));
  }

  function undo() {
    if (!history.length) return;
    setFuture((f) => [...f, cloneFrames(frames)]);
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setFrames(prev);
  }
  function redo() {
    if (!future.length) return;
    setHistory((h) => [...h, cloneFrames(frames)]);
    const next = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setFrames(next);
  }

  const addPlayer = useCallback((p: PlayPlayer) => { pushHistory(); updateFrame((f) => ({ ...f, players: [...f.players, p] })); }, [frames, frameIdx]);
  const addDefender = useCallback((x: number, y: number) => { pushHistory(); updateFrame((f) => ({ ...f, defenders: [...f.defenders, { x, y }] })); }, [frames, frameIdx]);
  const setBall = useCallback((x: number, y: number) => { pushHistory(); updateFrame((f) => ({ ...f, ball: { x, y } })); }, [frames, frameIdx]);
  const addAction = useCallback((a: PlayAction) => { pushHistory(); updateFrame((f) => ({ ...f, actions: [...f.actions, a] })); }, [frames, frameIdx]);
  const toggleAvatar = useCallback((idx: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, players: f.players.map((p, i) => i === idx ? { ...p, showAvatar: !(p.showAvatar ?? avatarsDefault) } : p) }));
  }, [frames, frameIdx, avatarsDefault]);

  function eraseNear(x: number, y: number) {
    pushHistory();
    const near = (a: { x: number; y: number }, r: number) => Math.hypot(a.x - x, a.y - y) < r;
    updateFrame((f) => ({
      players: f.players.filter((p) => !near(p, 16)),
      defenders: f.defenders.filter((d) => !near(d, 16)),
      ball: f.ball && near(f.ball, 12) ? null : f.ball,
      actions: f.actions.filter((a) => !near({ x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 }, 14)),
    }));
  }

  function addFrame() {
    pushHistory();
    const last = frames[frames.length - 1];
    const copy: PlayFrame = { players: JSON.parse(JSON.stringify(last.players)), defenders: JSON.parse(JSON.stringify(last.defenders)), ball: last.ball ? { ...last.ball } : null, actions: [] };
    setFrames((fr) => [...fr, copy]);
    setFrameIdx(frames.length);
  }
  function deleteFrame(i: number) {
    if (frames.length <= 1) return;
    pushHistory();
    setFrames((fr) => fr.filter((_, idx) => idx !== i));
    setFrameIdx((idx) => Math.max(0, idx >= i ? idx - 1 : idx));
  }

  function assignRoster(playerIdx: number, profileId: string) {
    updateFrame((f) => ({ ...f, players: f.players.map((p, i) => i === playerIdx ? { ...p, profile_id: profileId || null } : p) }));
  }

  async function saveCurrentFrameAsAction() {
    const name = window.prompt("Name this action (e.g. \"Flare screen\")");
    if (!name) return;
    try {
      const saved = await createSavedAction(name, frame);
      setSavedActions((a) => [saved, ...a]);
      showToast(`Saved "${name}"`);
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  function stampActionAt(action: SavedAction, x: number, y: number) {
    pushHistory();
    const d = action.data;
    // Anchor to the first available point in the saved action so the stamp
    // lands with that point under the click.
    const anchor = d.players[0] ?? d.ball ?? d.defenders[0] ?? (d.actions[0] ? { x: d.actions[0].x1, y: d.actions[0].y1 } : { x: 0, y: 0 });
    const dx = x - anchor.x, dy = y - anchor.y;
    const baseCount = frame.players.length;
    updateFrame((f) => ({
      players: [...f.players, ...d.players.map((p, i) => ({ ...p, x: p.x + dx, y: p.y + dy, num: ((baseCount + i) % 5) + 1 }))],
      defenders: [...f.defenders, ...d.defenders.map((def) => ({ x: def.x + dx, y: def.y + dy }))],
      ball: f.ball ?? (d.ball ? { x: d.ball.x + dx, y: d.ball.y + dy } : null),
      actions: [...f.actions, ...d.actions.map((a) => ({ ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy }))],
    }));
    setStampAction(null);
  }

  async function handleSave() {
    if (!title.trim()) { showToast("Give the play a title first"); return; }
    setSaving(true);
    const data: PlayData = { avatarsDefault, frames };
    const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      if (existingPlay) {
        await updatePlay(existingPlay.id, { title: title.trim(), tags, court_template: courtTemplate, data });
        showToast("Saved");
        onSaved?.({ ...existingPlay, title: title.trim(), tags, court_template: courtTemplate, data });
      } else {
        const created = await createPlay({ title: title.trim(), tags, court_template: courtTemplate, data });
        showToast("Play saved");
        onSaved?.(created);
      }
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setSaving(false); }
  }

  async function handleShare(staffId: string) {
    if (!existingPlay) { showToast("Save the play first, then share it"); return; }
    try {
      await sharePlay(existingPlay.id, staffId);
      showToast("Shared");
      setShowShare(false);
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  const rosterMap: Record<string, RosterPlayer> = Object.fromEntries(roster.map((r) => [r.id, r]));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16 }}>
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Play title"
            style={{ flex: "1 1 200px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          <select value={courtTemplate} onChange={(e) => setCourtTemplate(e.target.value as CourtTemplate)}
            style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
            {COURT_TEMPLATES.map((c) => <option key={c} value={c}>{COURT_TEMPLATE_LABELS[c]}</option>)}
          </select>
        </div>
        <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Tags (comma separated: inbounds, press break, BLOB...)"
          style={{ width: "100%", marginBottom: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {TOOL_LABELS.map(({ tool: t, label, icon }) => (
            <button key={label} onClick={() => { setTool(t); setStampAction(null); }}
              style={{ padding: "6px 10px", fontSize: 13, border: tool === t ? "2px solid var(--gold)" : "1px solid var(--border)", borderRadius: "8px", background: tool === t ? "rgba(240,192,64,0.12)" : "transparent" }}>
              {icon} {label}
            </button>
          ))}
          <button onClick={undo} disabled={!history.length} style={{ padding: "6px 10px" }}>↩ Undo</button>
          <button onClick={redo} disabled={!future.length} style={{ padding: "6px 10px" }}>↪ Redo</button>
          <button onClick={() => setAvatarsDefault((v) => !v)} style={{ padding: "6px 10px" }}>
            Avatars: {avatarsDefault ? "on" : "off"}
          </button>
          <button onClick={() => setPlaySignal((s) => s + 1)} style={{ padding: "6px 10px", border: "2px solid var(--gold)", color: "var(--gold)" }}>▶ Play frame</button>
        </div>

        {stampAction && (
          <p style={{ fontSize: 13, color: "var(--gold)", marginBottom: 6 }}>
            Click the court to stamp in "{stampAction.name}" — <button onClick={() => setStampAction(null)} style={{ fontSize: 12 }}>cancel</button>
          </p>
        )}

        <div
          onClickCapture={(e) => {
            if (!stampAction) return;
            const svg = (e.currentTarget as HTMLDivElement).querySelector("svg")!;
            const rect = svg.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
            const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
            stampActionAt(stampAction, x, y);
          }}
          style={{ background: "var(--surface2)", borderRadius: 12, padding: 12 }}
        >
          <PlayCanvas
            frame={frame}
            courtTemplate={courtTemplate}
            avatarsDefault={avatarsDefault}
            roster={rosterMap}
            edit={!stampAction}
            tool={tool}
            onAddPlayer={addPlayer}
            onAddDefender={addDefender}
            onSetBall={setBall}
            onAddAction={addAction}
            onErase={eraseNear}
            onToggleAvatar={toggleAvatar}
            playSignal={playSignal}
          />
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          {frames.map((_, i) => (
            <button key={i} onClick={() => setFrameIdx(i)}
              style={{ padding: "6px 10px", border: i === frameIdx ? "2px solid var(--gold)" : "1px solid var(--border)", borderRadius: "8px" }}>
              Beat {i + 1}
            </button>
          ))}
          <button onClick={addFrame} style={{ padding: "6px 10px" }}>+ Add beat</button>
          {frames.length > 1 && <button onClick={() => deleteFrame(frameIdx)} style={{ padding: "6px 10px" }}>Delete beat</button>}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>A play can be several sequential beats — e.g. "screen sets" then "cut".</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 14px", border: "2px solid var(--gold)", color: "var(--gold)" }}>
            {saving ? "Saving…" : "Save play"}
          </button>
          {currentUserRole === "player" && (
            <button onClick={() => setShowShare((v) => !v)} style={{ padding: "8px 14px" }}>Share with coach</button>
          )}
          {onClose && <button onClick={onClose} style={{ padding: "8px 14px" }}>Close</button>}
        </div>

        {showShare && (
          <div style={{ marginTop: 8, padding: 10, background: "var(--surface2)", borderRadius: "8px" }}>
            {staff.map((s) => (
              <button key={s.id} onClick={() => handleShare(s.id)} style={{ display: "block", padding: "6px 10px", marginBottom: 4 }}>{s.name}</button>
            ))}
            {staff.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No coaches found.</p>}
          </div>
        )}

        {toast && <p style={{ fontSize: 13, color: "var(--gold)", marginTop: 8 }}>{toast}</p>}
      </div>

      <div>
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Saved actions</h3>
        {savedActions.map((a) => (
          <div key={a.id} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <button onClick={() => setStampAction(a)} style={{ flex: 1, textAlign: "left", padding: "6px 8px", fontSize: 13 }}>
              🔖 {a.name}
            </button>
            <button onClick={async () => { await deleteSavedAction(a.id); setSavedActions((s) => s.filter((x) => x.id !== a.id)); }} style={{ padding: "6px 8px", fontSize: 12 }}>✕</button>
          </div>
        ))}
        {savedActions.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>None yet.</p>}
        <button onClick={saveCurrentFrameAsAction} style={{ width: "100%", padding: "6px 8px", fontSize: 13, marginTop: 6 }}>
          + Save current beat as action
        </button>

        <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Link players to roster</h3>
        {frame.players.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, width: 20 }}>#{p.num}</span>
            <select value={p.profile_id ?? ""} onChange={(e) => assignRoster(i, e.target.value)}
              style={{ flex: 1, fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", color: "var(--text)", fontFamily: "inherit", outline: "none" }}>
              <option value="">— unassigned —</option>
              {roster.map((r) => <option key={r.id} value={r.id}>{r.name}{r.jersey != null ? ` (#${r.jersey})` : ""}</option>)}
            </select>
          </div>
        ))}
        {frame.players.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Place players on the court to link them.</p>}
      </div>
    </div>
  );
}
