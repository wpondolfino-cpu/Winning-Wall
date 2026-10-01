// src/components/quizzes/quizStyles.ts
// Shared look for the quiz screens, matching the app's existing buttons
// (PracticeBuilder) and cards.
import type { CSSProperties } from "react";

export const primaryBtn: CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px",
  fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
export const secondaryBtn: CSSProperties = {
  background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 14px", fontSize: 13, fontFamily: "inherit", cursor: "pointer",
};
export const dangerBtn: CSSProperties = {
  background: "rgba(226,75,74,0.1)", color: "#ff7b7b", border: "1px solid rgba(226,75,74,0.3)", borderRadius: 8,
  padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
export const smallBtn: CSSProperties = {
  background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "3px 8px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};
export const card: CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px",
};
export const label: CSSProperties = { fontSize: 11, color: "var(--muted)", marginBottom: 4 };
export const sectionTitle: CSSProperties = {
  fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 8px",
};

export function pill(kind: "good" | "warn" | "bad" | "info" | "plain"): CSSProperties {
  const map = {
    good:  { background: "rgba(40,180,80,0.15)",  color: "#5de098" },
    warn:  { background: "rgba(240,192,64,0.12)", color: "var(--gold)" },
    bad:   { background: "rgba(220,50,50,0.15)",  color: "#ff7b7b" },
    info:  { background: "rgba(37,80,212,0.18)",  color: "#8fa8ff" },
    plain: { background: "var(--surface)",        color: "var(--muted)" },
  } as const;
  return { ...map[kind], fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" };
}

/** An answer button's look in each state. */
export function optionStyle(state: "idle" | "picked" | "right" | "wrong"): CSSProperties {
  const base: CSSProperties = {
    display: "block", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 8,
    borderRadius: 10, fontSize: 14, fontFamily: "inherit", cursor: "pointer",
    border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)",
  };
  if (state === "picked") return { ...base, border: "1px solid var(--royal-light)", background: "rgba(37,80,212,0.18)" };
  if (state === "right")  return { ...base, border: "1px solid rgba(40,180,80,0.5)", background: "rgba(40,180,80,0.15)", color: "#5de098" };
  if (state === "wrong")  return { ...base, border: "1px solid rgba(220,50,50,0.5)", background: "rgba(220,50,50,0.15)", color: "#ff7b7b" };
  return base;
}
