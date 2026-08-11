// src/components/game-stats/RankingsPanel.tsx
// Top 3, bottom 3, and what's nearly ready — per combination level.
//
// Three rules do most of the work here, and all three exist to stop the
// panel confidently ranking noise:
//
//   1. Individual ranks on ON/OFF, everything else on adjusted net. Raw
//      on-court net at individual level mostly measures who a player plays
//      alongside. If top and bottom used different metrics a player could
//      appear in both lists, which would look like a bug.
//
//   2. Only rows past their sample gate are ranked at all. Everything else
//      goes to "nearly there", sorted by how close it is -- never by
//      result, or the list would surface the luckiest small samples and
//      present them as promising.
//
//   3. The lists collapse rather than pad. Under seven qualifiers, top and
//      bottom would overlap, so it shows one ranked list instead. Under
//      three, it shows none.

import { useMemo, useState } from "react";
import { DEFAULT_STAT_ORDER, LINEUP_GOAL_STATS } from "../../lib/gameStats";
import {
  computeComboRows, computeOnOff, computeScorecard,
  COMBO_LEVELS, SAMPLE_GATES,
  type ComboLevel, type ComboRow, type Scorecard,
} from "../../lib/lineupStats";
import { useLineupData, playerLabeller } from "../../lib/useLineupData";
import { Reliability } from "./RotationPanel";

type Side = "overall" | "offense" | "defense";

const SIDE_LABEL: Record<Side, string> = { overall: "Overall", offense: "Offense", defense: "Defense" };

export default function RankingsPanel({ gameIds }: { gameIds: string[] }) {
  const { slices, goals, players, loading, error } = useLineupData(gameIds);
  const [level, setLevel] = useState<ComboLevel>(1);
  const [side, setSide] = useState<Side>("overall");
  const [open, setOpen] = useState<string | null>(null);

  const name = useMemo(() => playerLabeller(players), [players]);
  const statLabels = useMemo(() => {
    const m: Record<string, string> = {};
    [...DEFAULT_STAT_ORDER, ...LINEUP_GOAL_STATS].forEach((d) => { m[d.key] = d.label; });
    return m;
  }, []);

  const { rows } = useMemo(
    () => (slices.length ? computeComboRows(slices, level, goals, { excludeGarbage: true }) : { rows: [] as ComboRow[] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slices, level, goals],
  );

  // On/off drives the individual ranking and one of the goals, so it's
  // computed once here rather than per row per list.
  const onOff = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!slices.length) return m;
    rows.forEach((r) => m.set(r.key, computeOnOff(slices, r.playerIds, goals, { excludeGarbage: true }).diff));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, slices, goals]);

  /** What this level and side ranks on. Individual uses on/off; the rest use adjusted net. */
  function rankValue(r: ComboRow): number | null {
    if (side === "offense") return r.offPPP;
    if (side === "defense") return r.defPPP == null ? null : -r.defPPP; // fewer points allowed ranks higher
    return level === 1 ? onOff.get(r.key) ?? null : r.adjNet;
  }

  const rankLabel =
    side === "offense" ? "offensive PPP"
    : side === "defense" ? "defensive PPP"
    : level === 1 ? "on/off differential"
    : "adjusted net rating";

  const scorecards = useMemo(() => {
    const m = new Map<string, Scorecard>();
    rows.forEach((r) => m.set(r.key, computeScorecard(r, level, goals, statLabels, onOff.get(r.key) ?? null)));
    return m;
  }, [rows, level, goals, statLabels, onOff]);

  const qualified = rows.filter((r) => r.qualified && rankValue(r) != null);
  const ranked = [...qualified].sort((a, b) => (rankValue(b) ?? -1e9) - (rankValue(a) ?? -1e9));
  // Closest to the threshold first -- sorting these by result would surface
  // the luckiest small samples and dress them up as promising.
  const nearly = rows
    .filter((r) => !r.qualified)
    .sort((a, b) => b.offPossessions - a.offPossessions)
    .slice(0, 3);

  const gate = SAMPLE_GATES[level];
  const levelName = COMBO_LEVELS.find((c) => c.value === level)?.label ?? "";

  if (loading) return <div className="card">Loading rankings…</div>;
  if (error) return <div className="card" style={{ color: "#c66", fontSize: 13 }}>{error}</div>;

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {COMBO_LEVELS.map((c) => (
          <button key={c.value} onClick={() => { setLevel(c.value); setOpen(null); }} style={pill(level === c.value)}>{c.label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
        {(["overall", "offense", "defense"] as Side[]).map((s) => (
          <button key={s} onClick={() => setSide(s)} style={pill(side === s)}>{SIDE_LABEL[s]}</button>
        ))}
      </div>

      <Reliability
        state={qualified.length >= 7 ? "reliable" : qualified.length >= 3 ? "building" : "early"}
        detail={`${qualified.length} of ${rows.length} ${levelName.toLowerCase()} groups have reached ${gate.possessions} possessions across ${gate.games} games.`}
      />

      {qualified.length < 3 ? (
        // Everything is shown, dotted and sorted last, rather than hidden --
        // the ordering guarantee is what keeps that honest.
        <Section
          title={`All ${levelName.toLowerCase()} groups by ${rankLabel}`}
          rows={[...rows].sort((a, b) => {
            if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
            return (rankValue(b) ?? -1e9) - (rankValue(a) ?? -1e9);
          })}
          {...{ name, rankValue, side, level, scorecards, open, setOpen, onOff }}
        />
      ) : qualified.length < 7 ? (
        // Top and bottom would overlap with this few, so it's one list.
        <Section
          title={`All ${levelName.toLowerCase()} groups by ${rankLabel}`}
          rows={ranked}
          {...{ name, rankValue, side, level, scorecards, open, setOpen, onOff }}
        />
      ) : (
        <>
          <Section
            title={`Top 3 by ${rankLabel}`}
            rows={ranked.slice(0, 3)}
            {...{ name, rankValue, side, level, scorecards, open, setOpen, onOff }}
          />
          <Section
            title={`Bottom 3 by ${rankLabel}`}
            rows={ranked.slice(-3).reverse()}
            {...{ name, rankValue, side, level, scorecards, open, setOpen, onOff }}
          />
        </>
      )}

      {nearly.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Nearly there</div>
          {nearly.map((r) => (
            <div key={r.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#c9a227" }} />
              <span style={{ flex: 1, minWidth: 0 }}>{r.playerIds.map(name).join(" · ")}</span>
              <span style={{ fontSize: 12 }}>
                {r.offPossessions} poss · {r.games} game{r.games === 1 ? "" : "s"} ·{" "}
                {Math.max(0, gate.possessions - r.offPossessions)} more to qualify
              </span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            Sorted by how close they are, not by how they've done — ranking these by result would surface whichever small sample got luckiest.
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 14, lineHeight: 1.7 }}>
        {level === 1
          ? "Individuals rank on on/off differential — team net rating with them on the floor minus with them off. Raw on-court numbers at this level mostly reflect who someone plays alongside."
          : `Ranked on ${rankLabel}, which is pulled toward the team average based on how little each group has played.`}
        {" "}Scorecard totals aren't comparable across levels — a 4-of-4 individual and a 7-of-10 five are counted against different goal sets.
      </div>
    </div>
  );
}

function Section({ title, rows, name, rankValue, side, level, scorecards, open, setOpen, onOff }: {
  title: string;
  rows: ComboRow[];
  name: (id: string) => string;
  rankValue: (r: ComboRow) => number | null;
  side: Side;
  level: ComboLevel;
  scorecards: Map<string, Scorecard>;
  open: string | null;
  setOpen: (k: string | null) => void;
  onOff: Map<string, number | null>;
}) {
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>{title}</div>
      {rows.map((r, i) => {
        const v = rankValue(r);
        const shown = side === "defense" && v != null ? -v : v;
        const card = scorecards.get(r.key);
        const isOpen = open === r.key;
        return (
          <div key={r.key} style={{ borderTop: "1px solid var(--border)" }}>
            <div onClick={() => setOpen(isOpen ? null : r.key)} style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 10px", fontSize: 13, cursor: "pointer" }}>
              <span style={{ width: 16, color: "var(--muted)", fontSize: 12 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>{r.playerIds.map(name).join(" · ")}</span>
              {card && card.total > 0 && (
                <span style={{ fontSize: 12, color: card.met === card.total ? "#5cb98b" : "var(--muted)" }}>
                  {card.met} of {card.total} goals
                </span>
              )}
              <span style={{ width: 78, textAlign: "right", fontWeight: 500 }}>
                {shown == null ? "—" : side === "overall" ? `${shown > 0 ? "+" : ""}${shown}` : shown.toFixed(2)}
              </span>
            </div>
            {isOpen && (
              <div style={{ padding: "6px 10px 12px", background: "var(--surface2)", fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
                <div>
                  {r.games} game{r.games === 1 ? "" : "s"} · {r.offPossessions} offensive possessions ·
                  {" "}off {r.offPPP?.toFixed(2) ?? "—"} · def {r.defPPP?.toFixed(2) ?? "—"} ·
                  {" "}net {r.adjNet == null ? "—" : `${r.adjNet > 0 ? "+" : ""}${r.adjNet}`}
                  {level !== 5 && onOff.get(r.key) != null && <> · on/off {onOff.get(r.key)! > 0 ? "+" : ""}{onOff.get(r.key)}</>}
                </div>
                {card && card.items.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {card.items.map((it) => (
                      <div key={it.key} style={{ display: "flex", gap: 8 }}>
                        <span style={{ width: 14, color: it.met ? "#5cb98b" : "#d98b8b" }}>{it.met ? "✓" : "✗"}</span>
                        <span style={{ flex: 1 }}>{it.label}</span>
                        <span style={{ width: 120, textAlign: "right" }}>
                          {it.value == null ? "—" : it.value} vs {it.lowerBetter ? "under " : ""}{it.target}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function pill(active: boolean): React.CSSProperties {
  return {
    padding: "5px 11px", fontSize: 12, borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent, #3a5fd0)" : "var(--border)"}`,
    background: active ? "var(--accent, #3a5fd0)" : "var(--surface2)",
    color: active ? "#fff" : "var(--muted)",
  };
}
