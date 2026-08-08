// src/components/game-stats/NumberField.tsx
// A number input that can actually be cleared.
//
// The obvious version -- value={n} onChange={e => set(Number(e.target.value))}
// -- is broken: clearing the box makes Number("") return 0, state becomes 0,
// the input re-renders as "0", and the next keystroke lands after it, so
// typing 10 into an emptied field gives "010" with a leading zero you can't
// delete.
//
// This holds the raw text while you're typing (so an empty box stays empty)
// and only pushes a number up when the text parses. On blur it clamps into
// range and normalises what's displayed, so you can never leave it holding
// something invalid.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  /** "change" pushes a value on every valid keystroke; "blur" waits until focus leaves -- use that when onChange writes to the database. */
  commitOn?: "change" | "blur";
  style?: CSSProperties;
  title?: string;
  ariaLabel?: string;
}

export default function NumberField({ value, min, max, onChange, commitOn = "change", style, title, ariaLabel }: Props) {
  const [text, setText] = useState(String(value));

  // Follow the value when it changes from outside (a structure preset
  // filling the field, say) without clobbering what's being typed.
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(raw: string) {
    // Strip a leading zero as soon as a real digit follows it, so "08"
    // becomes "8" rather than waiting for blur to tidy up.
    const next = raw.replace(/^0+(?=\d)/, "");
    setText(next);
    if (commitOn !== "change") return;
    const n = Number(next);
    if (next !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n);
  }

  function handleBlur() {
    const n = Number(text);
    const clamped = text === "" || !Number.isFinite(n) ? value : Math.max(min, Math.min(max, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      title={title}
      aria-label={ariaLabel ?? title}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      style={style}
    />
  );
}
