// src/components/quizzes/QuizPlayVisual.tsx
// The court that goes with a play-quiz question, drawn with the same
// PlayCanvas the play viewer uses.
//
//   QuizPlayVisual -- the question's court.
//     * A question with a lead-up ("what happens next", "who gets the
//       ball") plays the step before the moment asked about, then pauses
//       there; the answers appear once it has played. The lead-up is every
//       step from the start of the play (a step-4 question plays 1-3), so
//       the player follows the play to the moment asked about. Watch again
//       replays it all; Last step only replays just the one before. Step 1
//       has no lead-up.
//     * A "name that play" visual plays its opening when the player taps
//       Watch, then hides the court before the answers appear.
//   QuizPlayReveal -- the answering step (arrows and all), shown with the
//     result. Only exists once the answer is locked.
//
// The court is capped at about phone width so the question and answers
// fit on screen on a desktop too.

import { useEffect, useRef, useState } from "react";
import PlayCanvas, { CANVAS_W, CANVAS_H } from "../plays/PlayCanvas";
import type { CourtTemplate, PlayFrame } from "../../lib/plays";
import type { QuizVisual, QuizReveal, QuizHeading, TapPoint } from "../../lib/quizzes";

/**
 * Drawn over the court for "Where do you go": catches taps (in the court's
 * own coordinates, so it works at any screen size) and shows the tap and,
 * once answered, the right spot with how close counted.
 */
function TapOverlay({ tap, target, onTap, num }: {
  tap?: TapPoint | null;
  target?: { point: TapPoint; radius: number } | null;
  onTap?: (p: TapPoint) => void;
  num?: number | null;
}) {
  function handle(e: React.MouseEvent<SVGSVGElement>) {
    if (!onTap) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    onTap({ x: Math.max(0, Math.min(CANVAS_W, Math.round(p.x))), y: Math.max(0, Math.min(CANVAS_H, Math.round(p.y))) });
  }
  return (
    <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} onClick={handle}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: onTap ? "crosshair" : "default" }}>
      {target && (
        <>
          <circle cx={target.point.x} cy={target.point.y} r={target.radius} fill="rgba(40,180,80,0.12)" stroke="#28b450" strokeWidth={2} strokeDasharray="6 4" />
          <circle cx={target.point.x} cy={target.point.y} r={5} fill="#28b450" />
        </>
      )}
      {tap && (
        <g>
          <circle cx={tap.x} cy={tap.y} r={14} fill="#F0C040" fillOpacity={0.9} stroke="#fff" strokeWidth={2} />
          {num != null && <text x={tap.x} y={tap.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#2A2008">{num}</text>}
        </g>
      )}
    </svg>
  );
}

const COURT_MAX = 520;
const courtBox: React.CSSProperties = {
  background: "var(--surface2)", borderRadius: 12, padding: 8, marginBottom: 10,
  maxWidth: COURT_MAX, marginLeft: "auto", marginRight: "auto",
};
const smallBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "3px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

/**
 * Which play and which step, big enough to read at a glance -- players
 * need it to answer. Older questions without a heading fall back to the
 * small caption line.
 */
function PlayHeading({ heading, status }: { heading: QuizHeading; status?: string | null }) {
  return (
    <div style={{ maxWidth: COURT_MAX, margin: "0 auto 8px" }}>
      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.2, color: "var(--text)" }}>{heading.play}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ background: "rgba(240,192,64,0.16)", border: "1px solid rgba(240,192,64,0.5)", color: "var(--gold)",
          borderRadius: 8, padding: "4px 10px", fontSize: 14, fontWeight: 700 }}>
          Step {heading.stepNumber}{heading.stepName ? ` · ${heading.stepName}` : heading.stepNumber === 1 ? " · Start of the play" : ""}
        </span>
        {heading.ballHolder != null && (
          <span style={{ fontSize: 13, color: "var(--text)" }}>🏀 The {heading.ballHolder} has the ball</span>
        )}
        {status && <span style={{ fontSize: 12, color: "var(--muted)" }}>{status}</span>}
      </div>
    </div>
  );
}

export function QuizPlayVisual({ visual, onReady, compact = false, tap, onTap, target, tapNum }: {
  visual: QuizVisual;
  /** Called once when the answers may be shown. */
  onReady?: () => void;
  compact?: boolean;
  /** "Where do you go": the current tap, a tap handler (null when locked), and the right spot once answered. */
  tap?: TapPoint | null;
  onTap?: ((p: TapPoint) => void) | null;
  target?: { point: TapPoint; radius: number } | null;
  tapNum?: number | null;
}) {
  const hideAfter = !!visual.hide_after;
  const lead = visual.lead_frames ?? [];
  // What's playing right now (a list of steps), and where in it.
  const [queue, setQueue] = useState<PlayFrame[] | null>(null);
  const [pos, setPos] = useState(0);
  // Which step number the queue starts at (1 = the start of the play).
  const [queueStart, setQueueStart] = useState(1);
  const [signal, setSignal] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [started, setStarted] = useState(false);
  const readySent = useRef(false);

  function ready() {
    if (readySent.current) return;
    readySent.current = true;
    onReady?.();
  }

  function play(frames: PlayFrame[], startStep = 1) {
    setQueueStart(startStep);
    if (!frames.length) return;
    setHidden(false);
    setQueue(frames);
    setPos(0);
    // Let the first frame mount before playing it.
    window.setTimeout(() => setSignal(n => n + 1), 60);
  }

  // New question: reset, then start the lead-up (or be ready at once).
  useEffect(() => {
    readySent.current = false;
    setQueue(null); setPos(0); setSignal(0); setHidden(false); setStarted(false);
    if (compact) return;
    if (hideAfter) return;                       // waits for the Watch tap
    if (lead.length) play(lead, 1);
    else ready();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visual]);

  function stepDone() {
    if (!queue) return;
    if (pos < queue.length - 1) {
      setPos(p => p + 1);
      window.setTimeout(() => setSignal(n => n + 1), 60);
      return;
    }
    setQueue(null);
    if (hideAfter) setHidden(true);
    ready();
  }

  // Name that play: the opening, then the court hides.
  if (hideAfter && hidden && !compact) {
    return (
      <div style={{ ...courtBox, height: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Court hidden — which play was that?</div>
        <button type="button" onClick={() => play(visual.frames)} style={smallBtn}>Watch again</button>
      </div>
    );
  }

  const playing = queue ? queue[Math.min(pos, queue.length - 1)] : null;
  const shown = playing ?? visual.frames[0];
  if (!shown) return null;

  return (
    <>
    {!compact && visual.heading && (
      <PlayHeading heading={visual.heading}
        status={playing && !hideAfter ? `▶ Lead-up: step ${queueStart + pos} of ${lead.length}` : null} />
    )}
    <div style={compact ? { background: "var(--surface2)", borderRadius: 8, padding: 4 } : courtBox}>
      <div style={{ position: "relative" }}>
        <PlayCanvas
          frame={shown}
          courtTemplate={visual.court_template as CourtTemplate}
          edit={false}
          playSignal={playing ? signal : undefined}
          onPlayDone={playing ? stepDone : undefined}
        />
        {!compact && !playing && (onTap || tap || target) && (
          <TapOverlay tap={tap} target={target} onTap={onTap ?? undefined} num={tapNum} />
        )}
      </div>
      {!compact && (
        <>
          {visual.caption && !visual.heading && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
              {playing && !hideAfter ? "Lead-up — " : ""}{visual.caption}
            </div>
          )}
          {hideAfter && !started && (
            <button type="button" onClick={() => { setStarted(true); play(visual.frames); }}
              style={{ width: "100%", marginTop: 8, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              ▶ Watch the play — the court hides when it ends
            </button>
          )}
          {!hideAfter && lead.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <button type="button" disabled={!!playing} onClick={() => play(lead, 1)} style={smallBtn}>↺ Watch again</button>
              {lead.length > 1 && (
                <button type="button" disabled={!!playing} onClick={() => play([lead[lead.length - 1]], lead.length)} style={smallBtn}>Last step only</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
}

export function QuizPlayReveal({ reveal, tap, target, tapNum }: {
  reveal: QuizReveal;
  /** "Where do you go": the player's tap and the right spot, drawn over the step. */
  tap?: TapPoint | null;
  target?: { point: TapPoint; radius: number } | null;
  tapNum?: number | null;
}) {
  const [signal, setSignal] = useState(0);
  return (
    <>
    {reveal.heading && <PlayHeading heading={reveal.heading} />}
    <div style={courtBox}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", marginBottom: 6 }}>What happens on this step</div>
      <div style={{ position: "relative" }}>
        <PlayCanvas frame={reveal.frame} courtTemplate={reveal.court_template as CourtTemplate} edit={false} playSignal={signal} />
        {(tap || target) && <TapOverlay tap={tap} target={target} num={tapNum} />}
      </div>
      <button type="button" onClick={() => setSignal(n => n + 1)} style={{ ...smallBtn, marginTop: 6 }}>▶ Play the step</button>
    </div>
    </>
  );
}
