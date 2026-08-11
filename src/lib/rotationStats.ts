// src/lib/rotationStats.ts
// Phase 4, observational half: what your rotation actually looks like, and
// what the season says about particular stretches of a game.
//
// Two things live here and they need very different amounts of data.
//
// FINDINGS need no shift data at all -- they're pure possession maths, so
// they say something useful from around game five. The heatmap needs shifts
// across roughly ten games. That gap is why they're computed separately and
// labelled separately rather than sharing one "not enough data" wall.
//
// The panel STATES things and never explains them. "Third quarters run
// -0.14 below the rest" is an observation; "so change your third-quarter
// lineup" is a conclusion the coach is far better placed to draw, because
// they know about the zone the other team switched to at half.
//
// The same restraint governs how personnel context is chosen. Deviations
// are surfaced by SIZE, never by how well they fit the story -- picking
// context that supports a narrative would be suggesting a cause through the
// back door. Sometimes you'll get a fact that explains nothing. That's
// correct.

import { periodLabel, type Possession } from "./gameStats";
import { assignPossessionSides, lineupKey, type Shift } from "./lineups";
import { possessionContexts, secondsPerPossession, type GameSlice } from "./lineupStats";

/** Personnel context needs its own sample before it means anything. */
export const CONTEXT_POSSESSION_FLOOR = 40;
/** A segment's own number needs this many before it's worth stating. */
export const SEGMENT_POSSESSION_FLOOR = 60;
/** Below this the difference isn't worth a line, however real it is. */
export const MIN_EFFECT_PPP = 0.06;

export type SegmentKind = "period" | "period_start" | "period_end" | "score_state";

export interface ContextFact {
  text: string;
  /** Possessions behind this fact -- below the floor it carries a caveat. */
  possessions: number;
  confident: boolean;
}

export interface Finding {
  kind: SegmentKind;
  label: string;
  /** Our net PPP in this segment, and across everything else, per possession. */
  segmentPPP: number;
  baselinePPP: number;
  diff: number;
  possessions: number;
  confident: boolean;
  context: ContextFact[];
}

interface Bucket {
  label: string;
  kind: SegmentKind;
  ours: Possession[];
  theirs: Possession[];
  ids: Set<string>;
}

/**
 * Four segment kinds, fixed in advance.
 *
 * Fixed rather than searched on purpose: testing every possible slice of a
 * season guarantees some will look meaningful by chance, and a panel that
 * hunts for patterns will always find them.
 *
 * Out-of-halftime isn't separate because the start of the third period IS
 * out of halftime -- it would be the same possessions counted twice.
 */
export function computeFindings(slices: GameSlice[]): Finding[] {
  const buckets = new Map<string, Bucket>();
  const all: Possession[] = [];

  function add(key: string, label: string, kind: SegmentKind, p: Possession) {
    let b = buckets.get(key);
    if (!b) { b = { label, kind, ours: [], theirs: [], ids: new Set() }; buckets.set(key, b); }
    (p.team === "us" ? b.ours : b.theirs).push(p);
    b.ids.add(p.id);
  }

  for (const slice of slices) {
    if (!slice.possessions.length) continue;
    const spp = secondsPerPossession(slice.possessions, slice.format);
    const ctx = possessionContexts(slice.possessions, {
      secondsPerPossession: [...spp.values()].reduce((a, b) => a + b, 0) / Math.max(1, spp.size),
    });

    const byPeriod = new Map<number, Possession[]>();
    slice.possessions.forEach((p) => {
      if (!byPeriod.has(p.quarter)) byPeriod.set(p.quarter, []);
      byPeriod.get(p.quarter)!.push(p);
    });

    byPeriod.forEach((list, period) => {
      const sorted = [...list].sort((a, b) => a.sequence - b.sequence);
      const label = periodLabel(slice.format, period);
      // Roughly the first and last 90 seconds of a period, at this game's pace.
      const edge = Math.max(3, Math.round(90 / (spp.get(period) ?? 16)));

      sorted.forEach((p, i) => {
        all.push(p);
        add(`period:${period}`, label, "period", p);
        if (i < edge) add(`start:${period}`, `Start of ${label}`, "period_start", p);
        if (i >= sorted.length - edge) add(`end:${period}`, `End of ${label}`, "period_end", p);

        const margin = ctx.get(p.id)?.margin ?? 0;
        const state = margin >= 10 ? "Leading by 10+" : margin <= -10 ? "Trailing by 10+" : "Within 10";
        add(`score:${state}`, state, "score_state", p);
      });
    });
  }

  const netOf = (ours: Possession[], theirs: Possession[]) => {
    if (!ours.length || !theirs.length) return null;
    const off = ours.reduce((s, p) => s + (p.points ?? 0), 0) / ours.length;
    const def = theirs.reduce((s, p) => s + (p.points ?? 0), 0) / theirs.length;
    return off - def;
  };

  const findings: Finding[] = [];
  buckets.forEach((b, key) => {
    const segNet = netOf(b.ours, b.theirs);
    if (segNet == null) return;
    // Compared against everything OUTSIDE this segment, not the whole
    // season -- otherwise a segment is partly compared against itself.
    const rest = all.filter((p) => !b.ids.has(p.id));
    const baseNet = netOf(rest.filter((p) => p.team === "us"), rest.filter((p) => p.team !== "us"));
    if (baseNet == null) return;

    const diff = segNet - baseNet;
    if (Math.abs(diff) < MIN_EFFECT_PPP) return;

    const possessions = b.ours.length + b.theirs.length;
    findings.push({
      kind: b.kind,
      label: b.label,
      segmentPPP: round2(segNet),
      baselinePPP: round2(baseNet),
      diff: round2(diff),
      possessions,
      confident: possessions >= SEGMENT_POSSESSION_FLOOR,
      context: personnelContext(slices, b.ids),
    });
  });

  // Biggest effects first, but anything below the sample floor sorts after
  // everything above it -- same rule the lineup rows follow.
  return findings.sort((a, b) => {
    if (a.confident !== b.confident) return a.confident ? -1 : 1;
    return Math.abs(b.diff) - Math.abs(a.diff);
  });
}

/**
 * What's different about the personnel in these possessions.
 *
 * Deviations are ranked by size alone. Choosing which ones to show based on
 * whether they'd explain the segment would be exactly the causal claim this
 * panel is meant to avoid.
 */
function personnelContext(slices: GameSlice[], ids: Set<string>): ContextFact[] {
  const inSeg = new Map<string, number>();
  const overall = new Map<string, number>();
  let segTotal = 0, allTotal = 0;

  const lineupSeg = new Map<string, { n: number; players: string[]; for: number; against: number }>();

  for (const slice of slices) {
    const assigned = assignPossessionSides(slice.possessions, slice.shifts);
    const byId = new Map(slice.shifts.map((s: Shift) => [s.id, s]));

    for (const p of slice.possessions) {
      const ends = assigned.get(p.id);
      const shift = ends?.off ? byId.get(ends.off) : ends?.def ? byId.get(ends.def) : null;
      if (!shift) continue;
      const isSeg = ids.has(p.id);
      allTotal++;
      if (isSeg) segTotal++;

      shift.player_ids.forEach((pid) => {
        overall.set(pid, (overall.get(pid) ?? 0) + 1);
        if (isSeg) inSeg.set(pid, (inSeg.get(pid) ?? 0) + 1);
      });

      if (isSeg) {
        const key = lineupKey(shift.player_ids);
        const l = lineupSeg.get(key) ?? { n: 0, players: [...shift.player_ids], for: 0, against: 0 };
        l.n++;
        if (p.team === "us") l.for += p.points ?? 0; else l.against += p.points ?? 0;
        lineupSeg.set(key, l);
      }
    }
  }

  if (!segTotal || !allTotal) return [];

  const facts: { text: string; size: number }[] = [];

  overall.forEach((n, pid) => {
    const segShare = (inSeg.get(pid) ?? 0) / segTotal;
    const allShare = n / allTotal;
    const delta = segShare - allShare;
    if (Math.abs(delta) < 0.1) return; // under 10 points of share isn't a difference
    facts.push({
      text: `__${pid}__ is on the floor for ${Math.round(segShare * 100)}% of these possessions, against ${Math.round(allShare * 100)}% across the rest.`,
      size: Math.abs(delta),
    });
  });

  const topLineup = [...lineupSeg.values()].sort((a, b) => b.n - a.n)[0];
  if (topLineup && topLineup.n / segTotal >= 0.15) {
    facts.push({
      text: `The five here most often (${topLineup.players.map((p) => `__${p}__`).join(" · ")}) covers ${Math.round((topLineup.n / segTotal) * 100)}% of them.`,
      size: topLineup.n / segTotal,
    });
  }

  return facts
    .sort((a, b) => b.size - a.size)
    .slice(0, 2)
    .map((f) => ({ text: f.text, possessions: segTotal, confident: segTotal >= CONTEXT_POSSESSION_FLOOR }));
}

// ── Rotation heatmap ─────────────────────────────────────────────

export interface HeatmapCell { block: number; share: number }
export interface HeatmapRow { playerId: string; cells: HeatmapCell[]; games: number }

/**
 * How often each player was on the floor in each block of the game.
 *
 * Twelve blocks -- three per regulation period -- deliberately matching the
 * planner's grid, so what you did and what you're planning are read on the
 * same axis. Blocks are cut by possession index rather than clock, which is
 * the only thing that works when film doesn't show the clock.
 *
 * Averaging substitution TIMES across games would produce a rotation you've
 * never run; a share-per-block heatmap doesn't pretend there's one canonical
 * pattern.
 */
export function computeRotationHeatmap(slices: GameSlice[], blocksPerPeriod = 3): { rows: HeatmapRow[]; blocks: string[]; games: number } {
  const onFloor = new Map<string, Map<number, number>>();
  const blockTotals = new Map<number, number>();
  const playerGames = new Map<string, Set<string>>();
  const labels = new Map<number, string>();
  let counted = 0;

  for (const slice of slices) {
    if (!slice.shifts.length || !slice.possessions.length) continue;
    counted++;
    const periods = [...new Set(slice.possessions.map((p) => p.quarter))].sort((a, b) => a - b);
    const assigned = assignPossessionSides(slice.possessions, slice.shifts);
    const byId = new Map(slice.shifts.map((s: Shift) => [s.id, s]));

    periods.forEach((period, pi) => {
      const list = slice.possessions.filter((p) => p.quarter === period).sort((a, b) => a.sequence - b.sequence);
      list.forEach((p, i) => {
        const within = Math.min(blocksPerPeriod - 1, Math.floor((i / list.length) * blocksPerPeriod));
        const block = pi * blocksPerPeriod + within;
        labels.set(block, `${periodLabel(slice.format, period)}${blocksPerPeriod > 1 ? ` ${within + 1}` : ""}`);
        blockTotals.set(block, (blockTotals.get(block) ?? 0) + 1);

        const ends = assigned.get(p.id);
        const shift = ends?.off ? byId.get(ends.off) : ends?.def ? byId.get(ends.def) : null;
        if (!shift) return;
        shift.player_ids.forEach((pid) => {
          if (!onFloor.has(pid)) onFloor.set(pid, new Map());
          const m = onFloor.get(pid)!;
          m.set(block, (m.get(block) ?? 0) + 1);
          if (!playerGames.has(pid)) playerGames.set(pid, new Set());
          playerGames.get(pid)!.add(slice.gameId);
        });
      });
    });
  }

  const blockIdx = [...blockTotals.keys()].sort((a, b) => a - b);
  const rows: HeatmapRow[] = [...onFloor.entries()]
    .map(([playerId, m]) => ({
      playerId,
      games: playerGames.get(playerId)?.size ?? 0,
      cells: blockIdx.map((b) => ({
        block: b,
        share: blockTotals.get(b) ? (m.get(b) ?? 0) / blockTotals.get(b)! : 0,
      })),
    }))
    // Most-used players first -- that's the rotation, top to bottom.
    .sort((a, b) => b.cells.reduce((s, c) => s + c.share, 0) - a.cells.reduce((s, c) => s + c.share, 0));

  return { rows, blocks: blockIdx.map((b) => labels.get(b) ?? ""), games: counted };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
