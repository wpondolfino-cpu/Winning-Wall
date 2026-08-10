// src/components/game-stats/GameScopePicker.tsx
// Which games a report covers, in one control.
//
// Replaces two overlapping dropdowns (an opponent filter and a game
// picker) that offered the same team names for different purposes and made
// you work out which one you wanted. Now: presets across the top, then a
// checkbox list grouped by opponent.
//
// Grouping by opponent is the point of the redesign. "How did we do against
// Mansfield, Franklin and Taunton" was five interactions before and is three
// ticks now, and a rematch is one tick because both meetings sit under the
// same header.
//
// Presets PRE-TICK rather than lock, so you can start from "Last 5" and
// adjust. There's no mode to get stuck in -- the preset highlight just
// drops away once the selection stops matching it.
//
// Shared by ReportBuilder (team reports) and LineupsTab (lineups) so the two
// behave identically and there's one thing to maintain.

import { useEffect, useMemo, useRef, useState } from "react";

export interface ScopeGame {
  id: string;
  opponent: string;
  game_date: string;
  /** null for anything without a result — practices, scrimmages, unfinished games. */
  won: boolean | null;
}

type Preset = "all" | "last5" | "last10" | "wins" | "losses" | "";

interface Props {
  games: ScopeGame[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Plural noun for the current game type, e.g. "games" or "practices". */
  noun?: string;
}

export default function GameScopePicker({ games, selected, onChange, noun = "games" }: Props) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("all");
  const ref = useRef<HTMLDivElement>(null);

  const decided = useMemo(() => games.filter((g) => g.won !== null), [games]);

  // Grouped by opponent, each group keeping the newest-first order it arrived in.
  const grouped = useMemo(() => {
    const m = new Map<string, ScopeGame[]>();
    games.forEach((g) => {
      if (!m.has(g.opponent)) m.set(g.opponent, []);
      m.get(g.opponent)!.push(g);
    });
    return [...m.entries()];
  }, [games]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function apply(p: Preset) {
    setPreset(p);
    const ids =
      p === "last5" ? games.slice(0, 5).map((g) => g.id) :
      p === "last10" ? games.slice(0, 10).map((g) => g.id) :
      p === "wins" ? games.filter((g) => g.won === true).map((g) => g.id) :
      p === "losses" ? games.filter((g) => g.won === false).map((g) => g.id) :
      games.map((g) => g.id);
    onChange(ids);
  }

  function toggleGame(id: string) {
    setPreset("");
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  function toggleOpponent(opponent: string, on: boolean) {
    setPreset("");
    const ids = games.filter((g) => g.opponent === opponent).map((g) => g.id);
    onChange(on ? [...new Set([...selected, ...ids])] : selected.filter((x) => !ids.includes(x)));
  }

  // Names while there are few enough to read; a count once there aren't.
  const label = (() => {
    if (!selected.length) return `No ${noun} selected`;
    if (selected.length === games.length) return `All ${noun} (${games.length})`;
    const opps = [...new Set(games.filter((g) => selected.includes(g.id)).map((g) => g.opponent))];
    if (opps.length <= 3) return `${opps.join(", ")} (${selected.length})`;
    return `${selected.length} of ${games.length} selected`;
  })();

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)",
          background: "var(--surface2)", color: "var(--text)", fontSize: 13,
          textAlign: "left", minWidth: 190, cursor: "pointer",
        }}
      >
        {label} ▾
      </button>

      {open && (
        <div
          style={{
            position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0,
            minWidth: 280, maxHeight: 400, overflowY: "auto",
            background: "var(--surface)", border: "1px solid var(--accent, #3a5fd0)",
            borderRadius: 10, padding: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            <PresetChip label="All" on={preset === "all"} onClick={() => apply("all")} />
            {games.length > 5 && <PresetChip label="Last 5" on={preset === "last5"} onClick={() => apply("last5")} />}
            {games.length > 10 && <PresetChip label="Last 10" on={preset === "last10"} onClick={() => apply("last10")} />}
            {/* Only where results exist — a practice has no winner. */}
            {decided.length > 1 && <PresetChip label="Wins" on={preset === "wins"} onClick={() => apply("wins")} />}
            {decided.length > 1 && <PresetChip label="Losses" on={preset === "losses"} onClick={() => apply("losses")} />}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
            Presets tick boxes — adjust them after if you want.
          </div>

          {!games.length && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No {noun} with data for this selection.</div>
          )}

          {grouped.map(([opponent, list]) => {
            const allOn = list.every((g) => selected.includes(g.id));
            const someOn = list.some((g) => selected.includes(g.id));
            return (
              <div key={opponent} style={{ borderTop: "1px solid var(--border)", padding: "7px 0" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13 }}>
                  <TriBox checked={allOn} mixed={!allOn && someOn} onChange={(on) => toggleOpponent(opponent, on)} />
                  <span style={{ fontWeight: 500 }}>{opponent}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{list.length} game{list.length === 1 ? "" : "s"}</span>
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "5px 0 0 24px" }}>
                  {list.map((g) => (
                    <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
                      <input type="checkbox" checked={selected.includes(g.id)} onChange={() => toggleGame(g.id)} />
                      {g.game_date}
                      {g.won !== null && (
                        <span style={{ color: g.won ? "#5cb98b" : "#d98b8b" }}>{g.won ? "W" : "L"}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {games.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => setOpen(false)} style={smallBtn}>Done</button>
              <button onClick={() => { setPreset(""); onChange([]); }} style={smallBtn}>Clear all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PresetChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12, padding: "4px 11px", borderRadius: 999, cursor: "pointer",
        border: `1px solid ${on ? "var(--accent, #3a5fd0)" : "var(--border)"}`,
        background: on ? "var(--accent, #3a5fd0)" : "var(--surface2)",
        color: on ? "#fff" : "var(--muted)",
      }}
    >
      {label}
    </button>
  );
}

/** A checkbox that can show "some but not all" — indeterminate can only be set from script. */
function TriBox({ checked, mixed, onChange }: { checked: boolean; mixed: boolean; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

const smallBtn: React.CSSProperties = {
  padding: "5px 11px", fontSize: 12, borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--surface2)",
  color: "var(--muted)", cursor: "pointer",
};
