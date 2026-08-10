// src/components/game-stats/LineupReport.tsx
// The lineup report: four combination levels, each with the stats that
// actually answer that level's question.
//
//   Individual  -- how much does he play, and is the team better with him
//                  out there? Led by on/off, because raw on-court numbers
//                  at this level mostly reflect who he plays with.
//   2-man       -- do these two fit? Led by together-vs-apart, which is the
//                  only view that can show two good players who don't work.
//   3-man       -- same question, one comparison instead of seven.
//   5-man       -- which unit, and for what situation? Led by play type,
//                  because you pick a five for a BLOB, not a player.
//
// Every rate stat comes from computeTeamStats() over a filtered possession
// set, so lineup numbers and team numbers are computed by identical code.
//
// Ranking is on the shrunk net rating, never the raw one. Raw is shown in
// brackets because it's the number people expect to see, but a five that
// went +47 over 22 possessions is not your best lineup and shouldn't sit
// at the top of a list that implies it is.

import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  listStatGoals, gameFormat, gameTypesForGroup, GAME_GROUPS, STAT_EXPLAINERS, LINEUP_GOAL_STATS,
  type GameFormat, type Possession, type StatGoal, type GameGroup,
} from "../../lib/gameStats";
import { listGamePlayers, listLineupEvents, type Shift, type LineupPlayer } from "../../lib/lineups";
import {
  computeComboRows, computeOnOff, computeTogetherApart, readiness,
  COMBO_LEVELS, SAMPLE_GATES,
  type ComboLevel, type ComboRow, type ComboResult, type GameSlice, type OnOffRow,
} from "../../lib/lineupStats";

interface Props {
  gameId: string | null;
  rosterId: string | null;
  season?: string;
}

type Group = "overview" | "factors" | "playtype" | "shots" | "onoff";

const LINEUP_EXPLAINERS: Record<string, { what: string; how: string }> = {
  poss: { what: "Offensive possessions with {subject} on the floor, and what share of the team's total that is.", how: "count of our trips while they were on / all our trips" },
  min: { what: "Estimated minutes on the floor — estimated, not measured. Each period's known length is spread across the possessions actually played in it, then rounded to the nearest 15 seconds.", how: "possessions x that period's seconds-per-possession" },
  net: { what: "Points scored minus points allowed, per 100 possessions, pulled toward the team average based on how little we've seen {subject}. The raw figure is in brackets.", how: "(n x raw + k x team) / (n + k), k estimated from the season" },
  offppp: { what: "Points we scored per offensive possession with {subject} on the floor.", how: "our points / our possessions" },
  defppp: { what: "Points allowed per defensive possession with {subject} on the floor.", how: "their points / their possessions" },
  on_net: { what: "Team net rating over the possessions {subject} was ON the floor.", how: "our points per 100 - their points per 100, while on" },
  off_net: { what: "Team net rating over the possessions {subject} was OFF the floor, counting only games they appeared in. For a PAIR this pools three situations — each one on without the other, and neither on — so expand the row for the four-way split.", how: "our points per 100 - their points per 100, while off" },
  onoff: { what: "Team net rating with {subject} on the floor, minus with them off. Off-court possessions only count games they appeared in. For a PAIR, \u201Coff\u201D pools three situations — one on without the other, and neither on — so expand the row for the four-way split.", how: "net rating on - net rating off" },
  oob_ppp: { what: "Points per possession on BLOB and SLOB trips. Which five you want out there for a sideline out with four seconds left.", how: "points on out-of-bounds trips / those trips" },
  three_rate: { what: "Share of field goal attempts that were threes. The clearest single expression of {subject}'s shot selection.", how: "3PA / FGA" },
  fouls: { what: "Foul trouble logged against {subject}, from the shift entry screen.", how: "count of foul-trouble events" },
};

const EXPLAINERS: Record<string, { what: string; how: string }> = { ...STAT_EXPLAINERS, ...LINEUP_EXPLAINERS };

/** What "{subject}" resolves to, so one string serves all four levels. */
function subjectFor(level: ComboLevel): string {
  if (level === 1) return "this player";
  if (level === 5) return "this exact five";
  return "this group";
}

function explainerFor(key: string, level: ComboLevel): { what: string; how: string } | null {
  const e = EXPLAINERS[key];
  if (!e) return null;
  return { what: e.what.replace(/\{subject\}/g, subjectFor(level)), how: e.how };
}

/**
 * Each level gets the stats that answer ITS question, not one shared set.
 *
 * Individual and the small groups deliberately have no raw four-factors
 * view: a player's on-court eFG% mostly reflects his teammates. The same
 * numbers appear as on/off differentials inside the On/off row detail,
 * where they explain the net difference instead of standing alone.
 *
 * Five-man is the reverse -- on/off is meaningless there ("without this
 * exact five" is nearly the whole season) but play type matters most,
 * because you pick a five for a situation.
 */
/** Nothing loaded yet -- kept as a constant so it always matches ComboResult. */
const EMPTY_COMBO_RESULT: ComboResult = {
  rows: [], k: 70, gamesCounted: 0,
  teamOffPPP: 0, teamDefPPP: 0, teamNet: 0,
  teamOffense: {}, teamDefense: {}, teamOffenseExtra: {}, teamDefenseExtra: {},
};

const GROUPS_FOR: Record<ComboLevel, Group[]> = {
  1: ["overview", "onoff"],
  2: ["overview", "onoff"],
  3: ["overview", "onoff"],
  5: ["overview", "playtype", "factors", "shots"],
};

const GROUP_LABEL: Record<Group, string> = {
  overview: "Overview", factors: "Four factors", playtype: "Play type", shots: "Shot profile", onoff: "On / off",
};

export default function LineupReport({ gameId, rosterId, season }: Props) {
  const [slices, setSlices] = useState<GameSlice[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
  // Distinct opponents across the loaded season, so a rematch can be
  // checked against what happened the first time.
  const [opponents, setOpponents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [level, setLevel] = useState<ComboLevel>(1);
  const [group, setGroup] = useState<Group>("overview");
  const [side, setSide] = useState<"offense" | "defense">("offense");
  const [excludeGarbage, setExcludeGarbage] = useState(true);
  const [clutchOnly, setClutchOnly] = useState(false);
  const [gameGroup, setGameGroup] = useState<GameGroup>("games");
  const [opponent, setOpponent] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Per-game applies to counting stats only. A per-game average of a RATE
  // would weight a 3-possession game the same as a 25-possession one.
  const [perGame, setPerGame] = useState(false);
  const [fouls, setFouls] = useState<Map<string, number>>(new Map());
  const [narrow, setNarrow] = useState(false);
  // null means the default order: qualified rows first, then adjusted net
  // descending. Clicking a heading overrides it.
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // Off by default and remembered. Colour is most useful when you're
  // showing someone else the report; once you know the numbers it reads
  // as noise.
  const [colour, setColour] = useState(() => {
    try { return localStorage.getItem("ww.lineupColour") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("ww.lineupColour", colour ? "1" : "0"); } catch { /* private mode */ }
  }, [colour]);
  const [explain, setExplain] = useState<string | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, rosterId, season, gameGroup, opponent]);
  useEffect(() => { if (!GROUPS_FOR[level].includes(group)) setGroup("overview"); }, [level, group]);

  // Narrow screens get name + possessions + net only; the rest of the row
  // moves into the expandable detail rather than a horizontal scroll.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  async function load() {
    setLoading(true);
    try {
      let gameIds: string[] = [];
      let formats = new Map<string, GameFormat>();

      if (gameId) {
        const { data } = await supabase.from("games").select("*").eq("id", gameId).maybeSingle();
        if (data) { gameIds = [gameId]; formats.set(gameId, gameFormat(data as any)); }
      } else {
        let q = supabase.from("games").select("*").in("game_type", gameTypesForGroup(gameGroup));
        if (rosterId) q = q.eq("roster_id", rosterId);
        if (season) q = q.eq("season", season);
        const { data, error: err } = await q;
        if (err) throw new Error(err.message);
        const all = (data ?? []) as any[];
        setOpponents([...new Set(all.map((g) => g.opponent as string))].filter(Boolean).sort());
        all.filter((g) => !opponent || g.opponent === opponent)
           .forEach((g) => { gameIds.push(g.id); formats.set(g.id, gameFormat(g)); });
      }

      if (!gameIds.length) { setSlices([]); setLoading(false); return; }

      const [{ data: poss }, { data: shiftRows }, { data: goalRows }] = await Promise.all([
        supabase.from("possessions").select("*").in("game_id", gameIds).order("sequence", { ascending: true }),
        supabase.from("shifts").select("*").in("game_id", gameIds).order("start_sequence", { ascending: true }),
        listStatGoals(),
      ]);

      const allPoss = (poss ?? []) as Possession[];
      const allShifts = (shiftRows ?? []) as Shift[];
      setGoals((goalRows ?? []) as StatGoal[]);
      // Sequence is unique per game, not across games, so each game has to
      // be matched against its own shifts before anything is merged.
      setSlices(gameIds.map((id) => ({
        gameId: id,
        possessions: allPoss.filter((p) => p.game_id === id),
        shifts: allShifts.filter((s) => s.game_id === id),
        format: formats.get(id) ?? gameFormat(null),
      })));
      setPlayers(await listGamePlayers(null));
      const events = (await Promise.all(gameIds.map((id) => listLineupEvents(id)))).flat();
      const counts = new Map<string, number>();
      events.forEach((e) => counts.set(e.player_id, (counts.get(e.player_id) ?? 0) + 1));
      setFouls(counts);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load lineup data.");
    }
    setLoading(false);
  }

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const name = (id: string) => {
    const p = byId.get(id);
    if (!p) return "?";
    return p.jersey != null ? `${p.jersey} ${p.name.split(" ").slice(-1)[0]}` : (p.name || "?");
  };

  const filters = { excludeGarbage, clutchOnly, foulsByPlayer: fouls };

  const { rows, k, gamesCounted, teamNet, teamOffPPP, teamDefPPP, teamOffense, teamDefense, teamOffenseExtra, teamDefenseExtra } = useMemo(
    () => (slices.length
      ? computeComboRows(slices, level, goals, filters)
      : EMPTY_COMBO_RESULT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slices, level, goals, excludeGarbage, clutchOnly, fouls],
  );

  const onOffMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeOnOff>>();
    if (group !== "onoff" || !slices.length) return m;
    rows.forEach((r) => m.set(r.key, computeOnOff(slices, r.playerIds, goals, { excludeGarbage })));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, rows, slices, goals, excludeGarbage]);

  const ready = useMemo(
    () => (slices.length ? readiness(slices, goals) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slices, goals],
  );

  if (loading) return <div className="card">Loading lineups…</div>;
  if (error) return <div className="card" style={{ color: "#c66", fontSize: 13 }}>{error}</div>;
  if (!rows.length) {
    return (
      <div className="card">
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          No shifts entered for this selection yet. Open a game and use its Shifts tab to mark who was on the floor.
        </div>
      </div>
    );
  }

  /** Which stat_goals key backs a column, where one exists. */
  const GOAL_KEY: Record<string, string> = {
    off: "lineup_off_ppp", def: "lineup_def_ppp", net: "lineup_net_rating",
    on_net: "lineup_net_rating", off_net: "lineup_net_rating", onoff_diff: "lineup_net_rating",
    oob_ppp: "lineup_oob_ppp",
    efg_pct: "efg_pct", tov_pct: "tov_pct", oreb_pct: "oreb_pct", ft_rate: "ft_rate",
    transition_pct: "transition_pct", transition_ppp: "transition_ppp",
    halfcourt_ppp: "halfcourt_ppp", quality_shot_pct: "quality_shot_pct",
  };
  /**
   * Lower is better. Derived from LINEUP_GOAL_STATS rather than restated,
   * so changing a goal's direction there can't leave the colouring stale.
   * Defensive columns invert on top of this.
   */
  const LOWER_BETTER = new Set<string>([
    "def", "tov_pct",
    ...LINEUP_GOAL_STATS.filter((g) => g.defaultDirection === "lower_better").map((g) => g.key),
  ]);

  function goalFor(key: string): number | null {
    const gk = GOAL_KEY[key];
    if (!gk) return null;
    const g = goals.find((x) => x.stat_key === gk && x.team === "us");
    return g?.target_value ?? null;
  }

  function teamValue(key: string): number | null {
    if (key === "off") return teamOffPPP ? Math.round(teamOffPPP * 100) / 100 : null;
    if (key === "def") return teamDefPPP ? Math.round(teamDefPPP * 100) / 100 : null;
    if (key === "net" || key === "on_net" || key === "off_net" || key === "onoff_diff") return teamNet;
    const extra = side === "offense" ? teamOffenseExtra : teamDefenseExtra;
    if (key === "oob_ppp" || key === "three_rate") return (extra[key] as number | null) ?? null;
    const stats = side === "offense" ? teamOffense : teamDefense;
    return (stats[key] as number | undefined) ?? null;
  }

  /**
   * Green or red against the benchmark, with a dead band so a near-miss
   * isn't dressed up as a finding. Rows below the sample gate are never
   * coloured -- painting a 22-possession lineup green would undo the gates.
   */
  function cellColour(r: ComboRow, key: string): string | null {
    if (!colour || !r.qualified) return null;
    const v = sortValue(r, key);
    if (v == null) return null;
    const bench = goalFor(key) ?? teamValue(key);
    if (bench == null) return null;
    const gk = GOAL_KEY[key];
    let lower = LOWER_BETTER.has(key) || (gk != null && LOWER_BETTER.has(gk));
    // On the defensive side of a rate stat the meaning flips: allowing a low
    // quality-shot percentage is good.
    if (side === "defense" && !["off", "def", "net", "on_net", "off_net", "onoff_diff"].includes(key)) lower = !lower;
    const diff = Math.abs(v - bench);
    const band = key === "off" || key === "def" || key === "oob_ppp" || key.endsWith("_ppp") ? 0.03 : ["net", "on_net", "off_net", "onoff_diff"].includes(key) ? 3 : 1;
    if (diff < band) return null;
    return (lower ? v < bench : v > bench) ? "#2f9e63" : "#b4544f";
  }

  /** One sentence saying what a column is measured against, shown in its explanation. */
  function benchmarkLine(key: string): string | null {
    const goal = goalFor(key);
    const team = teamValue(key);
    const fmt = (n: number) => (["net", "on_net", "off_net", "onoff_diff"].includes(key) ? `${n > 0 ? "+" : ""}${n}` : String(n));
    if (goal != null) {
      return `Measured against your goal of ${fmt(goal)}${team != null ? `. The team is at ${fmt(team)} across these games.` : "."}`;
    }
    if (team != null) {
      return `No goal is set for this, so it's measured against the team's own ${fmt(team)} across these games. You can set one in the Goals tab.`;
    }
    return null;
  }

  function sortValue(r: ComboRow, key: string): number | null {
    const extra = side === "offense" ? r.offenseExtra : r.defenseExtra;
    const stats = side === "offense" ? r.offense : r.defense;
    switch (key) {
      case "poss": return r.offPossessions;
      case "min": return r.estMinutes;
      case "shifts": return r.shifts;
      case "fouls": return r.fouls;
      case "off": return r.offPPP;
      case "def": return r.defPPP;
      case "net": return r.adjNet;
      case "on_net": return onOffMap.get(r.key)?.onNet ?? null;
      case "off_net": return onOffMap.get(r.key)?.offNet ?? null;
      case "onoff_diff": return onOffMap.get(r.key)?.diff ?? null;
      case "oob_ppp":
      case "three_rate": return extra[key] ?? null;
      default: return stats[key] ?? null;
    }
  }

  const sorted = [...rows].sort((a, b) => {
    // Unqualified rows stay at the bottom whatever the sort -- otherwise a
    // 12-possession lineup tops every column it happens to lead.
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    if (sort) {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return (av - bv) * sort.dir;
    }
    return (b.adjNet ?? -999) - (a.adjNet ?? -999);
  });

  function toggleSort(key: string) {
    setSort((cur) => (cur?.key !== key ? { key, dir: -1 } : cur.dir === -1 ? { key, dir: 1 } : null));
  }

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>Lineups</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{gamesCounted} game{gamesCounted === 1 ? "" : "s"} with shifts</span>
      </div>

      {/* Which levels can actually support a conclusion yet. Early season
          this points at individual and pairs, where the samples are. */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--muted)", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
        {ready.map((r) => (
          <span key={r.level} style={{ color: r.ready ? "var(--muted)" : "#c9a227" }}>
            {COMBO_LEVELS.find((c) => c.value === r.level)?.label}: {r.ready} of {r.total} ready
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {COMBO_LEVELS.map((c) => (
          <button key={c.value} onClick={() => setLevel(c.value)} style={pill(level === c.value)}>{c.label}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {GROUPS_FOR[level].map((g) => (
          <button key={g} onClick={() => setGroup(g)} style={pill(group === g)}>{GROUP_LABEL[g]}</button>
        ))}
        {(group === "factors" || group === "playtype" || group === "shots") && (
          <span style={{ display: "flex", gap: 5, marginLeft: "auto" }}>
            <button onClick={() => setSide("offense")} style={pill(side === "offense")}>Offense</button>
            <button onClick={() => setSide("defense")} style={pill(side === "defense")}>Defense</button>
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={excludeGarbage} onChange={(e) => setExcludeGarbage(e.target.checked)} />
          Exclude garbage time
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input type="checkbox" checked={clutchOnly} onChange={(e) => setClutchOnly(e.target.checked)} />
          Clutch only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }} title="Counting stats only — rates are unaffected">
          <input type="checkbox" checked={perGame} onChange={(e) => setPerGame(e.target.checked)} />
          Per game
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }} title="Green better than the benchmark, red worse. Rows below the sample gate are never coloured.">
          <input type="checkbox" checked={colour} onChange={(e) => setColour(e.target.checked)} />
          Colour
        </label>
        {!gameId && (
          <select value={gameGroup} onChange={(e) => setGameGroup(e.target.value as GameGroup)} style={selectStyle}>
            {GAME_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        )}
        {!gameId && opponents.length > 1 && (
          <select value={opponent} onChange={(e) => setOpponent(e.target.value)} style={selectStyle}>
            <option value="">All opponents</option>
            {opponents.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11 }}>k = {Math.round(k)}</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: narrow ? 0 : 620 }}>
          <HeaderRow group={group} level={level} onExplain={setExplain} narrow={narrow} sort={sort} onSort={toggleSort} explain={explain} benchmarkLine={benchmarkLine} />
          {sorted.map((r) => (
            <Row
              key={r.key}
              row={r}
              group={group}
              side={side}
              level={level}
              name={name}
              open={expanded === r.key}
              onToggle={() => setExpanded(expanded === r.key ? null : r.key)}
              slices={slices}
              excludeGarbage={excludeGarbage}
              perGame={perGame}
              narrow={narrow}
              onOff={onOffMap.get(r.key) ?? null}
              colourFor={cellColour}
            />
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
        {level === 5
          ? "A 5-man row means exactly that five on the floor."
          : `An ${level === 1 ? "individual" : `${level}-man group`} row means ${level === 1 ? "that player" : "all of them"} on the floor, whoever else is out there.`}
        {" "}Rows below {SAMPLE_GATES[level].possessions} possessions or {SAMPLE_GATES[level].games} games are marked and sorted last — treat them as directional.
        {" "}Tap a column heading for what it means, the arrow beside it to sort, or a row for its detail.
      </div>
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────

function HeaderRow({ group, level, onExplain, narrow, sort, onSort, explain, benchmarkLine }: {
  group: Group; level: ComboLevel; onExplain: (k: string | null) => void; narrow: boolean;
  sort: { key: string; dir: 1 | -1 } | null; onSort: (key: string) => void; explain: string | null;
  benchmarkLine: (key: string) => string | null;
}) {
  const all = columnsFor(group, level);
  const cols = narrow ? all.filter((c) => ["poss", "net", "onoff_diff"].includes(c.key)) : all;
  const active = cols.find((c) => c.explain && c.explain === explain);
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: 8, padding: "8px 10px", fontSize: 11, color: "var(--muted)" }}>
        <span style={{ flex: 1, minWidth: 0 }}>{level === 5 ? "Exact five" : level === 1 ? "Individual" : `${level}-man group`}</span>
        {cols.map((c) => (
          <span key={c.key} style={{ width: c.width, textAlign: "right", display: "inline-flex", justifyContent: "flex-end", gap: 3 }}>
            {/* Two targets in one heading: the label explains, the arrow sorts. */}
            <span
              onClick={() => c.explain && onExplain(explain === c.explain ? null : c.explain)}
              style={{ cursor: c.explain ? "pointer" : "default", textDecoration: c.explain ? "underline dotted" : "none" }}
            >
              {c.label}
            </span>
            <span
              onClick={() => onSort(c.key)}
              title="Sort"
              style={{ cursor: "pointer", color: sort?.key === c.key ? "var(--text)" : "var(--border-strong, var(--muted))" }}
            >
              {sort?.key === c.key ? (sort.dir === -1 ? "\u25BC" : "\u25B2") : "\u21C5"}
            </span>
          </span>
        ))}
      </div>
      {active && explainerFor(active.explain!, level) && (
        <div style={{ padding: "8px 10px 10px", background: "var(--surface2)", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>{explainerFor(active.explain!, level)!.what}</div>
          {benchmarkLine(active.key) && (
            <div style={{ fontSize: 12, color: "var(--accent, #6f8fe0)", marginTop: 5, lineHeight: 1.6 }}>{benchmarkLine(active.key)}</div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5, fontFamily: "monospace" }}>{explainerFor(active.explain!, level)!.how}</div>
        </div>
      )}
    </div>
  );
}

function columnsFor(group: Group, level: ComboLevel): { key: string; label: string; width: number; explain?: string }[] {
  if (group === "overview") return [
    { key: "poss", label: "Poss", width: 78, explain: "poss" },
    { key: "min", label: "~Min", width: 54, explain: "min" },
    { key: "shifts", label: "Shifts", width: 48 },
    ...(level === 1 ? [{ key: "fouls", label: "Foul tr.", width: 56, explain: "fouls" }] : []),
    { key: "off", label: "Off", width: 52, explain: "offppp" },
    { key: "def", label: "Def", width: 52, explain: "defppp" },
    { key: "net", label: "Net", width: 88, explain: "net" },
  ];
  if (group === "factors") return [
    { key: "poss", label: "Poss", width: 56, explain: "poss" },
    { key: "efg_pct", label: "eFG%", width: 58, explain: "efg_pct" },
    { key: "tov_pct", label: "TOV%", width: 58, explain: "tov_pct" },
    { key: "oreb_pct", label: "OREB%", width: 62, explain: "oreb_pct" },
    { key: "ft_rate", label: "FT rate", width: 62, explain: "ft_rate" },
  ];
  if (group === "playtype") return [
    { key: "poss", label: "Poss", width: 56, explain: "poss" },
    { key: "transition_pct", label: "Trans %", width: 62, explain: "transition_pct" },
    { key: "transition_ppp", label: "Trans PPP", width: 74, explain: "transition_ppp" },
    { key: "halfcourt_ppp", label: "Half ct PPP", width: 82, explain: "halfcourt_ppp" },
    { key: "oob_ppp", label: "BLOB/SLOB", width: 84, explain: "oob_ppp" },
  ];
  if (group === "shots") return [
    { key: "poss", label: "Poss", width: 56, explain: "poss" },
    { key: "three_rate", label: "3PT rate", width: 66, explain: "three_rate" },
    { key: "quality_shot_pct", label: "Quality %", width: 70, explain: "quality_shot_pct" },
    { key: "extra_possessions", label: "Extra poss", width: 74, explain: "extra_possessions" },
  ];
  // on/off. Keys are deliberately not "on"/"off" -- "off" collides with
  // the overview's offensive-PPP column and would match that branch first.
  // No Poss column here -- possessions and share already live on Overview.
  return [
    { key: "on_net", label: "On", width: 66, explain: "on_net" },
    { key: "off_net", label: "Off", width: 66, explain: "off_net" },
    { key: "onoff_diff", label: "Diff", width: 66, explain: "onoff" },
  ];
}

function Row({ row, group, side, level, name, open, onToggle, slices, excludeGarbage, perGame, narrow, onOff, colourFor }: {
  row: ComboRow; group: Group; side: "offense" | "defense"; level: ComboLevel;
  name: (id: string) => string; open: boolean; onToggle: () => void;
  slices: GameSlice[]; excludeGarbage: boolean;
  perGame: boolean; narrow: boolean;
  onOff: OnOffRow | null;
  colourFor: (r: ComboRow, key: string) => string | null;
}) {
  const dim = row.qualified ? {} : { color: "var(--muted)" as const };
  const stats = side === "offense" ? row.offense : row.defense;
  const allCols = columnsFor(group, level);
  const cols = narrow ? allCols.filter((c) => ["poss", "net", "onoff_diff"].includes(c.key)) : allCols;

  // Counting stats only. Dividing a rate by games would weight a
  // 3-possession game the same as a 25-possession one.
  const per = perGame && row.games ? row.games : 1;
  const cnt = (n: number) => (per > 1 ? Math.round((n / per) * 10) / 10 : n);

  function cell(key: string) {
    if (key === "poss") return `${cnt(row.offPossessions)}${group === "overview" && !perGame ? ` (${row.possessionShare}%)` : ""}`;
    if (key === "min") return row.estMinutes ? formatMinutes(row.estMinutes / per) : "—";
    if (key === "shifts") return String(cnt(row.shifts));
    if (key === "fouls") return row.fouls ? String(row.fouls) : "—";
    if (key === "oob_ppp" || key === "three_rate") {
      const v = (side === "offense" ? row.offenseExtra : row.defenseExtra)[key];
      if (v == null) return "—";
      return key === "three_rate" ? `${v}%` : v.toFixed(2);
    }
    if (key === "off") return row.offPPP?.toFixed(2) ?? "—";
    if (key === "def") return row.defPPP?.toFixed(2) ?? "—";
    if (key === "net") return row.adjNet == null ? "—" : `${row.adjNet > 0 ? "+" : ""}${row.adjNet}`;
    if (key === "on_net") return onOff?.onNet == null ? "—" : `${onOff.onNet > 0 ? "+" : ""}${onOff.onNet}`;
    if (key === "off_net") return onOff?.offNet == null ? "—" : `${onOff.offNet > 0 ? "+" : ""}${onOff.offNet}`;
    if (key === "onoff_diff") return onOff?.diff == null ? "—" : `${onOff.diff > 0 ? "+" : ""}${onOff.diff}`;
    const v = stats[key];
    if (v == null) return "—";
    if (key === "ft_rate" || key.endsWith("_ppp")) return v.toFixed(2);
    if (key === "extra_possessions") return `${v > 0 ? "+" : ""}${v}`;
    return `${v}%`;
  }

  const netColor = row.adjNet == null ? "var(--muted)" : row.adjNet > 3 ? "#5cb98b" : row.adjNet < -3 ? "#d98b8b" : "var(--text)";

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div onClick={onToggle} style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 10px", fontSize: 13, cursor: "pointer" }}>
        <span style={{ flex: 1, minWidth: 0, ...dim }}>
          {!row.qualified && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#c9a227", marginRight: 6 }} />}
          {row.playerIds.map(name).join(" · ")}
        </span>
        {cols.map((c) => {
          const tint = colourFor(row, c.key);
          return (
          <span key={c.key} style={{ width: c.width, textAlign: "right", ...(tint ? { color: tint } : c.key === "net" || c.key === "onoff_diff" ? { color: row.qualified ? netColor : "var(--muted)" } : dim) }}>
            {cell(c.key)}
            {c.key === "net" && row.rawNet != null && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}> ({row.rawNet > 0 ? "+" : ""}{row.rawNet})</span>
            )}
          </span>
          );
        })}
      </div>

      {open && (
        <div style={{ padding: "8px 10px 12px", background: "var(--surface2)", fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
          <div>
            {row.games} game{row.games === 1 ? "" : "s"} · {row.offPossessions} offensive and {row.defPossessions} defensive possessions ·
            {" "}{row.pointsFor} for, {row.pointsAgainst} against
          </div>
          {narrow && allCols.filter((c) => !cols.includes(c)).length > 0 && (
            <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 12px" }}>
              {allCols.filter((c) => !cols.includes(c)).map((c) => (
                <Fragment key={c.key}>
                  <span>{c.label}</span>
                  <span style={{ textAlign: "right" }}>{cell(c.key)}</span>
                </Fragment>
              ))}
            </div>
          )}
          {group === "onoff" && onOff && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <div style={{ marginBottom: 4 }}>What changes when they're on the floor</div>
              <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                <span style={{ flex: 1 }} /><span style={{ width: 56, textAlign: "right" }}>On</span>
                <span style={{ width: 56, textAlign: "right" }}>Off</span><span style={{ width: 56, textAlign: "right" }}>Diff</span>
              </div>
              {onOff.factors.map((f) => {
                const good = f.diff == null ? null : f.lowerBetter ? f.diff < 0 : f.diff > 0;
                return (
                  <div key={f.key} style={{ display: "flex", gap: 8 }}>
                    <span style={{ flex: 1 }}>{f.label}</span>
                    <span style={{ width: 56, textAlign: "right" }}>{f.on == null ? "—" : f.on}</span>
                    <span style={{ width: 56, textAlign: "right" }}>{f.off == null ? "—" : f.off}</span>
                    <span style={{ width: 56, textAlign: "right", color: good == null ? "var(--muted)" : good ? "#5cb98b" : "#d98b8b" }}>
                      {f.diff == null ? "—" : `${f.diff > 0 ? "+" : ""}${f.diff}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {level === 2 && <TogetherApart slices={slices} a={row.playerIds[0]} b={row.playerIds[1]} name={name} excludeGarbage={excludeGarbage} />}
          {!row.qualified && (
            <div style={{ color: "#c9a227", marginTop: 6 }}>
              Below the {SAMPLE_GATES[level].possessions}-possession / {SAMPLE_GATES[level].games}-game threshold — directional only.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The pair view worth having: two good players who don't fit show up here and nowhere else. */
function TogetherApart({ slices, a, b, name, excludeGarbage }: {
  slices: GameSlice[]; a: string; b: string; name: (id: string) => string; excludeGarbage: boolean;
}) {
  const r = useMemo(
    () => computeTogetherApart(slices, a, b, { excludeGarbage }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slices, a, b, excludeGarbage],
  );
  const line = (label: string, v: { possessions: number; net: number | null }) => (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ width: 70, textAlign: "right" }}>{v.possessions} poss</span>
      <span style={{ width: 56, textAlign: "right" }}>{v.net == null ? "—" : `${v.net > 0 ? "+" : ""}${v.net}`}</span>
    </div>
  );
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
      <div style={{ marginBottom: 4 }}>Together vs apart</div>
      {line("Both on", r.both)}
      {line(`${name(a)}, no ${name(b)}`, r.aOnly)}
      {line(`${name(b)}, no ${name(a)}`, r.bOnly)}
      {line("Neither", r.neither)}
    </div>
  );
}

/**
 * Minutes as 10:15 rather than 10.25. Rounded to the nearest 15 seconds --
 * these are estimated from possession counts, so anything finer would imply
 * a precision the number doesn't have.
 */
function formatMinutes(mins: number): string {
  const secs = Math.round((mins * 60) / 15) * 15;
  const m = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function pill(active: boolean): React.CSSProperties {
  return {
    padding: "5px 11px", fontSize: 12, borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent, #3a5fd0)" : "var(--border)"}`,
    background: active ? "var(--accent, #3a5fd0)" : "var(--surface2)",
    color: active ? "#fff" : "var(--muted)",
  };
}

const selectStyle: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--surface2)", color: "var(--text)", fontSize: 12,
};
