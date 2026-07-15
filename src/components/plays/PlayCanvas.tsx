// src/components/plays/PlayCanvas.tsx
// The shared rendering + drawing/animation engine for a single play frame.
// Both PlayEditor (edit=true) and PlayViewer (edit=false) render this —
// it's the one place that knows how to draw a court, a player/defender/
// ball icon, an action line, and how to animate one. Coordinate space is
// always the same 600x420 grid regardless of court_template, so saved
// actions and forked plays stay valid if the template changes later.

import { useRef, useState, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import type { CourtTemplate, PlayFrame, PlayPlayer, PlayAction, ActionType } from "../../lib/plays";
import type { RosterPlayer } from "../../lib/plays";

export const CANVAS_W = 600;
export const CANVAS_H = 420;

interface Props {
  frame: PlayFrame;
  courtTemplate: CourtTemplate;
  avatarsDefault: boolean;
  /** profile_id -> roster info, used to resolve a player's avatar/name. */
  roster?: Record<string, RosterPlayer>;
  /** When true, clicks/drags on the court edit the frame via the callbacks below. */
  edit?: boolean;
  tool?: "player" | "defender" | "ball" | ActionType | "erase" | null;
  onAddPlayer?: (p: PlayPlayer) => void;
  onAddDefender?: (x: number, y: number) => void;
  onSetBall?: (x: number, y: number) => void;
  onAddAction?: (a: PlayAction) => void;
  onErase?: (x: number, y: number) => void;
  onToggleAvatar?: (index: number) => void;
  /** Bump this number to play the current frame's actions once. */
  playSignal?: number;
  onPlayDone?: () => void;
  /** Override the court's background fill — used by PlayPrintView for a lighter, ink-friendly tone. */
  courtBg?: string;
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
          <rect x={4} y={135} width={80} height={150} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <rect x={516} y={135} width={80} height={150} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <path d="M 40 60 A 190 190 0 0 1 40 360" fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <path d="M 560 60 A 190 190 0 0 0 560 360" fill="none" stroke="var(--silver)" strokeWidth={1.5} />
        </>
      );
    case "baseline_oob":
      return (
        <>
          <rect x={4} y={4} width={592} height={412} fill="none" stroke="var(--silver)" strokeWidth={2} />
          <rect x={220} y={4} width={160} height={190} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <line x1={4} y1={4} x2={596} y2={4} stroke="var(--gold)" strokeWidth={3} />
          <circle cx={300} cy={194} r={45} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
        </>
      );
    case "sideline_oob":
      return (
        <>
          <rect x={4} y={4} width={592} height={412} fill="none" stroke="var(--silver)" strokeWidth={2} />
          <rect x={220} y={4} width={160} height={190} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <line x1={4} y1={4} x2={4} y2={416} stroke="var(--gold)" strokeWidth={3} />
          <circle cx={300} cy={194} r={45} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
        </>
      );
    case "half":
    default:
      return (
        <>
          <rect x={4} y={4} width={592} height={412} fill="none" stroke="var(--silver)" strokeWidth={2} />
          <rect x={220} y={4} width={160} height={190} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <circle cx={300} cy={194} r={45} fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <path d="M 50 4 A 260 260 0 0 0 550 4" fill="none" stroke="var(--silver)" strokeWidth={1.5} />
          <circle cx={300} cy={40} r={7} fill="none" stroke="var(--silver)" strokeWidth={2} />
        </>
      );
  }
}

function dribblePath(x1: number, y1: number, x2: number, y2: number) {
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

function ActionShape({ a }: { a: PlayAction }) {
  if (a.type === "screen") {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 9, ny = (dx / len) * 9;
    return (
      <g>
        <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="var(--text)" strokeWidth={4} />
        <line x1={a.x2 - nx} y1={a.y2 - ny} x2={a.x2 + nx} y2={a.y2 + ny} stroke="var(--text)" strokeWidth={4} />
      </g>
    );
  }
  if (a.type === "pass") {
    return (
      <path d={`M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`} fill="none" stroke="#185FA5" strokeWidth={2.5}
        strokeDasharray="6,4" markerEnd="url(#pc-arrow-pass)" />
    );
  }
  if (a.type === "dribble") {
    return (
      <path d={dribblePath(a.x1, a.y1, a.x2, a.y2)} fill="none" stroke="var(--text)" strokeWidth={2.5}
        markerEnd="url(#pc-arrow-solid)" />
    );
  }
  // "move" / cut
  return (
    <path d={`M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`} fill="none" stroke="var(--text)" strokeWidth={2.5}
      markerEnd="url(#pc-arrow-solid)" />
  );
}

const FACE_COLORS = ["#378ADD", "#639922", "#D85A30", "#D4537E", "#7F77DD"];

function PlayerIcon({ p, showAvatar, avatarUrl, onDoubleClick }: {
  p: PlayPlayer; showAvatar: boolean; avatarUrl?: string | null; onDoubleClick?: () => void;
}) {
  const color = FACE_COLORS[(p.num - 1 + 5) % 5];
  if (showAvatar && avatarUrl) {
    const clipId = `pc-clip-${p.num}-${Math.round(p.x)}-${Math.round(p.y)}`;
    return (
      <g style={{ cursor: onDoubleClick ? "pointer" : undefined }} onDoubleClick={onDoubleClick}>
        <defs><clipPath id={clipId}><circle cx={p.x} cy={p.y} r={14} /></clipPath></defs>
        <circle cx={p.x} cy={p.y} r={15} fill="var(--surface)" stroke={color} strokeWidth={2} />
        <image href={avatarUrl} x={p.x - 14} y={p.y - 14} width={28} height={28} clipPath={`url(#${clipId})`} />
        <circle cx={p.x + 10} cy={p.y + 10} r={7} fill="var(--surface)" stroke={color} strokeWidth={1.5} />
        <text x={p.x + 10} y={p.y + 13} textAnchor="middle" fontSize={9} fontWeight={500} fill={color}>{p.num}</text>
      </g>
    );
  }
  if (showAvatar) {
    // Avatar mode on, but this player has no photo on file yet — fall back gracefully.
    return (
      <g style={{ cursor: onDoubleClick ? "pointer" : undefined }} onDoubleClick={onDoubleClick}>
        <circle cx={p.x} cy={p.y} r={14} fill={color} opacity={0.18} stroke={color} strokeWidth={2} />
        <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize={13} fill={color}>?</text>
        <circle cx={p.x + 10} cy={p.y + 10} r={7} fill="var(--surface)" stroke={color} strokeWidth={1.5} />
        <text x={p.x + 10} y={p.y + 13} textAnchor="middle" fontSize={9} fontWeight={500} fill={color}>{p.num}</text>
      </g>
    );
  }
  return (
    <g style={{ cursor: onDoubleClick ? "pointer" : undefined }} onDoubleClick={onDoubleClick}>
      <circle cx={p.x} cy={p.y} r={13} fill="#E6F1FB" stroke="#185FA5" strokeWidth={2} />
      <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontWeight={500} fill="#0C447C">{p.num}</text>
    </g>
  );
}

export default function PlayCanvas({
  frame, courtTemplate, avatarsDefault, roster = {}, edit = false, tool = null,
  onAddPlayer, onAddDefender, onSetBall, onAddAction, onErase, onToggleAvatar,
  playSignal, onPlayDone, courtBg = "#3a2a17",
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [animT, setAnimT] = useState<number | null>(null); // 0..1 while animating, null when idle
  const nextNum = (frame.players.length % 5) + 1;

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
    if (tool === "player") { onAddPlayer?.({ num: nextNum, x: p.x, y: p.y }); return; }
    if (tool === "defender") { onAddDefender?.(p.x, p.y); return; }
    if (tool === "ball") { onSetBall?.(p.x, p.y); return; }
    if (tool === "erase") { onErase?.(p.x, p.y); return; }
    setDragStart(p);
  }

  function handleMouseUp(e: ReactMouseEvent) {
    if (!edit || !dragStart || !tool) return;
    if (["move", "pass", "dribble", "screen"].includes(tool)) {
      const p = pointFromEvent(e);
      if (Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 8) {
        onAddAction?.({ type: tool as ActionType, x1: dragStart.x, y1: dragStart.y, x2: p.x, y2: p.y });
      }
    }
    setDragStart(null);
  }

  // Play the current frame's actions once whenever playSignal changes.
  useEffect(() => {
    if (playSignal === undefined || playSignal === 0) return;
    const dur = 1400;
    const start = performance.now();
    let raf = 0;
    function step(now: number) {
      const t = Math.min(1, (now - start) / dur);
      setAnimT(t);
      if (t < 1) { raf = requestAnimationFrame(step); }
      else { setTimeout(() => { setAnimT(null); onPlayDone?.(); }, 350); }
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSignal]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      style={{ width: "100%", height: "auto", display: "block", background: courtBg, borderRadius: 8, cursor: edit && tool ? "crosshair" : "default" }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
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

      {frame.actions.map((a, i) => <ActionShape key={i} a={a} />)}

      {frame.players.map((p, i) => {
        const rp = p.profile_id ? roster[p.profile_id] : undefined;
        const showAvatar = p.showAvatar ?? avatarsDefault;
        return (
          <PlayerIcon
            key={i}
            p={p}
            showAvatar={showAvatar}
            avatarUrl={rp?.avatar_url}
            onDoubleClick={edit ? () => onToggleAvatar?.(i) : undefined}
          />
        );
      })}

      {frame.defenders.map((d, i) => (
        <g key={i}>
          <line x1={d.x - 9} y1={d.y - 9} x2={d.x + 9} y2={d.y + 9} stroke="#993C1D" strokeWidth={3} />
          <line x1={d.x - 9} y1={d.y + 9} x2={d.x + 9} y2={d.y - 9} stroke="#993C1D" strokeWidth={3} />
        </g>
      ))}

      {frame.ball && (
        <circle cx={frame.ball.x} cy={frame.ball.y} r={8} fill="#EF9F27" stroke="#854F0B" strokeWidth={1.5} />
      )}

      {animT !== null && frame.actions.map((a, i) => {
        if (a.type === "screen") return null;
        const x = a.x1 + (a.x2 - a.x1) * animT;
        const y = a.y1 + (a.y2 - a.y1) * animT;
        return <circle key={i} cx={x} cy={y} r={a.type === "pass" ? 6 : 9} fill="#378ADD" opacity={0.9} />;
      })}
    </svg>
  );
}
