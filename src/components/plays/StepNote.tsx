// src/components/plays/StepNote.tsx
// A step's name and coaching notes, shown under the court in the 2D and 3D
// viewers. Renders nothing for an unnamed step with no notes, so plays
// drawn before notes existed look exactly as they did.

import { PlayFrame, stepName } from "../../lib/plays";

interface Props {
  frame: PlayFrame | undefined;
  index: number;
  totalSteps: number;
}

export default function StepNote({ frame, index, totalSteps }: Props) {
  const note = frame?.note?.trim();
  const named = !!frame?.label?.trim();
  if (!note && !named) return null;
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", marginBottom: note ? 4 : 0 }}>
        {totalSteps > 1 ? `Step ${index + 1}${named ? ` — ${stepName(frame, index)}` : ""}` : stepName(frame, index)}
      </div>
      {note && <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note}</div>}
    </div>
  );
}
