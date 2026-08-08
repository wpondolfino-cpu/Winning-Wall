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
export type PossessionType = "transition" | "half_court" | "blob" | "slob" | "press";
export type DefenseScheme = "man" | "zone";
export type PressResult = "turnover" | "man" | "zone";
export type HalfCourtType = "set" | "motion";
// direct_shot: a shot was taken right off the action (OREB putback or
// BLOB/SLOB inbound), no set called. flowed_half_court: it turned into a
// traditional half-court possession (Set/Motion). turnover: lost the ball
// directly off the action, before any shot or set.
export type OobResult = "direct_shot" | "flowed_half_court" | "turnover";
export type Outcome = "fg_made" | "fg_missed" | "turnover" | "ft_trip";
export type ShotQuality = "great" | "good" | "live" | "tough";
export type TurnoverType = "live" | "dead" | "charge";
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
  defense_scheme: DefenseScheme | null;
  press_result: PressResult | null;
  paint_touch: boolean;
  paint_touch_both_sides: boolean;
  oreb_count: number;
  missed_fg_count: number;
  outcome: Outcome;
  shot_type: 2 | 3 | null;
  shot_quality: ShotQuality | null;
  turnover_type: TurnoverType | null;
  ft_attempts: 1 | 2 | 3 | null;
  absorbed_ft_attempts: number;
  absorbed_ft_made: number;
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
  team: Team;
  target_value: number;
  direction: "higher_better" | "lower_better";
  min_sample_size?: number | null;
  note?: string | null;
}

export async function listStatGoals() {
  return supabase.from("stat_goals").select("*");
}

export async function upsertStatGoal(
  statKey: string, team: Team, targetValue: number, direction: "higher_better" | "lower_better", userId: string,
  minSampleSize?: number | null, note?: string | null
) {
  return supabase.from("stat_goals").upsert(
    { stat_key: statKey, team, target_value: targetValue, direction, min_sample_size: minSampleSize ?? null, note: note ?? null, updated_by: userId },
    { onConflict: "stat_key,team" }
  );
}

// ── Stat definitions & custom ordering ──────────────────────────
// One master ordered list drives both what's available to reorder (Goals
// tab) and how every report renders. `inGame: false` items (set-play
// effectiveness, BLOB/SLOB effectiveness, streaks) only show on a "full"
// report (full game, season, custom report) -- not on a quarter/half
// in-game report. A stat's `kind` decides how ReportBody renders that row;
// `kind: "number"` rows are the only ones with goal-based coloring.
export type StatKind = "number" | "shot_quality" | "set_plays" | "oob" | "streaks" | "defense_schemes";

export interface StatDef {
  key: string;
  label: string;
  kind: StatKind;
  inGame: boolean;
  defaultDirection?: "higher_better" | "lower_better";
  selfColored?: boolean; // true for stats colored by their own sign (+/-), not against a goal target
  goalOnly?: boolean;    // settable as a goal, but not its own report row and not in the reorder list -- it's the headline of another block
  usOnly?: boolean;      // no opponent-side equivalent (we don't grade their shot selection), so no Opponent goal input
}

export const DEFAULT_STAT_ORDER: StatDef[] = [
  { key: "efg_pct", label: "eFG%", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "fg2_pct", label: "2PT FG%", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "fg3_pct", label: "3PT FG%", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "ft_pct", label: "FT%", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "transition_pct", label: "Transition %", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "oreb_pct", label: "OREB%", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "tov_pct", label: "TOV%", kind: "number", inGame: true, defaultDirection: "lower_better" },
  { key: "ft_rate", label: "FT rate %", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "paint_touch_single", label: "Paint touch %", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "paint_touch_both", label: "Both sides %", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "transition_ppp", label: "Transition PPP", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "halfcourt_ppp", label: "Half-court PPP", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "extra_possessions", label: "Extra Possessions", kind: "number", inGame: true, selfColored: true },
  { key: "points_off_live_to", label: "Points off Live TO", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "second_chance_points", label: "Second Chance Points", kind: "number", inGame: true, defaultDirection: "higher_better" },
  { key: "shot_quality", label: "Shot quality", kind: "shot_quality", inGame: true },
  // Not a paired us/opponent row of its own -- it is the headline of the
  // Shot quality block above. goalOnly keeps it out of the report rows and
  // out of the reorder list while still giving it a goal input.
  { key: "quality_shot_pct", label: "Quality shots % (Great + Good)", kind: "number", inGame: true, defaultDirection: "higher_better", goalOnly: true, usOnly: true },
  { key: "set_plays", label: "Set plays (Set / Motion)", kind: "set_plays", inGame: false },
  { key: "oob_plays", label: "Set plays (BLOB / SLOB)", kind: "oob", inGame: false },
  { key: "streaks", label: "Streaks", kind: "streaks", inGame: true },
  { key: "defense_schemes", label: "Defense schemes (Man / Zone / Press)", kind: "defense_schemes", inGame: false },
];

/** Goal-settable stats, for the Goals tab -- "number" kind, excluding self-colored ones like Extra Possessions that don't compare against a target. Includes goalOnly stats, which get a target but no report row of their own. */
export const GOAL_STATS = DEFAULT_STAT_ORDER.filter((s) => s.kind === "number" && !s.selfColored) as
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
  notes: string | null;
  closed_quarters: number[];
  period_format: PeriodFormat;
  regulation_periods: number;
  period_lengths: number[];
  ot_minutes: number;
  game_type: GameType;
}

// ── Game format (quarters vs halves, overtime, game type) ───────
// Period structure lives on the game row (migration 100) so nothing
// downstream hardcodes "4 quarters of 8 minutes" any more. A row created
// before that migration -- or a partial select that doesn't ask for these
// columns -- falls back to DEFAULT_GAME_FORMAT, which is exactly the old
// hardcoded behaviour, so every existing code path keeps working.
//
// Note that `possessions.quarter` is really a period number: regulation
// periods first, then overtimes. A halves game logs OT as period 3.
// "periods" (P1, P2...) is for scrimmages, which run more than four and
// aren't overtime; "sessions" (S1, S2...) is for practices, which hold
// several intrasquad blocks rather than anything resembling a quarter.
export type PeriodFormat = "quarters" | "halves" | "periods" | "sessions";
export type GameType = "regular" | "scrimmage" | "summer" | "tournament" | "playoff" | "practice";

export interface GameFormat {
  period_format: PeriodFormat;
  regulation_periods: number;
  /** Minutes of every period in order, regulation first then overtime. Its length IS the period count. */
  period_lengths: number[];
  /** Prefill for the "+ OT" prompt, updated whenever an overtime is added. Not typed at game creation. */
  ot_minutes: number;
}

export const DEFAULT_GAME_FORMAT: GameFormat = {
  period_format: "quarters",
  regulation_periods: 4,
  period_lengths: [8, 8, 8, 8],
  ot_minutes: 4,
};

/**
 * Starting points for each structure. The coach types the actual minutes,
 * so these are only defaults -- there's no preset per possible period
 * count any more, since periods are added as the game or practice runs.
 */
export const GAME_STRUCTURES: { value: PeriodFormat; label: string; periods: number; minutes: number; otMinutes: number }[] = [
  { value: "quarters", label: "Quarters", periods: 4, minutes: 8, otMinutes: 4 },
  { value: "halves", label: "Halves", periods: 2, minutes: 16, otMinutes: 4 },
  { value: "periods", label: "Periods (scrimmage)", periods: 5, minutes: 8, otMinutes: 8 },
  { value: "sessions", label: "Sessions (practice)", periods: 4, minutes: 10, otMinutes: 10 },
];

/** Builds a format from a structure choice plus a typed minutes value. */
export function buildGameFormat(structure: PeriodFormat, periods: number, minutes: number, otMinutes: number): GameFormat {
  const n = Math.max(1, Math.min(8, periods));
  return {
    period_format: structure,
    regulation_periods: n,
    period_lengths: Array.from({ length: n }, () => Math.max(1, Math.min(30, minutes))),
    ot_minutes: Math.max(1, Math.min(30, otMinutes)),
  };
}

export const GAME_TYPES: { value: GameType; label: string }[] = [
  { value: "regular", label: "Regular season" },
  { value: "scrimmage", label: "Scrimmage" },
  { value: "practice", label: "Practice/intrasquad" },
  { value: "summer", label: "Summer league" },
  { value: "tournament", label: "Tournament" },
  { value: "playoff", label: "Playoff" },
];

/**
 * Reports are scoped to a group of game types rather than a single type,
 * so "games" can mean regular plus tournament plus playoff without the
 * coach ticking three boxes. Scrimmage and practice data never lands in
 * a games report -- practice possessions in particular are our players
 * on both ends, so their efficiency isn't on the same scale as a real
 * game's and averaging the two together would make both less meaningful.
 */
export type GameGroup = "games" | "scrimmages" | "practices" | "summer";

export const GAME_GROUPS: { value: GameGroup; label: string; types: GameType[] }[] = [
  { value: "games", label: "Games", types: ["regular", "tournament", "playoff"] },
  { value: "scrimmages", label: "Scrimmages", types: ["scrimmage"] },
  { value: "practices", label: "Practices", types: ["practice"] },
  { value: "summer", label: "Summer league", types: ["summer"] },
];

export function gameTypesForGroup(group: GameGroup): GameType[] {
  return (GAME_GROUPS.find((g) => g.value === group) ?? GAME_GROUPS[0]).types;
}

/**
 * Whether extra periods on this game are overtimes or just more regulation.
 * A scrimmage that runs six periods isn't going to overtime -- those are
 * full-length periods, and calling them OT would also make the minutes
 * estimator size them with ot_minutes instead of their real length.
 */
export function usesOvertime(fmt: GameFormat): boolean {
  return fmt.period_format === "quarters" || fmt.period_format === "halves";
}

/** Label for the "add another period" button, which means different things per format. */
export function addPeriodLabel(fmt: GameFormat): string {
  if (usesOvertime(fmt)) return "+ OT";
  return fmt.period_format === "sessions" ? "+ Session" : "+ Period";
}

/** Normalises whatever a query actually returned into a complete GameFormat, falling back to the old hardcoded 4 x 8 quarters. */
export function gameFormat(game: Partial<GameFormat> | null | undefined): GameFormat {
  if (!game) return DEFAULT_GAME_FORMAT;
  const regulation = game.regulation_periods ?? DEFAULT_GAME_FORMAT.regulation_periods;
  const lengths = game.period_lengths?.length
    ? game.period_lengths
    : Array.from({ length: regulation }, () => 8);
  return {
    period_format: game.period_format ?? DEFAULT_GAME_FORMAT.period_format,
    regulation_periods: regulation,
    period_lengths: lengths,
    ot_minutes: game.ot_minutes ?? DEFAULT_GAME_FORMAT.ot_minutes,
  };
}

/** Total periods including any overtime -- derived from the array, so there's nothing to keep in sync. */
export function periodCount(fmt: GameFormat): number {
  return fmt.period_lengths.length;
}

/** How many periods past regulation this game has. */
export function overtimeCount(fmt: GameFormat): number {
  return Math.max(0, periodCount(fmt) - fmt.regulation_periods);
}

/** Whether individual period lengths can be edited. Games run uniform periods; scrimmages and practices don't. */
export function lengthsEditable(fmt: GameFormat): boolean {
  return !usesOvertime(fmt);
}

/** Total game length in minutes. */
export function gameLengthMinutes(fmt: GameFormat): number {
  return fmt.period_lengths.reduce((a, b) => a + b, 0);
}

/** Regulation period numbers -- [1,2,3,4] for quarters, [1,2] for halves. */
export function regulationPeriods(fmt: GameFormat): number[] {
  return Array.from({ length: fmt.regulation_periods }, (_, i) => i + 1);
}

/** Every period this game has a tab for -- straight from period_lengths. */
export function periodsInPlay(fmt: GameFormat): number[] {
  return Array.from({ length: periodCount(fmt) }, (_, i) => i + 1);
}

/** "Q3" / "H2" / "P5" / "S2" / "OT" / "2OT" -- anything past regulation is an overtime. */
export function periodLabel(fmt: GameFormat, period: number): string {
  if (period <= fmt.regulation_periods) {
    const prefix =
      fmt.period_format === "halves" ? "H" :
      fmt.period_format === "periods" ? "P" :
      fmt.period_format === "sessions" ? "S" : "Q";
    return prefix + period;
  }
  const ot = period - fmt.regulation_periods;
  return ot === 1 ? "OT" : `${ot}OT`;
}

/** Length of a period in seconds, straight from period_lengths. Used by the per-period minutes estimator. */
export function periodLengthSeconds(fmt: GameFormat, period: number): number {
  return (fmt.period_lengths[period - 1] ?? fmt.ot_minutes) * 60;
}

/**
 * Which period numbers a half report covers.
 *
 * For a quarters game this is [1,2] and [3,4] -- identical to the old
 * hardcoded behaviour. For a halves game each "half" is its own single
 * period, which is what was broken before: a halves game's Halftime
 * report matched [1,2] and so returned the entire game.
 *
 * Overtimes always attach to the second half. maxPeriod defaults past any
 * realistic overtime count; listing periods that don't exist is harmless
 * because this feeds an `.in()` filter.
 */
export function halfPeriods(fmt: GameFormat, half: 1 | 2, maxPeriod: number = 12): number[] {
  const split = Math.ceil(fmt.regulation_periods / 2);
  const regulation = regulationPeriods(fmt);
  if (half === 1) return regulation.filter((p) => p <= split);
  const out = regulation.filter((p) => p > split);
  for (let p = fmt.regulation_periods + 1; p <= maxPeriod; p++) out.push(p);
  return out;
}

/** Label for a half report, adjusted for format -- a halves game shouldn't say "Halftime (Q1-Q2)". */
export function halfLabel(fmt: GameFormat, half: 1 | 2): string {
  const periods = halfPeriods(fmt, half, fmt.regulation_periods);
  const names = periods.map((p) => periodLabel(fmt, p)).join("-");
  return half === 1 ? `Halftime (${names})` : `2nd half (${names})`;
}

export interface SavedReport {
  id: string;
  label: string;
  season: string;
  game_count: "3" | "5" | "10" | "season";
  category: "all" | PossessionType;
  game_group: GameGroup;
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
  const raw = await withStore<Possession[]>("readonly", (store) => store.getAll());
  return raw.map(normalizeLegacyPossession);
}

/**
 * Some possessions sitting in a device's local queue may predate a schema
 * change and still have the OLD shape -- e.g. paint_touch used to be a
 * text field ('single'/'both'), now it's two booleans. Supabase rejects
 * those on sync (invalid boolean, not-null violation), which otherwise
 * looks like permanent data loss for whatever got tracked before the
 * update went out. This converts old-shaped fields to the current shape
 * so that data actually recovers instead of just failing forever.
 */
function normalizeLegacyPossession(p: any): Possession {
  let paintTouch = p.paint_touch;
  let paintTouchBoth = p.paint_touch_both_sides;
  if (typeof paintTouch === "string") {
    // old shape: paint_touch was 'single' | 'both' | null
    paintTouchBoth = paintTouch === "both";
    paintTouch = paintTouch === "single" || paintTouch === "both";
  }
  return {
    ...p,
    paint_touch: paintTouch ?? false,
    paint_touch_both_sides: paintTouchBoth ?? false,
    missed_fg_count: p.missed_fg_count ?? 0,
    absorbed_ft_attempts: p.absorbed_ft_attempts ?? 0,
    absorbed_ft_made: p.absorbed_ft_made ?? 0,
    defense_scheme: p.defense_scheme ?? null,
    press_result: p.press_result ?? null,
    oob_result: p.oob_result === "score" ? "direct_shot" : p.oob_result ?? null,
  };
}

export async function queueCount(): Promise<number> {
  return withStore("readonly", (store) => store.count());
}

let syncing = false;
let lastSyncErrors: { id: string; message: string }[] = [];

export function getLastSyncErrors() {
  return lastSyncErrors;
}

/**
 * Drains the local queue into Supabase. Safe to call repeatedly -- no-ops
 * while offline or mid-sync.
 *
 * Previously this stopped at the first failed record, which meant one bad
 * possession (a schema mismatch, an expired session, anything) silently
 * blocked every possession queued after it from ever syncing -- the queue
 * would just grow all game long behind that one stuck record. Now it tries
 * every queued record on every pass and only leaves the ones that actually
 * failed behind, so a single bad record can't take the rest of the game
 * down with it.
 */
export async function syncQueue(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  const errors: { id: string; message: string }[] = [];
  try {
    const pending = await getQueuedPossessions();
    for (const p of pending) {
      let { error } = await supabase.from("possessions").upsert(p);

      // A (game_id, sequence) collision usually means the tracker got
      // reloaded mid-game and the sequence counter restarted at 1,
      // landing on a number an earlier possession already used. Rather
      // than leaving it stuck forever, bump it past whatever the highest
      // synced sequence for that game actually is and retry once.
      if (error && error.message.includes("possessions_game_seq_unique")) {
        const { data: maxRow } = await supabase
          .from("possessions")
          .select("sequence")
          .eq("game_id", p.game_id)
          .order("sequence", { ascending: false })
          .limit(1)
          .maybeSingle();
        const nextSeq = ((maxRow as any)?.sequence ?? 0) + 1;
        const bumped = { ...p, sequence: nextSeq };
        const retry = await supabase.from("possessions").upsert(bumped);
        error = retry.error;
      }

      if (!error) await removeFromQueue(p.id);
      else errors.push({ id: p.id, message: error.message });
    }
  } finally {
    lastSyncErrors = errors;
    syncing = false;
  }
}

/** Sum of tracked points, computed straight from the possession log -- used to pre-fill "Finish game" so the coach isn't hand-counting, and doubles as a sanity check: if this looks way off from the real final score, something didn't sync. */
export function computeFinalScore(possessions: Possession[]): { us: number; them: number } {
  return {
    us: possessions.filter((p) => p.team === "us").reduce((s, p) => s + p.points, 0),
    them: possessions.filter((p) => p.team === "opponent").reduce((s, p) => s + p.points, 0),
  };
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
  raw?: string; // e.g. "12/16" -- shown alongside the (colored) percentage, itself never colored
  signed?: boolean; // shows an explicit "+" on positive values (e.g. Extra Possessions)
  display?: string; // overrides how `value` renders (e.g. "1.00" instead of "1") without changing the underlying number used for coloring/goals
}

function colorRole(value: number, goal: number, direction: "higher_better" | "lower_better"): "success" | "warning" | "danger" {
  const ratio = direction === "higher_better" ? value / goal : goal / value;
  if (ratio < 0.8) return "danger";
  if (ratio < 0.95) return "warning";
  return "success";
}

function goalFor(goals: StatGoal[], key: string, team: Team) {
  return goals.find((g) => g.stat_key === key && g.team === team) ?? null;
}

/**
 * Same goal/direction resolution computeTeamStats uses internally, exposed
 * for stats computed outside it (points off live TOs, second chance
 * points -- both need both teams' possessions at once, so they're plain
 * functions rather than part of the per-team computeTeamStats pipeline).
 * Prefers a team-specific goal; falls back to inverting the "us" goal for
 * the opponent side, same as everywhere else.
 */
export function scoreAgainstGoal(goals: StatGoal[], key: string, team: Team, value: number): { goal: number | null; role: "success" | "warning" | "danger" | null } {
  const ownGoal = goalFor(goals, key, "us");
  const teamGoal = team === "us" ? ownGoal : goalFor(goals, key, "opponent");
  let goal: number | null = null;
  let direction: "higher_better" | "lower_better" | undefined;
  if (teamGoal) {
    goal = teamGoal.target_value;
    direction = teamGoal.direction;
  } else if (team === "opponent" && ownGoal) {
    goal = ownGoal.target_value;
    direction = ownGoal.direction === "higher_better" ? "lower_better" : "higher_better";
  }
  return { goal, role: goal != null && direction ? colorRole(value, goal, direction) : null };
}

/**
 * Core box-score math for one team's possessions in the given set.
 * Goal coloring for "opponent" prefers a coach-set opponent-specific goal
 * (team: 'opponent' in stat_goals) if one exists -- lets a coach hold the
 * opponent to a tighter number than just the inverse of our own target.
 * If no opponent-specific goal has been set, it falls back to inverting
 * our own goal's direction (higher_better becomes lower_better and vice
 * versa) using our own target as a rough benchmark.
 */
export function computeTeamStats(possessions: Possession[], team: Team, goals: StatGoal[]): StatRow[] {
  const trips = possessions.filter((p) => p.team === team);
  const fga = trips.filter((p) => p.outcome === "fg_made" || p.outcome === "fg_missed");
  const fga2 = fga.filter((p) => p.shot_type === 2);
  const fga3 = fga.filter((p) => p.shot_type === 3);
  const made2 = fga2.filter((p) => p.outcome === "fg_made").length;
  const made3 = fga3.filter((p) => p.outcome === "fg_made").length;
  const fgaCount = fga.length;
  const turnovers = trips.filter((p) => p.outcome === "turnover").length;
  const liveTov = trips.filter((p) => p.outcome === "turnover" && p.turnover_type === "live").length;
  const deadTov = trips.filter((p) => p.outcome === "turnover" && p.turnover_type === "dead").length;
  const chargeTov = trips.filter((p) => p.outcome === "turnover" && p.turnover_type === "charge").length;
  const oreb = trips.reduce((s, p) => s + p.oreb_count, 0);
  // A trip can absorb multiple missed shots before it finally ends (each
  // one rebounded and continued) -- missed_fg_count tallies the ones that
  // got continued; the final row's own outcome catches the last one if
  // *that* was also a miss (i.e. no OREB followed it, trip just ended).
  const orebOpportunities = trips.reduce((s, p) => s + p.missed_fg_count + (p.outcome === "fg_missed" ? 1 : 0), 0);
  const ftTripsWithAttempts = trips.filter((p) => p.outcome === "ft_trip" && p.ft_attempts != null);
  // FT makes/attempts from a trip that ended as an ft_trip itself, PLUS any
  // FT attempts that happened earlier in a trip but got absorbed into a
  // later, different final outcome (missed a FT, got the OREB, kept going)
  // -- otherwise those makes/attempts just vanish from FT% entirely.
  const ftMade = ftTripsWithAttempts.reduce((s, p) => s + p.points, 0) + trips.reduce((s, p) => s + p.absorbed_ft_made, 0);
  const ftAttempted = ftTripsWithAttempts.reduce((s, p) => s + (p.ft_attempts ?? 0), 0) + trips.reduce((s, p) => s + p.absorbed_ft_attempts, 0);
  const paintTouchSingle = trips.filter((p) => p.paint_touch).length;
  const paintTouchBoth = trips.filter((p) => p.paint_touch_both_sides).length;
  const transitionTripsArr = trips.filter((p) => p.possession_type === "transition");
  // A blob/slob possession that flowed into a set/motion look (oob_result
  // === "flowed_half_court") keeps possession_type "blob"/"slob" for BLOB
  // effectiveness purposes -- but the actual shot came from a half-court
  // action, so it belongs in half-court efficiency too, not just possessions
  // that started half-court outright.
  const halfCourtTripsArr = trips.filter((p) =>
    p.possession_type === "half_court" ||
    ((p.possession_type === "blob" || p.possession_type === "slob") && p.oob_result === "flowed_half_court")
  );

  const efg = fgaCount ? ((made2 + made3) + 0.5 * made3) / fgaCount * 100 : 0;
  const fg2Pct = fga2.length ? (made2 / fga2.length) * 100 : 0;
  const fg3Pct = fga3.length ? (made3 / fga3.length) * 100 : 0;
  const ftPct = ftAttempted ? (ftMade / ftAttempted) * 100 : 0;
  const tovPct = trips.length ? (turnovers / trips.length) * 100 : 0;
  const orebPct = orebOpportunities ? (oreb / orebOpportunities) * 100 : 0;
  const ftRate = fgaCount ? ftAttempted / fgaCount : 0;
  const paintTouchSinglePct = halfCourtTripsArr.length ? (paintTouchSingle / halfCourtTripsArr.length) * 100 : 0;
  const paintTouchBothPct = halfCourtTripsArr.length ? (paintTouchBoth / halfCourtTripsArr.length) * 100 : 0;
  const transitionPpp = transitionTripsArr.length ? transitionTripsArr.reduce((s, p) => s + p.points, 0) / transitionTripsArr.length : 0;
  const halfCourtPpp = halfCourtTripsArr.length ? halfCourtTripsArr.reduce((s, p) => s + p.points, 0) / halfCourtTripsArr.length : 0;
  const transitionPct = trips.length ? (transitionTripsArr.length / trips.length) * 100 : 0;

  const rows: { key: string; label: string; value: number; raw?: string; display?: string }[] = [
    { key: "efg_pct", label: "eFG%", value: round1(efg) },
    { key: "fg2_pct", label: "2PT FG%", value: round1(fg2Pct), raw: `${made2}/${fga2.length}` },
    { key: "fg3_pct", label: "3PT FG%", value: round1(fg3Pct), raw: `${made3}/${fga3.length}` },
    { key: "ft_pct", label: "FT%", value: round1(ftPct), raw: `${ftMade}/${ftAttempted}` },
    { key: "transition_pct", label: "Transition %", value: round1(transitionPct), raw: `${transitionTripsArr.length}/${trips.length}` },
    { key: "oreb_pct", label: "OREB%", value: round1(orebPct), raw: `${oreb}` },
    { key: "tov_pct", label: "TOV%", value: round1(tovPct), raw: `${liveTov}+${deadTov}+${chargeTov}=${turnovers}` },
    { key: "ft_rate", label: "FT rate %", value: round1(ftRate * 100) },
    { key: "paint_touch_single", label: "Paint touch %", value: round1(paintTouchSinglePct), raw: `${paintTouchSingle}/${halfCourtTripsArr.length}` },
    { key: "paint_touch_both", label: "Both sides %", value: round1(paintTouchBothPct), raw: `${paintTouchBoth}/${halfCourtTripsArr.length}` },
    { key: "transition_ppp", label: "Transition PPP", value: round2(transitionPpp), display: transitionPpp.toFixed(2) },
    { key: "halfcourt_ppp", label: "Half-court PPP", value: round2(halfCourtPpp), display: halfCourtPpp.toFixed(2) },
  ];

  return rows.map((r) => {
    const { goal, role } = scoreAgainstGoal(goals, r.key, team, r.value);
    return {
      key: r.key,
      label: r.label,
      value: r.value,
      goal,
      role,
      raw: r.raw,
      display: r.display,
    };
  });
}

/**
 * Extra Possessions: (our OREB + their TOV) minus (their OREB + our TOV).
 * Our own offensive rebounds and their turnovers both count in our favor;
 * their offensive rebounds and our own turnovers both count against us.
 * Positive is good for us, negative is bad -- colored by sign, not against
 * a goal target. This is inherently a two-team number (needs both sides'
 * OREB/TOV at once), unlike the rest of computeTeamStats which only looks
 * at one team's possessions -- so it's its own function.
 */
export function computeExtraPossessions(possessions: Possession[]): { us: number; opponent: number } {
  const orebFor = (team: Team) => possessions.filter((p) => p.team === team).reduce((s, p) => s + p.oreb_count, 0);
  const tovFor = (team: Team) => possessions.filter((p) => p.team === team && p.outcome === "turnover").length;
  const usTotal = orebFor("us") + tovFor("opponent");
  const oppTotal = orebFor("opponent") + tovFor("us");
  const us = usTotal - oppTotal;
  return { us, opponent: -us };
}

/**
 * Points off live-ball turnovers: for each team, points scored on a
 * transition possession that immediately follows (by sequence) a live-ball
 * turnover committed by the OTHER team. Needs the full ordered possession
 * list at once (it's about adjacency between two consecutive rows), same
 * reason computeExtraPossessions and computeStreaks aren't per-team.
 */
export function computePointsOffLiveTurnovers(possessions: Possession[]): { us: number; opponent: number } {
  const ordered = [...possessions].sort((a, b) => a.sequence - b.sequence);
  let us = 0;
  let opponent = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    const forcedByOtherTeam = prev.outcome === "turnover" && prev.turnover_type === "live" && cur.team !== prev.team;
    const scoredInTransition = cur.possession_type === "transition" && cur.outcome === "fg_made";
    if (forcedByOtherTeam && scoredInTransition) {
      if (cur.team === "us") us += cur.points;
      else opponent += cur.points;
    }
  }
  return { us, opponent };
}

/** Second chance points: made 2s/3s that happened on a possession that also had at least one OREB (oreb_count > 0) -- i.e. the score came after a rebound kept the trip alive. */
export function computeSecondChancePoints(possessions: Possession[]): { us: number; opponent: number } {
  const scoredAfterOreb = (team: Team) =>
    possessions
      .filter((p) => p.team === team && p.oreb_count > 0 && p.outcome === "fg_made")
      .reduce((s, p) => s + p.points, 0);
  return { us: scoredAfterOreb("us"), opponent: scoredAfterOreb("opponent") };
}

/** Weighted shot-quality score mapped back onto the great/good/live/tough label scale. Only meaningful for "us" -- we don't track the opponent's shot quality. */
export function computeShotQuality(possessions: Possession[], team: Team = "us") {
  const rated = possessions.filter((p) => p.team === team && p.shot_quality != null);
  const counts: Record<ShotQuality, number> = { great: 0, good: 0, live: 0, tough: 0 };
  rated.forEach((p) => counts[p.shot_quality as ShotQuality]++);
  const total = rated.length;
  const pct = (k: ShotQuality) => (total ? round1((counts[k] / total) * 100) : 0);

  // This used to return a 4/3/2/1 weighted average bucketed into a
  // great/good/live/tough label, but the band edges meant it read "good"
  // for essentially every real shot diet -- a flat 25/25/25/25 split
  // already averages 2.50, the bottom of the "good" band, and "great"
  // needed a 3.5 average (roughly 60% great with no tough shots). A four
  // value scale that only ever showed one value carried no information.
  //
  // The headline is now the share of great + good looks, compared against
  // a coach-set goal (stat key "quality_shot_pct"). The per-category
  // breakdown below is unchanged.
  const qualityPct = total ? round1(((counts.great + counts.good) / total) * 100) : null;

  return {
    total,
    qualityPct,
    breakdown: { great: pct("great"), good: pct("good"), live: pct("live"), tough: pct("tough") },
  };
}

/** Four-band status for the quality-shot percentage against its goal. Null goal means "no target set" -- show the number alone. */
export function qualityShotStatus(qualityPct: number | null, goal: number | null): { label: string; role: "success" | "warning" | "danger" } | null {
  if (qualityPct == null || goal == null) return null;
  if (qualityPct >= goal + 5) return { label: "exceeding", role: "success" };
  if (qualityPct >= goal) return { label: "meeting", role: "success" };
  if (qualityPct >= goal - 5) return { label: "just short", role: "warning" };
  return { label: "below", role: "danger" };
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

/** BLOB/SLOB breakdown: direct shot attempts (and makes), flowed into a half-court set (and how many of those still scored), or turned it over right off the action. */
export function computeOobEffectiveness(possessions: Possession[], type: "blob" | "slob") {
  const trips = possessions.filter((p) => p.team === "us" && p.possession_type === type);
  const directShots = trips.filter((p) => p.oob_result === "direct_shot");
  const scored = directShots.filter((p) => p.points > 0).length;
  const flowedTrips = trips.filter((p) => p.oob_result === "flowed_half_court");
  const flowed = flowedTrips.length;
  const scoredOnFlow = flowedTrips.filter((p) => p.points > 0).length;
  const turnovers = trips.filter((p) => p.oob_result === "turnover").length;
  return { total: trips.length, directAttempts: directShots.length, scored, flowed, scoredOnFlow, turnovers };
}

export interface DefenseSchemeSummary {
  label: string;
  calls: number;
  pointsAllowed: number;
  stopPct: number;
  ppp: number;
}

function summarizeDefense(trips: Possession[], label: string): DefenseSchemeSummary {
  const calls = trips.length;
  const pointsAllowed = trips.reduce((s, p) => s + p.points, 0);
  const stops = trips.filter((p) => p.points === 0).length;
  return {
    label,
    calls,
    pointsAllowed,
    stopPct: calls ? round1((stops / calls) * 100) : 0,
    ppp: calls ? round2(pointsAllowed / calls) : 0,
  };
}

/**
 * Defensive scheme effectiveness -- Man and Zone are tagged by
 * defense_scheme regardless of whether the possession got there directly
 * (a fresh Man/Zone call) or via a press that broke down into one (same
 * "counts toward the category either way" precedent as a BLOB that flows
 * into a half-court Set counting toward Set effectiveness). Press itself
 * is tracked by possession_type, with a breakdown of what it turned into.
 */
export function computeDefenseEffectiveness(possessions: Possession[]) {
  const oppTrips = possessions.filter((p) => p.team === "opponent");
  const man = summarizeDefense(oppTrips.filter((p) => p.defense_scheme === "man"), "Man");
  const zone = summarizeDefense(oppTrips.filter((p) => p.defense_scheme === "zone"), "Zone");
  const pressTrips = oppTrips.filter((p) => p.possession_type === "press");
  const press = summarizeDefense(pressTrips, "Press (overall)");
  const pressTurnovers = pressTrips.filter((p) => p.press_result === "turnover").length;
  const pressToMan = pressTrips.filter((p) => p.press_result === "man").length;
  const pressToZone = pressTrips.filter((p) => p.press_result === "zone").length;
  return { man, zone, press, pressTurnovers, pressToMan, pressToZone };
}

/** Human-readable one-line summary of a possession, for the sync-issues viewer where a raw row isn't meaningful at a glance. */
export function describePossession(p: Possession): string {
  const who = p.team === "us" ? "Us" : "Opponent";
  const type = p.possession_type.replace("_", " ");
  let action = p.outcome.replace("_", " ");
  if (p.outcome === "fg_made" || p.outcome === "fg_missed") action = `${p.outcome === "fg_made" ? "made" : "missed"} ${p.shot_type ?? "?"}pt`;
  if (p.outcome === "ft_trip") action = `FT trip (${p.points}/${p.ft_attempts ?? "?"})`;
  if (p.outcome === "turnover") action = `turnover (${p.turnover_type ?? "?"})`;
  return `Q${p.quarter} · ${who} · ${type} · ${action}`;
}

export async function finishGame(gameId: string, finalScoreUs: number, finalScoreThem: number, notes?: string) {
  const patch: { final_score_us: number; final_score_them: number; notes?: string } = { final_score_us: finalScoreUs, final_score_them: finalScoreThem };
  if (notes !== undefined) patch.notes = notes;
  return supabase.from("games").update(patch).eq("id", gameId);
}

/** Distinct seasons that have any games, most recent first -- drives the season selector so past seasons stay reachable instead of everything silently defaulting to "today's season." */
export async function listSeasons(): Promise<string[]> {
  const { data } = await supabase.from("games").select("season");
  const seasons = Array.from(new Set((data ?? []).map((g: any) => g.season as string)));
  return seasons.sort().reverse();
}

/** Undoes finishGame -- clears the final score so the game goes back to being trackable. The escape hatch for "finished too early." */
export async function reopenGame(gameId: string) {
  return supabase.from("games").update({ final_score_us: null, final_score_them: null }).eq("id", gameId);
}

/** Escape hatch for a quarter closed too early -- reopens it for tracking, mirroring reopenGame's escape hatch for the whole-game lock. */
export async function reopenQuarter(gameId: string, quarter: number, currentClosed: number[]): Promise<{ error: string | null; closedQuarters: number[] }> {
  const next = currentClosed.filter((q) => q !== quarter);
  const { error } = await supabase.from("games").update({ closed_quarters: next }).eq("id", gameId);
  return { error: error?.message ?? null, closedQuarters: error ? currentClosed : next };
}

/** Closes a quarter to new tracking input during a live, still-in-progress game -- a lighter, narrower lock than finishGame's whole-game lock, meant to stop a possession from accidentally getting logged against a quarter that's already moved on. */
export async function endQuarter(gameId: string, quarter: number, currentClosed: number[]): Promise<{ error: string | null; closedQuarters: number[] }> {
  const next = Array.from(new Set([...currentClosed, quarter])).sort((a, b) => a - b);
  const { error } = await supabase.from("games").update({ closed_quarters: next }).eq("id", gameId);
  return { error: error?.message ?? null, closedQuarters: error ? currentClosed : next };
}

/**
 * Writes a new period structure to an existing game. Guarded against
 * orphaning possessions: if the game already has possessions logged in a
 * period the new structure doesn't have, the change is refused rather
 * than leaving those rows unreachable from any tab.
 */
export async function updateGameFormat(gameId: string, fmt: GameFormat): Promise<{ error: string | null }> {
  const highest = periodCount(fmt);
  const { data: stray } = await supabase
    .from("possessions")
    .select("quarter")
    .eq("game_id", gameId)
    .gt("quarter", highest)
    .limit(1);
  if (stray && stray.length) {
    return { error: `This game has possessions logged in period ${(stray[0] as any).quarter}, which the new structure doesn't have. Move or delete those first.` };
  }
  const { error } = await supabase
    .from("games")
    .update({
      period_format: fmt.period_format,
      regulation_periods: fmt.regulation_periods,
      period_lengths: fmt.period_lengths,
      ot_minutes: fmt.ot_minutes,
    })
    .eq("id", gameId);
  return { error: error?.message ?? null };
}

/**
 * Appends a period. Every format asks for the length -- an overtime is
 * added maybe twice a season, so a prefilled prompt there is cheaper than
 * a minutes field sitting on the create form for every game.
 *
 * Adding an overtime also stores its length as ot_minutes, so a second
 * overtime prefills with the first one's value.
 */
export async function addGamePeriod(gameId: string, fmt: GameFormat, minutes: number): Promise<{ error: string | null; format: GameFormat }> {
  if (periodCount(fmt) >= 12) return { error: "12 periods is the maximum.", format: fmt };
  const length = Math.max(1, Math.min(30, minutes));
  const isOvertime = usesOvertime(fmt);
  const next: GameFormat = {
    ...fmt,
    period_lengths: [...fmt.period_lengths, length],
    ot_minutes: isOvertime ? length : fmt.ot_minutes,
  };
  const { error } = await updateGameFormat(gameId, next);
  return { error, format: error ? fmt : next };
}

/**
 * Which regulation periods have no possessions logged against them. Used
 * to warn before adding an overtime -- you can't reach OT without playing
 * out regulation, so an empty Q3 means the button was probably a misclick.
 * It's a warning rather than a block, since entering a game from film out
 * of order is legitimate.
 */
export async function emptyRegulationPeriods(gameId: string, fmt: GameFormat): Promise<number[]> {
  const { data } = await supabase
    .from("possessions")
    .select("quarter")
    .eq("game_id", gameId)
    .lte("quarter", fmt.regulation_periods);
  const seen = new Set((data ?? []).map((r: any) => r.quarter as number));
  return regulationPeriods(fmt).filter((p) => !seen.has(p));
}

/** What the "+ OT" / "+ Period" prompt should start with. */
export function suggestedPeriodMinutes(fmt: GameFormat): number {
  if (usesOvertime(fmt)) return fmt.ot_minutes;
  return fmt.period_lengths[fmt.period_lengths.length - 1] ?? 8;
}

/** Drops the last period. Refused by updateGameFormat if it has possessions in it. */
export async function removeLastPeriod(gameId: string, fmt: GameFormat): Promise<{ error: string | null; format: GameFormat }> {
  if (periodCount(fmt) <= 1) return { error: null, format: fmt };
  const lengths = fmt.period_lengths.slice(0, -1);
  const next: GameFormat = {
    ...fmt,
    period_lengths: lengths,
    regulation_periods: Math.min(fmt.regulation_periods, lengths.length),
  };
  const { error } = await updateGameFormat(gameId, next);
  return { error, format: error ? fmt : next };
}

/** Changes one period's length. Only meaningful where lengthsEditable(fmt) is true. */
export async function setPeriodLength(gameId: string, fmt: GameFormat, period: number, minutes: number): Promise<{ error: string | null; format: GameFormat }> {
  const lengths = [...fmt.period_lengths];
  if (period < 1 || period > lengths.length) return { error: null, format: fmt };
  lengths[period - 1] = Math.max(1, Math.min(30, minutes));
  const next: GameFormat = { ...fmt, period_lengths: lengths };
  const { error } = await updateGameFormat(gameId, next);
  return { error, format: error ? fmt : next };
}

/** Lowest period not yet closed -- used to default the period tab to wherever tracking should actually pick up, instead of always defaulting to the first. highestPeriod defaults to 4 so pre-format callers behave exactly as before. */
export function nextOpenQuarter(closedQuarters: number[], highestPeriod: number = 4): number {
  for (let q = 1; q <= highestPeriod; q++) if (!closedQuarters.includes(q)) return q;
  return highestPeriod;
}

/** A game is only editable/correctable once it's been explicitly finished (final score set) -- this keeps live entry and post-game correction from colliding. */
export function isGameFinal(game: Pick<Game, "final_score_us" | "final_score_them">): boolean {
  return game.final_score_us != null && game.final_score_them != null;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
