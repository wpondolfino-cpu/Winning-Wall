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
}

export async function listStatGoals() {
  return supabase.from("stat_goals").select("*");
}

export async function upsertStatGoal(statKey: string, team: Team, targetValue: number, direction: "higher_better" | "lower_better", userId: string) {
  return supabase.from("stat_goals").upsert(
    { stat_key: statKey, team, target_value: targetValue, direction, updated_by: userId },
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
export type StatKind = "number" | "shot_quality" | "set_plays" | "oob" | "streaks";

export interface StatDef {
  key: string;
  label: string;
  kind: StatKind;
  inGame: boolean;
  defaultDirection?: "higher_better" | "lower_better";
  selfColored?: boolean; // true for stats colored by their own sign (+/-), not against a goal target
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
  { key: "set_plays", label: "Set plays (Set / Motion)", kind: "set_plays", inGame: false },
  { key: "oob_plays", label: "Set plays (BLOB / SLOB)", kind: "oob", inGame: false },
  { key: "streaks", label: "Streaks", kind: "streaks", inGame: true },
];

/** Goal-settable stats, for the Goals tab -- "number" kind, excluding self-colored ones like Extra Possessions that don't compare against a target. */
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
  const halfCourtTripsArr = trips.filter((p) => p.possession_type === "half_court");

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
    { key: "tov_pct", label: "TOV%", value: round1(tovPct), raw: `${liveTov}+${deadTov}=${turnovers}` },
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
 * Extra Possessions: (our OREB + our TOV) minus (their OREB + their TOV).
 * Positive is good for us, negative is bad -- colored by sign, not against
 * a goal target. This is inherently a two-team number (needs both sides'
 * OREB/TOV at once), unlike the rest of computeTeamStats which only looks
 * at one team's possessions -- so it's its own function.
 */
export function computeExtraPossessions(possessions: Possession[]): { us: number; opponent: number } {
  const orebFor = (team: Team) => possessions.filter((p) => p.team === team).reduce((s, p) => s + p.oreb_count, 0);
  const tovFor = (team: Team) => possessions.filter((p) => p.team === team && p.outcome === "turnover").length;
  const usTotal = orebFor("us") + tovFor("us");
  const oppTotal = orebFor("opponent") + tovFor("opponent");
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

export async function finishGame(gameId: string, finalScoreUs: number, finalScoreThem: number) {
  return supabase.from("games").update({ final_score_us: finalScoreUs, final_score_them: finalScoreThem }).eq("id", gameId);
}

/** Undoes finishGame -- clears the final score so the game goes back to being trackable. The escape hatch for "finished too early." */
export async function reopenGame(gameId: string) {
  return supabase.from("games").update({ final_score_us: null, final_score_them: null }).eq("id", gameId);
}

/** A game is only editable/correctable once it's been explicitly finished (final score set) -- this keeps live entry and post-game correction from colliding. */
export function isGameFinal(game: Pick<Game, "final_score_us" | "final_score_them">): boolean {
  return game.final_score_us != null && game.final_score_them != null;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
