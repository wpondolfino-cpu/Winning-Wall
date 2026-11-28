// src/components/parent/familyUi.ts
// Shared looks for the parent portal screens (parent app and coach side).
import type { CSSProperties } from "react";

export const fu = {
  card: { background: "var(--surface2, #141b2d)", border: "1px solid var(--border, rgba(176,184,200,0.15))", borderRadius: 14, padding: "14px 16px" } as CSSProperties,
  inner: { background: "var(--surface, #0f1524)", border: "1px solid var(--border, rgba(176,184,200,0.15))", borderRadius: 10, padding: "10px 12px" } as CSSProperties,
  h2: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 1, color: "var(--info-text, #93b4ff)", margin: 0 } as CSSProperties,
  muted: { fontSize: 12, color: "var(--muted, #9aa3b5)" } as CSSProperties,
  text: { fontSize: 14, color: "var(--text, #e8ecf4)" } as CSSProperties,
  label: { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted, #9aa3b5)" } as CSSProperties,
  input: {
    width: "100%", minWidth: 0, background: "var(--input-bg, #1a2235)", border: "1px solid var(--border, rgba(176,184,200,0.15))", borderRadius: 10,
    padding: "10px 12px", color: "var(--text, #e8ecf4)", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  } as CSSProperties,
  tag: (bg: string, fg: string): CSSProperties => ({ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 7px", borderRadius: 6, background: bg, color: fg, textTransform: "uppercase", whiteSpace: "nowrap" }),
  btn: (kind: "go" | "plain" | "danger" | "quiet" = "plain", color = "var(--royal, #1a3fa8)"): CSSProperties => ({
    background: kind === "go" ? color : "transparent",
    color: kind === "go" ? "#fff" : kind === "danger" ? "var(--danger-text, #ff9b9b)" : kind === "quiet" ? "var(--muted, #9aa3b5)" : "var(--text, #e8ecf4)",
    border: kind === "go" ? "none" : kind === "quiet" ? "none" : "1px solid var(--border, rgba(176,184,200,0.2))",
    borderRadius: 8, padding: kind === "quiet" ? "4px 6px" : "7px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
    whiteSpace: "nowrap", textDecoration: kind === "quiet" ? "underline" : "none",
  }),
  pill: (on: boolean, color = "var(--royal, #1a3fa8)"): CSSProperties => ({
    padding: "6px 12px", borderRadius: 999, border: `1px solid ${on ? color : "var(--border, rgba(176,184,200,0.2))"}`,
    background: on ? color : "transparent", color: on ? "#fff" : "var(--muted-2, #b5bdcc)", fontSize: 12.5, fontWeight: 600,
    fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
  }),
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" } as CSSProperties,
  sheet: { background: "#111828", borderRadius: "18px 18px 0 0", width: 600, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", padding: "18px 16px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 } as CSSProperties,
};

export function errText(e: unknown): string {
  return (e as any)?.message ?? String(e);
}
