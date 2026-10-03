// src/components/quizzes/QuizPlayVisual.tsx
// The court that goes with a play-quiz question, drawn with the same
// PlayCanvas the play viewer uses.
//
//   QuizPlayVisual -- the question's court.
//     * A question with a lead-up ("what happens next", "who gets the
//       ball") plays the step before the moment asked about, then pauses
//       there; the answers appear once it has played. Replay last step and
//       Watch from the start replay it. Step 1 has no lead-up.
//     * A "name that play" visual plays its opening when the player taps
//       Watch, then hides the court before the answers appear.
//   QuizPlayReveal -- the answering step (arrows and all), shown with the
//     result. Only exists once the answer is locked.
//
// The court is capped at about phone width so the question and answers
// fit on screen on a desktop too.

import { useEffect, useRef, useState } from "react";
import PlayCanvas from "../plays/PlayCanvas";
import type { CourtTemplate, PlayFrame } from "../../lib/plays";
import type { QuizVisual, QuizReveal } from "../../lib/quizzes";

const COURT_MAX = 520;
const courtBox: React.CSSProperties = {
  background: "var(--surface2)", borderRadius: 12, padding: 8, marginBottom: 10,
  maxWidth: COURT_MAX, marginLeft: "auto", marginRight: "auto",
};
const smallBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "3px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

export function QuizPlayVisual({ visual, onReady, compact = false }: {
  visual: QuizVisual;
  /** Called once when the answers may be shown. */
  onReady?: () => void;
  compact?: boolean;
}) {
  const hideAfter = !!visual.hide_after;
  const lead = visual.lead_frames ?? [];
  // What's playing right now (a list of steps), and where in it.
  const [queue, setQueue] = useState<PlayFrame[] | null>(null);
  const [pos, setPos] = useState(0);
  const [signal, setSignal] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [started, setStarted] = useState(false);
  const readySent = useRef(false);

  function ready() {
    if (readySent.current) return;
    readySent.current = true;
    onReady?.();
  }

  function play(frames: PlayFrame[]) {
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
    if (lead.length) play([lead[lead.length - 1]]);
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
    <div style={compact ? { background: "var(--surface2)", borderRadius: 8, padding: 4 } : courtBox}>
      <PlayCanvas
        frame={shown}
        courtTemplate={visual.court_template as CourtTemplate}
        edit={false}
        playSignal={playing ? signal : undefined}
        onPlayDone={playing ? stepDone : undefined}
      />
      {!compact && (
        <>
          {visual.caption && (
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
              <button type="button" disabled={!!playing} onClick={() => play([lead[lead.length - 1]])} style={smallBtn}>↺ Replay last step</button>
              {lead.length > 1 && (
                <button type="button" disabled={!!playing} onClick={() => play(lead)} style={smallBtn}>⏮ Watch from the start</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function QuizPlayReveal({ reveal }: { reveal: QuizReveal }) {
  const [signal, setSignal] = useState(0);
  return (
    <div style={courtBox}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", marginBottom: 6 }}>What happens on this step</div>
      <PlayCanvas frame={reveal.frame} courtTemplate={reveal.court_template as CourtTemplate} edit={false} playSignal={signal} />
      <button type="button" onClick={() => setSignal(n => n + 1)} style={{ ...smallBtn, marginTop: 6 }}>▶ Play the step</button>
    </div>
  );
}
