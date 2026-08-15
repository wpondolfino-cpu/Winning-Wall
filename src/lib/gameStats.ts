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
// press_break: a trip that started against a press and ended against it
// (turnover / FT trip / and-1). Once a break flows into transition or a
// half-court look the type BECOMES that, so those points land in the
// existing transition and half-court numbers -- press_break_type_id is
// what durably marks the trip as a press break either way.
// non_possession_ft: free throws that didn't come from an offensive
// possession (end-of-game fouling, technicals, flagrants). Excluded from
// every rate stat both top and bottom; still on the scoreboard and in FT%.
export type PossessionType = "transition" | "half_court" | "blob" | "slob" | "press" | "press_break" | "non_possession_ft";
export type DefenseScheme = "man" | "zone";
export type PressResult = "turnover" | "man" | "zone";
// The half-court structure we ran. "zone" is a zone set, which doubles as
// the record that we were playing against a zone -- there's no separate
// defense_faced field, because it would be a second copy of the same fact.
// "unscripted" is a trip with no called structure, so it has no play call.
export type HalfCourtType = "set" | "motion" | "unscripted" | "zone";
/** What a press break turned into. "oob" is a foul/jump/OOB that kept it our ball -- still broken. */
export type PressBreakResult = "transition" | "half_court" | "turnover" | "oob" | "ft_trip";
/** What they were in ON THE INBOUNDS. A separate question from half_court_type: a team can go zone on a BLOB and match up man after. */
export type OobDefense = "man" | "zone";
/** Why a non-possession free throw trip happened. Only "eog" is a live ball, so only "eog" can convert into a real possession off a rebound. */
export type FtAwardType = "eog" | "technical" | "flagrant";
// direct_shot: a shot was taken right off the action (OREB putback or
// BLOB/SLOB inbound), no set called. flowed_half_court: it turned into a
// traditional half-court possession (Set/Motion). turnover: lost the ball
// directly off the action, before any shot or set.
export type OobResult = "direct_shot" | "flowed_half_court" | "turnover";
export type Outcome = "fg_made" | "fg_missed" | "turnover" | "ft_trip";
export type ShotQuality = "great" | "good" | "live" | "tough";
export type TurnoverType = "live" | "dead" | "charge";
// "zone" is a real play list picked exactly like sets. "press_type" holds
// the presses we attack (Trap, 2-2-1, ...) -- their alignment, not our
// call, which is why a possession stores it in press_break_type_id and
// leaves play_call_id free for whatever set the break flows into.
export type PlayCallCategory = "set" | "motion" | "blob" | "slob" | "zone" | "press_type";

/** Half-court structures that have a play list behind them. "unscripted" deliberately doesn't -- it skips the play-call step. */
export const HALF_COURT_PLAY_CATEGORIES: HalfCourtType[] = ["set", "motion", "zone"];

/** Seeded on first use so the press picker isn't empty on day one. Editable and extendable like any other play call. */
export const DEFAULT_PRESS_TYPES = ["Trap", "2-2-1", "2-1-2", "1-2-1-1", "1-2-2"];

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
  /** Which press we were breaking. Non-null IS the definition of "this trip was a press break", and survives the type changing to transition/half_court/blob/slob. */
  press_break_type_id: string | null;
  press_break_result: PressBreakResult | null;
  oob_defense: OobDefense | null;
  ft_award_type: FtAwardType | null;
  paint_touch: boolean;
  paint_touch_both_sides: boolean;
  oreb_count: number;
  missed_fg_count: number;
  /** Rebounded misses split by shot type, so they can enter the SHOOTING denominators (missed_fg_count stays the total and still feeds OREB%). */
  missed_fg2_count: number;
  missed_fg3_count: number;
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
export type StatKind = "number" | "shot_quality" | "set_plays" | "oob" | "streaks" | "defense_schemes" | "press_break" | "half_court_structure" | "paint_impact" | "quality_conversion" | "turnover_breakdown" | "period_splits" | "prev_possession";

export interface StatDef {
  key: string;
  label: string;
  kind: StatKind;
  inGame: boolean;
  /**
   * Report-builder only. There are three tiers, not two:
   *   inGame: true                  -> quarter/half, full game, and builder
   *   inGame: false                 -> full game and builder
   *   inGame: false, builderOnly    -> builder only
   * Used for the deeper cuts that would bury the end-of-game report but
   * are the whole point of a report you build yourself.
   */
  builderOnly?: boolean;
  defaultDirection?: "higher_better" | "lower_better";
  selfColored?: boolean; // true for stats colored by their own sign (+/-), not against a goal target
  goalOnly?: boolean;    // settable as a goal, but not its own report row and not in the reorder list -- it's the headline of another block
  usOnly?: boolean;      // no opponent-side equivalent, so no Opponent goal input. Nothing uses it now that shot quality is graded on both ends, but the mechanism stays for the next stat that needs it
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
  { key: "quality_shot_pct", label: "Quality shots % (Great + Good)", kind: "number", inGame: true, defaultDirection: "higher_better", goalOnly: true },
  { key: "set_plays", label: "Set plays (Set / Motion / Zone)", kind: "set_plays", inGame: false },
  { key: "half_court_structure", label: "Half court (man / zone)", kind: "half_court_structure", inGame: false },
  { key: "oob_plays", label: "Set plays (BLOB / SLOB)", kind: "oob", inGame: false },
  { key: "press_break", label: "Press break", kind: "press_break", inGame: false },
  { key: "streaks", label: "Streaks", kind: "streaks", inGame: true },
  { key: "defense_schemes", label: "Defense schemes (Man / Zone / Press)", kind: "defense_schemes", inGame: false },

  // ── Report-builder only ────────────────────────────────────────
  // Everything below is computed from possessions already being tracked
  // -- no extra taps. They're kept off the end-of-game report to stop it
  // becoming a wall, and off quarter reports where the samples are far
  // too small for any of them to mean anything.
  { key: "ts_pct", label: "True shooting %", kind: "number", inGame: false, builderOnly: true, defaultDirection: "higher_better" },
  { key: "three_rate", label: "3PT rate %", kind: "number", inGame: false, builderOnly: true },
  { key: "ppp", label: "PPP", kind: "number", inGame: false, builderOnly: true, defaultDirection: "higher_better" },
  { key: "second_chance_ppp", label: "Second chance PPP", kind: "number", inGame: false, builderOnly: true, defaultDirection: "higher_better" },
  { key: "possessions", label: "Possessions", kind: "number", inGame: false, builderOnly: true },
  { key: "paint_impact", label: "Paint touch impact", kind: "paint_impact", inGame: false, builderOnly: true },
  { key: "quality_conversion", label: "Shot quality conversion", kind: "quality_conversion", inGame: false, builderOnly: true },
  { key: "turnover_breakdown", label: "Turnover breakdown", kind: "turnover_breakdown", inGame: false, builderOnly: true },
  { key: "period_splits", label: "By period", kind: "period_splits", inGame: false, builderOnly: true },
  { key: "prev_possession", label: "After their possession", kind: "prev_possession", inGame: false, builderOnly: true },
];

/**
 * Plain-English definitions, shared by the team report and the lineup
 * reports so a stat can never be explained two different ways. Keyed by
 * stat key where one exists; lineup-only keys are added at the end.
 */
export const STAT_EXPLAINERS: Record<string, { what: string; how: string }> = {
  efg_pct: { what: "Field goal percentage with threes counted as worth more, since they are.", how: "(FGM + 0.5 x 3PM) / FGA" },
  fg2_pct: { what: "Two-point field goal percentage.", how: "2PM / 2PA" },
  fg3_pct: { what: "Three-point field goal percentage.", how: "3PM / 3PA" },
  ft_pct: { what: "Free throw percentage. Includes intentional-foul and technical free throws, since a free throw is a free throw.", how: "FTM / FTA" },
  ft_rate: { what: "How often we get to the line relative to how often we shoot. A proxy for attacking rather than settling. Intentional-foul and technical free throws are excluded, since the offense didn't earn them.", how: "earned FTA / FGA" },
  tov_pct: { what: "Share of possessions that ended in a turnover.", how: "turnovers / possessions" },
  oreb_pct: { what: "Share of available offensive rebounds collected.", how: "OREB / (OREB + their defensive rebound chances)" },
  transition_pct: { what: "Share of possessions that were transition rather than half court. A press break that got out and ran counts as transition.", how: "transition trips / all trips" },
  transition_ppp: { what: "Points per possession in transition, including breaks against a press that pushed.", how: "transition points / transition trips" },
  halfcourt_ppp: { what: "Points per possession in the half court. Includes BLOB and SLOB trips, and press breaks, that flowed into a set.", how: "half-court points / half-court trips" },
  press_break: { what: "How we handled the press. Broken means we got out of it -- into transition, into a half-court look, to the line, or a foul that kept it our ball. Points off the break counts transition makes and free throws only: a break that becomes a half-court possession and scores is a half-court score.", how: "broken / press trips" },
  ts_pct: { what: "True shooting. One number for scoring efficiency that values a three above a two and gives credit for getting to the line, so it compares a volume three-point shooter and a post scorer fairly.", how: "points / (2 x (FGA + 0.44 x FTA))" },
  three_rate: { what: "Share of field goal attempts that were threes. A shot-diet number, not a quality one -- read it next to 3PT%.", how: "3PA / FGA" },
  ppp: { what: "Points per possession overall. Every other PPP row on this report is a slice of this one.", how: "points / possessions" },
  second_chance_ppp: { what: "Points per offensive rebound. Says whether the boards you win actually turn into points, which the raw second-chance points total can't.", how: "points on trips with an OREB / offensive rebounds" },
  possessions: { what: "Trips counted. Excludes intentional-foul, technical and flagrant free throws, since those aren't possessions.", how: "count" },
  paint_impact: { what: "What a paint touch is worth, rather than just how often you get one. The gap between the two PPP figures is the argument for demanding it.", how: "PPP on half-court trips with a paint touch vs without" },
  quality_conversion: { what: "How each grade of look actually converted. Two readings: whether the team finishes the shots it generates, and whether the grading itself is calibrated -- if great looks come back below your good looks, the grading is drifting.", how: "eFG% within each shot quality grade" },
  turnover_breakdown: { what: "Turnovers split by type. Live-ball giveaways are the expensive ones because they run the other way; dead balls and charges don't.", how: "count by turnover type" },
  period_splits: { what: "PPP for and against, and possessions, by period. Where a game was actually won or lost, and the number behind a habit like slow third quarters.", how: "points / possessions, per period" },
  prev_possession: { what: "How the offense responds to what just happened at the other end. Whether a bucket against you turns into two.", how: "PPP on trips following their score, their miss, or their turnover" },
  half_court_structure: { what: "What we ran in the half court, and by extension what we ran it against. A zone set is also the record that they were in a zone, so man is everything else.", how: "points / trips, per structure" },
  quality_shot_pct: { what: "Share of shots graded great or good. On the defensive side this is the looks we allowed, so lower is better.", how: "(great + good) / graded shots" },
  extra_possessions: { what: "Net extra chances created, the possession-count version of winning the margins.", how: "(our OREB + their turnovers) - (their OREB + our turnovers)" },
  points_off_live_to: { what: "Points scored on possessions that followed a live-ball turnover.", how: "sum of points after live turnovers" },
  second_chance_points: { what: "Points scored after an offensive rebound on the same trip.", how: "sum of points following an OREB" },
  paint_touch_single: { what: "Share of half-court trips where the ball touched the paint.", how: "paint touches / half-court trips" },
  paint_touch_both: { what: "Share of half-court trips where the ball changed sides of the floor.", how: "both-sides trips / half-court trips" },
};

/**
 * Goals that only make sense for a lineup, not for the team report.
 *
 * The team report already covers efficiency better than a single PPP number
 * would -- transition, half court and BLOB/SLOB PPP each tell you something
 * you can act on. A lineup doesn't need that breakdown: you're comparing
 * units against each other, so broad offence and defence is the question.
 *
 * Kept out of DEFAULT_STAT_ORDER so they never appear as team report rows,
 * but stored in the same stat_goals table (its stat_key is free text), and
 * marked usOnly because a lineup goal has no opponent side.
 */
export const LINEUP_GOAL_STATS: StatDef[] = [
  { key: "lineup_off_ppp", label: "Offensive PPP", kind: "number", inGame: true, defaultDirection: "higher_better", usOnly: true },
  { key: "lineup_def_ppp", label: "Defensive PPP", kind: "number", inGame: true, defaultDirection: "lower_better", usOnly: true },
  { key: "lineup_net_rating", label: "Net rating (per 100)", kind: "number", inGame: true, defaultDirection: "higher_better", usOnly: true },
  { key: "lineup_onoff_diff", label: "On/off differential (per 100)", kind: "number", inGame: true, defaultDirection: "higher_better", usOnly: true },
  { key: "lineup_oob_ppp", label: "BLOB / SLOB PPP", kind: "number", inGame: true, defaultDirection: "higher_better", usOnly: true },
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
export type GameType = "regular" | "postseason" | "summer" | "scrimmage" | "practice";

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
  { value: "postseason", label: "Postseason" },
  { value: "summer", label: "Summer league" },
  { value: "scrimmage", label: "Scrimmage" },
  { value: "practice", label: "Practice/intrasquad" },
];

/**
 * Which period structures make sense for a game type. A real game is
 * played in quarters or halves; a scrimmage runs straight periods; a
 * practice runs sessions. Restricting the dropdown means you can't end up
 * with a practice labelled Q1 or a scrimmage that thinks it's in overtime.
 */
export function structuresForGameType(type: GameType): PeriodFormat[] {
  if (type === "scrimmage") return ["periods"];
  if (type === "practice") return ["sessions"];
  return ["quarters", "halves"];
}

/** The structure a game type should default to when it's picked. */
export function defaultStructureForGameType(type: GameType): PeriodFormat {
  return structuresForGameType(type)[0];
}

/**
 * Reports are scoped to a group of game types rather than a single type,
 * so "games" can mean regular season plus postseason without the coach
 * ticking two boxes. Scrimmage and practice data never lands in
 * a games report -- practice possessions in particular are our players
 * on both ends, so their efficiency isn't on the same scale as a real
 * game's and averaging the two together would make both less meaningful.
 */
export type GameGroup = "games" | "scrimmages" | "practices" | "summer";

export const GAME_GROUPS: { value: GameGroup; label: string; types: GameType[] }[] = [
  { value: "games", label: "Games", types: ["regular", "postseason"] },
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
  if (!usesOvertime(fmt)) return 0;
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
  if (period <= fmt.regulation_periods || !usesOvertime(fmt)) {
    const prefix =
      fmt.period_format === "halves" ? "H" :
      fmt.period_format === "periods" ? "P" :
      fmt.period_format === "sessions" ? "S" : "Q";
    return prefix + period;
  }
  const ot = period - fmt.regulation_periods;
  return ot === 1 ? "OT" : `${ot}OT`;
}

/** The word for a period in this format -- "quarter", "half", "period", "session". For UI wording like "All halves". */
export function periodNoun(fmt: GameFormat, plural = false): string {
  const base =
    fmt.period_format === "halves" ? "half" :
    fmt.period_format === "periods" ? "period" :
    fmt.period_format === "sessions" ? "session" : "quarter";
  if (!plural) return base;
  return base === "half" ? "halves" : base + "s";
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
  /** Explicit game set for a hand-picked report. Null means it stays relative and re-resolves from game_count. */
  game_ids?: string[] | null;
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
    missed_fg2_count: p.missed_fg2_count ?? 0,
    missed_fg3_count: p.missed_fg3_count ?? 0,
    absorbed_ft_attempts: p.absorbed_ft_attempts ?? 0,
    absorbed_ft_made: p.absorbed_ft_made ?? 0,
    defense_scheme: p.defense_scheme ?? null,
    press_result: p.press_result ?? null,
    press_break_type_id: p.press_break_type_id ?? null,
    press_break_result: p.press_break_result ?? null,
    oob_defense: p.oob_defense ?? null,
    ft_award_type: p.ft_award_type ?? null,
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

/**
 * Whether a row is a real offensive trip.
 *
 * Everything in this file counted every row until now. Non-possession
 * free throws (end-of-game fouling, technicals, flagrants) are the first
 * exception: they're points without a trip, so leaving them in would
 * inflate pace and deflate PPP in exactly the close games where those
 * numbers matter most.
 *
 * The rule is applied at the TOP of each calculation rather than threaded
 * through it, so there's one place to look and no filter to forget
 * halfway down a function.
 *
 * Two things deliberately do NOT use this: computeFinalScore (the
 * scoreboard is the scoreboard) and FT% (a free throw is a free throw).
 *
 * An end-of-game trip that gets offensive-rebounded has already had its
 * possession_type flipped to half_court by then, so it passes here and
 * counts fully -- which is the whole point of the conversion.
 */
export function isCountedPossession(p: Possession): boolean {
  return p.possession_type !== "non_possession_ft";
}

export function countedPossessions(possessions: Possession[]): Possession[] {
  return possessions.filter(isCountedPossession);
}

/** True once a trip is (or was) a press break, whatever it flowed into afterwards. */
export function isPressBreak(p: Possession): boolean {
  return p.press_break_type_id != null;
}

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
  // allTrips includes non-possession free throws; trips doesn't. Only FT%
  // reads allTrips -- an intentional-foul free throw is still a free
  // throw, but it isn't a possession and it isn't the offense earning a
  // trip to the line, so it stays out of FT rate along with everything
  // else that has a possession-based denominator.
  const allTrips = possessions.filter((p) => p.team === team);
  const trips = allTrips.filter(isCountedPossession);
  // A trip only stores its FINAL outcome, so a miss that was rebounded and
  // followed by another shot isn't in `fga` at all. Those rebounded misses
  // are real attempts and they all missed, so they go into the denominators
  // and nowhere else -- without them every shooting percentage runs high by
  // roughly the offensive rebound rate.
  const fga = trips.filter((p) => p.outcome === "fg_made" || p.outcome === "fg_missed");
  const fga2 = fga.filter((p) => p.shot_type === 2);
  const fga3 = fga.filter((p) => p.shot_type === 3);
  const made2 = fga2.filter((p) => p.outcome === "fg_made").length;
  const made3 = fga3.filter((p) => p.outcome === "fg_made").length;
  const reboundedMissed2 = trips.reduce((s, p) => s + p.missed_fg2_count, 0);
  const reboundedMissed3 = trips.reduce((s, p) => s + p.missed_fg3_count, 0);
  const fga2Count = fga2.length + reboundedMissed2;
  const fga3Count = fga3.length + reboundedMissed3;
  const fgaCount = fga2Count + fga3Count;
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
  // FT makes/attempts from a trip that ended as an ft_trip itself, PLUS any
  // FT attempts that happened earlier in a trip but got absorbed into a
  // later, different final outcome (missed a FT, got the OREB, kept going)
  // -- otherwise those makes/attempts just vanish from FT% entirely.
  const ftTripsWithAttempts = allTrips.filter((p) => p.outcome === "ft_trip" && p.ft_attempts != null);
  const ftMade = ftTripsWithAttempts.reduce((s, p) => s + p.points, 0) + allTrips.reduce((s, p) => s + p.absorbed_ft_made, 0);
  const ftAttempted = ftTripsWithAttempts.reduce((s, p) => s + (p.ft_attempts ?? 0), 0) + allTrips.reduce((s, p) => s + p.absorbed_ft_attempts, 0);
  // FT rate asks how often the OFFENSE got to the line, so it uses only
  // free throws that came from a real trip.
  const earnedFtTrips = trips.filter((p) => p.outcome === "ft_trip" && p.ft_attempts != null);
  const ftAttemptedEarned =
    earnedFtTrips.reduce((s, p) => s + (p.ft_attempts ?? 0), 0) + trips.reduce((s, p) => s + p.absorbed_ft_attempts, 0);
  const paintTouchSingle = trips.filter((p) => p.paint_touch).length;
  const paintTouchBoth = trips.filter((p) => p.paint_touch_both_sides).length;
  // A press break that got out and ran has possession_type "transition"
  // by the time it commits (press_break_type_id is what remembers it was
  // a break), so it counts here without a special case -- breaking a
  // press and pushing IS playing fast.
  const transitionTripsArr = trips.filter((p) => p.possession_type === "transition");
  // A blob/slob possession that flowed into a set/motion look (oob_result
  // === "flowed_half_court") keeps possession_type "blob"/"slob" for BLOB
  // effectiveness purposes -- but the actual shot came from a half-court
  // action, so it belongs in half-court efficiency too, not just possessions
  // that started half-court outright. A press break that flowed into a
  // half-court look is already possession_type "half_court" and needs no
  // clause of its own.
  const halfCourtTripsArr = trips.filter((p) =>
    p.possession_type === "half_court" ||
    ((p.possession_type === "blob" || p.possession_type === "slob") && p.oob_result === "flowed_half_court")
  );

  const efg = fgaCount ? ((made2 + made3) + 0.5 * made3) / fgaCount * 100 : 0;
  const fg2Pct = fga2Count ? (made2 / fga2Count) * 100 : 0;
  const fg3Pct = fga3Count ? (made3 / fga3Count) * 100 : 0;
  // True shooting charges free throws at the standard 0.44 trips-per-attempt
  // estimate. Uses earned FTs only -- an intentional-foul trip isn't the
  // offense generating a shooting possession.
  const totalPoints = trips.reduce((s, p) => s + p.points, 0);
  const tsAttempts = fgaCount + 0.44 * ftAttemptedEarned;
  const tsPct = tsAttempts ? (totalPoints / (2 * tsAttempts)) * 100 : 0;
  const threeRate = fgaCount ? (fga3Count / fgaCount) * 100 : 0;
  const ppp = trips.length ? totalPoints / trips.length : 0;
  const secondChancePpp = oreb ? trips.filter((p) => p.oreb_count > 0).reduce((s, p) => s + p.points, 0) / oreb : 0;
  const ftPct = ftAttempted ? (ftMade / ftAttempted) * 100 : 0;
  const tovPct = trips.length ? (turnovers / trips.length) * 100 : 0;
  const orebPct = orebOpportunities ? (oreb / orebOpportunities) * 100 : 0;
  const ftRate = fgaCount ? ftAttemptedEarned / fgaCount : 0;
  const paintTouchSinglePct = halfCourtTripsArr.length ? (paintTouchSingle / halfCourtTripsArr.length) * 100 : 0;
  const paintTouchBothPct = halfCourtTripsArr.length ? (paintTouchBoth / halfCourtTripsArr.length) * 100 : 0;
  const transitionPpp = transitionTripsArr.length ? transitionTripsArr.reduce((s, p) => s + p.points, 0) / transitionTripsArr.length : 0;
  const halfCourtPpp = halfCourtTripsArr.length ? halfCourtTripsArr.reduce((s, p) => s + p.points, 0) / halfCourtTripsArr.length : 0;
  const transitionPct = trips.length ? (transitionTripsArr.length / trips.length) * 100 : 0;

  const rows: { key: string; label: string; value: number; raw?: string; display?: string }[] = [
    { key: "efg_pct", label: "eFG%", value: round1(efg) },
    { key: "fg2_pct", label: "2PT FG%", value: round1(fg2Pct), raw: `${made2}/${fga2Count}` },
    { key: "fg3_pct", label: "3PT FG%", value: round1(fg3Pct), raw: `${made3}/${fga3Count}` },
    { key: "ts_pct", label: "True shooting %", value: round1(tsPct) },
    { key: "three_rate", label: "3PT rate %", value: round1(threeRate), raw: `${fga3Count}/${fgaCount}` },
    { key: "ppp", label: "PPP", value: round2(ppp), display: ppp.toFixed(2) },
    { key: "second_chance_ppp", label: "Second chance PPP", value: round2(secondChancePpp), display: secondChancePpp.toFixed(2) },
    { key: "possessions", label: "Possessions", value: trips.length },
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
export function computeExtraPossessions(all: Possession[]): { us: number; opponent: number } {
  const possessions = countedPossessions(all);
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
  // Non-possession free throws are dropped BEFORE the adjacency walk, not
  // skipped inside it -- a technical logged between a live turnover and
  // the trip it led to would otherwise break the two rows apart and lose
  // the points entirely.
  const ordered = countedPossessions(possessions).sort((a, b) => a.sequence - b.sequence);
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
    countedPossessions(possessions)
      .filter((p) => p.team === team && p.oreb_count > 0 && p.outcome === "fg_made")
      .reduce((s, p) => s + p.points, 0);
  return { us: scoredAfterOreb("us"), opponent: scoredAfterOreb("opponent") };
}

/** Weighted shot-quality score mapped back onto the great/good/live/tough label scale. Only meaningful for "us" -- we don't track the opponent's shot quality. */
export function computeShotQuality(possessions: Possession[], team: Team = "us") {
  const rated = countedPossessions(possessions).filter((p) => p.team === team && p.shot_quality != null);
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
  const ordered = countedPossessions(possessions).sort((a, b) => a.sequence - b.sequence);

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
  const counted = countedPossessions(possessions);
  return playCalls.map((call) => {
    const trips = counted.filter((p) => p.play_call_id === call.id);
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
  const trips = countedPossessions(possessions).filter((p) => p.team === "us" && p.possession_type === type);
  const directShots = trips.filter((p) => p.oob_result === "direct_shot");
  const scored = directShots.filter((p) => p.points > 0).length;
  const flowedTrips = trips.filter((p) => p.oob_result === "flowed_half_court");
  const flowed = flowedTrips.length;
  const scoredOnFlow = flowedTrips.filter((p) => p.points > 0).length;
  const turnovers = trips.filter((p) => p.oob_result === "turnover").length;
  return { total: trips.length, directAttempts: directShots.length, scored, flowed, scoredOnFlow, turnovers };
}

export interface PressTypeRow {
  id: string;
  name: string;
  calls: number;
  broken: number;
  turnovers: number;
  points: number;
  ppp: number;
}

export interface PressBreakSummary {
  total: number;
  /** Everything that wasn't a turnover against the press -- got it into transition, into a half-court look, to the line, or drew a foul/jump/OOB that kept it our ball. */
  broken: number;
  brokenPct: number;
  turnovers: number;
  turnoverPct: number;
  /** Transition makes plus free throws off the break. A break that turns into a half-court possession and scores is a half-court score -- the press had no hand in it. */
  pointsOffBreak: number;
  points: number;
  ppp: number;
  toTransition: number;
  toHalfCourt: number;
  toFtTrip: number;
  toOob: number;
  byType: PressTypeRow[];
}

/**
 * How we handled the press.
 *
 * Keys off press_break_type_id rather than possession_type, because a
 * broken press stops being possession_type "press_break" the moment it
 * becomes transition or a half-court look -- which is deliberate, so
 * those points land in the normal transition and half-court numbers.
 * The id is what survives.
 */
export function computePressBreakEffectiveness(possessions: Possession[], playCalls: PlayCall[]): PressBreakSummary {
  const trips = countedPossessions(possessions).filter((p) => p.team === "us" && isPressBreak(p));
  const countBy = (r: PressBreakResult) => trips.filter((p) => p.press_break_result === r).length;
  const turnovers = countBy("turnover");
  const broken = trips.length - turnovers;
  const points = trips.reduce((s, p) => s + p.points, 0);
  const pointsOffBreak = trips.reduce((s, p) => {
    if (p.possession_type === "transition" && p.outcome === "fg_made") return s + p.points;
    if (p.press_break_result === "ft_trip") return s + p.points;
    return s;
  }, 0);

  const byType: PressTypeRow[] = playCalls
    .filter((c) => c.category === "press_type")
    .map((call) => {
      const own = trips.filter((p) => p.press_break_type_id === call.id);
      const tovs = own.filter((p) => p.press_break_result === "turnover").length;
      const pts = own.reduce((s, p) => s + p.points, 0);
      return {
        id: call.id,
        name: call.name,
        calls: own.length,
        broken: own.length - tovs,
        turnovers: tovs,
        points: pts,
        ppp: own.length ? round2(pts / own.length) : 0,
      };
    })
    .filter((r) => r.calls > 0)
    .sort((a, b) => b.calls - a.calls);

  return {
    total: trips.length,
    broken,
    brokenPct: trips.length ? round1((broken / trips.length) * 100) : 0,
    turnovers,
    turnoverPct: trips.length ? round1((turnovers / trips.length) * 100) : 0,
    pointsOffBreak,
    points,
    ppp: trips.length ? round2(points / trips.length) : 0,
    toTransition: countBy("transition"),
    toHalfCourt: countBy("half_court"),
    toFtTrip: countBy("ft_trip"),
    toOob: countBy("oob"),
    byType,
  };
}

export interface SplitRow {
  label: string;
  trips: number;
  points: number;
  ppp: number;
}

function splitRow(trips: Possession[], label: string): SplitRow {
  const points = trips.reduce((s, p) => s + p.points, 0);
  return { label, trips: trips.length, points, ppp: trips.length ? round2(points / trips.length) : 0 };
}

/**
 * What they were in on our inbounds plays, and how many trips we actually
 * tagged.
 *
 * The coverage count is the point of the untagged figure: a number that
 * silently drops the trips you forgot to tag looks the same as a number
 * built on all of them, so the report says how many it's standing on and
 * the untagged ones can be fixed in the possession editor.
 */
export function computeInboundsDefense(possessions: Possession[]) {
  const trips = countedPossessions(possessions).filter(
    (p) => p.team === "us" && (p.possession_type === "blob" || p.possession_type === "slob")
  );
  const tagged = trips.filter((p) => p.oob_defense != null);
  return {
    total: trips.length,
    tagged: tagged.length,
    untagged: trips.length - tagged.length,
    man: splitRow(trips.filter((p) => p.oob_defense === "man"), "vs man"),
    zone: splitRow(trips.filter((p) => p.oob_defense === "zone"), "vs zone"),
  };
}

/**
 * Half-court structure: what we ran, and by extension what we ran it
 * against. A zone set IS the record that they were in a zone, which is
 * why man is the sum of the other three rather than its own tag.
 *
 * Reads every trip carrying a half_court_type, so a BLOB that flowed into
 * a set and a press break that flowed into one both count here.
 */
export function computeHalfCourtStructure(possessions: Possession[]) {
  const trips = countedPossessions(possessions).filter((p) => p.team === "us" && p.half_court_type != null);
  const of = (t: HalfCourtType) => trips.filter((p) => p.half_court_type === t);
  return {
    total: trips.length,
    set: splitRow(of("set"), "Man set"),
    motion: splitRow(of("motion"), "Motion"),
    unscripted: splitRow(of("unscripted"), "Unscripted"),
    zone: splitRow(of("zone"), "Zone set"),
    vsMan: splitRow(trips.filter((p) => p.half_court_type !== "zone"), "vs man"),
    vsZone: splitRow(of("zone"), "vs zone"),
  };
}

/** Non-possession free throws, broken out by why they happened. An end-of-game trip that got rebounded isn't here -- it converted into a real possession, which is the point. */
export function computeAwardedFts(possessions: Possession[]) {
  const rows = possessions.filter((p) => p.possession_type === "non_possession_ft");
  const forTeam = (team: Team) => {
    const own = rows.filter((p) => p.team === team);
    const by = (t: FtAwardType) => own.filter((p) => p.ft_award_type === t).length;
    return {
      total: own.length,
      points: own.reduce((s, p) => s + p.points, 0),
      attempts: own.reduce((s, p) => s + (p.ft_attempts ?? 0), 0),
      eog: by("eog"),
      technical: by("technical"),
      flagrant: by("flagrant"),
    };
  };
  return { us: forTeam("us"), opponent: forTeam("opponent") };
}

/** What a paint touch is actually worth, not just how often it happens. Half-court trips only, since the flag is only asked there. */
export function computePaintImpact(possessions: Possession[]) {
  const trips = countedPossessions(possessions).filter(
    (p) => p.team === "us" && (p.possession_type === "half_court" || p.oob_result === "flowed_half_court")
  );
  return {
    total: trips.length,
    withTouch: splitRow(trips.filter((p) => p.paint_touch), "With paint touch"),
    withoutTouch: splitRow(trips.filter((p) => !p.paint_touch), "No paint touch"),
    bothSides: splitRow(trips.filter((p) => p.paint_touch_both_sides), "Both sides"),
    oneSide: splitRow(trips.filter((p) => p.paint_touch && !p.paint_touch_both_sides), "One side only"),
  };
}

/**
 * Whether each grade of look actually went in.
 *
 * Reads two ways: how well the team finishes what it generates, and
 * whether the grading itself is calibrated -- if "great" converts below
 * "good", the grades are drifting rather than the shooters failing.
 *
 * Rebounded misses can't be included: missed_fg2/3_count records that a
 * miss happened but not what it was graded, so this is attempts that
 * ENDED a trip. Stated in the report rather than papered over.
 */
export function computeQualityConversion(possessions: Possession[], team: Team) {
  const shots = countedPossessions(possessions).filter(
    (p) => p.team === team && p.shot_quality != null && (p.outcome === "fg_made" || p.outcome === "fg_missed")
  );
  const grades: ShotQuality[] = ["great", "good", "live", "tough"];
  return grades.map((g) => {
    const own = shots.filter((p) => p.shot_quality === g);
    const made = own.filter((p) => p.outcome === "fg_made");
    const made3 = made.filter((p) => p.shot_type === 3).length;
    return {
      grade: g,
      attempts: own.length,
      made: made.length,
      efg: own.length ? round1(((made.length + 0.5 * made3) / own.length) * 100) : 0,
    };
  });
}

/** Turnovers by type, both directions. Live-ball giveaways are the ones that run the other way. */
export function computeTurnoverBreakdown(possessions: Possession[]) {
  const counted = countedPossessions(possessions);
  const forTeam = (team: Team) => {
    const tovs = counted.filter((p) => p.team === team && p.outcome === "turnover");
    const by = (t: string) => tovs.filter((p) => p.turnover_type === t).length;
    return {
      total: tovs.length,
      live: by("live"),
      dead: by("dead"),
      charge: by("charge"),
      livePct: tovs.length ? round1((by("live") / tovs.length) * 100) : 0,
    };
  };
  return { us: forTeam("us"), opponent: forTeam("opponent") };
}

export interface PeriodSplit {
  period: number;
  possessions: number;
  ourPpp: number;
  theirPpp: number;
  margin: number;
}

/** Where the game was actually won or lost. The number behind a habit like slow third quarters. */
export function computePeriodSplits(possessions: Possession[]): PeriodSplit[] {
  const counted = countedPossessions(possessions);
  // The column is `quarter` even when the game format is halves -- the
  // PeriodSplit field is named `period` because that's what it means.
  const periods = [...new Set(counted.map((p) => p.quarter))].sort((a, b) => a - b);
  return periods.map((period) => {
    const inPeriod = counted.filter((p) => p.quarter === period);
    const ours = inPeriod.filter((p) => p.team === "us");
    const theirs = inPeriod.filter((p) => p.team === "opponent");
    const ourPts = ours.reduce((s, p) => s + p.points, 0);
    // Scoreboard margin uses every row, including awarded free throws --
    // they're points on the board even though they aren't possessions.
    const allInPeriod = possessions.filter((p) => p.quarter === period);
    const margin =
      allInPeriod.filter((p) => p.team === "us").reduce((s, p) => s + p.points, 0) -
      allInPeriod.filter((p) => p.team === "opponent").reduce((s, p) => s + p.points, 0);
    return {
      period,
      possessions: ours.length,
      ourPpp: ours.length ? round2(ourPts / ours.length) : 0,
      theirPpp: theirs.length ? round2(theirs.reduce((s, p) => s + p.points, 0) / theirs.length) : 0,
      margin,
    };
  });
}

/**
 * How the offense responds to what just happened at the other end.
 *
 * Walks counted trips in sequence order and looks at the row before each
 * of ours. Awarded free throws are dropped BEFORE the walk rather than
 * skipped inside it, so a technical logged between their bucket and our
 * answer doesn't break the pair apart.
 */
export function computePrevPossession(possessions: Possession[]) {
  const ordered = countedPossessions(possessions).sort((a, b) => a.sequence - b.sequence);
  const buckets = { afterScore: [] as Possession[], afterMiss: [] as Possession[], afterTurnover: [] as Possession[] };
  for (let i = 1; i < ordered.length; i++) {
    const cur = ordered[i];
    const prev = ordered[i - 1];
    if (cur.team !== "us" || prev.team !== "opponent") continue;
    if (prev.outcome === "turnover") buckets.afterTurnover.push(cur);
    else if (prev.points > 0) buckets.afterScore.push(cur);
    else buckets.afterMiss.push(cur);
  }
  return {
    afterScore: splitRow(buckets.afterScore, "After they score"),
    afterMiss: splitRow(buckets.afterMiss, "After they miss"),
    afterTurnover: splitRow(buckets.afterTurnover, "After their turnover"),
  };
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
  const oppTrips = countedPossessions(possessions).filter((p) => p.team === "opponent");
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
  let type = p.possession_type.replace(/_/g, " ");
  if (p.possession_type === "non_possession_ft") type = `${p.ft_award_type ?? "awarded"} FT`;
  else if (isPressBreak(p)) type = `press break → ${type}`;
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
    // A scrimmage's 6th period or a practice's 5th session is regulation --
    // those formats have no overtime concept. Leaving regulation_periods
    // behind would make periodLabel() render them as "OT".
    regulation_periods: isOvertime ? fmt.regulation_periods : fmt.regulation_periods + 1,
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
