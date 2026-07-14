// src/lib/time.ts
// Shared helpers for displaying/entering durations as minutes:seconds
// instead of raw decimal seconds. Storage stays as total seconds
// (needed for the existing ranking/comparison math) — this only changes
// how it's shown and typed in.

export function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "0:00.00";
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  const sStr = s.toFixed(2).padStart(5, "0"); // e.g. "05.30"
  return `${m}:${sStr}`;
}
