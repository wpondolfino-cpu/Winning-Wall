// src/lib/inputStyle.ts
// Base style for bare <input>/<select>/<textarea> elements, matching
// the look already used elsewhere in the app (e.g. DrillLibrary's
// "Search drills…" bar) instead of falling back to the browser's
// default white input styling. Spread this first, then override
// specific properties (width, flex, fontSize) per usage.
import type { CSSProperties } from "react";

export const inputStyle: CSSProperties = {
  background: "var(--surface2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "9px 12px",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};
