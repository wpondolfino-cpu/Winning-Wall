// src/lib/boxScores.ts
// Individual stats: player box scores (Hudl file or typed in), the stats
// the app works out from them, and what players are allowed to see.
//
// The formulas here must match public._box_calc in migration 221 — the
// database works out what players see, this file works out what coaches
// see while importing and in the season view.
import { supabase } from "./supabase";

// ── Counting stats ───────────────────────────────────────────────

export const COUNT_KEYS = [
  "pts", "fgm2", "fga2", "fgm3", "fga3", "ftm", "fta", "oreb", "dreb", "reb",
  "ast", "stl", "blk", "tov", "pf", "defl", "chg",
] as const;
export type CountKey = (typeof COUNT_KEYS)[number];
export type BoxCounts = Record<CountKey, number>;

export const emptyCounts = (): BoxCounts =>
  Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as BoxCounts;

/** One player's line as saved. A line with no player_id is someone not on the roster (kept so team totals add up). */
export interface BoxLine extends BoxCounts {
  player_id: string | null;
  jersey: number | null;
  name: string | null;
}

/** All stats for a line: counting + calculated. Calculated values are null when there's nothing to divide by. */
export type BoxStats = Record<string, number | null>;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Counting stats in, everything out. teamUse = the team's FGA + 0.44·FTA + TO (for "share"). */
export function calcStats(c: Partial<BoxCounts>, teamUse: number | null = null): BoxStats {
  const v = (k: CountKey) => Number(c[k] ?? 0);
  const fgm = v("fgm2") + v("fgm3"), fga = v("fga2") + v("fga3");
  const tsa = fga + 0.44 * v("fta");
  const out: BoxStats = {};
  COUNT_KEYS.forEach((k) => (out[k] = v(k)));
  out.fgm = fgm;
  out.fga = fga;
  out.fg_pct = fga > 0 ? r1((fgm / fga) * 100) : null;
  out.fg2_pct = v("fga2") > 0 ? r1((v("fgm2") / v("fga2")) * 100) : null;
  out.fg3_pct = v("fga3") > 0 ? r1((v("fgm3") / v("fga3")) * 100) : null;
  out.ft_pct = v("fta") > 0 ? r1((v("ftm") / v("fta")) * 100) : null;
  out.efg_pct = fga > 0 ? r1(((fgm + 0.5 * v("fgm3")) / fga) * 100) : null;
  out.ts_pct = tsa > 0 ? r1((v("pts") / (2 * tsa)) * 100) : null;
  out.pps = tsa > 0 ? r2(v("pts") / tsa) : null;
  out.rate3 = fga > 0 ? r1((v("fga3") / fga) * 100) : null;
  out.ftr = fga > 0 ? r2(v("fta") / fga) : null;
  out.ast_to = v("tov") > 0 ? r2(v("ast") / v("tov")) : null;
  out.disruptions = v("stl") + v("blk") + v("defl") + v("chg");
  out.impact = r1(
    v("pts") + 0.4 * fgm - 0.7 * fga - 0.4 * (v("fta") - v("ftm")) + 0.7 * v("oreb") + 0.3 * v("dreb")
    + v("stl") + 0.7 * v("ast") + 0.7 * v("blk") - 0.4 * v("pf") - v("tov") + 0.5 * v("defl") + v("chg"),
  );
  out.share = teamUse && teamUse > 0 ? r1(((fga + 0.44 * v("fta") + v("tov")) / teamUse) * 100) : null;
  return out;
}

/** FGA + 0.44·FTA + TO — the "possessions used" a share is measured against. */
export const possessionsUsed = (c: Partial<BoxCounts>) =>
  Number(c.fga2 ?? 0) + Number(c.fga3 ?? 0) + 0.44 * Number(c.fta ?? 0) + Number(c.tov ?? 0);

export function sumCounts(lines: Partial<BoxCounts>[]): BoxCounts {
  const t = emptyCounts();
  lines.forEach((l) => COUNT_KEYS.forEach((k) => (t[k] += Number(l[k] ?? 0))));
  return t;
}

/** Points that don't match made shots, or makes above attempts. null = fine. */
export function lineProblem(c: Partial<BoxCounts>): string | null {
  const v = (k: CountKey) => Number(c[k] ?? 0);
  if (COUNT_KEYS.some((k) => v(k) < 0 || !Number.isFinite(v(k)))) return "Numbers can't be negative.";
  if (v("fgm2") > v("fga2")) return "More 2s made than tried.";
  if (v("fgm3") > v("fga3")) return "More 3s made than tried.";
  if (v("ftm") > v("fta")) return "More free throws made than tried.";
  const shot = 2 * v("fgm2") + 3 * v("fgm3") + v("ftm");
  if (v("pts") !== shot) return `Points (${v("pts")}) don't match made shots (${shot}).`;
  return null;
}

// ── What each stat means ─────────────────────────────────────────

export type StatFormat = "int" | "pct" | "dec1" | "dec2";
export interface StatDef {
  key: string;
  label: string;
  /** Column header. */
  short: string;
  /** The "Players see" tick it belongs to. */
  group: string;
  format: StatFormat;
  calculated?: boolean;
  description: string;
}

export const STAT_DEFS: StatDef[] = [
  { key: "pts", label: "Points", short: "Pts", group: "points", format: "int", description: "Points scored." },
  { key: "fgm", label: "Field goals made", short: "FGM", group: "shooting", format: "int", calculated: true, description: "2s and 3s made, together." },
  { key: "fga", label: "Field goals tried", short: "FGA", group: "shooting", format: "int", calculated: true, description: "2s and 3s tried, together." },
  { key: "fg_pct", label: "Field goal %", short: "FG%", group: "shooting", format: "pct", calculated: true, description: "Share of 2s and 3s that went in." },
  { key: "fgm2", label: "2s made", short: "2PM", group: "shooting", format: "int", description: "Two-point shots made." },
  { key: "fga2", label: "2s tried", short: "2PA", group: "shooting", format: "int", description: "Two-point shots tried." },
  { key: "fg2_pct", label: "2-point %", short: "2P%", group: "shooting", format: "pct", calculated: true, description: "Share of 2s that went in." },
  { key: "fgm3", label: "3s made", short: "3PM", group: "shooting", format: "int", description: "Three-point shots made." },
  { key: "fga3", label: "3s tried", short: "3PA", group: "shooting", format: "int", description: "Three-point shots tried." },
  { key: "fg3_pct", label: "3-point %", short: "3P%", group: "shooting", format: "pct", calculated: true, description: "Share of 3s that went in." },
  { key: "ftm", label: "Free throws made", short: "FTM", group: "shooting", format: "int", description: "Free throws made." },
  { key: "fta", label: "Free throws tried", short: "FTA", group: "shooting", format: "int", description: "Free throws tried." },
  { key: "ft_pct", label: "Free throw %", short: "FT%", group: "shooting", format: "pct", calculated: true, description: "Share of free throws that went in." },
  { key: "oreb", label: "Offensive rebounds", short: "OREB", group: "rebounds", format: "int", description: "Rebounds of our own misses — another chance to score." },
  { key: "dreb", label: "Defensive rebounds", short: "DREB", group: "rebounds", format: "int", description: "Rebounds of the other team's misses — ends their trip." },
  { key: "reb", label: "Rebounds", short: "Reb", group: "rebounds", format: "int", description: "Offensive and defensive rebounds together." },
  { key: "ast", label: "Assists", short: "Ast", group: "assists", format: "int", description: "Passes that led straight to a teammate's basket." },
  { key: "stl", label: "Steals", short: "Stl", group: "steals", format: "int", description: "Took the ball from the other team." },
  { key: "blk", label: "Blocks", short: "Blk", group: "blocks", format: "int", description: "Blocked a shot." },
  { key: "defl", label: "Deflections", short: "Defl", group: "deflections", format: "int", description: "Got a hand on a pass or dribble, even if it didn't end the trip. Hudl tracks these; most box scores don't." },
  { key: "chg", label: "Charges taken", short: "Chg", group: "charges", format: "int", description: "Drew an offensive foul — a turnover for the other team." },
  { key: "tov", label: "Turnovers", short: "TO", group: "turnovers", format: "int", description: "Lost the ball without a shot." },
  { key: "pf", label: "Fouls", short: "PF", group: "fouls", format: "int", description: "Personal fouls." },
  { key: "disruptions", label: "Disruptions", short: "Disr", group: "disruptions", format: "int", calculated: true, description: "Steals + blocks + deflections + charges. Counts plays that wreck the other team's trip — it's a count of plays, not points." },
  { key: "impact", label: "Impact Score", short: "Impact", group: "impact", format: "dec1", calculated: true, description: "One number for a player's whole game, on roughly the same scale as points. Points, made shots, rebounds (offensive count more), assists, steals, blocks, deflections and charges add; missed shots, missed free throws, turnovers and fouls take away. Roughly: under 5 quiet, 5–10 solid, 10–15 very good, 15+ standout. Compared with your own team's average, not an outside scale." },
  { key: "efg_pct", label: "Effective FG %", short: "eFG%", group: "efficiency", format: "pct", calculated: true, description: "Field goal % with each 3 counted as 1.5 makes, since it's worth 1.5 times as much." },
  { key: "ts_pct", label: "True shooting %", short: "TS%", group: "efficiency", format: "pct", calculated: true, description: "How efficiently a player scores, counting 3s and free throws. Points ÷ (2 × (shots + 0.44 × free throws tried))." },
  { key: "pps", label: "Points per shot", short: "Pts/shot", group: "efficiency", format: "dec2", calculated: true, description: "Points ÷ (shots + 0.44 × free throws tried). About 1.0 is average; higher is better." },
  { key: "rate3", label: "3-point rate", short: "3PAr", group: "efficiency", format: "pct", calculated: true, description: "Share of a player's shots that were 3s." },
  { key: "ftr", label: "Free throw rate", short: "FTr", group: "efficiency", format: "dec2", calculated: true, description: "Free throws tried per shot — how often a player gets to the line." },
  { key: "ast_to", label: "Assist-to-turnover", short: "A/TO", group: "ast_to", format: "dec2", calculated: true, description: "Assists ÷ turnovers. Blank with no turnovers." },
  { key: "share", label: "Share of team trips", short: "Share", group: "share", format: "pct", calculated: true, description: "Share of the team's shots, free throw trips and turnovers that were this player's — who the offense runs through. Not per minute, since box scores don't have minutes." },
];
export const STAT_BY_KEY = new Map(STAT_DEFS.map((s) => [s.key, s]));

/** The "Players see" ticks, in the order the settings show them. */
export const STAT_GROUPS: { key: string; label: string; description: string }[] = [
  { key: "points", label: "Points", description: "Points scored." },
  { key: "shooting", label: "Shooting", description: "Made, tried and % for field goals, 2s, 3s and free throws." },
  { key: "rebounds", label: "Rebounds", description: "Offensive, defensive and total rebounds." },
  { key: "assists", label: "Assists", description: STAT_BY_KEY.get("ast")!.description },
  { key: "steals", label: "Steals", description: STAT_BY_KEY.get("stl")!.description },
  { key: "blocks", label: "Blocks", description: STAT_BY_KEY.get("blk")!.description },
  { key: "deflections", label: "Deflections", description: STAT_BY_KEY.get("defl")!.description },
  { key: "charges", label: "Charges taken", description: STAT_BY_KEY.get("chg")!.description },
  { key: "disruptions", label: "Disruptions", description: STAT_BY_KEY.get("disruptions")!.description },
  { key: "impact", label: "Impact Score", description: STAT_BY_KEY.get("impact")!.description },
  { key: "turnovers", label: "Turnovers", description: STAT_BY_KEY.get("tov")!.description },
  { key: "fouls", label: "Fouls", description: STAT_BY_KEY.get("pf")!.description },
  { key: "efficiency", label: "Efficiency", description: "eFG%, true shooting %, points per shot, 3-point rate and free throw rate." },
  { key: "ast_to", label: "Assist-to-turnover", description: STAT_BY_KEY.get("ast_to")!.description },
  { key: "share", label: "Share of team trips", description: STAT_BY_KEY.get("share")!.description },
];
export const DEFAULT_VISIBLE = ["points", "shooting", "rebounds", "assists", "steals", "blocks", "deflections", "charges", "disruptions", "impact"];

/** Single-game Hall of Fame records, and the tick each needs. */
export const RECORD_DEFS: { key: string; label: string; group: string }[] = [
  { key: "pts", label: "Most points in a game", group: "points" },
  { key: "reb", label: "Most rebounds in a game", group: "rebounds" },
  { key: "oreb", label: "Most offensive rebounds in a game", group: "rebounds" },
  { key: "ast", label: "Most assists in a game", group: "assists" },
  { key: "fgm3", label: "Most 3s made in a game", group: "shooting" },
  { key: "stl", label: "Most steals in a game", group: "steals" },
  { key: "blk", label: "Most blocks in a game", group: "blocks" },
  { key: "defl", label: "Most deflections in a game", group: "deflections" },
  { key: "chg", label: "Most charges taken in a game", group: "charges" },
  { key: "disruptions", label: "Most disruptions in a game", group: "disruptions" },
  { key: "impact", label: "Best Impact Score in a game", group: "impact" },
];

export function formatStat(key: string, v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  const f = STAT_BY_KEY.get(key)?.format ?? "int";
  if (f === "pct") return v.toFixed(1);
  if (f === "dec2") return v.toFixed(2);
  if (f === "dec1") return v.toFixed(1);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ── Reading a Hudl box score file ────────────────────────────────

const HUDL_COLUMNS: Record<string, CountKey | "jersey" | "fgm" | "fga"> = {
  jersey: "jersey", number: "jersey", points: "pts",
  twopointsmade: "fgm2", twopointattempts: "fga2", twopointsattempted: "fga2",
  threepointsmade: "fgm3", threepointattempts: "fga3", threepointsattempted: "fga3",
  fieldgoalsmade: "fgm", fieldgoalattempts: "fga", fieldgoalsattempted: "fga",
  freethrowsmade: "ftm", freethrowattempts: "fta", freethrowsattempted: "fta",
  offensiverebounds: "oreb", defensiverebounds: "dreb", rebounds: "reb", totalrebounds: "reb",
  assists: "ast", blockedshots: "blk", blocks: "blk", steals: "stl", turnovers: "tov",
  personalfouls: "pf", fouls: "pf", deflections: "defl", charges: "chg", chargestaken: "chg",
};

export interface ParsedFile {
  lines: (BoxCounts & { jersey: number | null })[];
  /** Columns in the file we don't use. */
  ignored: string[];
  problems: string[];
}

/**
 * Hudl's basketball box score export: an id line, a header line, then one
 * line per player separated by "|". Also takes commas or tabs, and
 * field-goal columns in place of 2-point columns.
 */
export function parseBoxScoreFile(text: string): ParsedFile {
  const raw = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const headerAt = raw.findIndex((l) => /jersey|number/i.test(l) && /points/i.test(l));
  if (headerAt < 0) return { lines: [], ignored: [], problems: ["Couldn't find the header line (it should start with Jersey|Points|…). Is this the box score export?"] };
  const delim = raw[headerAt].includes("|") ? "|" : raw[headerAt].includes("\t") ? "\t" : ",";
  const header = raw[headerAt].split(delim).map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const ignored = header.filter((h) => !HUDL_COLUMNS[h]);
  const problems: string[] = [];
  const lines: ParsedFile["lines"] = [];
  for (const row of raw.slice(headerAt + 1)) {
    const cells = row.split(delim).map((c) => c.trim());
    if (cells.length < 3) continue;
    const c = emptyCounts() as BoxCounts & { jersey: number | null };
    c.jersey = null;
    let fgm: number | null = null, fga: number | null = null;
    header.forEach((h, i) => {
      const key = HUDL_COLUMNS[h];
      if (!key) return;
      const n = cells[i] === "" || cells[i] == null ? 0 : Number(cells[i]);
      if (key === "jersey") { c.jersey = Number.isFinite(n) && cells[i] !== "" ? n : null; return; }
      if (!Number.isFinite(n)) { problems.push(`Couldn't read "${cells[i]}" in ${h}.`); return; }
      if (key === "fgm") fgm = n; else if (key === "fga") fga = n; else c[key] = n;
    });
    // Field goal columns instead of 2-point ones: 2s = FG − 3s.
    if (!header.includes("twopointsmade") && fgm != null) c.fgm2 = Math.max(0, fgm - c.fgm3);
    if (!header.some((h) => h.startsWith("twopointattempt")) && fga != null) c.fga2 = Math.max(0, fga - c.fga3);
    if (!header.includes("rebounds") && !header.includes("totalrebounds")) c.reb = c.oreb + c.dreb;
    lines.push(c);
  }
  if (!lines.length) problems.push("The file has a header but no player lines.");
  return { lines, ignored, problems };
}

// ── Saved box scores ─────────────────────────────────────────────

export interface BoxRow {
  game_id: string;
  player_id: string | null;
  jersey: number | null;
  name: string;
  opponent: string;
  game_date: string;
  game_type: string;
  season_id: string | null;
  roster_id: string | null;
  source: "hudl" | "hand";
  shared: boolean;
  stats: BoxStats;
}

/** Box score lines. Coaches get every stat; players get only what their coach allows (decided by the database). */
export async function getBoxRows(opts: { gameId?: string; playerId?: string; seasonId?: string } = {}): Promise<BoxRow[]> {
  const { data, error } = await supabase.rpc("player_box_scores", {
    p_game: opts.gameId ?? null, p_player: opts.playerId ?? null, p_season: opts.seasonId ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoxRow[];
}

/** Coaches: the raw lines (for editing / re-saving). */
export async function getBoxLines(gameId: string): Promise<BoxLine[]> {
  const { data, error } = await supabase.from("player_box_lines").select("*").eq("game_id", gameId).order("jersey", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoxLine[];
}

export interface BoxMeta { game_id: string; source: "hudl" | "hand"; shared: boolean; saved_at: string; roster_id: string | null }

/** Coaches: which games have a box score. */
export async function getBoxMetas(gameIds?: string[]): Promise<Map<string, BoxMeta>> {
  let q = supabase.from("game_box_scores").select("game_id, source, shared, saved_at, roster_id");
  if (gameIds) q = q.in("game_id", gameIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as BoxMeta[]).map((m) => [m.game_id, m]));
}

export async function saveBoxScore(gameId: string, source: "hudl" | "hand", shared: boolean, lines: BoxLine[]): Promise<number> {
  const { data, error } = await supabase.rpc("save_box_score", { p_game: gameId, p_source: source, p_shared: shared, p_lines: lines });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function deleteBoxScore(gameId: string): Promise<void> {
  const { error } = await supabase.from("game_box_scores").delete().eq("game_id", gameId);
  if (error) throw new Error(error.message);
}

export async function setBoxShared(gameId: string, shared: boolean): Promise<void> {
  const { error } = await supabase.from("game_box_scores").update({ shared }).eq("game_id", gameId);
  if (error) throw new Error(error.message);
}

/**
 * Coaches: who wore each number on this team's earlier box scores this
 * season — so a call-up picked once is remembered the next time.
 */
export async function pastJerseyPicks(rosterId: string | null, seasonId: string | null): Promise<Map<number, string>> {
  if (!rosterId) return new Map();
  const { data: metas } = await supabase.from("game_box_scores").select("game_id, saved_at").eq("roster_id", rosterId);
  let gameIds = ((metas ?? []) as any[]).sort((a, b) => String(a.saved_at).localeCompare(String(b.saved_at))).map((m) => m.game_id as string);
  if (!gameIds.length) return new Map();
  if (seasonId) {
    const { data: gs } = await supabase.from("games").select("id").in("id", gameIds).eq("season_id", seasonId);
    const keep = new Set(((gs ?? []) as any[]).map((g) => g.id));
    gameIds = gameIds.filter((id) => keep.has(id));
  }
  if (!gameIds.length) return new Map();
  const { data } = await supabase.from("player_box_lines").select("game_id, jersey, player_id").in("game_id", gameIds).not("player_id", "is", null);
  const order = new Map(gameIds.map((id, i) => [id, i]));
  const out = new Map<number, string>();
  ((data ?? []) as any[])
    .sort((a, b) => (order.get(a.game_id) ?? 0) - (order.get(b.game_id) ?? 0))
    .forEach((r) => { if (r.jersey != null) out.set(r.jersey, r.player_id); });
  return out;
}

// ── Player view settings ─────────────────────────────────────────

export type Whose = "off" | "own" | "team";
export interface StatSettings {
  roster_id: string;
  whose: Whose;
  visible: string[];
  hof: string[];
  team_hof: string[];
}

export const defaultSettings = (rosterId: string): StatSettings =>
  ({ roster_id: rosterId, whose: "own", visible: [...DEFAULT_VISIBLE], hof: [], team_hof: [] });

export async function getStatSettings(rosterId: string): Promise<StatSettings> {
  const { data } = await supabase.from("player_stat_settings").select("roster_id, whose, visible, hof, team_hof").eq("roster_id", rosterId).maybeSingle();
  return (data as StatSettings) ?? defaultSettings(rosterId);
}

export async function saveStatSettings(s: StatSettings): Promise<void> {
  // A Hall of Fame tick only counts while players can see that stat.
  const hof = s.hof.filter((k) => s.visible.includes(RECORD_DEFS.find((r) => r.key === k)?.group ?? ""));
  const { error } = await supabase.from("player_stat_settings").upsert(
    { roster_id: s.roster_id, whose: s.whose, visible: s.visible, hof, team_hof: s.team_hof, updated_at: new Date().toISOString() },
    { onConflict: "roster_id" },
  );
  if (error) throw new Error(error.message);
}

// ── Profile and Hall of Fame ─────────────────────────────────────

export interface SeasonSummary {
  games?: number;
  whose?: Whose;
  totals?: BoxStats;
  per_game?: BoxStats;
  team_avg_impact?: number | null;
}

export async function getSeasonSummary(playerId?: string, seasonId?: string): Promise<SeasonSummary | null> {
  const { data, error } = await supabase.rpc("player_season_summary", { p_player: playerId ?? null, p_season: seasonId ?? null });
  if (error) throw new Error(error.message);
  return (data as SeasonSummary) ?? null;
}

export interface GameRecord {
  record_key: string;
  value: number;
  player_id: string | null;
  name: string;
  game_id: string;
  opponent: string;
  game_date: string;
}

export async function getGameRecords(rosterId: string): Promise<GameRecord[]> {
  const { data, error } = await supabase.rpc("game_records", { p_roster: rosterId });
  if (error) throw new Error(error.message);
  return (data ?? []) as GameRecord[];
}
