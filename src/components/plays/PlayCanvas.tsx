// src/components/plays/PlayCanvas.tsx
// The shared rendering + drawing/animation engine for a single play frame.
// Both PlayEditor (edit=true) and PlayViewer (edit=false) render this —
// it's the one place that knows how to draw a court, a player/defender/
// ball icon, an action line, and how to animate one. Coordinate space is
// always the same 600x420 grid regardless of court_template, so saved
// actions and forked plays stay valid if the template changes later.

import { useRef, useState, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import type { CourtTemplate, PlayFrame, PlayPlayer, PlayAction, ActionType, PlayText, PlayZone, PlayPoint } from "../../lib/plays";
import type { RosterPlayer } from "../../lib/plays";
import { resolvePassEndpoint, localActionProgress, playerActionSequence, ballChainSequence } from "../../lib/plays";
import { genPlayerId } from "../../lib/plays";

export const CANVAS_W = 600;
export const CANVAS_H = 420;

interface Props {
  frame: PlayFrame;
  courtTemplate: CourtTemplate;
  /** profile_id -> roster info, used to resolve a player's avatar/name. */
  roster?: Record<string, RosterPlayer>;
  /** When true, clicks/drags on the court edit the frame via the callbacks below. */
  edit?: boolean;
  tool?: "player" | "defender" | "ball" | ActionType | "erase" | "select" | "draw" | "handoff" | "text" | "zone" | "cone" | "coach" | "shot" | "loop" | null;
  onAddPlayer?: (p: PlayPlayer) => void;
  onAddDefender?: (x: number, y: number) => void;
  onSetBall?: (x: number, y: number) => void;
  onAddAction?: (a: PlayAction) => void;
  onErase?: (x: number, y: number) => void;
  /** "handoff" tool — click a player to stamp/unstamp the handoff marker on them. */
  onToggleHandoff?: (index: number) => void;
  /** "select" tool — drag an existing player/defender/ball, or either end (or the whole line) of an existing action. */
  onMovePlayer?: (index: number, x: number, y: number) => void;
  onMoveDefender?: (index: number, x: number, y: number) => void;
  onMoveBall?: (x: number, y: number) => void;
  onMoveActionPoint?: (index: number, which: "start" | "end", x: number, y: number) => void;
  onMoveActionWhole?: (index: number, x1: number, y1: number, x2: number, y2: number, curve?: { x: number; y: number }) => void;
  /** "select" tool — drag a cut/pass line's midpoint handle to bow it into a curl. */
  onSetActionCurve?: (index: number, x: number, y: number) => void;
  /** Loop tool's second bend point — only present/used on actions that have curve2 set. */
  onSetActionCurve2?: (index: number, x: number, y: number) => void;
  /** "draw" tool — called once, with the full point list, when a freehand stroke is released. */
  onAddDrawing?: (points: { x: number; y: number }[]) => void;
  /** "text" tool — click the court to place a label (the editor prompts for the content). */
  onAddText?: (x: number, y: number) => void;
  onMoveText?: (index: number, x: number, y: number) => void;
  /** Double-click an existing label (any tool) to edit its content. */
  onEditText?: (index: number) => void;
  /** "zone" tool — drag a rectangle to shade an area of the court. */
  onAddZone?: (x: number, y: number, w: number, h: number) => void;
  onMoveZone?: (index: number, x: number, y: number) => void;
  /** "cone" tool — click the court to place a practice-drill cone marker. */
  onAddCone?: (x: number, y: number) => void;
  onMoveCone?: (index: number, x: number, y: number) => void;
  /** "coach" tool — click the court to place a coach position marker ("C" in a circle), showing where the coach stands for a drill. */
  onAddCoach?: (x: number, y: number) => void;
  onMoveCoach?: (index: number, x: number, y: number) => void;
  /** "shot" tool — click a player to stamp a shot action from them to the nearest hoop. */
  onAddShot?: (index: number) => void;
  /** A ghost preview of where a saved action's players/ball/lines would land if stamped right now — follows the cursor while a stamp is armed, so placement isn't a blind guess. */
  stampPreview?: { players: PlayPlayer[]; ball: PlayPoint | null; actions: PlayAction[] } | null;
  /** Bump this number to play the current frame's actions once. */
  playSignal?: number;
  onPlayDone?: () => void;
  /** Playback speed multiplier for the beat animation — 1 is normal, 0.5 is half speed, 2 is double. */
  speed?: number;
  /** Override the court's background fill — used by PlayPrintView for a lighter, ink-friendly tone. */
  courtBg?: string;
  /** "select" tool — the currently selected element, highlighted, and what Delete/Backspace acts on. */
  selected?: { kind: "player" | "defender" | "ball" | "action" | "text" | "zone" | "cone" | "coach"; index: number } | null;
  onSelect?: (sel: { kind: "player" | "defender" | "ball" | "action" | "text" | "zone" | "cone" | "coach"; index: number } | null) => void;
  /** Viewer-only, local override — renders this one player (by stable id) with the viewer's own avatar, regardless of what's actually linked in the play data. Never persisted or saved. */
  selfOverride?: { playerId: string; avatarUrl: string | null } | null;
}

// Shared half-court markings (key, free-throw circle, hoop, 3PT line) used
// by "half", "baseline_oob", and "sideline_oob" — those three are the same
// physical half-court, just with a different boundary highlighted.
// The 3PT line is built as two straight corner segments (baseline out to
// where the arc begins) plus one arc — a plain single arc from baseline to
// baseline was cutting through the free-throw lane because its radius was
// too small for that chord width; this shape keeps the arc's apex well
// below (deeper than) the free-throw line so it never crosses the lane.
function halfCourtMarkings() {
  return (
    <>
      <rect x={220} y={4} width={160} height={190} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
      <circle cx={300} cy={194} r={45} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
      <path d="M 45 4 L 45 150 A 331 331 0 0 0 555 150 L 555 4" fill="none" stroke="var(--silver)" strokeWidth={1.5} />
      <circle cx={300} cy={40} r={7} fill="none" stroke="var(--silver)" strokeWidth={2} />
    </>
  );
}

function courtBackground(template: CourtTemplate) {
  // All variants share the outer boundary; only the paint/arc placement changes.
  switch (template) {
    case "full":
      return (
        <>
          <rect x={4} y={4} width={592} height={412} fill="none" stroke="var(--silver)" strokeWidth={2} />
          <line x1={300} y1={4} x2={300} y2={416} stroke="var(--silver)" strokeWidth={1.5} />
          <circle cx={300} cy={210} r={35} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          {/* Left basket */}
          <rect x={4} y={135} width={80} height={150} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <circle cx={84} cy={210} r={45} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <circle cx={20} cy={210} r={7} fill="none" stroke="var(--silver)" strokeWidth={2} />
          <path d="M 4 36 L 108 36 A 219 219 0 0 1 108 384 L 4 384" fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          {/* Right basket (mirrored) */}
          <rect x={516} y={135} width={80} height={150} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <circle cx={516} cy={210} r={45} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <circle cx={580} cy={210} r={7} fill="none" stroke="var(--silver)" strokeWidth={2} />
          <path d="M 596 36 L 492 36 A 219 219 0 0 0 492 384 L 596 384" fill="none" stroke="var(--silver)" strokeWidth={1.5} />
        </>
      );
    case "baseline_oob":
      // Shrink the court slightly and shift it down, leaving real
      // out-of-bounds space above the highlighted baseline to place the
      // inbounder — previously they had to stand right on the line itself.
      return (
        <>
          <g transform="translate(0,35.34) scale(1,0.91505)">
            <rect x={4} y={4} width={592} height={412} fill="none" stroke="var(--silver)" strokeWidth={2} />
            {halfCourtMarkings()}
          </g>
          <line x1={4} y1={39} x2={596} y2={39} stroke="var(--gold)" strokeWidth={3} />
        </>
      );
    case "sideline_oob":
      return (
        <>
          <g transform="translate(35.24,0) scale(0.94088,1)">
            <rect x={4} y={4} width={592} height={412} fill="none" stroke="var(--silver)" strokeWidth={2} />
            {halfCourtMarkings()}
          </g>
          <line x1={39} y1={4} x2={39} y2={416} stroke="var(--gold)" strokeWidth={3} />
        </>
      );
    case "half":
    default:
      return (
        <>
          <rect x={4} y={4} width={592} height={412} fill="none" stroke="var(--silver)" strokeWidth={2} />
          {halfCourtMarkings()}
        </>
      );
  }
}

/** The ball's effective position — follows its holder (by id) when one is set, otherwise its own stored x/y. Shared by rendering and hit-testing so a click always lands where the ball is actually drawn.
 * ballHolderId only ever gets computed when advancing into a NEW frame based on the previous one's actions — drawing a dribble doesn't retroactively set it on that same frame, so falls back to a dribble action's own source player when ballHolderId isn't set yet (e.g. the very first step of a play, before ever clicking "Add step"). */
function getBallPos(f: PlayFrame): { x: number; y: number } | null {
  const holderId = f.ballHolderId ?? f.actions.find((a) => a.type === "dribble" && a.sourcePlayerId)?.sourcePlayerId ?? null;
  if (holderId) {
    const holder = f.players.find((p) => p.id === holderId);
    if (holder) return { x: holder.x, y: holder.y };
  }
  return f.ball;
}

function pointsToPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  return `M ${points[0].x} ${points[0].y} ` + points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");
}

function dribblePath(a: PlayAction) {
  const { x1, y1, x2, y2, curve } = a;
  if (!curve) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const n = Math.max(3, Math.round(len / 14));
    let d = `M ${x1} ${y1} `;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const px = x1 + dx * t, py = y1 + dy * t;
      const off = i % 2 === 0 ? 6 : -6;
      const nx = (-dy / len) * off, ny = (dx / len) * off;
      d += `L ${px + nx} ${py + ny} `;
    }
    return d;
  }
  // Curved dribble — zigzag perpendicular to the curve's local direction at
  // each sampled point, rather than one constant direction.
  const approxLen = Math.hypot(x2 - x1, y2 - y1) * 1.3; // curved paths run a bit longer than the straight chord
  const n = Math.max(6, Math.round(approxLen / 14));
  let d = `M ${x1} ${y1} `;
  for (let i = 1; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    const px = mt * mt * x1 + 2 * mt * t * curve.x + t * t * x2;
    const py = mt * mt * y1 + 2 * mt * t * curve.y + t * t * y2;
    const tdx = 2 * mt * (curve.x - x1) + 2 * t * (x2 - curve.x);
    const tdy = 2 * mt * (curve.y - y1) + 2 * t * (y2 - curve.y);
    const tlen = Math.hypot(tdx, tdy) || 1;
    const off = i % 2 === 0 ? 6 : -6;
    const nx = (-tdy / tlen) * off, ny = (tdx / tlen) * off;
    d += `L ${px + nx} ${py + ny} `;
  }
  return d;
}

function linePath(a: PlayAction) {
  if (a.curve2 && a.curve) return `M ${a.x1} ${a.y1} C ${a.curve.x} ${a.curve.y} ${a.curve2.x} ${a.curve2.y} ${a.x2} ${a.y2}`;
  if (a.curve) return `M ${a.x1} ${a.y1} Q ${a.curve.x} ${a.curve.y} ${a.x2} ${a.y2}`;
  return `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`;
}

/** Where the draggable "bend" handle sits — the curve's control point if set, otherwise the straight midpoint. */
function curveHandlePos(a: PlayAction) {
  return a.curve ?? { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 };
}

/** The Loop tool's second bend point — only meaningful when curve2 is set. */
function curveHandle2Pos(a: PlayAction) {
  return a.curve2 ?? { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 };
}

/** Direction the line is heading at its endpoint — the curve's tangent there if curved, otherwise the straight direction. Used to keep the screen's end-tick perpendicular to what's actually drawn. */
function endDirection(a: PlayAction) {
  if (a.curve2 && a.curve) return { dx: 3 * (a.x2 - a.curve2.x), dy: 3 * (a.y2 - a.curve2.y) };
  if (a.curve) return { dx: 2 * (a.x2 - a.curve.x), dy: 2 * (a.y2 - a.curve.y) };
  return { dx: a.x2 - a.x1, dy: a.y2 - a.y1 };
}

function ActionShape({ a }: { a: PlayAction }) {
  if (a.type === "screen") {
    const { dx, dy } = endDirection(a);
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 9, ny = (dx / len) * 9;
    return (
      <g>
        <path d={linePath(a)} fill="none" stroke="var(--text)" strokeWidth={4} />
        <line x1={a.x2 - nx} y1={a.y2 - ny} x2={a.x2 + nx} y2={a.y2 + ny} stroke="var(--text)" strokeWidth={4} />
      </g>
    );
  }
  if (a.type === "shot") {
    return (
      <g>
        <path d={linePath(a)} fill="none" stroke="#e2650f" strokeWidth={2.5}
          strokeDasharray="2,4" markerEnd="url(#pc-arrow-solid)" />
        <circle cx={a.x2} cy={a.y2} r={6} fill="none" stroke="#e2650f" strokeWidth={1.5} />
      </g>
    );
  }
  if (a.type === "lob") {
    return (
      <path d={linePath(a)} fill="none" stroke="#8a4fd6" strokeWidth={2.5}
        strokeDasharray="5,3" markerEnd="url(#pc-arrow-solid)" />
    );
  }
  if (a.type === "pass") {
    return (
      <g>
        <path d={linePath(a)} fill="none" stroke="#185FA5" strokeWidth={2.5}
          strokeDasharray="6,4" markerEnd="url(#pc-arrow-pass)" />
        {!a.targetPlayerId && (
          <circle cx={a.x2} cy={a.y2} r={9} fill="none" stroke="#E24B4A" strokeWidth={1.5} strokeDasharray="3,2" opacity={0.85} />
        )}
      </g>
    );
  }
  if (a.type === "dribble") {
    return (
      <path d={dribblePath(a)} fill="none" stroke="var(--text)" strokeWidth={2.5}
        markerEnd="url(#pc-arrow-solid)" />
    );
  }
  // "move" / cut — the type that can curl off a screen
  return (
    <path d={linePath(a)} fill="none" stroke="var(--text)" strokeWidth={2.5}
      markerEnd="url(#pc-arrow-solid)" />
  );
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distance from a point to an action's actual visible line — follows the curve when one is set, instead of the straight chord underneath it. */
function distToAction(px: number, py: number, a: PlayAction) {
  if (!a.curve) return distToSegment(px, py, a.x1, a.y1, a.x2, a.y2);
  let min = Infinity;
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t1 = i / steps, t2 = (i + 1) / steps;
    const mt1 = 1 - t1, mt2 = 1 - t2;
    const p1x = mt1 * mt1 * a.x1 + 2 * mt1 * t1 * a.curve.x + t1 * t1 * a.x2;
    const p1y = mt1 * mt1 * a.y1 + 2 * mt1 * t1 * a.curve.y + t1 * t1 * a.y2;
    const p2x = mt2 * mt2 * a.x1 + 2 * mt2 * t2 * a.curve.x + t2 * t2 * a.x2;
    const p2y = mt2 * mt2 * a.y1 + 2 * mt2 * t2 * a.curve.y + t2 * t2 * a.y2;
    min = Math.min(min, distToSegment(px, py, p1x, p1y, p2x, p2y));
  }
  return min;
}

const FACE_COLORS = ["#378ADD", "#639922", "#D85A30", "#D4537E", "#7F77DD"];

function PlayerIcon({ p, avatarUrl }: { p: PlayPlayer; avatarUrl?: string | null }) {
  const color = FACE_COLORS[(p.num - 1 + 5) % 5];
  if (avatarUrl) {
    const clipId = `pc-clip-${p.num}-${Math.round(p.x)}-${Math.round(p.y)}`;
    return (
      <g>
        <defs><clipPath id={clipId}><circle cx={p.x} cy={p.y} r={14} /></clipPath></defs>
        <circle cx={p.x} cy={p.y} r={15} fill="var(--surface)" stroke={color} strokeWidth={2} />
        <image href={avatarUrl} x={p.x - 14} y={p.y - 14} width={28} height={28} clipPath={`url(#${clipId})`} />
        <circle cx={p.x + 10} cy={p.y + 10} r={7} fill="var(--surface)" stroke={color} strokeWidth={1.5} />
        <text x={p.x + 10} y={p.y + 13} textAnchor="middle" fontSize={9} fontWeight={500} fill={color}>{p.num}</text>
        {p.handoff && (
          <g>
            <circle cx={p.x - 10} cy={p.y - 10} r={7} fill="var(--surface)" stroke="var(--gold)" strokeWidth={1.5} />
            <text x={p.x - 10} y={p.y - 7} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--gold)">*</text>
          </g>
        )}
      </g>
    );
  }
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={13} fill="#E6F1FB" stroke="#185FA5" strokeWidth={2} />
      <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontWeight={500} fill="#0C447C">{p.num}</text>
      {p.handoff && (
        <g>
          <circle cx={p.x - 10} cy={p.y - 10} r={7} fill="var(--surface)" stroke="var(--gold)" strokeWidth={1.5} />
          <text x={p.x - 10} y={p.y - 7} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--gold)">*</text>
        </g>
      )}
    </g>
  );
}

export default function PlayCanvas({
  frame, courtTemplate, roster = {}, edit = false, tool = null,
  onAddPlayer, onAddDefender, onSetBall, onAddAction, onErase,
  onMovePlayer, onMoveDefender, onMoveBall, onMoveActionPoint, onMoveActionWhole, onAddDrawing, onToggleHandoff, onSetActionCurve, onSetActionCurve2,
  onAddText, onMoveText, onEditText, onAddZone, onMoveZone, onAddCone, onMoveCone, onAddCoach, onMoveCoach, onAddShot, stampPreview,
  playSignal, onPlayDone, courtBg = "#3a2a17", selected = null, onSelect, selfOverride = null, speed = 1,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [justLinked, setJustLinked] = useState<string[]>([]);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[] | null>(null);
  const [animT, setAnimT] = useState<number | null>(null); // 0..1 while animating, null when idle
  const nextNum = (frame.players.length % 5) + 1;

  type MoveDrag =
    | { kind: "player" | "defender" | "text" | "cone" | "coach"; index: number }
    | { kind: "zone"; index: number; offsetX: number; offsetY: number }
    | { kind: "ball" }
    | { kind: "actionStart" | "actionEnd"; index: number }
    | { kind: "actionCurve"; index: number }
    | { kind: "actionCurve2"; index: number }
    | { kind: "actionWhole"; index: number; startX: number; startY: number; origA: PlayAction };
  const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
  const [movePos, setMovePos] = useState<{ x: number; y: number } | null>(null);

  function pointFromEvent(e: ReactMouseEvent): { x: number; y: number } {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  function handleMouseDown(e: ReactMouseEvent) {
    if (!edit || !tool) return;
    const p = pointFromEvent(e);
    if (tool === "player") { onAddPlayer?.({ id: genPlayerId(), num: nextNum, x: p.x, y: p.y }); return; }
    if (tool === "defender") { onAddDefender?.(p.x, p.y); return; }
    if (tool === "ball") { onSetBall?.(p.x, p.y); return; }
    if (tool === "erase") { onErase?.(p.x, p.y); return; }
    if (tool === "draw") { setDrawPoints([p]); return; }
    if (tool === "text") { onAddText?.(p.x, p.y); return; }
    if (tool === "handoff") {
      let closest = -1, closestDist = 20;
      frame.players.forEach((pl, i) => {
        const d = Math.hypot(pl.x - p.x, pl.y - p.y);
        if (d < closestDist) { closest = i; closestDist = d; }
      });
      if (closest >= 0) onToggleHandoff?.(closest);
      return;
    }
    if (tool === "cone") { onAddCone?.(p.x, p.y); return; }
    if (tool === "coach") { onAddCoach?.(p.x, p.y); return; }
    if (tool === "shot") {
      let closest = -1, closestDist = 20;
      frame.players.forEach((pl, i) => {
        const d = Math.hypot(pl.x - p.x, pl.y - p.y);
        if (d < closestDist) { closest = i; closestDist = d; }
      });
      if (closest >= 0) onAddShot?.(closest);
      return;
    }
    if (tool === "select") {
      const within = (a: { x: number; y: number }, r: number) => Math.hypot(a.x - p.x, a.y - p.y) < r;
      for (let i = 0; i < frame.players.length; i++) {
        if (within(frame.players[i], 16)) { setMoveDrag({ kind: "player", index: i }); setMovePos(p); return; }
      }
      for (let i = 0; i < frame.defenders.length; i++) {
        if (within(frame.defenders[i], 16)) { setMoveDrag({ kind: "defender", index: i }); setMovePos(p); return; }
      }
      const ballHit = getBallPos(frame);
      if (ballHit && within(ballHit, 12)) { setMoveDrag({ kind: "ball" }); setMovePos(p); return; }
      for (let i = 0; i < frame.actions.length; i++) {
        const a = frame.actions[i];
        if ((a.type === "move" || a.type === "pass" || a.type === "dribble" || a.type === "screen" || a.type === "lob") && within(curveHandlePos(a), 11)) {
          setMoveDrag({ kind: "actionCurve", index: i }); setMovePos(p); return;
        }
      }
      for (let i = 0; i < frame.actions.length; i++) {
        const a = frame.actions[i];
        if (a.curve2 && within(curveHandle2Pos(a), 11)) {
          setMoveDrag({ kind: "actionCurve2", index: i }); setMovePos(p); return;
        }
      }
      for (let i = 0; i < frame.actions.length; i++) {
        const a = frame.actions[i];
        if (within({ x: a.x1, y: a.y1 }, 11)) { setMoveDrag({ kind: "actionStart", index: i }); setMovePos(p); return; }
        if (within({ x: a.x2, y: a.y2 }, 11)) { setMoveDrag({ kind: "actionEnd", index: i }); setMovePos(p); return; }
      }
      for (let i = 0; i < frame.actions.length; i++) {
        const a = frame.actions[i];
        if (distToAction(p.x, p.y, a) < 14) {
          setMoveDrag({ kind: "actionWhole", index: i, startX: p.x, startY: p.y, origA: { ...a } });
          setMovePos(p);
          return;
        }
      }
      for (let i = 0; i < (frame.texts ?? []).length; i++) {
        if (within(frame.texts![i], 20)) { setMoveDrag({ kind: "text", index: i }); setMovePos(p); return; }
      }
      for (let i = 0; i < (frame.zones ?? []).length; i++) {
        const z = frame.zones![i];
        if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) {
          setMoveDrag({ kind: "zone", index: i, offsetX: p.x - z.x, offsetY: p.y - z.y });
          setMovePos(p);
          return;
        }
      }
      for (let i = 0; i < (frame.cones ?? []).length; i++) {
        if (within(frame.cones![i], 16)) { setMoveDrag({ kind: "cone", index: i }); setMovePos(p); return; }
      }
      for (let i = 0; i < (frame.coachMarkers ?? []).length; i++) {
        if (within(frame.coachMarkers![i], 16)) { setMoveDrag({ kind: "coach", index: i }); setMovePos(p); return; }
      }
      onSelect?.(null);
      return;
    }
    setDragStart(p);
  }

  function handleMouseMove(e: ReactMouseEvent) {
    if (drawPoints) { setDrawPoints((pts) => (pts ? [...pts, pointFromEvent(e)] : pts)); return; }
    if (dragStart) { setDragCurrent(pointFromEvent(e)); }
    if (!moveDrag) return;
    setMovePos(pointFromEvent(e));
  }

  function handleMouseUp(e: ReactMouseEvent) {
    if (drawPoints) {
      if (drawPoints.length > 1) onAddDrawing?.(drawPoints);
      setDrawPoints(null);
      return;
    }
    if (moveDrag) {
      const p = pointFromEvent(e);
      if (moveDrag.kind === "player") { onMovePlayer?.(moveDrag.index, p.x, p.y); onSelect?.({ kind: "player", index: moveDrag.index }); }
      else if (moveDrag.kind === "defender") { onMoveDefender?.(moveDrag.index, p.x, p.y); onSelect?.({ kind: "defender", index: moveDrag.index }); }
      else if (moveDrag.kind === "ball") { onMoveBall?.(p.x, p.y); onSelect?.({ kind: "ball", index: 0 }); }
      else if (moveDrag.kind === "actionStart") { onMoveActionPoint?.(moveDrag.index, "start", p.x, p.y); onSelect?.({ kind: "action", index: moveDrag.index }); }
      else if (moveDrag.kind === "actionEnd") { onMoveActionPoint?.(moveDrag.index, "end", p.x, p.y); onSelect?.({ kind: "action", index: moveDrag.index }); }
      else if (moveDrag.kind === "actionCurve") { onSetActionCurve?.(moveDrag.index, p.x, p.y); onSelect?.({ kind: "action", index: moveDrag.index }); }
      else if (moveDrag.kind === "actionCurve2") { onSetActionCurve2?.(moveDrag.index, p.x, p.y); onSelect?.({ kind: "action", index: moveDrag.index }); }
      else if (moveDrag.kind === "actionWhole") {
        const dx = p.x - moveDrag.startX, dy = p.y - moveDrag.startY;
        const a = moveDrag.origA;
        onMoveActionWhole?.(moveDrag.index, a.x1 + dx, a.y1 + dy, a.x2 + dx, a.y2 + dy, a.curve ? { x: a.curve.x + dx, y: a.curve.y + dy } : undefined);
        onSelect?.({ kind: "action", index: moveDrag.index });
      }
      else if (moveDrag.kind === "text") { onMoveText?.(moveDrag.index, p.x, p.y); onSelect?.({ kind: "text", index: moveDrag.index }); }
      else if (moveDrag.kind === "cone") { onMoveCone?.(moveDrag.index, p.x, p.y); onSelect?.({ kind: "cone", index: moveDrag.index }); }
      else if (moveDrag.kind === "coach") { onMoveCoach?.(moveDrag.index, p.x, p.y); onSelect?.({ kind: "coach", index: moveDrag.index }); }
      else if (moveDrag.kind === "zone") { onMoveZone?.(moveDrag.index, p.x - moveDrag.offsetX, p.y - moveDrag.offsetY); onSelect?.({ kind: "zone", index: moveDrag.index }); }
      setMoveDrag(null);
      setMovePos(null);
      return;
    }
    if (!edit || !dragStart || !tool) return;
    if (["move", "pass", "dribble", "screen", "lob", "loop"].includes(tool)) {
      const p = pointFromEvent(e);
      if (Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 8) {
        const nearestPlayer = (x: number, y: number) => {
          let best = -1, bestDist = 22;
          frame.players.forEach((pl, i) => {
            const d = Math.hypot(pl.x - x, pl.y - y);
            if (d < bestDist) { best = i; bestDist = d; }
          });
          return best >= 0 ? frame.players[best] : null;
        };
        // Cut and Loop are the only tools a defender can ever be the
        // source of — nothing ball-related (pass/dribble/screen/lob)
        // ever considers a defender, so those stay exactly as
        // player-only as they've always been. This is what keeps
        // defender movement scoped to just these two tools rather than
        // opening every action type up to them.
        const nearestDefender = (x: number, y: number) => {
          let best = -1, bestDist = 22;
          frame.defenders.forEach((d, i) => {
            const dd = Math.hypot(d.x - x, d.y - y);
            if (dd < bestDist) { best = i; bestDist = dd; }
          });
          return best >= 0 ? frame.defenders[best] : null;
        };
        const canTargetDefender = tool === "move" || tool === "loop";
        const nearestEntity = (x: number, y: number) => {
          const pl = nearestPlayer(x, y);
          if (!canTargetDefender) return pl;
          const df = nearestDefender(x, y);
          if (pl && df) {
            const dPl = Math.hypot(pl.x - x, pl.y - y), dDf = Math.hypot(df.x - x, df.y - y);
            return dPl <= dDf ? pl : df;
          }
          return pl ?? df;
        };
        // An explicit selection always wins over proximity guessing for
        // who this action belongs to — draw it anywhere on the court and
        // it's still assigned to whoever's selected, not whoever the
        // line happens to start near. A selected defender only counts
        // for Cut/Loop, same restriction as proximity detection above.
        const selectedEntity = selected?.kind === "player"
          ? frame.players[selected.index]
          : (selected?.kind === "defender" && canTargetDefender ? frame.defenders[selected.index] : null);
        const source = selectedEntity ?? nearestEntity(dragStart.x, dragStart.y);
        const target = (tool === "pass" || tool === "lob") ? nearestPlayer(p.x, p.y) : null;
        // If the selected entity already has an action in this step (e.g.
        // a screen), a new one chains onto the end of it — starting where
        // the previous one left off, one slot further in their sequence —
        // instead of restarting from their original position.
        const existingSeq = selectedEntity?.id
          ? frame.actions.filter((a) => a.sourcePlayerId === selectedEntity.id).sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0))
          : [];
        const priorAction = existingSeq[existingSeq.length - 1];
        const startX = priorAction ? priorAction.x2 : selectedEntity ? selectedEntity.x : dragStart.x;
        const startY = priorAction ? priorAction.y2 : selectedEntity ? selectedEntity.y : dragStart.y;
        const sequenceIndex = selectedEntity ? existingSeq.length : undefined;
        // The Loop tool is really just a Cut ("move") with two bend points
        // instead of one, seeded right away so there's something to see
        // and drag immediately — perpendicular to the drawn line, on the
        // same side, roughly a third of the way along from each end. The
        // coach can then drag either handle anywhere to reshape it.
        let curve: { x: number; y: number } | undefined;
        let curve2: { x: number; y: number } | undefined;
        if (tool === "loop") {
          const dx = p.x - startX, dy = p.y - startY;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const offset = Math.max(30, len * 0.4);
          curve = { x: startX + dx * 0.33 + nx * offset, y: startY + dy * 0.33 + ny * offset };
          curve2 = { x: startX + dx * 0.66 + nx * offset, y: startY + dy * 0.66 + ny * offset };
        }
        onAddAction?.({
          type: (tool === "loop" ? "move" : tool) as ActionType, x1: startX, y1: startY, x2: p.x, y2: p.y,
          sourcePlayerId: source?.id, targetPlayerId: target?.id, sequenceIndex, curve, curve2,
        });
        const linked = [source?.id, target?.id].filter(Boolean) as string[];
        if (linked.length) {
          setJustLinked(linked);
          setTimeout(() => setJustLinked([]), 700);
        }
      }
    } else if (tool === "zone") {
      const p = pointFromEvent(e);
      const x = Math.min(dragStart.x, p.x), y = Math.min(dragStart.y, p.y);
      const w = Math.abs(p.x - dragStart.x), h = Math.abs(p.y - dragStart.y);
      if (w > 10 && h > 10) onAddZone?.(x, y, w, h);
    }
    setDragStart(null);
    setDragCurrent(null);
  }

  // Play the current frame's actions once whenever playSignal changes.
  useEffect(() => {
    if (playSignal === undefined || playSignal === 0) return;
    // Same reasoning as the 3D viewer: 1400ms is calibrated for a single
    // action, so a chained sequence (a player's own multi-action chain,
    // or a multi-hop pass chain across different players) needs
    // proportionally more real time, not just a slice of the same fixed
    // total, or it plays back looking sped up once it's correctly
    // sequenced instead of overlapping.
    const maxChainLen = Math.max(
      1,
      ...frame.players.map((p) => (p.id ? playerActionSequence(frame, p.id).length : 1)),
      ...frame.defenders.map((d) => (d.id ? playerActionSequence(frame, d.id).length : 1)),
      ...frame.actions.filter((a) => a.type === "pass" || a.type === "lob").map((a) => ballChainSequence(frame, a).length)
    );
    const dur = (1400 * maxChainLen) / speed;
    const start = performance.now();
    let raf = 0;
    function step(now: number) {
      const t = Math.min(1, (now - start) / dur);
      setAnimT(t);
      if (t < 1) { raf = requestAnimationFrame(step); }
      else { setTimeout(() => { setAnimT(null); onPlayDone?.(); }, 350 / speed); }
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSignal]);

  // While dragging (select tool), render a preview with the dragged
  // element's position updated live — the actual frame only gets updated
  // once, on mouseup, via the onMove* callbacks.
  let displayFrame = frame;
  if (moveDrag && movePos) {
    if (moveDrag.kind === "player") {
      displayFrame = { ...frame, players: frame.players.map((p, i) => i === moveDrag.index ? { ...p, x: movePos.x, y: movePos.y } : p) };
    } else if (moveDrag.kind === "defender") {
      displayFrame = { ...frame, defenders: frame.defenders.map((d, i) => i === moveDrag.index ? { x: movePos.x, y: movePos.y } : d) };
    } else if (moveDrag.kind === "ball") {
      displayFrame = { ...frame, ball: { x: movePos.x, y: movePos.y } };
    } else if (moveDrag.kind === "actionStart") {
      displayFrame = { ...frame, actions: frame.actions.map((a, i) => i === moveDrag.index ? { ...a, x1: movePos.x, y1: movePos.y } : a) };
    } else if (moveDrag.kind === "actionEnd") {
      displayFrame = { ...frame, actions: frame.actions.map((a, i) => i === moveDrag.index ? { ...a, x2: movePos.x, y2: movePos.y } : a) };
    } else if (moveDrag.kind === "actionCurve") {
      displayFrame = { ...frame, actions: frame.actions.map((a, i) => i === moveDrag.index ? { ...a, curve: { x: movePos.x, y: movePos.y } } : a) };
    } else if (moveDrag.kind === "actionCurve2") {
      displayFrame = { ...frame, actions: frame.actions.map((a, i) => i === moveDrag.index ? { ...a, curve2: { x: movePos.x, y: movePos.y } } : a) };
    } else if (moveDrag.kind === "actionWhole") {
      const dx = movePos.x - moveDrag.startX, dy = movePos.y - moveDrag.startY;
      const orig = moveDrag.origA;
      displayFrame = {
        ...frame,
        actions: frame.actions.map((a, i) => i === moveDrag.index
          ? { ...a, x1: orig.x1 + dx, y1: orig.y1 + dy, x2: orig.x2 + dx, y2: orig.y2 + dy, curve: orig.curve ? { x: orig.curve.x + dx, y: orig.curve.y + dy } : undefined }
          : a),
      };
    } else if (moveDrag.kind === "text") {
      displayFrame = { ...frame, texts: (frame.texts ?? []).map((t, i) => i === moveDrag.index ? { ...t, x: movePos.x, y: movePos.y } : t) };
    } else if (moveDrag.kind === "cone") {
      displayFrame = { ...frame, cones: (frame.cones ?? []).map((c, i) => i === moveDrag.index ? { ...c, x: movePos.x, y: movePos.y } : c) };
    } else if (moveDrag.kind === "coach") {
      displayFrame = { ...frame, coachMarkers: (frame.coachMarkers ?? []).map((c, i) => i === moveDrag.index ? { ...c, x: movePos.x, y: movePos.y } : c) };
    } else if (moveDrag.kind === "zone") {
      displayFrame = { ...frame, zones: (frame.zones ?? []).map((z, i) => i === moveDrag.index ? { ...z, x: movePos.x - moveDrag.offsetX, y: movePos.y - moveDrag.offsetY } : z) };
    }
  }

  // The ball follows whoever currently holds it (even mid-drag), instead of
  // its own stored position — dragging the ball-carrier brings the ball along.
  const ballPos = getBallPos(displayFrame);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={{ width: "100%", height: "auto", display: "block", background: courtBg, borderRadius: 8, cursor: !edit || !tool ? "default" : tool === "select" ? (moveDrag ? "grabbing" : "grab") : "crosshair" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { setMoveDrag(null); setMovePos(null); setDrawPoints(null); setDragStart(null); setDragCurrent(null); }}
    >
      <defs>
        <marker id="pc-arrow-solid" markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--text)" />
        </marker>
        <marker id="pc-arrow-pass" markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#185FA5" />
        </marker>
      </defs>
      {courtBackground(courtTemplate)}

      {(displayFrame.zones ?? []).map((z, i) => (
        <rect key={i} x={z.x} y={z.y} width={z.w} height={z.h} fill="var(--gold)" opacity={0.15} stroke="var(--gold)" strokeWidth={1} strokeDasharray="4,3" />
      ))}
      {tool === "zone" && dragStart && dragCurrent && (
        <rect
          x={Math.min(dragStart.x, dragCurrent.x)} y={Math.min(dragStart.y, dragCurrent.y)}
          width={Math.abs(dragCurrent.x - dragStart.x)} height={Math.abs(dragCurrent.y - dragStart.y)}
          fill="var(--gold)" opacity={0.15} stroke="var(--gold)" strokeWidth={1} strokeDasharray="4,3"
        />
      )}

      {displayFrame.actions.map((a, i) => {
        const resolved = a.type === "pass" ? resolvePassEndpoint(displayFrame, a) : { x: a.x2, y: a.y2 };
        return <ActionShape key={i} a={{ ...a, x2: resolved.x, y2: resolved.y }} />;
      })}

      {displayFrame.actions.map((a, i) => {
        if (!a.sourcePlayerId) return null;
        const seq = playerActionSequence(displayFrame, a.sourcePlayerId);
        if (seq.length <= 1) return null;
        const order = (a.sequenceIndex ?? 0) + 1;
        return (
          <g key={"seq-" + i}>
            <circle cx={a.x1} cy={a.y1} r={8} fill="var(--gold)" stroke="#5a4200" strokeWidth={1} />
            <text x={a.x1} y={a.y1 + 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#2a1e00">{order}</text>
          </g>
        );
      })}

      {(displayFrame.drawings ?? []).map((d, i) => (
        <path key={i} d={pointsToPath(d.points)} fill="none" stroke="var(--gold)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {drawPoints && drawPoints.length > 1 && (
        <path d={pointsToPath(drawPoints)} fill="none" stroke="var(--gold)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      )}

      {displayFrame.players.map((p, i) => {
        const isSelf = !!(selfOverride && p.id === selfOverride.playerId);
        const rp = p.profile_id ? roster[p.profile_id] : undefined;
        const avatarUrl = isSelf ? selfOverride!.avatarUrl : rp?.avatar_url;
        return (
          <PlayerIcon
            key={i}
            p={p}
            avatarUrl={avatarUrl}
          />
        );
      })}

      {displayFrame.players.map((p, i) => p.id && justLinked.includes(p.id) && (
        <circle key={"link-" + i} cx={p.x} cy={p.y} r={22} fill="none" stroke="var(--gold)" strokeWidth={2.5} opacity={0.8}>
          <animate attributeName="r" values="16;24;16" dur="0.7s" repeatCount="1" />
          <animate attributeName="opacity" values="0.9;0.2;0.9" dur="0.7s" repeatCount="1" />
        </circle>
      ))}

      {displayFrame.defenders.map((d, i) => d.id && justLinked.includes(d.id) && (
        <circle key={"dlink-" + i} cx={d.x} cy={d.y} r={22} fill="none" stroke="var(--gold)" strokeWidth={2.5} opacity={0.8}>
          <animate attributeName="r" values="16;24;16" dur="0.7s" repeatCount="1" />
          <animate attributeName="opacity" values="0.9;0.2;0.9" dur="0.7s" repeatCount="1" />
        </circle>
      ))}

      {displayFrame.defenders.map((d, i) => (
        <g key={i}>
          <line x1={d.x - 9} y1={d.y - 9} x2={d.x + 9} y2={d.y + 9} stroke="#993C1D" strokeWidth={3} />
          <line x1={d.x - 9} y1={d.y + 9} x2={d.x + 9} y2={d.y - 9} stroke="#993C1D" strokeWidth={3} />
        </g>
      ))}

      {(displayFrame.cones ?? []).map((c, i) => (
        <g key={i}>
          <polygon points={`${c.x},${c.y - 13} ${c.x - 9},${c.y + 9} ${c.x + 9},${c.y + 9}`} fill="#e2650f" stroke="#7a3308" strokeWidth={1.2} />
          <rect x={c.x - 10} y={c.y + 7} width={20} height={4} rx={1} fill="#e2650f" stroke="#7a3308" strokeWidth={1} />
          <line x1={c.x - 5} y1={c.y - 3} x2={c.x + 5} y2={c.y - 3} stroke="#fff" strokeWidth={1.6} opacity={0.85} />
        </g>
      ))}

      {(displayFrame.coachMarkers ?? []).map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={13} fill="#2f4a7a" stroke="#1a2c4c" strokeWidth={1.5} />
          <text x={c.x} y={c.y + 1} textAnchor="middle" dominantBaseline="middle" fontSize={14} fontWeight={700} fill="#fff">C</text>
        </g>
      ))}

      {ballPos && (
        <circle cx={ballPos.x} cy={ballPos.y} r={8} fill="#EF9F27" stroke="#854F0B" strokeWidth={1.5} />
      )}

      {(displayFrame.texts ?? []).map((t, i) => {
        const w = Math.max(24, t.text.length * 6.2 + 10);
        return (
          <g key={i} style={{ cursor: edit ? "pointer" : undefined }} onDoubleClick={edit ? () => onEditText?.(i) : undefined}>
            <rect x={t.x - w / 2} y={t.y - 10} width={w} height={18} rx={4} fill="var(--surface)" stroke="var(--gold)" strokeWidth={1} opacity={0.92} />
            <text x={t.x} y={t.y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={500} fill="var(--gold)">{t.text}</text>
          </g>
        );
      })}

      {selected && selected.kind === "player" && displayFrame.players[selected.index] && (
        <circle cx={displayFrame.players[selected.index].x} cy={displayFrame.players[selected.index].y} r={20} fill="none" stroke="var(--gold)" strokeWidth={2} strokeDasharray="4,3" />
      )}
      {selected && selected.kind === "defender" && displayFrame.defenders[selected.index] && (
        <circle cx={displayFrame.defenders[selected.index].x} cy={displayFrame.defenders[selected.index].y} r={17} fill="none" stroke="var(--gold)" strokeWidth={2} strokeDasharray="4,3" />
      )}
      {selected && selected.kind === "ball" && ballPos && (
        <circle cx={ballPos.x} cy={ballPos.y} r={14} fill="none" stroke="var(--gold)" strokeWidth={2} strokeDasharray="4,3" />
      )}
      {selected && selected.kind === "action" && displayFrame.actions[selected.index] && (
        <path d={linePath(displayFrame.actions[selected.index])} fill="none" stroke="var(--gold)" strokeWidth={6} opacity={0.35} />
      )}
      {selected && selected.kind === "text" && (displayFrame.texts ?? [])[selected.index] && (
        <circle cx={(displayFrame.texts ?? [])[selected.index].x} cy={(displayFrame.texts ?? [])[selected.index].y} r={16} fill="none" stroke="var(--gold)" strokeWidth={2} strokeDasharray="4,3" />
      )}
      {selected && selected.kind === "cone" && (displayFrame.cones ?? [])[selected.index] && (
        <circle cx={(displayFrame.cones ?? [])[selected.index].x} cy={(displayFrame.cones ?? [])[selected.index].y} r={16} fill="none" stroke="var(--gold)" strokeWidth={2} strokeDasharray="4,3" />
      )}
      {selected && selected.kind === "coach" && (displayFrame.coachMarkers ?? [])[selected.index] && (
        <circle cx={(displayFrame.coachMarkers ?? [])[selected.index].x} cy={(displayFrame.coachMarkers ?? [])[selected.index].y} r={17} fill="none" stroke="var(--gold)" strokeWidth={2} strokeDasharray="4,3" />
      )}
      {selected && selected.kind === "zone" && (displayFrame.zones ?? [])[selected.index] && (() => {
        const z = (displayFrame.zones ?? [])[selected.index];
        return <rect x={z.x - 3} y={z.y - 3} width={z.w + 6} height={z.h + 6} fill="none" stroke="var(--gold)" strokeWidth={2} strokeDasharray="4,3" />;
      })()}

      {edit && tool === "select" && displayFrame.actions.map((a, i) => {
        const chp = (a.type === "move" || a.type === "pass" || a.type === "dribble" || a.type === "screen" || a.type === "lob") ? curveHandlePos(a) : null;
        const chp2 = a.curve2 ? curveHandle2Pos(a) : null;
        return (
          <g key={i}>
            <circle cx={a.x1} cy={a.y1} r={6} fill="var(--gold)" opacity={0.85} />
            <circle cx={a.x2} cy={a.y2} r={6} fill="var(--gold)" opacity={0.85} />
            {chp && <circle cx={chp.x} cy={chp.y} r={6} fill="none" stroke="var(--gold)" strokeWidth={2} opacity={0.85} />}
            {chp2 && <circle cx={chp2.x} cy={chp2.y} r={6} fill="none" stroke="var(--gold)" strokeWidth={2} opacity={0.85} />}
          </g>
        );
      })}

      {animT !== null && frame.actions.map((a, i) => {
        if (a.type === "screen") return null;
        const endpoint = a.type === "pass" ? resolvePassEndpoint(frame, a) : { x: a.x2, y: a.y2 };
        const localT = localActionProgress(animT, a, frame);
        let x: number, y: number;
        if (a.curve2 && a.curve) {
          const t = localT, mt = 1 - t;
          x = mt * mt * mt * a.x1 + 3 * mt * mt * t * a.curve.x + 3 * mt * t * t * a.curve2.x + t * t * t * endpoint.x;
          y = mt * mt * mt * a.y1 + 3 * mt * mt * t * a.curve.y + 3 * mt * t * t * a.curve2.y + t * t * t * endpoint.y;
        } else if (a.curve) {
          const t = localT, mt = 1 - t;
          x = mt * mt * a.x1 + 2 * mt * t * a.curve.x + t * t * endpoint.x;
          y = mt * mt * a.y1 + 2 * mt * t * a.curve.y + t * t * endpoint.y;
        } else {
          x = a.x1 + (endpoint.x - a.x1) * localT;
          y = a.y1 + (endpoint.y - a.y1) * localT;
        }
        const isShot = a.type === "shot";
        return <circle key={i} cx={x} cy={y} r={a.type === "pass" ? 6 : isShot ? 7 : 9} fill={isShot ? "#EF9F27" : "#378ADD"} stroke={isShot ? "#854F0B" : undefined} strokeWidth={isShot ? 1.5 : 0} opacity={0.9} />;
      })}

      {stampPreview && (
        <g opacity={0.5} pointerEvents="none">
          {stampPreview.actions.map((a, i) => <ActionShape key={"ghost-a-" + i} a={a} />)}
          {stampPreview.ball && (
            <circle cx={stampPreview.ball.x} cy={stampPreview.ball.y} r={8} fill="#EF9F27" stroke="#854F0B" strokeWidth={1.5} strokeDasharray="2,2" />
          )}
          {stampPreview.players.map((p, i) => (
            <g key={"ghost-p-" + i}>
              <circle cx={p.x} cy={p.y} r={14} fill="#1a3fa8" stroke="var(--gold)" strokeWidth={1.5} strokeDasharray="3,2" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{p.num}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
