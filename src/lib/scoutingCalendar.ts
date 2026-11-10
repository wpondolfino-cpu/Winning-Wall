// src/lib/scoutingCalendar.ts
// The Scouting page's Calendar tab: other teams' games worth watching,
// which coaches are scouting each one (live in the gym or on film), video
// links on a game, and each team's MIAA division and power ranking.
//
// Tables (SQL 209): scouting_games, scouting_assignments, scouting_videos,
// scouting_rankings. Coaches only -- row security keeps players and other
// programs out.
//
// Getting games in is a paste, like the schedule import: copy a schedule
// page or your own spreadsheet, check the preview, save. Nothing is
// written until you press Save, and a game already on the calendar is
// skipped rather than doubled.

import { supabase } from "./supabase";
import { getYouTubeId } from "./youtube";

export type ScoutMode = "live" | "film";

export interface ScoutAssignment { id: string; coach_id: string; mode: ScoutMode }
export interface ScoutVideo { id: string; url: string; note: string | null; created_at: string }
export interface ScoutingGame {
  id: string;
  game_date: string;            // YYYY-MM-DD
  tip_time: string | null;      // HH:MM[:SS]
  away_team: string;
  home_team: string;
  /** Only set when it isn't the home team's gym (a neutral site). */
  location: string | null;
  note: string | null;
  assignments: ScoutAssignment[];
  videos: ScoutVideo[];
}
export interface Ranking { team: string; division: number; rank: number | null; record: string | null }

type Result = { error: string | null };
const fail = (e: any): Result => ({ error: e?.message ?? String(e) });

/** A team name squashed to letters and digits -- the same rule the database uses. */
export function teamKey(name: string): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Dates ────────────────────────────────────────────────────
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** The Monday of the week a date falls in. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

// ── Reading ──────────────────────────────────────────────────
export async function getScoutingGames(from: string, to: string): Promise<ScoutingGame[]> {
  const { data, error } = await supabase
    .from("scouting_games")
    .select("id, game_date, tip_time, away_team, home_team, location, note, scouting_assignments(id, coach_id, mode), scouting_videos(id, url, note, created_at)")
    .gte("game_date", from).lte("game_date", to)
    .order("game_date", { ascending: true })
    .order("tip_time", { ascending: true, nullsFirst: false })
    .order("home_team", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map(g => ({
    id: g.id, game_date: g.game_date, tip_time: g.tip_time, away_team: g.away_team, home_team: g.home_team, location: g.location ?? null, note: g.note,
    assignments: (g.scouting_assignments ?? []) as ScoutAssignment[],
    videos: ((g.scouting_videos ?? []) as ScoutVideo[]).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

export async function getRankings(): Promise<Ranking[]> {
  const { data, error } = await supabase.from("scouting_rankings").select("team, division, rank, record")
    .order("division", { ascending: true }).order("rank", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Ranking[];
}

/**
 * Our own upcoming games, by opponent: what puts "We play them Dec 22" on
 * a game. Matched by name the same way as everywhere else (capitals,
 * spaces and punctuation ignored). Only the next game against each team.
 */
export interface OurGame { id: string; game_date: string; roster_id: string | null; opponent: string }
export async function getOurUpcomingGames(): Promise<Map<string, OurGame>> {
  const today = isoDate(new Date());
  const { data, error } = await supabase
    .from("games")
    .select("id, game_date, roster_id, opponent, opponents(name)")
    .gte("game_date", today)
    .order("game_date", { ascending: true });
  if (error) throw error;
  const map = new Map<string, OurGame>();
  for (const g of (data ?? []) as any[]) {
    const opp = Array.isArray(g.opponents) ? g.opponents[0] : g.opponents;
    const names = [g.opponent, opp?.name].filter(Boolean) as string[];
    for (const n of names) {
      const k = teamKey(n);
      if (k && !map.has(k)) map.set(k, { id: g.id, game_date: g.game_date, roster_id: g.roster_id ?? null, opponent: opp?.name ?? g.opponent });
    }
  }
  return map;
}

// ── Games ────────────────────────────────────────────────────
export interface NewScoutingGame { game_date: string; tip_time: string | null; away_team: string; home_team: string }

/** Adds games, skipping any already on the calendar. Returns how many were added. */
export async function addScoutingGames(rows: NewScoutingGame[]): Promise<{ added: number; skipped: number; error: string | null }> {
  if (!rows.length) return { added: 0, skipped: 0, error: null };
  try {
    const dates = rows.map(r => r.game_date).sort();
    const existing = await getScoutingGames(dates[0], dates[dates.length - 1]);
    const have = new Set(existing.map(g => `${g.game_date}|${teamKey(g.away_team)}|${teamKey(g.home_team)}`));
    const fresh: NewScoutingGame[] = [];
    for (const r of rows) {
      const k = `${r.game_date}|${teamKey(r.away_team)}|${teamKey(r.home_team)}`;
      if (have.has(k)) continue;
      have.add(k);
      fresh.push({ game_date: r.game_date, tip_time: r.tip_time, away_team: r.away_team.trim(), home_team: r.home_team.trim() });
    }
    if (fresh.length) {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("scouting_games").insert(fresh.map(f => ({ ...f, created_by: user?.id ?? null })));
      if (error) throw error;
    }
    return { added: fresh.length, skipped: rows.length - fresh.length, error: null };
  } catch (e) { return { added: 0, skipped: 0, ...fail(e) }; }
}

/**
 * Changes a game's date, time, teams or location. A location that's just
 * the home team's name is cleared, since that's where it's played anyway.
 */
export async function updateScoutingGame(id: string, patch: { game_date: string; tip_time: string | null; away_team: string; home_team: string; location: string | null }): Promise<Result> {
  const away = patch.away_team.trim(), home = patch.home_team.trim();
  if (!away || !home) return { error: "Both teams need a name." };
  if (!patch.game_date) return { error: "Pick a date." };
  let location = patch.location?.trim() || null;
  if (location && teamKey(location) === teamKey(home)) location = null;
  const { error } = await supabase.from("scouting_games")
    .update({ game_date: patch.game_date, tip_time: patch.tip_time || null, away_team: away, home_team: home, location }).eq("id", id);
  if (error?.code === "23505") return { error: "That game is already on the calendar for that date." };
  return { error: error?.message ?? null };
}

export async function deleteScoutingGame(id: string): Promise<Result> {
  const { error } = await supabase.from("scouting_games").delete().eq("id", id);
  return { error: error?.message ?? null };
}

// ── Scouts ───────────────────────────────────────────────────
export async function addScout(gameId: string, coachId: string, mode: ScoutMode = "live"): Promise<Result> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("scouting_assignments")
    .insert({ scouting_game_id: gameId, coach_id: coachId, mode, created_by: user?.id ?? null });
  return { error: error?.message ?? null };
}
export async function setScoutMode(assignmentId: string, mode: ScoutMode): Promise<Result> {
  const { error } = await supabase.from("scouting_assignments").update({ mode }).eq("id", assignmentId);
  return { error: error?.message ?? null };
}
export async function removeScout(assignmentId: string): Promise<Result> {
  const { error } = await supabase.from("scouting_assignments").delete().eq("id", assignmentId);
  return { error: error?.message ?? null };
}

// ── Video links ──────────────────────────────────────────────
export type VideoKind = "youtube" | "drive" | "hudl" | "nfhs" | "other";
export interface VideoInfo { kind: VideoKind; label: string; embed: string | null }

/** What a pasted link is, what to call its button, and whether it can play on the page. */
export function videoInfo(url: string): VideoInfo {
  const u = url.toLowerCase();
  const yt = getYouTubeId(url);
  if (yt && (u.includes("youtube.") || u.includes("youtu.be"))) {
    return { kind: "youtube", label: "YouTube", embed: `https://www.youtube.com/embed/${yt}` };
  }
  if (u.includes("drive.google.") || u.includes("docs.google.")) {
    const m = url.match(/\/d\/([\w-]{10,})/) ?? url.match(/[?&]id=([\w-]{10,})/);
    return { kind: "drive", label: "Drive", embed: m ? `https://drive.google.com/file/d/${m[1]}/preview` : null };
  }
  if (u.includes("hudl.com")) return { kind: "hudl", label: "Hudl", embed: null };
  if (u.includes("nfhsnetwork.com") || u.includes("nfhs.")) return { kind: "nfhs", label: "NFHS", embed: null };
  let host = "link";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep "link" */ }
  return { kind: "other", label: host, embed: null };
}

/** Tidies a pasted link: adds https:// if it was left off. Null if it isn't a link at all. */
export function cleanUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return u.hostname.includes(".") ? u.toString() : null; } catch { return null; }
}

export async function addVideo(gameId: string, url: string, note: string | null): Promise<Result> {
  const clean = cleanUrl(url);
  if (!clean) return { error: "That doesn't look like a link. Copy it from the address bar and paste it again." };
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("scouting_videos")
    .insert({ scouting_game_id: gameId, url: clean, note: note?.trim() || null, created_by: user?.id ?? null });
  return { error: error?.message ?? null };
}
export async function removeVideo(id: string): Promise<Result> {
  const { error } = await supabase.from("scouting_videos").delete().eq("id", id);
  return { error: error?.message ?? null };
}

// ── Rankings ─────────────────────────────────────────────────
/**
 * Saves pasted rankings. Each division you pasted is replaced as a whole
 * (that's how a weekly update works: the new list wins), and a team that
 * moved divisions is moved, not doubled.
 */
export async function saveRankings(rows: Ranking[]): Promise<Result> {
  if (!rows.length) return { error: "Nothing to save." };
  try {
    const divisions = Array.from(new Set(rows.map(r => r.division)));
    const del = await supabase.from("scouting_rankings").delete().in("division", divisions);
    if (del.error) throw del.error;
    const keys = Array.from(new Set(rows.map(r => teamKey(r.team))));
    for (let i = 0; i < keys.length; i += 100) {
      const d = await supabase.from("scouting_rankings").delete().in("team_key", keys.slice(i, i + 100));
      if (d.error) throw d.error;
    }
    // One row per team: if a team appears twice, the first one wins.
    const seen = new Set<string>();
    const clean = rows.filter(r => { const k = teamKey(r.team); if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .map(r => ({ team: r.team.trim(), division: r.division, rank: r.rank, record: r.record, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("scouting_rankings").insert(clean);
    if (error) throw error;
    return { error: null };
  } catch (e) { return fail(e); }
}

// ── Pasting games ────────────────────────────────────────────
export interface ParsedGame extends NewScoutingGame { problem: string | null; raw: string }

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Basketball season runs Nov-Mar: a month from Aug on is the start year, earlier ones the next. */
export function seasonStartYear(today = new Date()): number {
  return today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
}
function yearFor(month: number, startYear: number): number {
  return month >= 7 ? startYear : startYear + 1;
}

/** Finds a date anywhere in the text: 12/15, 12/15/26, Dec 15, December 15th. */
function findDate(text: string, startYear: number): { iso: string; match: string } | null {
  let m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const mo = parseInt(m[1], 10) - 1, d = parseInt(m[2], 10);
    if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) {
      let y = m[3] ? parseInt(m[3], 10) : yearFor(mo, startYear);
      if (y < 100) y += 2000;
      return { iso: isoDate(new Date(y, mo, d)), match: m[0] };
    }
  }
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()], d = parseInt(m[2], 10);
    const y = m[3] ? parseInt(m[3], 10) : yearFor(mo, startYear);
    return { iso: isoDate(new Date(y, mo, d)), match: m[0] };
  }
  return null;
}

/** Finds a tip time: 7:00, 7pm, 6:30 PM, 6:30p. No am/pm means evening (high school). */
function findTime(text: string): { hhmm: string; match: string } | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?(?=\s|$|,)/i);
  if (!m) return null;
  if (!m[2] && !m[3]) return null;                 // a bare number isn't a time
  let h = parseInt(m[1], 10);
  const min = m[2] ?? "00";
  if (h > 23 || parseInt(min, 10) > 59) return null;
  const ap = (m[3] ?? "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  else if (ap.startsWith("a") && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 11) h += 12;      // "7:00" on a schedule is 7 PM
  return { hhmm: `${String(h).padStart(2, "0")}:${min}`, match: m[0] };
}

const WEEKDAY = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday)?\.?,?/gi;
const tidy = (s: string) => s.replace(WEEKDAY, " ").replace(/\s+/g, " ").replace(/^[\s,–—-]+|[\s,–—-]+$/g, "").trim();

/**
 * Reads pasted games. Handles the usual shapes:
 *   Tue 12/15  Lowell  Cambridge  7:00        (spreadsheet: away, then home)
 *   Lowell at Cambridge 7:00 PM               (or "@")
 *   Cambridge vs Lowell                       ("vs": home team first)
 * A line with only a date on it ("Tuesday 12/15") sets the date for the
 * lines under it, so a schedule grouped by day pastes straight in.
 */
export function parseScoutingPaste(raw: string, startYear = seasonStartYear()): ParsedGame[] {
  const out: ParsedGame[] = [];
  let currentDate: string | null = null;
  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line) continue;
    if (/^(date|day)\b.*\b(home|away|team|opponent)/i.test(line)) continue;   // a header row

    const date = findDate(line, startYear);
    let rest = date ? line.replace(date.match, " ") : line;
    const time = findTime(rest);
    if (time) rest = rest.replace(time.match, " ");

    // Spreadsheet columns, if it came from one.
    let cells = rest.split(/\t|\s{2,}|\s*\|\s*/).map(tidy).filter(Boolean);
    if (date && !time && cells.length === 0) { currentDate = date.iso; continue; }   // a day heading
    if (date) currentDate = date.iso;

    let away = "", home = "";
    const joined = cells.join(" ");
    const at = joined.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    const vs = joined.match(/^(.+?)\s+(?:vs\.?|v\.?)\s+(.+)$/i);
    if (at) { away = tidy(at[1]); home = tidy(at[2]); }
    else if (vs) { home = tidy(vs[1]); away = tidy(vs[2]); }
    else {
      cells = cells.filter(c => !/^(@|at|vs\.?|v)$/i.test(c));
      if (cells.length >= 2) { away = cells[0]; home = cells[1]; }
    }

    const g: ParsedGame = { game_date: currentDate ?? "", tip_time: time?.hhmm ?? null, away_team: away, home_team: home, problem: null, raw: line };
    if (!away && !home) {
      if (!date) { g.problem = "couldn't find two teams"; out.push(g); }
      continue;
    }
    if (!away || !home) g.problem = "couldn't find two teams";
    else if (!g.game_date) g.problem = "no date";
    out.push(g);
  }
  return out;
}

// ── Pasting rankings ─────────────────────────────────────────
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };

/**
 * Reads pasted MIAA power rankings. Each ranked line starts with its rank,
 * then the team, then numbers (record, rating ...), which are ignored
 * apart from a W-L record. A "Division 3" (or "Div. III") line switches
 * division, so several divisions can be pasted at once; otherwise every
 * team goes in the division picked.
 */
export function parseRankingsPaste(raw: string, defaultDivision: number): Ranking[] {
  const out: Ranking[] = [];
  let division = defaultDivision;
  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const head = line.match(/^(?:division|div\.?)\s*([ivx]+|\d)\b/i);
    if (head) {
      const v = head[1].toLowerCase();
      const n = ROMAN[v] ?? parseInt(v, 10);
      if (n >= 1 && n <= 8) division = n;
      continue;
    }
    const m = line.match(/^#?(\d{1,3})[.)]?\s+(.+)$/);
    if (!m) continue;
    const rank = parseInt(m[1], 10);
    const words = m[2].split(" ");
    const name: string[] = [];
    for (const w of words) {
      if (/^[\d(.$-]/.test(w)) break;           // numbers start: record, rating, points
      name.push(w);
    }
    const team = name.join(" ").replace(/[,*]+$/, "").trim();
    if (!team) continue;
    const rec = m[2].match(/\b(\d{1,2}-\d{1,2}(?:-\d{1,2})?)\b/);
    out.push({ team, division, rank, record: rec ? rec[1] : null });
  }
  return out;
}
