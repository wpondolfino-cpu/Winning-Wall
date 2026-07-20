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
// direct_shot: a shot was taken right off the action (OREB putback or
// BLOB/SLOB inbound), no set called. flowed_half_court: it turned into a
// traditional half-court possession (Set/Motion). turnover: lost the ball
// directly off the action, before any shot or set.
export type OobResult = "direct_shot" | "flowed_half_court" | "turnover";
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
  linked_play_id: string | null;
  created_by: string;
  created_at: string;
}

/** Minimal shape of a row from the Plays feature's `plays` table -- just enough to surface it as a pickable play call. */
export interface DrawnPlay {
  id: string;
  title: string;
  tags: string[];
}

/** Plays tagged with a category (case-insensitively) that a coach drew in the Plays feature, so they can surface in the tracker without re-entering the name. RLS on `plays` only returns ones this user owns or was shared -- see note in GameTracker. */
export async function fetchDrawnPlaysForCategory(category: PlayCallCategory): Promise<DrawnPlay[]> {
  const { data } = await supabase.from("plays").select("id, title, tags");
  return ((data as DrawnPlay[]) ?? []).filter((p) => p.tags.some((t) => t.toLowerCase() === category));
}

/** Mirrors a drawn play into play_calls (once) so it can be referenced by possession.play_call_id and show up in effectiveness reports like any other play call. */
export async function ensurePlayCallForPlay(play: DrawnPlay, category: PlayCallCategory, userId: string): Promise<PlayCall | null> {
  const { data: existing } = await supabase.from("play_calls").select("*").eq("linked_play_id", play.id).maybeSingle();
  if (existing) return existing as PlayCall;
  const { data, error } = await supabase
    .from("play_calls")
    .insert({ category, name: play.title, linked_play_id: play.id, created_by: userId })
    .select()
    .single();
  return error ? null : (data as PlayCall);
}

export interface StatGoal {
  stat_key: string;
  target_value: number;
  direction: "higher_better" | "lower_better";
}

export async function listStatGoals() {
  return supabase.from("stat_goals").select("*");
}

export async function upsertStatGoal(statKey: string, targetValue: number, direction: "higher_better" | "lower_better", userId: string) {
  return supabase.from("stat_goals").upsert({ stat_key: statKey, target_value: targetValue, direction, updated_by: userId }, { onConflict: "stat_key" });
}

// ── Stat definitions & custom ordering ──────────────────────────
// One master ordered list drives both what's available to reorder (Goals
// tab) and how every report renders. `inGame: false` items (set-play
// effectiveness, BLOB/SLOB effectiveness, streaks) only show on a "full"
// report (full game, season, custom report) -- not on a quarter/half
// in-game report. A stat's `kind` decides how ReportBody renders that row;
// `kind: "number"` rows are the only ones with goal-based coloring.
export type StatKind = "number" | "shot_quality" | "set_plays" | "oob" | "streaks";

export interface StatDef {
  key: string;
  label: string;
  kind: StatKind;
  inGame: boolean;
  defaultDirection?: "higher_better" | "lower_better";
}

export const DEFAULT_STAT_ORDER: StatDef[] = [
  { key: "efg_pct", label: "eFG%", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "transition_pct", label: "Transition %", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "oreb_pct", label: "OREB%", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "tov_pct", label: "TOV%", kind: "number", inGame: true, defaultDirection: "lower_better" },
  { key: "ft_rate", label: "FT rate", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "paint_touch_single", label: "Paint touch", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "paint_touch_both", label: "Both sides", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "transition_ppp", label: "Transition PPP", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "halfcourt_ppp", label: "Half-court PPP", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "shot_quality", label: "Shot quality", kind: "shot_quality", inGame: true },
  { key: "set_plays", label: "Set plays (Set / Motion)", kind: "set_plays", inGame: false },
  { key: "oob_plays", label: "Set plays (BLOB / SLOB)", kind: "oob", inGame: false },
  { key: "streaks", label: "Streaks", kind: "streaks", inGame: false },
];

/** Goal-settable stats, for the Goals tab -- just the "number" kind subset. */
export const GOAL_STATS = DEFAULT_STAT_ORDER.filter((s) => s.kind === "number") as
  { key: string; label: string; defaultDirection: "higher_better" | "lower_better" }[];

/** Reads the coach's saved stat order (single most-recent row). Null if never customized. */
export async function getReportLayout(): Promise<string[] | null> {
  const { data } = await supabase.from("report_layout").select("stat_order").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data ? (data.stat_order as string[]) : null;
}

/** Saves the full stat order. Updates the single existing row if there is one, otherwise inserts the first. */
export async function saveReportLayout(order: string[], userId: string) {
  const { data: existing } = await supabase.from("report_layout").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    return supabase.from("report_layout").update({ stat_order: order, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", (existing as any).id);
  }
  return supabase.from("report_layout").insert({ stat_order: order, updated_by: userId });
}

/** Merges a saved key order against the current DEFAULT_STAT_ORDER -- any stat not in the saved list (e.g. one added after the coach last customized) falls in at the end, in its default position. */
export function resolveStatOrder(savedOrder: string[] | null): StatDef[] {
  if (!savedOrder || !savedOrder.length) return DEFAULT_STAT_ORDER;
  const byKey = new Map(DEFAULT_STAT_ORDER.map((d) => [d.key, d]));
  const ordered: StatDef[] = [];
  savedOrder.forEach((k) => {
    const d = byKey.get(k);
    if (d) { ordered.push(d); byKey.delete(k); }
  });
  byKey.forEach((d) => ordered.push(d)); // newly-added stats land at the end
  return ordered;
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

export interface SavedReport {
  id: string;
  label: string;
  season: string;
  game_count: "3" | "5" | "10" | "season";
  category: "all" | PossessionType;
  created_by: string;
  created_at: string;
}

export async function listSavedReports(season: string) {
  return supabase.from("saved_reports").select("*").eq("season", season).order("created_at", { ascending: false });
}

export async function saveReport(report: Omit<SavedReport, "id" | "created_at">) {
  return supabase.from("saved_reports").insert(report).select().single();
}

export async function deleteSavedReport(id: string) {
  return supabase.from("saved_reports").delete().eq("id", id);
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

/**
 * Core box-score math for one team's possessions in the given set.
 * `invertDirection` is used for the opponent's stat block: a goal is set
 * from our own perspective (e.g. "keep TOV% under 14"), so judging the
 * opponent's *same* stat number flips what's good for us -- their eFG%
 * being low is what we want, so a "higher_better" goal becomes
 * "lower_better" when scoring their side, using our own target as the
 * rough benchmark since there's no separate opponent-specific goal.
 */
export function computeTeamStats(possessions: Possession[], team: Team, goals: StatGoal[], invertDirection = false): StatRow[] {
  const trips = possessions.filter((p) => p.team === team);
  const fga = trips.filter((p) => p.outcome === "fg_made" || p.outcome === "fg_missed");
  const made2 = trips.filter((p) => p.outcome === "fg_made" && p.shot_type === 2).length;
  const made3 = trips.filter((p) => p.outcome === "fg_made" && p.shot_type === 3).length;
  const fgaCount = fga.length;
  const turnovers = trips.filter((p) => p.outcome === "turnover").length;
  const oreb = trips.reduce((s, p) => s + p.oreb_count, 0);
  const missedFg = trips.filter((p) => p.outcome === "fg_missed").length;
  const orebOpportunities = missedFg; // simplification: OREB% of own missed FGs
  const ftTrips = trips.filter((p) => p.outcome === "ft_trip").length;
  const paintTouchSingle = trips.filter((p) => p.paint_touch === "single").length;
  const paintTouchBoth = trips.filter((p) => p.paint_touch === "both").length;
  const transitionTripsArr = trips.filter((p) => p.possession_type === "transition");
  const halfCourtTripsArr = trips.filter((p) => p.possession_type === "half_court");

  const efg = fgaCount ? ((made2 + made3) + 0.5 * made3) / fgaCount * 100 : 0;
  const tovPct = trips.length ? (turnovers / trips.length) * 100 : 0;
  const orebPct = orebOpportunities ? (oreb / orebOpportunities) * 100 : 0;
  const ftRate = fgaCount ? ftTrips / fgaCount : 0;
  const transitionPpp = transitionTripsArr.length ? transitionTripsArr.reduce((s, p) => s + p.points, 0) / transitionTripsArr.length : 0;
  const halfCourtPpp = halfCourtTripsArr.length ? halfCourtTripsArr.reduce((s, p) => s + p.points, 0) / halfCourtTripsArr.length : 0;
  const transitionPct = trips.length ? (transitionTripsArr.length / trips.length) * 100 : 0;

  const rows: { key: string; label: string; value: number }[] = [
    { key: "efg_pct", label: "eFG%", value: round1(efg) },
    { key: "transition_pct", label: "Transition %", value: round1(transitionPct) },
    { key: "oreb_pct", label: "OREB%", value: round1(orebPct) },
    { key: "tov_pct", label: "TOV%", value: round1(tovPct) },
    { key: "ft_rate", label: "FT rate", value: round2(ftRate) },
    { key: "paint_touch_single", label: "Paint touch", value: paintTouchSingle },
    { key: "paint_touch_both", label: "Both sides", value: paintTouchBoth },
    { key: "transition_ppp", label: "Transition PPP", value: round2(transitionPpp) },
    { key: "halfcourt_ppp", label: "Half-court PPP", value: round2(halfCourtPpp) },
  ];

  return rows.map((r) => {
    const goal = goalFor(goals, r.key);
    const direction = goal ? (invertDirection ? (goal.direction === "higher_better" ? "lower_better" : "higher_better") : goal.direction) : undefined;
    return {
      key: r.key,
      label: r.label,
      value: r.value,
      goal: goal?.target_value ?? null,
      role: goal && direction ? colorRole(r.value, goal.target_value, direction) : null,
    };
  });
}

/** Weighted shot-quality score mapped back onto the great/good/live/tough label scale. Only meaningful for "us" -- we don't track the opponent's shot quality. */
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

/** BLOB/SLOB breakdown: direct shot attempts (and makes), flowed into a half-court set, or turned it over right off the action. */
export function computeOobEffectiveness(possessions: Possession[], type: "blob" | "slob") {
  const trips = possessions.filter((p) => p.team === "us" && p.possession_type === type);
  const directShots = trips.filter((p) => p.oob_result === "direct_shot");
  const scored = directShots.filter((p) => p.points > 0).length;
  const flowed = trips.filter((p) => p.oob_result === "flowed_half_court").length;
  const turnovers = trips.filter((p) => p.oob_result === "turnover").length;
  return { total: trips.length, directAttempts: directShots.length, scored, flowed, turnovers };
}

export async function finishGame(gameId: string, finalScoreUs: number, finalScoreThem: number) {
  return supabase.from("games").update({ final_score_us: finalScoreUs, final_score_them: finalScoreThem }).eq("id", gameId);
}

/** A game is only editable/correctable once it's been explicitly finished (final score set) -- this keeps live entry and post-game correction from colliding. */
export function isGameFinal(game: Pick<Game, "final_score_us" | "final_score_them">): boolean {
  return game.final_score_us != null && game.final_score_them != null;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
