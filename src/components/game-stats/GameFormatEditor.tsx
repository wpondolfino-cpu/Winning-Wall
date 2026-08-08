// src/components/game-stats/GameFormatEditor.tsx
// Fixes a game's period structure after the fact -- wrong structure picked
// at creation, or an old summer-league game tracked before halves existed
// as an option. Rendered collapsed by default in both the track view and
// the post-game edit view, so it's reachable whether or not the game has
// been finished.
//
// Two behaviours off one schema:
//   Games (quarters/halves)  -- one minutes value fills every period and
//                               periods aren't individually editable,
//                               because a real game runs uniform ones.
//   Scrimmages / practices   -- each period's length is editable, since a
//   (periods/sessions)          practice genuinely runs uneven blocks.
//
// Changing format never touches possession rows: possessions.quarter is
// just a period number, so a game tracked as Q1/Q2 is already correct as
// periods 1 and 2 the moment it's relabelled as halves. The only unsafe
// direction is shrinking below a period that already has possessions in
// it, which updateGameFormat() refuses outright.

import { useState } from "react";
import {
  GAME_STRUCTURES,
  buildGameFormat,
  updateGameFormat,
  setPeriodLength,
  periodLabel,
  overtimeCount,
  lengthsEditable,
  gameLengthMinutes,
  type GameFormat,
  type PeriodFormat,
} from "../../lib/gameStats";

interface Props {
  gameId: string;
  format: GameFormat;
  onSaved: (fmt: GameFormat) => void;
}

const fieldStyle = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
} as const;

export default function GameFormatEditor({ gameId, format, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [structure, setStructure] = useState<PeriodFormat>(format.period_format);
  const [periods, setPeriods] = useState(format.regulation_periods);
  const [minutes, setMinutes] = useState(format.period_lengths[0] ?? 8);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const structureLabel = GAME_STRUCTURES.find((g) => g.value === format.period_format)?.label ?? format.period_format;
  const ots = overtimeCount(format);
  const summary = `${format.regulation_periods} x ${format.period_lengths[0] ?? "?"} min ${structureLabel.toLowerCase()}${ots ? ` +${ots} extra` : ""}`;

  function pickStructure(next: PeriodFormat) {
    const preset = GAME_STRUCTURES.find((g) => g.value === next)!;
    setStructure(next);
    setPeriods(preset.periods);
    setMinutes(preset.minutes);
  }

  function reset() {
    setStructure(format.period_format);
    setPeriods(format.regulation_periods);
    setMinutes(format.period_lengths[0] ?? 8);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const rebuilt = buildGameFormat(structure, periods, minutes, format.ot_minutes);

    // Rebuilding flattens every period to the typed value. For a scrimmage
    // or practice whose structure isn't changing, re-apply the per-period
    // lengths on top -- otherwise saving the structure would silently wipe
    // uneven sessions the coach set deliberately.
    if (lengthsEditable(format) && structure === format.period_format) {
      for (let i = 0; i < rebuilt.period_lengths.length; i++) {
        if (format.period_lengths[i] != null) rebuilt.period_lengths[i] = format.period_lengths[i];
      }
    }
    // Carry over genuine overtimes only -- periods past the OLD regulation
    // count. Indexing from the NEW count instead kept old regulation
    // periods too, so switching a 4-quarter game to halves left Q3 and Q4
    // hanging around relabelled as OT and 2OT. Old regulation periods the
    // new structure doesn't have are dropped; updateGameFormat refuses the
    // whole change if any of them still hold possessions.
    rebuilt.period_lengths.push(...format.period_lengths.slice(format.regulation_periods));

    const { error: err } = await updateGameFormat(gameId, rebuilt);
    setSaving(false);
    if (err) { setError(err); return; }
    onSaved(rebuilt);
    setOpen(false);
  }

  async function editPeriod(period: number) {
    const current = format.period_lengths[period - 1];
    const answer = window.prompt(`Minutes for ${periodLabel(format, period)}?`, String(current));
    if (answer === null) return;
    const parsed = Number(answer);
    if (!parsed || parsed < 1 || parsed > 30) { alert("Enter a number of minutes between 1 and 30."); return; }
    const { error: err, format: next } = await setPeriodLength(gameId, format, period, parsed);
    if (err) { setError(err); return; }
    onSaved(next);
  }

  if (!open) {
    return (
      <button
        onClick={() => { reset(); setOpen(true); }}
        style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer" }}
      >
        Format: {summary}
      </button>
    );
  }

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400, marginBottom: 10 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Game format</div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" }}>
          Structure
          <select value={structure} onChange={(e) => pickStructure(e.target.value as PeriodFormat)} style={fieldStyle}>
            {GAME_STRUCTURES.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" }}>
          Periods
          <input type="number" min={1} max={8} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} style={{ ...fieldStyle, width: 70 }} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--muted)" }}>
          Minutes each
          <input type="number" min={1} max={30} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ ...fieldStyle, width: 80 }} />
        </label>

        <button className="btn-primary" style={{ width: "auto", padding: "8px 14px" }} onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save format"}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          style={{ padding: "8px 12px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        {format.period_lengths.map((len, i) => (
          <span
            key={i}
            onClick={lengthsEditable(format) ? () => editPeriod(i + 1) : undefined}
            style={{
              display: "inline-flex", gap: 5, alignItems: "baseline", padding: "5px 9px", borderRadius: 6,
              background: "var(--surface2)", border: "1px solid var(--border)", fontSize: 13,
              cursor: lengthsEditable(format) ? "pointer" : "default",
            }}
          >
            <span>{periodLabel(format, i + 1)}</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{len}m</span>
          </span>
        ))}
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 4 }}>{gameLengthMinutes(format)} min total</span>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        {lengthsEditable(format)
          ? "Tap a period to change just its length -- scrimmages and practices often run uneven blocks."
          : "Games run uniform periods, so \u201CMinutes each\u201D sets them all. Overtime length is asked for when you add one."}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        Possessions aren't moved or changed -- they're stored by period number, so a game tracked as Q1/Q2 is already correct as H1/H2 once relabelled.
      </div>

      {error && <div style={{ fontSize: 12, color: "#c66", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
