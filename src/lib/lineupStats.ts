// src/lib/lineupStats.ts
// Phase 2 of the lineup tracker: turning shifts into numbers you can act on.
//
// Split from lineups.ts on purpose -- that file is the data layer (reading
// and writing shifts), this is the analytics layer. Nothing here talks to
// the database.
//
// Two principles run through all of it:
//
//   1. REUSE THE TEAM DEFINITIONS. Every rate stat comes from
//      computeTeamStats() in gameStats.ts, run over a filtered possession
//      set. So a lineup's eFG% is computed by exactly the same code as the
//      team's eFG%, and the two can never drift apart. That was the whole
//      argument for one tracker instead of two.
//
//   2. BE HONEST ABOUT SMALL SAMPLES. Raw numbers on 20 possessions are
//      mostly noise, and noise presented confidently is worse than no
//      number at all. Hence shrinkage toward the team mean, sample gates
//      per level, and a readiness strip that says which levels can support
//      a conclusion yet.

import {
  computeShotQuality,
  computeTeamStats,
  countedPossessions,
  periodLengthSeconds,
  type GameFormat,
  type Possession,
  type StatGoal,
} from "./gameStats";
import { assignPossessionSides, lineupKey, type Shift } from "./lineups";

export type ComboLevel = 1 | 2 | 3 | 5;

export const COMBO_LEVELS: { value: ComboLevel; label: string }[] = [
  { value: 1, label: "Individual" },
  { value: 2, label: "2-man" },
  { value: 3, label: "3-man" },
  { value: 5, label: "5-man" },
];

/**
 * Minimum possessions and games before a row is treated as meaningful.
 * Tuned so an actual rotation clears them around game 3-4 rather than
 * never: an individual starter sees ~46 possessions a game, a top pair
 * ~40, a top trio ~34, the starting five ~22.
 */
export const SAMPLE_GATES: Record<ComboLevel, { possessions: number; games: number }> = {
  1: { possessions: 120, games: 3 },
  2: { possessions: 100, games: 3 },
  3: { possessions: 80, games: 3 },
  5: { possessions: 60, games: 3 },
};

// ── Score margin, garbage time, clutch ───────────────────────────

export interface PossessionContext {
  /** Our margin AFTER this possession. Derived from the log -- never entered. */
  margin: number;
  /** Possessions remaining in the game after this one. */
  remaining: number;
  garbage: boolean;
  clutch: boolean;
}

/**
 * Walks one game's possessions and works out the score context of each.
 *
 * The margin is derived, not recorded: every possession already carries
 * points and which team scored them, so a running total is free.
 *
 * Garbage time and clutch are expressed in POSSESSIONS REMAINING rather
 * than clock time, because the game clock isn't reliably legible on film.
 * Once garbage time triggers it stays on unless the margin closes back
 * under a lower threshold -- otherwise one free throw flips it on and off.
 */
export function possessionContexts(
  gamePossessions: Possession[],
  opts: { garbageMargin?: number; garbageRemaining?: number; garbageExit?: number; clutchMargin?: number; clutchRemaining?: number; secondsPerPossession?: number } = {},
): Map<string, PossessionContext> {
  const garbageMargin = opts.garbageMargin ?? 20;
  // Exit sits 5 below the trigger so a single free throw can't flip the
  // flag on and off across consecutive possessions.
  const garbageExit = opts.garbageExit ?? 15;
  const clutchMargin = opts.clutchMargin ?? 6;
  // Minutes converted to possessions at this game's own pace -- a slow
  // grind and a track meet fit very different numbers of trips into the
  // last four minutes, so a fixed possession count would mean different
  // things in different games.
  const secsPerPoss = opts.secondsPerPossession ?? 16;
  const garbageRemaining = opts.garbageRemaining ?? Math.round((3 * 60) / secsPerPoss);
  const clutchRemaining = opts.clutchRemaining ?? Math.round((4 * 60) / secsPerPoss);

  const sorted = [...gamePossessions].sort((a, b) => a.sequence - b.sequence);
  const total = sorted.length;
  const out = new Map<string, PossessionContext>();

  let margin = 0;
  let inGarbage = false;

  sorted.forEach((p, i) => {
    margin += (p.team === "us" ? 1 : -1) * (p.points ?? 0);
    const remaining = total - i - 1;
    const abs = Math.abs(margin);

    if (!inGarbage && abs >= garbageMargin && remaining <= garbageRemaining) inGarbage = true;
    else if (inGarbage && abs < garbageExit) inGarbage = false;

    out.set(p.id, {
      margin,
      remaining,
      garbage: inGarbage,
      clutch: abs <= clutchMargin && remaining <= clutchRemaining,
    });
  });

  return out;
}

// ── Minutes estimate ─────────────────────────────────────────────

/**
 * Estimated seconds per possession, calibrated per period.
 *
 * Each period's known length is spread across the possessions actually
 * played in it, so a foul-heavy fourth quarter (short possessions, lots of
 * stopped clock) doesn't distort a fast-paced first. Error can't compound
 * across the game because every period is bounded independently.
 *
 * A period with almost no possessions falls back to the game average --
 * an 8-possession overtime would otherwise produce a wild number.
 */
export function secondsBySequence(
  gamePossessions: Possession[],
  fmt: GameFormat,
  /** Clock readings taken from film, as { sequence, secondsRemaining }. Optional and sparse. */
  anchors: { sequence: number; seconds: number }[] = [],
): Map<number, number> {
  // Where anchors exist, the elapsed time between two of them is KNOWN, so
  // the possessions between them get their real duration instead of the
  // period average. Everything outside an anchored span still falls back to
  // even distribution, so a game with two anchors is tighter than one with
  // none and neither is wrong.
  const even = evenSeconds(gamePossessions, fmt);
  const out = new Map<number, number>();
  const spans = anchors.length ? anchoredSpans(gamePossessions, fmt, anchors) : new Map<number, number>();
  gamePossessions.forEach((p) => {
    out.set(p.sequence, spans.get(p.sequence) ?? even.get(p.quarter) ?? 16);
  });
  return out;
}

/** Average seconds per possession in a period, for anything that needs a period-level figure. */
export function averageSeconds(bySequence: Map<number, number>, possessions: Possession[], period?: number): number {
  const list = possessions.filter((p) => period == null || p.quarter === period);
  if (!list.length) return 16;
  return list.reduce((s, p) => s + (bySequence.get(p.sequence) ?? 16), 0) / list.length;
}

/**
 * Per-period seconds-per-possession refined by clock anchors.
 *
 * Anchors are validated by the caller before they get here -- a reading
 * outside its period, or one that goes backwards, would distort the
 * possessions around it worse than having no anchor at all.
 */
function anchoredSpans(
  gamePossessions: Possession[],
  fmt: GameFormat,
  anchors: { sequence: number; seconds: number }[],
): Map<number, number> {
  const out = new Map<number, number>();

  const byPeriod = new Map<number, Possession[]>();
  gamePossessions.forEach((p) => {
    if (!byPeriod.has(p.quarter)) byPeriod.set(p.quarter, []);
    byPeriod.get(p.quarter)!.push(p);
  });

  byPeriod.forEach((list, period) => {
    const sorted = [...list].sort((a, b) => a.sequence - b.sequence);
    const inPeriod = anchors
      .filter((a) => sorted.some((p) => p.sequence === a.sequence))
      .sort((a, b) => a.sequence - b.sequence);
    if (!inPeriod.length) return;

    // Bracket the period with its known endpoints: full length at the first
    // possession, zero at the end.
    const points = [
      { sequence: sorted[0].sequence, seconds: periodLengthSeconds(fmt, period) },
      ...inPeriod,
      { sequence: sorted[sorted.length - 1].sequence + 1, seconds: 0 },
    ].sort((a, b) => a.sequence - b.sequence);

    // Each span between two known clock readings gets its own pace, which
    // is the entire point -- a period-wide figure would average them back
    // together and the anchor would change nothing.
    for (let i = 1; i < points.length; i++) {
      const span = points[i].sequence - points[i - 1].sequence;
      const elapsed = points[i - 1].seconds - points[i].seconds;
      if (span <= 0 || elapsed <= 0) continue;
      const rate = elapsed / span;
      sorted
        .filter((p) => p.sequence >= points[i - 1].sequence && p.sequence < points[i].sequence)
        .forEach((p) => out.set(p.sequence, rate));
    }
  });

  return out;
}

function evenSeconds(gamePossessions: Possession[], fmt: GameFormat): Map<number, number> {
  const byPeriod = new Map<number, number>();
  gamePossessions.forEach((p) => byPeriod.set(p.quarter, (byPeriod.get(p.quarter) ?? 0) + 1));

  let totalSeconds = 0;
  let totalPossessions = 0;
  byPeriod.forEach((count, period) => {
    totalSeconds += periodLengthSeconds(fmt, period);
    totalPossessions += count;
  });
  const gameAverage = totalPossessions ? totalSeconds / totalPossessions : 16;

  const out = new Map<number, number>();
  byPeriod.forEach((count, period) => {
    out.set(period, count >= 10 ? periodLengthSeconds(fmt, period) / count : gameAverage);
  });
  return out;
}

/**
 * Why a clock reading can't be trusted, or null when it's fine.
 *
 * A mistyped anchor is worse than no anchor -- it silently distorts every
 * shift around it, where the even-distribution fallback can only ever be
 * mildly wrong. So they're checked rather than absorbed.
 */
export function validateAnchor(
  seconds: number,
  period: number,
  fmt: GameFormat,
  neighbours: { sequence: number; seconds: number }[],
  sequence: number,
): string | null {
  const length = periodLengthSeconds(fmt, period);
  if (seconds < 0 || seconds > length) {
    return `A ${Math.round(length / 60)}-minute period can't show ${formatClock(seconds)}.`;
  }
  const before = neighbours.filter((n) => n.sequence < sequence).sort((a, b) => b.sequence - a.sequence)[0];
  const after = neighbours.filter((n) => n.sequence > sequence).sort((a, b) => a.sequence - b.sequence)[0];
  // The clock counts down, so a later possession must show less time.
  if (before && seconds >= before.seconds) return `The clock has to be below ${formatClock(before.seconds)} by here.`;
  if (after && seconds <= after.seconds) return `The clock has to be above ${formatClock(after.seconds)} by here.`;
  return null;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.round(Math.max(0, seconds) % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseClock(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const plain = Number(text.trim());
  return Number.isFinite(plain) && plain >= 0 ? Math.round(plain) : null;
}

// ── Shrinkage ────────────────────────────────────────────────────

/**
 * Pulls a rate toward the team mean in proportion to how little of it
 * we've seen. At n possessions the row's own data carries n/(n+k) of the
 * weight, so a lineup at +47 over 22 possessions lands nearer the team
 * average than its raw number suggests.
 */
export function shrink(value: number, n: number, teamValue: number, k: number): number {
  if (n <= 0) return teamValue;
  return (n * value + k * teamValue) / (n + k);
}

/**
 * Estimates k from the data instead of asking a coach to pick one.
 *
 * The spread you observe between lineups is real differences plus noise.
 * The noise is measurable -- it's the per-possession scoring variance
 * divided by each lineup's possession count -- so subtracting it leaves the
 * real spread, and k is the ratio of the two.
 *
 * Guarded three ways, because the estimate is itself noisy early on:
 * clamped to a sane range, floored on total sample before it's trusted at
 * all, and handled for the case where lineups vary LESS than noise alone
 * would predict (meaning no detectable difference, so regress hard).
 */
export function estimateK(
  rows: { value: number; n: number }[],
  perPossessionVariance: number,
  sample: { distinctPossessions: number; games: number },
  fallback = 70,
  min = 25,
  max = 200,
): number {
  const qualifying = rows.filter((r) => r.n > 0);
  // Distinct possessions, not the sum across rows -- at individual level
  // every possession belongs to five rows, so summing made one game look
  // like a season and let a meaningless estimate through.
  if (qualifying.length < 3 || sample.games < 5 || sample.distinctPossessions < 600) return fallback;
  const totalN = qualifying.reduce((s, r) => s + r.n, 0);

  const weighted = qualifying.reduce((s, r) => s + r.value * r.n, 0) / totalN;
  const observedVar =
    qualifying.reduce((s, r) => s + r.n * Math.pow(r.value - weighted, 2), 0) / totalN;
  const expectedNoise =
    qualifying.reduce((s, r) => s + perPossessionVariance / r.n, 0) / qualifying.length;

  const trueVar = observedVar - expectedNoise;
  if (!(trueVar > 0)) return max; // lineups vary less than noise -- regress hard
  return Math.max(min, Math.min(max, perPossessionVariance / trueVar));
}

/** Per-possession variance of points scored, for the noise term above. */
export function perPossessionVariance(possessions: Possession[]): number {
  if (!possessions.length) return 1.3;
  const mean = possessions.reduce((s, p) => s + (p.points ?? 0), 0) / possessions.length;
  return possessions.reduce((s, p) => s + Math.pow((p.points ?? 0) - mean, 2), 0) / possessions.length;
}

// ── Combination rows ─────────────────────────────────────────────

export interface ComboRow {
  key: string;
  playerIds: string[];
  offPossessions: number;
  defPossessions: number;
  totalPossessions: number;
  possessionShare: number;
  estMinutes: number;
  games: number;
  shifts: number;
  pointsFor: number;
  pointsAgainst: number;
  offPPP: number | null;
  defPPP: number | null;
  /** Raw offence minus defence, per 100 possessions. */
  rawNet: number | null;
  /** Same, pulled toward the team mean by sample size. This is what ranks. */
  adjNet: number | null;
  /** True once both the possession and game gates are cleared. */
  qualified: boolean;
  /** Full stat sets, computed by the same code the team report uses. */
  offense: Record<string, number>;
  defense: Record<string, number>;
  /** Lineup-only stats -- BLOB/SLOB PPP, 3PT rate, shot quality mix. */
  offenseExtra: Record<string, number | null>;
  defenseExtra: Record<string, number | null>;
  /** Foul trouble logged against members of this group. Individual level only. */
  fouls: number;
}

function statMap(possessions: Possession[], team: "us" | "opponent", goals: StatGoal[]): Record<string, number> {
  const out: Record<string, number> = {};
  computeTeamStats(possessions, team, goals).forEach((r) => { out[r.key] = r.value; });
  return out;
}

/**
 * Stats the team report doesn't have, so they're defined once here.
 *
 * BLOB/SLOB PPP is the one worth calling out: which five you want on the
 * floor for a sideline out with four seconds left is a real coaching
 * question that no product answers. computeOobEffectiveness() exists but
 * returns a scored/flowed/turnover breakdown for the OOB display block,
 * not points per trip, so this computes the trips directly.
 */
function extraStats(possessions: Possession[], team: "us" | "opponent"): Record<string, number | null> {
  const own = countedPossessions(possessions).filter((p) => p.team === team);
  const oob = own.filter((p) => p.possession_type === "blob" || p.possession_type === "slob");
  const fga = own.filter((p) => p.outcome === "fg_made" || p.outcome === "fg_missed");
  const fga3 = fga.filter((p) => p.shot_type === 3);
  const sq = computeShotQuality(possessions, team);
  return {
    oob_ppp: oob.length ? round2(oob.reduce((s, p) => s + (p.points ?? 0), 0) / oob.length) : null,
    oob_trips: oob.length,
    three_rate: fga.length ? Math.round((fga3.length / fga.length) * 1000) / 10 : null,
    sq_great: sq.total ? sq.breakdown.great : null,
    sq_good: sq.total ? sq.breakdown.good : null,
    sq_live: sq.total ? sq.breakdown.live : null,
    sq_tough: sq.total ? sq.breakdown.tough : null,
  };
}

/** Every k-sized subset of a five, as sorted id arrays. */
function combinations(ids: string[], size: number): string[][] {
  if (size > ids.length) return [];
  const out: string[][] = [];
  const walk = (start: number, acc: string[]) => {
    if (acc.length === size) { out.push([...acc]); return; }
    for (let i = start; i < ids.length; i++) walk(i + 1, [...acc, ids[i]]);
  };
  walk(0, []);
  return out;
}

/**
 * Everything the report needs from one pass: the rows themselves, plus the
 * team's own numbers over the SAME filtered possessions, which is what a
 * stat with no goal set gets measured against.
 */
export interface ComboResult {
  rows: ComboRow[];
  teamOffPPP: number;
  teamDefPPP: number;
  teamNet: number;
  teamOffense: Record<string, number>;
  teamDefense: Record<string, number>;
  teamOffenseExtra: Record<string, number | null>;
  teamDefenseExtra: Record<string, number | null>;
  k: number;
  gamesCounted: number;
}

export interface GameSlice {
  gameId: string;
  possessions: Possession[];
  shifts: Shift[];
  format: GameFormat;
  /** Clock readings from shifts that have one, for the minutes estimate. Sparse and optional. */
  anchors?: { sequence: number; seconds: number }[];
}

/**
 * Builds one row per distinct combination at the requested size.
 *
 * A 5-man row means exactly that five on the floor. Below five it means
 * ALL of those players on the floor together, whoever else is out there --
 * "Doucette + Fontes with any other three". Different questions, and the
 * UI has to say which, or people read a pair's number as if it were the
 * pair alone.
 */
export function computeComboRows(
  slices: GameSlice[],
  level: ComboLevel,
  goals: StatGoal[],
  opts: { excludeGarbage?: boolean; clutchOnly?: boolean; foulsByPlayer?: Map<string, number> } = {},
): ComboResult {
  type Bucket = {
    playerIds: string[];
    off: Possession[];
    def: Possession[];
    games: Set<string>;
    shifts: Set<string>;
    seconds: number;
  };
  const buckets = new Map<string, Bucket>();
  const foulsByPlayer = opts.foulsByPlayer ?? new Map<string, number>();

  let teamOff: Possession[] = [];
  let teamDef: Possession[] = [];
  const gamesCounted = new Set<string>();

  for (const slice of slices) {
    if (!slice.shifts.length) continue;
    gamesCounted.add(slice.gameId);

    // Margin needs every point on the scoreboard, so possessionContexts
    // still sees the full log -- an end-of-game free throw absolutely
    // changes whether the next trip is clutch or garbage time. Everything
    // downstream of it works off counted trips only: pace (game minutes
    // divided by possessions would otherwise shrink every player's
    // estimated minutes in exactly the games with the most fouling),
    // shift assignment, and the walk itself.
    const ctx = possessionContexts(slice.possessions);
    const counted = countedPossessions(slice.possessions);
    const spp = secondsBySequence(counted, slice.format, slice.anchors ?? []);
    const assigned = assignPossessionSides(counted, slice.shifts);
    const shiftById = new Map(slice.shifts.map((s) => [s.id, s]));

    for (const p of counted) {
      const c = ctx.get(p.id);
      if (opts.excludeGarbage && c?.garbage) continue;
      if (opts.clutchOnly && !c?.clutch) continue;

      if (p.team === "us") teamOff.push(p); else teamDef.push(p);

      const ends = assigned.get(p.id);
      if (!ends) continue;

      // Both ends are credited. In a game only one of them resolves, so
      // this is the same as before. In an intrasquad practice both do:
      // one of your lineups scored and another gave it up.
      for (const [shiftId, end] of [[ends.off, "off"], [ends.def, "def"]] as const) {
        if (!shiftId) continue;
        const shift = shiftById.get(shiftId);
        if (!shift) continue;

        const groups = level === 5 ? [[...shift.player_ids].sort()] : combinations([...shift.player_ids].sort(), level);
        for (const g of groups) {
          const key = lineupKey(g);
          let b = buckets.get(key);
          if (!b) {
            b = { playerIds: g, off: [], def: [], games: new Set(), shifts: new Set(), seconds: 0 };
            buckets.set(key, b);
          }
          if (end === "off") b.off.push(p); else b.def.push(p);
          b.games.add(slice.gameId);
          b.shifts.add(shiftId);
          // Only count the clock once per possession per group, or a
          // practice lineup on the floor for both ends would double.
          if (end === "off") b.seconds += spp.get(p.sequence) ?? 16;
        }
      }
    }
  }

  const teamOffPPP = teamOff.length ? teamOff.reduce((s, p) => s + (p.points ?? 0), 0) / teamOff.length : 0;
  const teamDefPPP = teamDef.length ? teamDef.reduce((s, p) => s + (p.points ?? 0), 0) / teamDef.length : 0;
  const teamNet = (teamOffPPP - teamDefPPP) * 100;
  const totalTeamOff = teamOff.length;

  const draft = [...buckets.values()].map((b) => {
    const offPPP = b.off.length ? b.off.reduce((s, p) => s + (p.points ?? 0), 0) / b.off.length : null;
    const defPPP = b.def.length ? b.def.reduce((s, p) => s + (p.points ?? 0), 0) / b.def.length : null;
    const rawNet = offPPP != null && defPPP != null ? (offPPP - defPPP) * 100 : null;
    return { b, offPPP, defPPP, rawNet, n: b.off.length + b.def.length };
  });

  const k = estimateK(
    draft.filter((d) => d.rawNet != null).map((d) => ({ value: d.rawNet as number, n: d.n })),
    perPossessionVariance([...teamOff, ...teamDef]) * 10000,
    { distinctPossessions: teamOff.length + teamDef.length, games: gamesCounted.size },
  );

  const gate = SAMPLE_GATES[level];
  const rows: ComboRow[] = draft.map(({ b, offPPP, defPPP, rawNet, n }) => ({
    key: lineupKey(b.playerIds),
    playerIds: b.playerIds,
    offPossessions: b.off.length,
    defPossessions: b.def.length,
    totalPossessions: n,
    possessionShare: totalTeamOff ? Math.round((b.off.length / totalTeamOff) * 100) : 0,
    estMinutes: Math.round((b.seconds / 60) * 10) / 10,
    games: b.games.size,
    shifts: b.shifts.size,
    pointsFor: b.off.reduce((s, p) => s + (p.points ?? 0), 0),
    pointsAgainst: b.def.reduce((s, p) => s + (p.points ?? 0), 0),
    offPPP: offPPP != null ? round2(offPPP) : null,
    defPPP: defPPP != null ? round2(defPPP) : null,
    rawNet: rawNet != null ? Math.round(rawNet) : null,
    adjNet: rawNet != null ? Math.round(shrink(rawNet, n, teamNet, k)) : null,
    qualified: b.off.length >= gate.possessions && b.games.size >= gate.games,
    offense: statMap(b.off, "us", goals),
    defense: statMap(b.def, "opponent", goals),
    offenseExtra: extraStats(b.off, "us"),
    defenseExtra: extraStats(b.def, "opponent"),
    fouls: b.playerIds.reduce((n, id) => n + (foulsByPlayer.get(id) ?? 0), 0),
  }));

  rows.sort((a, b) => b.offPossessions - a.offPossessions);
  return {
    rows, teamOffPPP, teamDefPPP, k, gamesCounted: gamesCounted.size,
    teamNet: Math.round(teamNet),
    teamOffense: statMap(teamOff, "us", goals),
    teamDefense: statMap(teamDef, "opponent", goals),
    teamOffenseExtra: extraStats(teamOff, "us"),
    teamDefenseExtra: extraStats(teamDef, "opponent"),
  };
}

// ── On/off ───────────────────────────────────────────────────────

export interface OnOffRow {
  playerIds: string[];
  onPossessions: number;
  offPossessions: number;
  onNet: number | null;
  offNet: number | null;
  diff: number | null;
  /** Four factors and shot quality, on vs off, so the net difference can be explained. */
  factors: { key: string; label: string; on: number | null; off: number | null; diff: number | null; lowerBetter?: boolean }[];
}

/**
 * Team net rating with a group on the floor, minus with them off.
 *
 * The "off" side is restricted to games the player actually appeared in.
 * Without that, a January call-up's off sample includes every December
 * game he wasn't on the roster for, and the number stops measuring him and
 * starts measuring when he joined the team.
 *
 * Meaningless at five-man -- "without this exact five" is nearly the whole
 * season -- so it's only offered below that.
 */
export function computeOnOff(
  slices: GameSlice[],
  playerIds: string[],
  goals: StatGoal[],
  opts: { excludeGarbage?: boolean } = {},
): OnOffRow {
  const key = new Set(playerIds);
  const appeared = new Set(
    slices.filter((s) => s.shifts.some((sh) => playerIds.every((id) => sh.player_ids.includes(id)))).map((s) => s.gameId),
  );

  let onFor = 0, onAgainst = 0, onOff = 0, onDef = 0;
  let offFor = 0, offAgainst = 0, offOff = 0, offDef = 0;
  const onPoss: Possession[] = [], offPoss: Possession[] = [];

  for (const slice of slices) {
    if (!appeared.has(slice.gameId) || !slice.shifts.length) continue;
    const ctx = possessionContexts(slice.possessions);
    const counted = countedPossessions(slice.possessions);
    const assigned = assignPossessionSides(counted, slice.shifts);
    const shiftById = new Map(slice.shifts.map((s) => [s.id, s]));

    for (const p of counted) {
      if (opts.excludeGarbage && ctx.get(p.id)?.garbage) continue;
      const ends = assigned.get(p.id);
      if (!ends) continue;
      const offShift = ends.off ? shiftById.get(ends.off) : null;
      const defShift = ends.def ? shiftById.get(ends.def) : null;
      const pts = p.points ?? 0;

      if (offShift) {
        const on = [...key].every((id) => offShift.player_ids.includes(id));
        (on ? onPoss : offPoss).push(p);
        if (on) { onFor += pts; onOff++; } else { offFor += pts; offOff++; }
      }
      if (defShift) {
        const on = [...key].every((id) => defShift.player_ids.includes(id));
        if (on) { onAgainst += pts; onDef++; } else { offAgainst += pts; offDef++; }
      }
    }
  }

  const net = (f: number, fN: number, a: number, aN: number) =>
    fN && aN ? Math.round((f / fN - a / aN) * 100) : null;

  const onNet = net(onFor, onOff, onAgainst, onDef);
  const offNet = net(offFor, offOff, offAgainst, offDef);

  const onStats = statMap(onPoss, "us", goals);
  const offStats = statMap(offPoss, "us", goals);
  const FACTORS: { key: string; label: string; lowerBetter?: boolean }[] = [
    { key: "efg_pct", label: "eFG%" },
    { key: "tov_pct", label: "TOV%", lowerBetter: true },
    { key: "oreb_pct", label: "OREB%" },
    { key: "ft_rate", label: "FT rate" },
    { key: "quality_shot_pct", label: "Quality shot %" },
  ];
  const factors = FACTORS.map((f) => {
    const on = onPoss.length ? onStats[f.key] ?? null : null;
    const off = offPoss.length ? offStats[f.key] ?? null : null;
    return { ...f, on, off, diff: on != null && off != null ? Math.round((on - off) * 10) / 10 : null };
  });

  return {
    playerIds,
    onPossessions: onOff + onDef,
    offPossessions: offOff + offDef,
    onNet,
    offNet,
    diff: onNet != null && offNet != null ? onNet - offNet : null,
    factors,
  };
}

/**
 * For a pair: together, each one without the other, and neither. The case
 * worth finding is when "both" is lower than either alone -- two good
 * players who don't fit, which raw combined numbers can never show.
 */
export function computeTogetherApart(slices: GameSlice[], a: string, b: string, opts: { excludeGarbage?: boolean } = {}) {
  const buckets = { both: [0, 0, 0, 0], aOnly: [0, 0, 0, 0], bOnly: [0, 0, 0, 0], neither: [0, 0, 0, 0] };

  for (const slice of slices) {
    if (!slice.shifts.length) continue;
    const ctx = possessionContexts(slice.possessions);
    const counted = countedPossessions(slice.possessions);
    const assigned = assignPossessionSides(counted, slice.shifts);
    const shiftById = new Map(slice.shifts.map((s) => [s.id, s]));

    for (const p of counted) {
      if (opts.excludeGarbage && ctx.get(p.id)?.garbage) continue;
      const ends = assigned.get(p.id);
      if (!ends) continue;
      const pts = p.points ?? 0;
      const bucketFor = (sh: Shift) => {
        const hasA = sh.player_ids.includes(a);
        const hasB = sh.player_ids.includes(b);
        return hasA && hasB ? buckets.both : hasA ? buckets.aOnly : hasB ? buckets.bOnly : buckets.neither;
      };
      const offShift = ends.off ? shiftById.get(ends.off) : null;
      const defShift = ends.def ? shiftById.get(ends.def) : null;
      if (offShift) { const bk = bucketFor(offShift); bk[0] += pts; bk[1]++; }
      if (defShift) { const bk = bucketFor(defShift); bk[2] += pts; bk[3]++; }
    }
  }

  const toRow = (v: number[]) => ({
    possessions: v[1] + v[3],
    net: v[1] && v[3] ? Math.round((v[0] / v[1] - v[2] / v[3]) * 100) : null,
  });
  return { both: toRow(buckets.both), aOnly: toRow(buckets.aOnly), bOnly: toRow(buckets.bOnly), neither: toRow(buckets.neither) };
}

// ── Goal scorecard ───────────────────────────────────────────────

/**
 * Which goals apply at each level.
 *
 * The rule is that goals mirror the columns. Below five-man the report
 * shows four factors as on/off DIFFERENTIALS rather than raw values, so a
 * team goal like eFG% would be judging a number that isn't on screen --
 * "missed the eFG% goal" with no eFG% column to check. Five-man does show
 * raw four factors, so team goals have something to point at there.
 *
 * A consequence worth surfacing in the UI: the denominators differ, so a
 * 4-of-4 individual and a 7-of-10 five aren't comparable.
 */
export const LINEUP_GOAL_KEYS = ["lineup_off_ppp", "lineup_def_ppp", "lineup_net_rating", "lineup_onoff_diff", "lineup_oob_ppp"] as const;

/**
 * Net rating is deliberately absent from the scorecard even though it's a
 * settable goal: it's the metric the ranking sorts on, so counting it would
 * mean a lineup partly explaining its own position. Its two components --
 * offensive and defensive PPP -- carry the same information without the
 * circularity.
 */
const SCORECARD_EXCLUDED = ["lineup_net_rating"] as const;

/**
 * Team goals that actually have a column at five-man.
 *
 * The same rule as everywhere else: goals mirror the columns. Seven of the
 * fifteen goal-settable team stats -- 2PT%, 3PT%, FT%, both paint-touch
 * splits, points off live turnovers, second-chance points -- have no column
 * on any lineup view, so counting them meant "missed the FT% goal" against a
 * number the report never shows. It also inflated the scorecard to seventeen
 * entries, which is a wall rather than a summary.
 */
export const TEAM_GOAL_KEYS_AT_FIVE = [
  "efg_pct", "tov_pct", "oreb_pct", "ft_rate",
  // transition_pct is deliberately out: it's a frequency, not a quality. A
  // lineup isn't better for running more often, and transition_ppp already
  // says whether the running works.
  "transition_ppp", "halfcourt_ppp", "quality_shot_pct",
] as const;

export interface ScorecardItem {
  key: string;
  label: string;
  target: number;
  value: number | null;
  met: boolean;
  lowerBetter: boolean;
}

export interface Scorecard {
  met: number;
  total: number;
  items: ScorecardItem[];
}

export function computeScorecard(
  row: ComboRow,
  level: ComboLevel,
  goals: StatGoal[],
  statLabels: Record<string, string>,
  onOffDiff: number | null,
): Scorecard {
  const set = goals.filter((g) => g.team === "us");

  function valueFor(key: string): number | null {
    switch (key) {
      case "lineup_off_ppp": return row.offPPP;
      case "lineup_def_ppp": return row.defPPP;
      case "lineup_net_rating": return row.adjNet;
      // On/off is meaningless at five-man, so that goal simply doesn't apply there.
      case "lineup_onoff_diff": return level === 5 ? null : onOffDiff;
      // Lives in offenseExtra rather than the team stat map -- it's a
      // lineup-only stat with no team report equivalent.
      case "lineup_oob_ppp": return (row.offenseExtra.oob_ppp as number | null) ?? null;
      default: return row.offense[key] ?? null;
    }
  }

  const applicable = set.filter((g) => {
    if ((SCORECARD_EXCLUDED as readonly string[]).includes(g.stat_key)) return false;
    const isLineupGoal = (LINEUP_GOAL_KEYS as readonly string[]).includes(g.stat_key);
    // On/off is meaningless at five; BLOB/SLOB PPP only has a column there.
    if (isLineupGoal) {
      if (g.stat_key === "lineup_onoff_diff") return level !== 5;
      if (g.stat_key === "lineup_oob_ppp") return level === 5;
      return true;
    }
    // Team goals only at five-man, and only those with a column there.
    return level === 5 && (TEAM_GOAL_KEYS_AT_FIVE as readonly string[]).includes(g.stat_key);
  });

  const items: ScorecardItem[] = applicable.map((g) => {
    const value = valueFor(g.stat_key);
    const lowerBetter = g.direction === "lower_better";
    return {
      key: g.stat_key,
      label: statLabels[g.stat_key] ?? g.stat_key,
      target: g.target_value,
      value,
      met: value != null && (lowerBetter ? value <= g.target_value : value >= g.target_value),
      lowerBetter,
    };
  });

  return { met: items.filter((i) => i.met).length, total: items.length, items };
}

// ── Readiness ────────────────────────────────────────────────────

/**
 * How many groups at each level clear their gate. Early season this points
 * you at individual and pairs, where the samples actually are, instead of
 * letting you draw conclusions from a 22-possession five.
 */
export function readiness(slices: GameSlice[], goals: StatGoal[]): { level: ComboLevel; ready: number; total: number }[] {
  return COMBO_LEVELS.map(({ value }) => {
    const { rows } = computeComboRows(slices, value, goals, { excludeGarbage: true });
    return { level: value, ready: rows.filter((r) => r.qualified).length, total: rows.length };
  });
}

function round2(n: number) { return Math.round(n * 100) / 100; }
