// src/components/game-stats/GameFormatEditor.tsx
// Fixes a game's period structure after the fact -- picked the wrong
// preset when creating it, or tracked a summer-league game before halves
// existed as an option. Rendered collapsed by default in both the track
// view and the post-game edit view, so it's reachable whether or not the
// game has been finished.
//
// Changing format never touches possession rows: possessions.quarter is
// just a period number, so a game tracked as Q1/Q2 is already correct as
// periods 1 and 2 the moment it's relabelled as halves. The only unsafe
// direction is shrinking the structure below a period that already has
// possessions in it, which updateGameFormat() refuses outright rather
// than leaving those rows stranded with no tab to reach them from.

import { useState } from "react";
import {
  GAME_FORMAT_PRESETS,
  updateGameFormat,
  periodLabel,
  type GameFormat,
} from "../../lib/gameStats";

interface Props {
  gameId: string;
  format: GameFormat;
  overtimePeriods: number;
  onSaved: (fmt: GameFormat, overtimePeriods: number) => void;
}

/** Index of the preset matching this format, or -1 for a format that came from somewhere else (e.g. edited directly in Supabase). */
function presetIndexFor(fmt: GameFormat): number {
  return GAME_FORMAT_PRESETS.findIndex(
    (p) =>
      p.format.period_format === fmt.period_format &&
      p.format.regulation_periods === fmt.regulation_periods &&
      p.format.period_minutes === fmt.period_minutes,
  );
}

export default function GameFormatEditor({ gameId, format, overtimePeriods, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(() => presetIndexFor(format));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = GAME_FORMAT_PRESETS[presetIndexFor(format)];
  const summary = current
    ? current.label
    : `${format.regulation_periods} x ${format.period_minutes} min ${format.period_format}`;

  async function save() {
    if (idx < 0) return;
    setSaving(true);
    setError(null);
    const next = GAME_FORMAT_PRESETS[idx].format;
    const { error: err } = await updateGameFormat(gameId, next, overtimePeriods);
    setSaving(false);
    if (err) { setError(err); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onSaved(next, overtimePeriods);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => { setIdx(presetIndexFor(format)); setOpen(true); }}
        style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer" }}
      >
        Format: {summary}
      </button>
    );
  }

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400, marginBottom: 10 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Game format</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
        >
          {idx < 0 && <option value={-1}>{summary} (custom)</option>}
          {GAME_FORMAT_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>{p.label}</option>
          ))}
        </select>
        <button className="btn-primary" style={{ width: "auto", padding: "8px 14px" }} onClick={save} disabled={saving || idx < 0}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save format"}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          style={{ padding: "8px 12px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>

      {overtimePeriods > 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
          This game has {overtimePeriods} overtime period{overtimePeriods === 1 ? "" : "s"} ({periodLabel(format, format.regulation_periods + overtimePeriods)}), which is kept as-is.
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        Possessions aren't moved or changed -- they're stored by period number, so a game tracked as Q1/Q2 is already correct as H1/H2 once relabelled.
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#c66", marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
