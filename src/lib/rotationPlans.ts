// src/lib/rotationPlans.ts
// Phase 5: planning a rotation, and estimating what a five you've never
// played would be worth.
//
// THE PROJECTION IS THE INTERESTING PART, and the obvious version of it is
// worthless. Summing five players' on/off differentials means the best
// projected five is always the top five by on/off -- which the report
// already tells you in two clicks. It assumes fit away entirely, so it can
// never say "these two good players don't work together", which is the only
// thing worth asking of a projection.
//
// So a five is projected from EVERY observed group inside it: the five
// itself if you've played it, its ten pairs, its ten trios, its five
// individuals. Each contributes in proportion to how many possessions back
// it and how specific it is -- a trio says more about a five than any one
// player does. Nothing observed falls back to the team's own average.
//
// The output is deliberately two numbers, not one. "Individuals alone
// suggest +14, everything together says +6" makes the fit effect visible
// instead of burying it inside a single figure.

import { supabase } from "./supabase";
import type { StatGoal } from "./gameStats";
import { computeComboRows, type ComboLevel, type GameSlice } from "./lineupStats";
import { lineupKey } from "./lineups";

export interface RotationPlan {
  id?: string;
  game_id: string;
  /** One entry per block, in order. Each is the five intended for it. */
  blocks: string[][];
  minute_targets: Record<string, number>;
  notes: string | null;
}

export const DEFAULT_BLOCKS_PER_PERIOD = 3;

// ── Storage ──────────────────────────────────────────────────────

export async function loadPlan(gameId: string): Promise<RotationPlan | null> {
  const { data, error } = await supabase.from("rotation_plans").select("*").eq("game_id", gameId).maybeSingle();
  if (error) throw new Error(`Couldn't load the rotation plan: ${error.message}`);
  if (!data) return null;
  const row = data as any;
  return { id: row.id, game_id: row.game_id, blocks: row.blocks ?? [], minute_targets: row.minute_targets ?? {}, notes: row.notes };
}

export async function savePlan(plan: RotationPlan, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("rotation_plans").upsert(
    {
      game_id: plan.game_id,
      blocks: plan.blocks,
      minute_targets: plan.minute_targets,
      notes: plan.notes,
      created_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "game_id" },
  );
  return { error: error?.message ?? null };
}

/** The most recent plan on another game, for copy-forward. */
export async function lastPlan(excludeGameId: string, rosterId: string | null): Promise<RotationPlan | null> {
  let q = supabase.from("games").select("id, game_date").order("game_date", { ascending: false }).limit(25);
  if (rosterId) q = q.eq("roster_id", rosterId);
  const { data: games } = await q;
  const ids = ((games ?? []) as any[]).map((g) => g.id).filter((id: string) => id !== excludeGameId);
  if (!ids.length) return null;
  const { data } = await supabase.from("rotation_plans").select("*").in("game_id", ids).order("updated_at", { ascending: false }).limit(1);
  const row = ((data ?? []) as any[])[0];
  if (!row) return null;
  return { game_id: excludeGameId, blocks: row.blocks ?? [], minute_targets: row.minute_targets ?? {}, notes: null };
}

// ── Projection ───────────────────────────────────────────────────

/**
 * How much a group of each size counts toward projecting a five.
 *
 * A trio that's played 60 possessions tells you far more about a five than a
 * single player who's played 600, because four of that player's teammates
 * vary. These aren't tuned -- they're a stated judgement that specificity
 * beats raw sample, and they're visible here rather than buried.
 */
const LEVEL_WEIGHT: Record<ComboLevel, number> = { 1: 1, 2: 3, 3: 6, 5: 20 };

export interface Projection {
  /** Best estimate, using every observed group inside the five. */
  net: number | null;
  /** What the five individuals alone would suggest -- the naive version. */
  individualsOnly: number | null;
  /** The difference. Negative means they fit worse than their parts imply. */
  fit: number | null;
  /** True when this exact five has actually been played. */
  observed: boolean;
  /** Total weighted evidence behind the estimate, for confidence. */
  evidence: number;
  contributions: { level: ComboLevel; groups: number; possessions: number }[];
}

export interface ProjectionModel {
  project: (playerIds: string[]) => Projection;
  teamNet: number;
  /** Possessions behind the whole model, for the reliability banner. */
  totalPossessions: number;
}

/**
 * Builds a projector once for a set of games, so a builder can price every
 * block without recomputing the season per block.
 */
export function buildProjectionModel(slices: GameSlice[], goals: StatGoal[]): ProjectionModel {
  const byLevel = new Map<ComboLevel, Map<string, { net: number | null; n: number }>>();
  let teamNet = 0;
  let totalPossessions = 0;

  ([1, 2, 3, 5] as ComboLevel[]).forEach((level) => {
    const { rows, teamNet: tn, teamOffPPP, teamDefPPP } = computeComboRows(slices, level, goals, { excludeGarbage: true });
    if (level === 1) {
      teamNet = tn;
      totalPossessions = rows.reduce((s, r) => s + r.offPossessions, 0);
      void teamOffPPP; void teamDefPPP;
    }
    const m = new Map<string, { net: number | null; n: number }>();
    rows.forEach((r) => m.set(r.key, { net: r.adjNet, n: r.offPossessions + r.defPossessions }));
    byLevel.set(level, m);
  });

  /** Every subset of the given size, as lineup keys. */
  function subsets(ids: string[], size: number): string[][] {
    const out: string[][] = [];
    const walk = (start: number, acc: string[]) => {
      if (acc.length === size) { out.push([...acc]); return; }
      for (let i = start; i < ids.length; i++) walk(i + 1, [...acc, ids[i]]);
    };
    walk(0, []);
    return out;
  }

  function project(playerIds: string[]): Projection {
    if (playerIds.length !== 5) {
      return { net: null, individualsOnly: null, fit: null, observed: false, evidence: 0, contributions: [] };
    }
    const sorted = [...playerIds].sort();

    let weighted = 0, weight = 0;
    let indWeighted = 0, indWeight = 0;
    let observed = false;
    const contributions: Projection["contributions"] = [];

    ([1, 2, 3, 5] as ComboLevel[]).forEach((level) => {
      const table = byLevel.get(level);
      if (!table) return;
      let groups = 0, possessions = 0;

      subsets(sorted, level).forEach((sub) => {
        const hit = table.get(lineupKey(sub));
        if (!hit || hit.net == null || !hit.n) return;
        groups++;
        possessions += hit.n;
        if (level === 5) observed = true;
        const w = hit.n * LEVEL_WEIGHT[level];
        weighted += hit.net * w;
        weight += w;
        if (level === 1) { indWeighted += hit.net * hit.n; indWeight += hit.n; }
      });

      if (groups) contributions.push({ level, groups, possessions });
    });

    // Nothing observed at all -- the team's own number is the only honest
    // answer, and it isn't a projection so much as an admission.
    if (!weight) {
      return { net: teamNet, individualsOnly: teamNet, fit: 0, observed: false, evidence: 0, contributions };
    }

    const net = Math.round(weighted / weight);
    const individualsOnly = indWeight ? Math.round(indWeighted / indWeight) : null;
    return {
      net,
      individualsOnly,
      fit: individualsOnly == null ? null : net - individualsOnly,
      observed,
      evidence: weight,
      contributions,
    };
  }

  return { project, teamNet, totalPossessions };
}

// ── Plan versus actual ───────────────────────────────────────────

export interface PlanComparison {
  block: number;
  planned: string[];
  actual: string[];
  /** Players planned but not on the floor, and vice versa. */
  missing: string[];
  extra: string[];
  matched: boolean;
}

/**
 * Compares the plan against the shifts actually entered, block by block.
 *
 * Stated, not judged. A plan that broke isn't a failure -- foul trouble and
 * game state are exactly why you'd deviate -- but seeing WHERE it broke
 * across a season is how you learn your plan was unrealistic in the first
 * place.
 */
export function comparePlanToActual(plan: RotationPlan, actualBlocks: string[][]): PlanComparison[] {
  const out: PlanComparison[] = [];
  const n = Math.max(plan.blocks.length, actualBlocks.length);
  for (let i = 0; i < n; i++) {
    const planned = plan.blocks[i] ?? [];
    const actual = actualBlocks[i] ?? [];
    if (!planned.length && !actual.length) continue;
    const missing = planned.filter((p) => !actual.includes(p));
    const extra = actual.filter((p) => !planned.includes(p));
    out.push({ block: i, planned, actual, missing, extra, matched: !missing.length && !extra.length });
  }
  return out;
}

/** The five most on the floor in each block of a played game, for the comparison above. */
export function actualBlocksFromSlice(slice: GameSlice, blocksPerPeriod = DEFAULT_BLOCKS_PER_PERIOD): string[][] {
  const periods = [...new Set(slice.possessions.map((p) => p.quarter))].sort((a, b) => a - b);
  const shiftAt = (seq: number) =>
    slice.shifts
      .filter((s) => (s.side ?? "us") === "us" && s.start_sequence <= seq)
      .sort((a, b) => b.start_sequence - a.start_sequence)[0];

  const out: string[][] = [];
  periods.forEach((period) => {
    const list = slice.possessions.filter((p) => p.quarter === period).sort((a, b) => a.sequence - b.sequence);
    for (let b = 0; b < blocksPerPeriod; b++) {
      const from = Math.floor((b / blocksPerPeriod) * list.length);
      const to = Math.floor(((b + 1) / blocksPerPeriod) * list.length);
      const counts = new Map<string, number>();
      list.slice(from, to).forEach((p) => {
        const sh = shiftAt(p.sequence);
        sh?.player_ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
      });
      out.push([...counts.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 5).map(([id]) => id));
    }
  });
  return out;
}
