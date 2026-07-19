// src/lib/gameStats.ts
// Game Stats feature: types, an offline-first write queue (IndexedDB +
// background sync), and the stat calculations that turn a possession log
// into quarter/half/game/win-loss/season reports.
//
// Why offline-first: live entry happens courtside, often on bad gym wifi.
// Every tap in GameTracker writes to the local queue immediately -- the UI
// never waits on the network -- and syncQueue() drains it to Supabase
// whenever a connection is available.

import { supabase } from "./supabase";

// ── Types ────────────────────────────────────────────────────
export type Team = "us" | "opponent";
export type PossessionType = "transition" | "half_court" | "blob" | "slob";
export type HalfCourtType = "set" | "motion";
export type OobResult = "score" | "flowed_half_court";
export type PaintTouch = "single" | "both";
export type Outcome = "fg_made" | "fg_missed" | "turnover" | "ft_trip";
export type ShotQuality = "great" | "good" | "live" | "tough";
export type TurnoverType = "live" | "dead";
export type PlayCallCategory = "set" | "motion" | "blob" | "slob";

export interface Possession {
  id: string;
  game_id: string;
  team: Team;
  quarter: number;
  sequence: number;
  possession_type: PossessionType;
  half_court_type: HalfCourtType | null;
  play_call_id: string | null;
  oob_result: OobResult | null;
  paint_touch: PaintTouch | null;
  oreb_count: number;
  outcome: Outcome;
  shot_type: 2 | 3 | null;
  shot_quality: ShotQuality | null;
  turnover_type: TurnoverType | null;
  points: number;
  created_by: string;
  created_at: string;
}

export interface PlayCall {
  id: string;
  category: PlayCallCategory;
  name: string;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
}

export interface StatGoal {
  stat_key: string;
  target_value: number;
  direction: "higher_better" | "lower_better";
}

export interface Game {
  id: string;
  opponent: string;
  game_date: string;
  season: string;
  home_away: "home" | "away" | "neutral";
  final_score_us: number | null;
  final_score_them: number | null;
  status: "draft" | "published";
}

// ── Offline queue (IndexedDB) ──────────────────────────────────
const DB_NAME = "ww-game-stats";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Queue a possession locally. Called on every tap in GameTracker -- never awaits the network. */
export async function queuePossession(p: Possession): Promise<void> {
  await withStore("readwrite", (store) => store.put(p));
  void syncQueue();
}

export async function removeFromQueue(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function getQueuedPossessions(): Promise<Possession[]> {
  return withStore("readonly", (store) => store.getAll());
}

export async function queueCount(): Promise<number> {
  return withStore("readonly", (store) => store.count());
}

let syncing = false;

/** Drains the local queue into Supabase. Safe to call repeatedly -- no-ops while offline or mid-sync. */
export async function syncQueue(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await getQueuedPossessions();
    for (const p of pending) {
      const { error } = await supabase.from("possessions").upsert(p);
      if (!error) await removeFromQueue(p.id);
      else break; // stop on first failure, retry next trigger
    }
  } finally {
    syncing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void syncQueue());
}

// ── Stat calculations ──────────────────────────────────────────
export interface StatRow {
  key: string;
  label: string;
  value: number;
  goal: number | null;
  role: "success" | "warning" | "danger" | null;
}

function colorRole(value: number, goal: number, direction: "higher_better" | "lower_better"): "success" | "warning" | "danger" {
  const ratio = direction === "higher_better" ? value / goal : goal / value;
  if (ratio < 0.8) return "danger";
  if (ratio < 0.95) return "warning";
  return "success";
}

function goalFor(goals: StatGoal[], key: string) {
  return goals.find((g) => g.stat_key === key) ?? null;
}

/** Core box-score math for one team's possessions in the given set. FGA/points drive eFG%, PPP, etc. */
export function computeTeamStats(possessions: Possession[], team: Team, goals: StatGoal[]): StatRow[] {
  const trips = possessions.filter((p) => p.team === team);
  const fga = trips.filter((p) => p.outcome === "fg_made" || p.outcome === "fg_missed");
  const made2 = trips.filter((p) => p.outcome === "fg_made" && p.shot_type === 2).length;
  const made3 = trips.filter((p) => p.outcome === "fg_made" && p.shot_type === 3).length;
  const fgaCount = fga.length;
  const totalPoints = trips.reduce((s, p) => s + p.points, 0);
  const turnovers = trips.filter((p) => p.outcome === "turnover").length;
  const oreb = trips.reduce((s, p) => s + p.oreb_count, 0);
  const missedFg = trips.filter((p) => p.outcome === "fg_missed").length;
  const orebOpportunities = missedFg; // simplification: OREB% of own missed FGs
  const ftTrips = trips.filter((p) => p.outcome === "ft_trip").length;
  const paintTouches = trips.filter((p) => p.paint_touch != null).length;
  const transitionTrips = trips.filter((p) => p.possession_type === "transition").length;

  const efg = fgaCount ? ((made2 + made3) + 0.5 * made3) / fgaCount * 100 : 0;
  const tovPct = trips.length ? (turnovers / trips.length) * 100 : 0;
  const orebPct = orebOpportunities ? (oreb / orebOpportunities) * 100 : 0;
  const ftRate = fgaCount ? ftTrips / fgaCount : 0;
  const ppp = trips.length ? totalPoints / trips.length : 0;
  const transitionPct = trips.length ? (transitionTrips / trips.length) * 100 : 0;

  const rows: { key: string; label: string; value: number }[] = [
    { key: "efg_pct", label: "eFG%", value: round1(efg) },
    { key: "transition_pct", label: "Transition %", value: round1(transitionPct) },
    { key: "oreb_pct", label: "OREB%", value: round1(orebPct) },
    { key: "tov_pct", label: "TOV%", value: round1(tovPct) },
    { key: "paint_touches", label: "Paint touches", value: paintTouches },
    { key: "ft_rate", label: "FT rate", value: round2(ftRate) },
    { key: "ppp", label: "PPP", value: round2(ppp) },
  ];

  return rows.map((r) => {
    const goal = goalFor(goals, r.key);
    return {
      key: r.key,
      label: r.label,
      value: r.value,
      goal: goal?.target_value ?? null,
      role: goal ? colorRole(r.value, goal.target_value, goal.direction) : null,
    };
  });
}

/** Weighted shot-quality score mapped back onto the great/good/live/tough label scale. */
export function computeShotQuality(possessions: Possession[], team: Team = "us") {
  const rated = possessions.filter((p) => p.team === team && p.shot_quality != null);
  const weights: Record<ShotQuality, number> = { great: 4, good: 3, live: 2, tough: 1 };
  const counts: Record<ShotQuality, number> = { great: 0, good: 0, live: 0, tough: 0 };
  rated.forEach((p) => counts[p.shot_quality as ShotQuality]++);
  const total = rated.length;
  const pct = (k: ShotQuality) => (total ? round1((counts[k] / total) * 100) : 0);

  const avg = total
    ? rated.reduce((s, p) => s + weights[p.shot_quality as ShotQuality], 0) / total
    : 0;
  const label: ShotQuality = avg >= 3.5 ? "great" : avg >= 2.5 ? "good" : avg >= 1.5 ? "live" : "tough";

  return {
    label: total ? label : null,
    breakdown: { great: pct("great"), good: pct("good"), live: pct("live"), tough: pct("tough") },
  };
}

/** Scoring runs (us) and stop runs (opponent held scoreless), 3+ consecutive trips, plus best run. */
export function computeStreaks(possessions: Possession[]) {
  const ordered = [...possessions].sort((a, b) => a.sequence - b.sequence);

  const scoringRuns = countRuns(
    ordered.filter((p) => p.team === "us"),
    (p) => p.points > 0
  );
  const stopRuns = countRuns(
    ordered.filter((p) => p.team === "opponent"),
    (p) => p.points === 0
  );

  return { scoringRuns, stopRuns };
}

function countRuns(trips: Possession[], hit: (p: Possession) => boolean) {
  let current = 0;
  let best = 0;
  let runsOfThreePlus = 0;
  for (const p of trips) {
    if (hit(p)) {
      current++;
      best = Math.max(best, current);
    } else {
      if (current >= 3) runsOfThreePlus++;
      current = 0;
    }
  }
  if (current >= 3) runsOfThreePlus++;
  return { count: runsOfThreePlus, best };
}

/** Most-called / most-effective breakdown per named play, within one category. */
export function computePlayCallEffectiveness(possessions: Possession[], playCalls: PlayCall[]) {
  return playCalls.map((call) => {
    const trips = possessions.filter((p) => p.play_call_id === call.id);
    const scored = trips.filter((p) => p.points > 0).length;
    return {
      playCallId: call.id,
      name: call.name,
      category: call.category,
      calls: trips.length,
      scored,
      conversionPct: trips.length ? round1((scored / trips.length) * 100) : 0,
      ppp: trips.length ? round2(trips.reduce((s, p) => s + p.points, 0) / trips.length) : 0,
    };
  }).sort((a, b) => b.calls - a.calls);
}

/** BLOB/SLOB direct-score vs flowed-to-half-court breakdown. */
export function computeOobEffectiveness(possessions: Possession[], type: "blob" | "slob") {
  const trips = possessions.filter((p) => p.team === "us" && p.possession_type === type);
  const scored = trips.filter((p) => p.oob_result === "score" && p.points > 0).length;
  const flowed = trips.filter((p) => p.oob_result === "flowed_half_court").length;
  return { total: trips.length, scored, flowed };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
