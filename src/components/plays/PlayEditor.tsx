// src/components/plays/PlayEditor.tsx
// Desktop-optimized play editor (coach/admin primary use, but also used by
// players drawing up their own plays — same component, access is governed
// by RLS on the plays table, not by role checks here).

import { useState, useEffect, useCallback } from "react";
import PlayCanvas, { CANVAS_W, CANVAS_H } from "./PlayCanvas";
import { hoopPositions } from "./courtGeometry";
import {
  Play, PlayData, PlayFrame, PlayPlayer, PlayAction, ActionType,
  CourtTemplate, COURT_TEMPLATES, COURT_TEMPLATE_LABELS,
  SavedAction, RosterPlayer, PlayShareTarget,
  emptyPlayData, createPlay, updatePlay, deletePlay, genPlayerId,
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

type Tool = "player" | "defender" | "ball" | ActionType | "erase" | "select" | "draw" | "handoff" | "text" | "zone" | "cone" | "shot" | null;

const PRIMARY_TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: "select", label: "Move", icon: "✥" },
  { tool: "player", label: "Player", icon: "⬤" },
  { tool: "ball", label: "Ball", icon: "●" },
  { tool: "move", label: "Cut", icon: "→" },
  { tool: "pass", label: "Pass", icon: "┄" },
  { tool: "dribble", label: "Dribble", icon: "〜" },
  { tool: "screen", label: "Screen", icon: "⊥" },
  { tool: "handoff", label: "Handoff", icon: "✱" },
  { tool: "shot", label: "Shot", icon: "🏀" },
  { tool: "text", label: "Text", icon: "T" },
  { tool: "erase", label: "Erase", icon: "⌫" },
];
// Used less often — tucked behind "More tools" instead of permanently
// taking up space in the main row.
const MORE_TOOLS: { tool: Tool; label: string; icon: string }[] = [
  { tool: "cone", label: "Cone", icon: "▲" },
  { tool: "defender", label: "Defender", icon: "✕" },
  { tool: "draw", label: "Draw", icon: "✎" },
  { tool: "zone", label: "Zone shading", icon: "▦" },
];

function cloneFrames(frames: PlayFrame[]): PlayFrame[] { return JSON.parse(JSON.stringify(frames)); }

export default function PlayEditor({ existingPlay, currentUserRole, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(existingPlay?.title ?? "");
  const [tagsInput, setTagsInput] = useState((existingPlay?.tags ?? []).join(", "));
  const [courtTemplate, setCourtTemplate] = useState<CourtTemplate>(existingPlay?.court_template ?? "half");
  const [avatarsDefault, setAvatarsDefault] = useState(existingPlay?.data?.avatarsDefault ?? false);
  const [frames, setFrames] = useState<PlayFrame[]>(() => {
    const initial = existingPlay?.data?.frames ?? emptyPlayData().frames;
    // Plays saved before player identity existed have no `id` on their
    // players — assign one based on array position (the same assumption
    // the app already made implicitly elsewhere) so the new carry-forward
    // logic has something to work with going forward.
    return initial.map((f) => ({
      ...f,
      players: f.players.map((p, i) => (p.id ? p : { ...p, id: `legacy-${i}` })),
    }));
  });
  const [frameIdx, setFrameIdx] = useState(0);
  const [tool, setTool] = useState<Tool>("player");
  const [isMobile] = useState(() => window.innerWidth < 768);
  const [mobileStage, setMobileStage] = useState<"draw" | "confirm" | "naming">("draw");
  const [showMoreTools, setShowMoreTools] = useState(false);
  const [selected, setSelected] = useState<{ kind: "player" | "defender" | "ball" | "action" | "text" | "zone" | "cone"; index: number } | null>(null);
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

  // Keyboard shortcuts. Skipped while typing in a text field so native
  // undo/redo in the title/tags inputs still works normally.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (typing) return;
      const cmdOrCtrl = e.metaKey || e.ctrlKey;
      if (cmdOrCtrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (cmdOrCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setTool(null);
        setStampAction(null);
        setSelected(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, future, frames, selected]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  const frame = frames[frameIdx];

  useEffect(() => { setSelected(null); }, [frameIdx]);

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
  const setBall = useCallback((x: number, y: number) => { pushHistory(); updateFrame((f) => ({ ...f, ball: { x, y }, ballHolderId: null })); }, [frames, frameIdx]);
  const addAction = useCallback((a: PlayAction) => { pushHistory(); updateFrame((f) => ({ ...f, actions: [...f.actions, a] })); }, [frames, frameIdx]);
  const addDrawing = useCallback((points: { x: number; y: number }[]) => {
    pushHistory();
    updateFrame((f) => ({ ...f, drawings: [...(f.drawings ?? []), { points }] }));
  }, [frames, frameIdx]);
  const toggleAvatar = useCallback((idx: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, players: f.players.map((p, i) => i === idx ? { ...p, showAvatar: !(p.showAvatar ?? avatarsDefault) } : p) }));
  }, [frames, frameIdx, avatarsDefault]);
  const toggleHandoff = useCallback((idx: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, players: f.players.map((p, i) => i === idx ? { ...p, handoff: !p.handoff } : p) }));
  }, [frames, frameIdx]);

  const movePlayer = useCallback((idx: number, x: number, y: number) => {
    pushHistory();
    updateFrame((f) => {
      const players = f.players.map((p, i) => i === idx ? { ...p, x, y } : p);
      // If this player is the current ball-holder, keep the ball's stored
      // position in sync too — this matters for the beat-to-beat animation,
      // which reads ball.x/y directly rather than re-deriving from the holder.
      const movedId = f.players[idx]?.id;
      const ball = (movedId && f.ballHolderId === movedId) ? { x, y } : f.ball;
      return { ...f, players, ball };
    });
  }, [frames, frameIdx]);
  const moveDefender = useCallback((idx: number, x: number, y: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, defenders: f.defenders.map((d, i) => i === idx ? { x, y } : d) }));
  }, [frames, frameIdx]);
  const moveBall = useCallback((x: number, y: number) => {
    pushHistory();
    // Manually dragging the ball is an explicit override — it's no longer
    // "held" by whoever it was tracking, it's just sitting at this spot.
    updateFrame((f) => ({ ...f, ball: { x, y }, ballHolderId: null }));
  }, [frames, frameIdx]);
  const moveActionPoint = useCallback((idx: number, which: "start" | "end", x: number, y: number) => {
    pushHistory();
    updateFrame((f) => ({
      ...f,
      actions: f.actions.map((a, i) => i === idx ? (which === "start" ? { ...a, x1: x, y1: y } : { ...a, x2: x, y2: y }) : a),
    }));
  }, [frames, frameIdx]);
  const moveActionWhole = useCallback((idx: number, x1: number, y1: number, x2: number, y2: number, curve?: { x: number; y: number }) => {
    pushHistory();
    updateFrame((f) => ({ ...f, actions: f.actions.map((a, i) => i === idx ? { ...a, x1, y1, x2, y2, curve } : a) }));
  }, [frames, frameIdx]);
  const setActionCurve = useCallback((idx: number, x: number, y: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, actions: f.actions.map((a, i) => i === idx ? { ...a, curve: { x, y } } : a) }));
  }, [frames, frameIdx]);

  function addText(x: number, y: number) {
    const text = window.prompt("Text for this label (e.g. \"wait for screen\")");
    if (!text || !text.trim()) return;
    pushHistory();
    updateFrame((f) => ({ ...f, texts: [...(f.texts ?? []), { x, y, text: text.trim() }] }));
  }
  const moveText = useCallback((idx: number, x: number, y: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, texts: (f.texts ?? []).map((t, i) => i === idx ? { ...t, x, y } : t) }));
  }, [frames, frameIdx]);
  function editText(idx: number) {
    const current = frame.texts?.[idx]?.text ?? "";
    const next = window.prompt("Edit label text (leave blank to keep unchanged):", current);
    if (next === null || !next.trim()) return;
    pushHistory();
    updateFrame((f) => ({ ...f, texts: (f.texts ?? []).map((t, i) => i === idx ? { ...t, text: next.trim() } : t) }));
  }

  function addZone(x: number, y: number, w: number, h: number) {
    pushHistory();
    updateFrame((f) => ({ ...f, zones: [...(f.zones ?? []), { x, y, w, h }] }));
  }
  const moveZone = useCallback((idx: number, x: number, y: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, zones: (f.zones ?? []).map((z, i) => i === idx ? { ...z, x, y } : z) }));
  }, [frames, frameIdx]);

  function addCone(x: number, y: number) {
    pushHistory();
    updateFrame((f) => ({ ...f, cones: [...(f.cones ?? []), { x, y }] }));
  }
  const moveCone = useCallback((idx: number, x: number, y: number) => {
    pushHistory();
    updateFrame((f) => ({ ...f, cones: (f.cones ?? []).map((c, i) => i === idx ? { x, y } : c) }));
  }, [frames, frameIdx]);

  function addShot(playerIdx: number) {
    const player = frame.players[playerIdx];
    if (!player) return;
    const hoops = hoopPositions(courtTemplate);
    let target = hoops[0];
    let bestDist = Infinity;
    for (const h of hoops) {
      const d = Math.hypot(h.x - player.x, h.y - player.y);
      if (d < bestDist) { bestDist = d; target = h; }
    }
    // A gentle bow away from the straight line, for a shot-arc look rather
    // than a flat line to the rim.
    const mx = (player.x + target.x) / 2, my = (player.y + target.y) / 2;
    const dx = target.x - player.x, dy = target.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bow = Math.min(40, len * 0.25);
    const curve = { x: mx + nx * bow, y: my + ny * bow };
    pushHistory();
    updateFrame((f) => ({
      ...f,
      actions: [...f.actions, { type: "shot" as const, x1: player.x, y1: player.y, x2: target.x, y2: target.y, curve, sourcePlayerId: player.id }],
    }));
  }

  function deleteSelected() {
    if (!selected) return;
    pushHistory();
    if (selected.kind === "player") updateFrame((f) => ({ ...f, players: f.players.filter((_, i) => i !== selected.index) }));
    else if (selected.kind === "defender") updateFrame((f) => ({ ...f, defenders: f.defenders.filter((_, i) => i !== selected.index) }));
    else if (selected.kind === "ball") updateFrame((f) => ({ ...f, ball: null }));
    else if (selected.kind === "action") updateFrame((f) => ({ ...f, actions: f.actions.filter((_, i) => i !== selected.index) }));
    else if (selected.kind === "text") updateFrame((f) => ({ ...f, texts: (f.texts ?? []).filter((_, i) => i !== selected.index) }));
    else if (selected.kind === "zone") updateFrame((f) => ({ ...f, zones: (f.zones ?? []).filter((_, i) => i !== selected.index) }));
    else if (selected.kind === "cone") updateFrame((f) => ({ ...f, cones: (f.cones ?? []).filter((_, i) => i !== selected.index) }));
    setSelected(null);
  }

  function previewAllBeats() {
    setFrameIdx(0);
    setTimeout(() => setPlaySignal((s) => s + 1), 50);
  }
  function handlePreviewBeatDone() {
    if (frameIdx < frames.length - 1) {
      setFrameIdx((i) => i + 1);
      setTimeout(() => setPlaySignal((s) => s + 1), 150);
    } else if (isMobile) {
      setMobileStage("confirm");
    }
  }

  function eraseNear(x: number, y: number) {
    pushHistory();
    const near = (a: { x: number; y: number }, r: number) => Math.hypot(a.x - x, a.y - y) < r;
    // Distance from the click to the closest point ANYWHERE along the
    // action's line — using only the midpoint meant you had to click one
    // exact tiny spot in the middle of a pass/screen line to erase it.
    const distToSegment = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1, dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
      const cx = x1 + t * dx, cy = y1 + t * dy;
      return Math.hypot(x - cx, y - cy);
    };
    updateFrame((f) => ({
      players: f.players.filter((p) => !near(p, 16)),
      defenders: f.defenders.filter((d) => !near(d, 16)),
      ball: f.ball && near(f.ball, 12) ? null : f.ball,
      actions: f.actions.filter((a) => {
        if (!a.curve) return distToSegment(a.x1, a.y1, a.x2, a.y2) >= 14;
        // Curved line — sample points along the quadratic curve and check
        // each segment, so clicking anywhere on the visible curve erases it.
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          const t1 = i / steps, t2 = (i + 1) / steps;
          const mt1 = 1 - t1, mt2 = 1 - t2;
          const p1x = mt1 * mt1 * a.x1 + 2 * mt1 * t1 * a.curve.x + t1 * t1 * a.x2;
          const p1y = mt1 * mt1 * a.y1 + 2 * mt1 * t1 * a.curve.y + t1 * t1 * a.y2;
          const p2x = mt2 * mt2 * a.x1 + 2 * mt2 * t2 * a.curve.x + t2 * t2 * a.x2;
          const p2y = mt2 * mt2 * a.y1 + 2 * mt2 * t2 * a.curve.y + t2 * t2 * a.y2;
          if (distToSegment(p1x, p1y, p2x, p2y) < 14) return false;
        }
        return true;
      }),
      drawings: (f.drawings ?? []).filter((d) => {
        for (let i = 0; i < d.points.length - 1; i++) {
          const a = d.points[i], b = d.points[i + 1];
          if (distToSegment(a.x, a.y, b.x, b.y) < 14) return false;
        }
        return true;
      }),
      texts: (f.texts ?? []).filter((t) => !near(t, 20)),
      zones: (f.zones ?? []).filter((z) => !(x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h)),
      cones: (f.cones ?? []).filter((c) => !near(c, 16)),
    }));
  }

  function addFrame() {
    pushHistory();
    const last = frames[frames.length - 1];

    // Cuts/dribbles carry their player forward to the action's endpoint;
    // everyone else keeps their prior spot. Handoff markers clear each step
    // since they mark a one-time moment, not a persistent state.
    const players = last.players.map((p) => {
      const sourced = p.id ? last.actions.find((a) => a.sourcePlayerId === p.id && (a.type === "move" || a.type === "dribble" || a.type === "screen")) : undefined;
      const base = sourced ? { ...p, x: sourced.x2, y: sourced.y2 } : { ...p };
      return { ...base, handoff: false };
    });

    // Ball possession carries forward: a shot ends possession outright
    // (nobody's holding a ball that just went up), otherwise an explicit
    // handoff marker wins, then whoever a pass targeted, then a continuing
    // dribbler, then whoever already held it.
    let ballHolderId: string | null = last.ballHolderId ?? null;
    const tookShot = last.actions.some((a) => a.type === "shot");
    if (tookShot) {
      ballHolderId = null;
    } else {
      const handoffPlayer = last.players.find((p) => p.handoff);
      if (handoffPlayer?.id) {
        ballHolderId = handoffPlayer.id;
      } else {
        const passTarget = [...last.actions].reverse().find((a) => a.type === "pass" && a.targetPlayerId);
        if (passTarget?.targetPlayerId) {
          ballHolderId = passTarget.targetPlayerId;
        } else {
          const dribbler = [...last.actions].reverse().find((a) => a.type === "dribble" && a.sourcePlayerId);
          if (dribbler?.sourcePlayerId) ballHolderId = dribbler.sourcePlayerId;
        }
      }
    }

    let ball = last.ball ? { ...last.ball } : null;
    if (tookShot) {
      const shotAction = [...last.actions].reverse().find((a) => a.type === "shot");
      if (shotAction) ball = { x: shotAction.x2, y: shotAction.y2 };
    } else if (ballHolderId) {
      const holder = players.find((p) => p.id === ballHolderId);
      if (holder) ball = { x: holder.x, y: holder.y };
    }

    const copy: PlayFrame = {
      players,
      defenders: JSON.parse(JSON.stringify(last.defenders)),
      ball,
      ballHolderId,
      actions: [],
    };
    setFrames((fr) => [...fr, copy]);
    setFrameIdx(frames.length);
  }
  function deleteFrame(i: number) {
    if (frames.length <= 1) return;
    pushHistory();
    setFrames((fr) => fr.filter((_, idx) => idx !== i));
    setFrameIdx((idx) => Math.max(0, idx >= i ? idx - 1 : idx));
  }

  function duplicateFrame() {
    pushHistory();
    const copy: PlayFrame = JSON.parse(JSON.stringify(frames[frameIdx]));
    setFrames((fr) => [...fr.slice(0, frameIdx + 1), copy, ...fr.slice(frameIdx + 1)]);
    setFrameIdx(frameIdx + 1);
    setSelected(null);
  }

  function flipFrameData(f: PlayFrame): PlayFrame {
    return {
      ...f,
      players: f.players.map((p) => ({ ...p, x: CANVAS_W - p.x })),
      defenders: f.defenders.map((d) => ({ ...d, x: CANVAS_W - d.x })),
      ball: f.ball ? { ...f.ball, x: CANVAS_W - f.ball.x } : null,
      actions: f.actions.map((a) => ({
        ...a, x1: CANVAS_W - a.x1, x2: CANVAS_W - a.x2,
        curve: a.curve ? { ...a.curve, x: CANVAS_W - a.curve.x } : undefined,
      })),
      drawings: (f.drawings ?? []).map((d) => ({ points: d.points.map((pt) => ({ ...pt, x: CANVAS_W - pt.x })) })),
      texts: (f.texts ?? []).map((t) => ({ ...t, x: CANVAS_W - t.x })),
      zones: (f.zones ?? []).map((z) => ({ ...z, x: CANVAS_W - z.x - z.w })),
    };
  }
  function flipCurrentStep() {
    pushHistory();
    setFrames((fr) => fr.map((f, i) => (i === frameIdx ? flipFrameData(f) : f)));
    setSelected(null);
  }
  function flipEntirePlay() {
    if (!window.confirm("Flip every step in this play left-to-right?")) return;
    pushHistory();
    setFrames((fr) => fr.map((f) => flipFrameData(f)));
    setSelected(null);
  }

  function duplicateSelectedPlayer() {
    if (!selected || selected.kind !== "player") return;
    pushHistory();
    updateFrame((f) => {
      const orig = f.players[selected.index];
      if (!orig) return f;
      const nextNumVal = (f.players.length % 5) + 1;
      return { ...f, players: [...f.players, { ...orig, id: genPlayerId(), x: orig.x + 20, y: orig.y + 20, num: nextNumVal, handoff: false }] };
    });
  }

  function assignRoster(playerIdx: number, profileId: string) {
    const playerId = frame.players[playerIdx]?.id;
    pushHistory();
    if (!playerId) {
      // No stable id (shouldn't normally happen) — fall back to updating just this step.
      updateFrame((f) => ({ ...f, players: f.players.map((p, i) => i === playerIdx ? { ...p, profile_id: profileId || null } : p) }));
      return;
    }
    setFrames((fr) => fr.map((f) => ({
      ...f,
      players: f.players.map((p) => p.id === playerId ? { ...p, profile_id: profileId || null } : p),
    })));
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
    // Stamped players are new, distinct players — give each a fresh id
    // rather than reusing whatever the saved template's players had (which
    // could collide with existing players, or with another copy of this
    // same stamp used elsewhere). Remap the stamped actions' source/target
    // links through the same table so they still point at the right player.
    const idMap = new Map<string, string>();
    const newPlayers = d.players.map((p, i) => {
      const newId = genPlayerId();
      if (p.id) idMap.set(p.id, newId);
      return { ...p, id: newId, x: p.x + dx, y: p.y + dy, num: ((baseCount + i) % 5) + 1 };
    });
    const newActions = d.actions.map((a) => ({
      ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy,
      sourcePlayerId: a.sourcePlayerId ? idMap.get(a.sourcePlayerId) : undefined,
      targetPlayerId: a.targetPlayerId ? idMap.get(a.targetPlayerId) : undefined,
    }));
    updateFrame((f) => ({
      players: [...f.players, ...newPlayers],
      defenders: [...f.defenders, ...d.defenders.map((def) => ({ x: def.x + dx, y: def.y + dy }))],
      ball: f.ball ?? (d.ball ? { x: d.ball.x + dx, y: d.ball.y + dy } : null),
      actions: [...f.actions, ...newActions],
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

  async function handleDelete() {
    if (!existingPlay) return;
    if (!window.confirm(`Delete "${existingPlay.title}"? This can't be undone.`)) return;
    try {
      await deletePlay(existingPlay.id);
      onClose?.();
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  const rosterMap: Record<string, RosterPlayer> = Object.fromEntries(roster.map((r) => [r.id, r]));

  // --- Mobile layout: reorganized toolbar, court moved up front, and a
  // combined preview -> confirm -> name/tags -> save flow instead of an
  // always-visible title field. Desktop below is untouched. ---
  if (isMobile) {
    if (mobileStage === "confirm") {
      return (
        <div>
          <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <PlayCanvas frame={frames[frames.length - 1]} courtTemplate={courtTemplate} avatarsDefault={avatarsDefault} roster={rosterMap} edit={false} />
          </div>
          <p style={{ textAlign: "center", fontSize: 14, color: "var(--text)", marginBottom: 10 }}>Look good?</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setMobileStage("draw")} style={{ flex: 1, padding: 10 }}>← Go back</button>
            <button onClick={() => setMobileStage("naming")} className="coach-add-btn" style={{ flex: 1, justifyContent: "center" }}>Confirm</button>
          </div>
        </div>
      );
    }

    if (mobileStage === "naming") {
      return (
        <div>
          <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 16 }}>
            <h3 style={{ fontSize: 15, margin: "0 0 12px", color: "var(--text)" }}>Name this play</h3>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Play title (required)"
              style={{ width: "100%", marginBottom: 8, background: "var(--surface)", border: title.trim() ? "1px solid var(--border)" : "2px solid var(--gold)", borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Tags (optional)"
              style={{ width: "100%", marginBottom: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setMobileStage("draw")} style={{ flex: 1, padding: 10 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} className="coach-add-btn" style={{ flex: 1, justifyContent: "center" }}>
                {saving ? "Saving…" : "Confirm save"}
              </button>
            </div>
            {toast && <p style={{ fontSize: 13, color: "var(--gold)", marginTop: 10, textAlign: "center" }}>{toast}</p>}
          </div>
        </div>
      );
    }

    // mobileStage === "draw"
    return (
      <div>
        <select value={courtTemplate} onChange={(e) => setCourtTemplate(e.target.value as CourtTemplate)}
          style={{ width: "100%", marginBottom: 8, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
          {COURT_TEMPLATES.map((c) => <option key={c} value={c}>{COURT_TEMPLATE_LABELS[c]}</option>)}
        </select>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: 6 }}>
          {[
            { tool: "select" as Tool, label: "Move", icon: "✥" },
            { tool: "player" as Tool, label: "Player", icon: "⬤" },
            { tool: "ball" as Tool, label: "Ball", icon: "●" },
            { tool: "move" as Tool, label: "Cut", icon: "→" },
            { tool: "pass" as Tool, label: "Pass", icon: "┄" },
            { tool: "dribble" as Tool, label: "Dribble", icon: "〜" },
            { tool: "screen" as Tool, label: "Screen", icon: "⊥" },
          ].map(({ tool: t, label, icon }) => (
            <button key={label} onClick={() => { setTool(t); setStampAction(null); }}
              style={{ padding: "6px 2px", fontSize: 10, border: tool === t ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: tool === t ? "rgba(240,192,64,0.12)" : "var(--surface2)", color: "var(--text)" }}>
              {icon} {label}
            </button>
          ))}
          <button onClick={undo} disabled={!history.length}
            style={{ padding: "6px 2px", fontSize: 10, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface2)", color: "var(--text)" }}>
            ↩ Undo
          </button>
          <button onClick={() => { setTool("erase"); setStampAction(null); }}
            style={{ padding: "6px 2px", fontSize: 10, border: tool === "erase" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: tool === "erase" ? "rgba(240,192,64,0.12)" : "var(--surface2)", color: "var(--text)" }}>
            ⌫ Erase
          </button>
          <button onClick={() => setAvatarsDefault((v) => !v)}
            style={{ padding: "6px 2px", fontSize: 10, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface2)", color: "var(--text)" }}>
            Avatars: {avatarsDefault ? "on" : "off"}
          </button>
        </div>

        <button onClick={() => setShowMoreTools((v) => !v)}
          style={{ width: "100%", padding: "6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 8, background: showMoreTools ? "var(--surface2)" : "transparent", color: "var(--muted)", marginBottom: 8 }}>
          {showMoreTools ? "▴" : "▾"} More tools
        </button>
        {showMoreTools && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8, padding: 8, background: "var(--surface2)", borderRadius: 8 }}>
            <button onClick={() => { setTool("cone"); setStampAction(null); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: tool === "cone" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>▲ Cone</button>
            <button onClick={() => { setTool("defender"); setStampAction(null); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: tool === "defender" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>✕ Defender</button>
            <button onClick={() => { setTool("draw"); setStampAction(null); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: tool === "draw" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>✎ Draw</button>
            <button onClick={() => { flipEntirePlay(); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>↔ Flip entire play</button>
            <button onClick={() => { flipCurrentStep(); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>↔ Flip step</button>
            <button onClick={() => { setTool("handoff"); setStampAction(null); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: tool === "handoff" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>✱ Handoff</button>
            <button onClick={() => { redo(); setShowMoreTools(false); }} disabled={!future.length}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>↪ Redo</button>
            <button onClick={() => { setTool("shot"); setStampAction(null); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: tool === "shot" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>🏀 Shot</button>
            <button onClick={() => { setTool("zone"); setStampAction(null); setShowMoreTools(false); }}
              style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, border: tool === "zone" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }}>▦ Zone shading</button>
          </div>
        )}

        {stampAction && (
          <p style={{ fontSize: 12, color: "var(--gold)", marginBottom: 6 }}>
            Tap the court to stamp in "{stampAction.name}" — <button onClick={() => setStampAction(null)} style={{ fontSize: 11 }}>cancel</button>
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
          style={{ background: "var(--surface2)", borderRadius: 12, padding: 10, marginBottom: 8 }}
        >
          <PlayCanvas
            frame={frame} courtTemplate={courtTemplate} avatarsDefault={avatarsDefault} roster={rosterMap}
            edit={!stampAction} tool={tool}
            onAddPlayer={addPlayer} onAddDefender={addDefender} onSetBall={setBall} onAddAction={addAction}
            onErase={eraseNear} onToggleAvatar={toggleAvatar} onToggleHandoff={toggleHandoff}
            onMovePlayer={movePlayer} onMoveDefender={moveDefender} onMoveBall={moveBall}
            onMoveActionPoint={moveActionPoint} onMoveActionWhole={moveActionWhole} onSetActionCurve={setActionCurve}
            onAddText={addText} onMoveText={moveText} onEditText={editText} onAddZone={addZone} onMoveZone={moveZone}
            onAddCone={addCone} onMoveCone={moveCone} onAddShot={addShot}
            selected={selected} onSelect={setSelected} onAddDrawing={addDrawing}
            playSignal={playSignal} onPlayDone={handlePreviewBeatDone}
          />
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          {frames.map((_, i) => (
            <button key={i} onClick={() => setFrameIdx(i)}
              style={{ padding: "6px 9px", fontSize: 11, border: i === frameIdx ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 8, background: "var(--surface2)", color: "var(--text)" }}>
              Step {i + 1}
            </button>
          ))}
          <button onClick={addFrame} style={{ padding: "6px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface2)", color: "var(--muted)" }}>+</button>
        </div>

        <button onClick={previewAllBeats} className="coach-add-btn" style={{ width: "100%", justifyContent: "center", marginBottom: 16 }}>
          ▶ Preview & save
        </button>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text)" }}>Saved actions</h3>
          {savedActions.map((a) => (
            <div key={a.id} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              <button onClick={() => setStampAction(a)} style={{ flex: 1, textAlign: "left", padding: "6px 8px", fontSize: 12 }}>🔖 {a.name}</button>
              <button onClick={async () => { await deleteSavedAction(a.id); setSavedActions((s) => s.filter((x) => x.id !== a.id)); }} style={{ padding: "6px 8px", fontSize: 11 }}>✕</button>
            </div>
          ))}
          {savedActions.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)" }}>None yet.</p>}
          <button onClick={saveCurrentFrameAsAction} style={{ width: "100%", padding: "6px 8px", fontSize: 12, marginTop: 4 }}>+ Save current step as action</button>

          <h3 style={{ fontSize: 13, margin: "16px 0 8px", color: "var(--text)" }}>Link players to roster</h3>
          {frame.players.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 11, width: 20, color: "var(--text)" }}>#{p.num}</span>
              <select value={p.profile_id ?? ""} onChange={(e) => assignRoster(i, e.target.value)}
                style={{ flex: 1, fontSize: 11, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", color: "var(--text)", fontFamily: "inherit", outline: "none" }}>
                <option value="">— unassigned —</option>
                {roster.map((r) => <option key={r.id} value={r.id}>{r.name}{r.jersey != null ? ` (#${r.jersey})` : ""}</option>)}
              </select>
            </div>
          ))}
          {frame.players.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)" }}>Place players on the court to link them.</p>}

          <div style={{ display: "flex", gap: 12, marginTop: 16, fontSize: 12, flexWrap: "wrap" }}>
            {currentUserRole === "player" && <button onClick={() => setShowShare((v) => !v)} style={{ padding: "6px 10px" }}>Share with coach</button>}
            {onClose && <button onClick={onClose} style={{ padding: "6px 10px" }}>Close</button>}
            {existingPlay && <button onClick={handleDelete} style={{ padding: "6px 10px", color: "#ff7b7b" }}>🗑 Delete play</button>}
          </div>
          {showShare && (
            <div style={{ marginTop: 8, padding: 10, background: "var(--surface2)", borderRadius: 8 }}>
              {staff.map((s) => (
                <button key={s.id} onClick={() => handleShare(s.id)} style={{ display: "block", padding: "6px 10px", marginBottom: 4, fontSize: 12 }}>{s.name}</button>
              ))}
              {staff.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)" }}>No coaches found.</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

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

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: showMoreTools ? 6 : 8 }}>
          {PRIMARY_TOOLS.map(({ tool: t, label, icon }) => (
            <button key={label} onClick={() => { setTool(t); setStampAction(null); }}
              style={{ padding: "6px 10px", fontSize: 13, border: tool === t ? "2px solid var(--gold)" : "1px solid var(--border)", borderRadius: "8px", background: tool === t ? "rgba(240,192,64,0.12)" : "transparent" }}>
              {icon} {label}
            </button>
          ))}
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 2px" }} />
          <button onClick={() => setShowMoreTools((v) => !v)}
            style={{ padding: "6px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: "8px", background: showMoreTools ? "var(--surface2)" : "transparent" }}>
            {showMoreTools ? "▴" : "▾"} More tools
          </button>
        </div>

        {showMoreTools && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, padding: "8px 8px", background: "var(--surface2)", borderRadius: 8 }}>
            {MORE_TOOLS.map(({ tool: t, label, icon }) => (
              <button key={label} onClick={() => { setTool(t); setStampAction(null); setShowMoreTools(false); }}
                style={{ padding: "6px 10px", fontSize: 13, border: tool === t ? "2px solid var(--gold)" : "1px solid var(--border)", borderRadius: "8px", background: tool === t ? "rgba(240,192,64,0.12)" : "var(--surface)" }}>
                {icon} {label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <button onClick={undo} disabled={!history.length} style={{ padding: "6px 10px" }}>↩ Undo</button>
          <button onClick={redo} disabled={!future.length} style={{ padding: "6px 10px" }}>↪ Redo</button>
          {selected && <button onClick={deleteSelected} style={{ padding: "6px 10px" }}>🗑 Delete selected</button>}
          {selected && selected.kind === "player" && <button onClick={duplicateSelectedPlayer} style={{ padding: "6px 10px" }}>⧉ Duplicate player</button>}
          <button onClick={flipCurrentStep} style={{ padding: "6px 10px" }}>↔ Flip step</button>
          <button onClick={flipEntirePlay} style={{ padding: "6px 10px" }}>↔ Flip entire play</button>
          <button onClick={() => setAvatarsDefault((v) => !v)} style={{ padding: "6px 10px" }}>
            Avatars: {avatarsDefault ? "on" : "off"}
          </button>
          <button onClick={() => setPlaySignal((s) => s + 1)} className="coach-add-btn">▶ Play frame</button>
          {frames.length > 1 && <button onClick={previewAllBeats} style={{ padding: "6px 10px" }}>▶▶ Preview full play</button>}
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
            onToggleHandoff={toggleHandoff}
            onMovePlayer={movePlayer}
            onMoveDefender={moveDefender}
            onMoveBall={moveBall}
            onMoveActionPoint={moveActionPoint}
            onMoveActionWhole={moveActionWhole}
            onSetActionCurve={setActionCurve}
            onAddText={addText}
            onMoveText={moveText}
            onEditText={editText}
            onAddZone={addZone}
            onMoveZone={moveZone}
            onAddCone={addCone}
            onMoveCone={moveCone}
            onAddShot={addShot}
            selected={selected}
            onSelect={setSelected}
            onAddDrawing={addDrawing}
            playSignal={playSignal}
            onPlayDone={handlePreviewBeatDone}
          />
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          {frames.map((_, i) => (
            <button key={i} onClick={() => setFrameIdx(i)}
              style={{ padding: "6px 10px", border: i === frameIdx ? "2px solid var(--gold)" : "1px solid var(--border)", borderRadius: "8px" }}>
              Step {i + 1}
            </button>
          ))}
          <button onClick={addFrame} style={{ padding: "6px 10px" }}>+ Add step</button>
          <button onClick={duplicateFrame} style={{ padding: "6px 10px" }}>⧉ Duplicate step</button>
          {frames.length > 1 && <button onClick={() => deleteFrame(frameIdx)} style={{ padding: "6px 10px" }}>Delete step</button>}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>A play can be several sequential steps — e.g. "screen sets" then "cut".</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleSave} disabled={saving} className="coach-add-btn">
            {saving ? "Saving…" : "Save play"}
          </button>
          {currentUserRole === "player" && (
            <button onClick={() => setShowShare((v) => !v)} style={{ padding: "8px 14px" }}>Share with coach</button>
          )}
          {onClose && <button onClick={onClose} style={{ padding: "8px 14px" }}>Close</button>}
          {existingPlay && <button onClick={handleDelete} style={{ padding: "8px 14px", color: "#ff7b7b" }}>🗑 Delete play</button>}
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
          + Save current step as action
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
