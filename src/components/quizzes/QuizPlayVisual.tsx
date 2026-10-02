// src/components/quizzes/QuizPlayVisual.tsx
// The court that goes with a play-quiz question, drawn with the same
// PlayCanvas the play viewer uses.
//
//   QuizPlayVisual -- the question's court. A "name that play" visual
//                     animates its opening steps, then hides the court and
//                     calls onReady so the answers can appear.
//   QuizPlayReveal -- the answering step (arrows and all), shown with the
//                     result. Only exists once the answer is locked.

import { useEffect, useState } from "react";
import PlayCanvas from "../plays/PlayCanvas";
import type { CourtTemplate } from "../../lib/plays";
import type { QuizVisual, QuizReveal } from "../../lib/quizzes";

const courtBox: React.CSSProperties = { background: "var(--surface2)", borderRadius: 12, padding: 8, marginBottom: 10 };

export function QuizPlayVisual({ visual, onReady, compact = false }: {
  visual: QuizVisual;
  /** Called when answers may be shown: at once, or after a hide-after animation. */
  onReady?: () => void;
  compact?: boolean;
}) {
  const animated = !!visual.hide_after;
  const [idx, setIdx] = useState(0);
  const [signal, setSignal] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [started, setStarted] = useState(false);

  // Reset whenever the question changes.
  useEffect(() => {
    setIdx(0); setHidden(false); setStarted(false); setSignal(0);
    if (!animated) onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visual]);

  function start() {
    setIdx(0); setHidden(false); setStarted(true);
    setSignal(n => n + 1);
  }

  function stepDone() {
    if (!animated || !started) return;
    if (idx < visual.frames.length - 1) {
      setIdx(i => i + 1);
      // Let the next frame mount before playing it.
      window.setTimeout(() => setSignal(n => n + 1), 60);
    } else {
      setHidden(true);
      onReady?.();
    }
  }

  const frame = visual.frames[Math.min(idx, visual.frames.length - 1)];
  if (!frame) return null;

  if (animated && hidden) {
    return (
      <div style={{ ...courtBox, height: compact ? 90 : 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Court hidden — which play was that?</div>
        <button type="button" onClick={start}
          style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Watch again
        </button>
      </div>
    );
  }

  return (
    <div style={courtBox}>
      <PlayCanvas
        frame={frame}
        courtTemplate={visual.court_template as CourtTemplate}
        edit={false}
        playSignal={animated ? signal : undefined}
        onPlayDone={animated ? stepDone : undefined}
      />
      {visual.caption && !compact && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{visual.caption}</div>
      )}
      {animated && !started && !compact && (
        <button type="button" onClick={start}
          style={{ width: "100%", marginTop: 8, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          ▶ Watch the play — the court hides when it ends
        </button>
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
      <button type="button" onClick={() => setSignal(n => n + 1)}
        style={{ marginTop: 6, background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
        ▶ Play the step
      </button>
    </div>
  );
}
