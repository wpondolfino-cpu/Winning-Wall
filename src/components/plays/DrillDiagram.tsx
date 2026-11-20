// src/components/plays/DrillDiagram.tsx
// A drill's diagram, read-only: the court drawing from the play designer,
// with step buttons and "Play steps" when the drill has more than one
// step. Used in the Drill Library, the player's practice schedule and the
// printout (static, first step only).

import { useState } from "react";
import PlayCanvas from "./PlayCanvas";
import StepNote from "./StepNote";
import type { Play } from "../../lib/plays";

interface Props {
  play: Play;
  /** Static: just the first step, no buttons (thumbnails, printing). */
  still?: boolean;
  /** Small list thumbnail: no padding, no step note. */
  thumb?: boolean;
}

export default function DrillDiagram({ play, still = false, thumb = false }: Props) {
  const frames = play.data?.frames ?? [];
  const [idx, setIdx] = useState(0);
  const [signal, setSignal] = useState(0);
  if (!frames.length) return null;
  const frame = frames[Math.min(idx, frames.length - 1)];

  const done = () => {
    if (idx < frames.length - 1) {
      setIdx(i => i + 1);
      setTimeout(() => setSignal(s => s + 1), 150);
    }
  };

  if (still || thumb) {
    // The printout uses the same light court and dark lines as printed
    // plays, so it reads on paper and doesn't burn ink.
    return (
      <div style={{ pointerEvents: "none", borderRadius: thumb ? 5 : 8, overflow: "hidden", ...(still ? { ["--silver" as any]: "#555" } : {}) }}>
        <PlayCanvas frame={frames[0]} courtTemplate={play.court_template} edit={false} labels={play.data?.labels ?? "numbers"} {...(still ? { courtBg: "#f3e4c8" } : {})} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ borderRadius: 8, overflow: "hidden" }}>
        <PlayCanvas frame={frame} courtTemplate={play.court_template} edit={false} labels={play.data?.labels ?? "numbers"} playSignal={signal} onPlayDone={done} />
      </div>
      {frames.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <button onClick={() => { setIdx(0); setTimeout(() => setSignal(s => s + 1), 50); }}
            style={{ padding: "5px 12px", fontSize: 12, borderRadius: 7, border: "1px solid var(--royal)", background: "var(--royal)", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
            ▶ Play steps
          </button>
          {frames.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)}
              style={{ padding: "4px 9px", fontSize: 12, borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
                border: i === idx ? "2px solid var(--gold)" : "1px solid var(--border)", background: "transparent", color: "var(--text)" }}>
              Step {i + 1}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <StepNote frame={frame} index={idx} totalSteps={frames.length} />
      </div>
    </div>
  );
}
