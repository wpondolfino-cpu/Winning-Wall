// schedule.ts — one agenda over practices, games and events.
//
// Schedule owns no data of its own except events. Practices belong to the
// practice system and games to the game-stats system; this reads both and
// links back to their real editors rather than becoming a third place a
// practice can be defined.
//
// The only thing it writes to a practice or a game is scheduling fields —
// date, time, location — because opening Practice Builder to change a
// start time is absurd. Everything else routes to the owning editor.

import { supabase } from "./supabase";

export type ScheduleKind = "practice" | "game" | "event";

export interface ScheduleItem {
  id: string;
  kind: ScheduleKind;
  date: string;          // ISO yyyy-mm-dd
  time: string | null;   // HH:MM:SS, null when unknown
  title: string;
  subtitle: string;
  week_id: string | null;
  /** Published state of the thing behind this row. Drives the faded/live treatment. */
  published: boolean;
  /** Games only: whether a scout sheet exists and is published. */
  scoutPublished?: boolean;
  /** Games only: whether the game has been played (a final score exists). */
  played?: boolean;
  /** Games only: the play sheet attached to this game, if one is. */
  gamedaySheetId?: string | null;
  rosterIds?: string[];
}

export interface ScheduleWeek {
  id: string | null;
  name: string;
  start_date: string | null;
  end_date: string | null;
  items: ScheduleItem[];
}

export interface ScheduleEvent {
  id: string;
  week_id: string | null;
  season_id: string | null;
  event_date: string;
  start_time: string | null;
  title: string;
  location: string | null;
  roster_ids: string[];
}

// ── Reading ───────────────────────────────────────────────────

/**
 * Everything on the schedule for a season, grouped by week.
 *
 * Three separate queries rather than a view: practices, games and events
 * live in unrelated systems with their own RLS, and a view would need
 * maintaining every time any of them gains a column.
 */
export async function getSchedule(seasonId: string | null, opts: { playerVisibleOnly?: boolean } = {}): Promise<ScheduleWeek[]> {
  const [weeksRes, practicesRes, gamesRes, eventsRes, sheetsRes] = await Promise.all([
    supabase.from("practice_weeks").select("*").order("start_date", { ascending: true, nullsFirst: false }),
    supabase.from("practices").select("id, practice_date, start_time, week_id, status, roster_ids, is_tryout"),
    supabase.from("games").select("id, game_date, tip_time, location, opponent, home_away, week_id, final_score_us, final_score_them, status, gameday_sheet_id"),
    supabase.from("schedule_events").select("*"),
    supabase.from("scout_sheets").select("game_id, status"),
  ]);

  const sheetByGame = new Map<string, string>(
    ((sheetsRes.data ?? []) as any[]).filter(s => s.game_id).map(s => [s.game_id, s.status])
  );

  const items: ScheduleItem[] = [];

  for (const p of (practicesRes.data ?? []) as any[]) {
    // A tryout practice is coach-only: the pool contains kids who haven't
    // made the team, and the roster shouldn't see it on their schedule.
    if (opts.playerVisibleOnly && (p.status !== "published" || p.is_tryout)) continue;
    items.push({
      id: p.id, kind: "practice", date: p.practice_date, time: p.start_time ?? null,
      title: p.is_tryout ? "Tryout" : "Practice",
      subtitle: "", week_id: p.week_id, published: p.status === "published",
      rosterIds: p.roster_ids ?? [],
    });
  }

  for (const g of (gamesRes.data ?? []) as any[]) {
    const played = g.final_score_us != null && g.final_score_them != null;
    if (opts.playerVisibleOnly && played && g.status !== "published") {
      // An unpublished report shouldn't hide the game itself — a player
      // still needs to know it happened, they just can't open the report.
    }
    const prefix = g.home_away === "away" ? "@ " : g.home_away === "home" ? "vs " : "";
    items.push({
      id: g.id, kind: "game", date: g.game_date, time: g.tip_time ?? null,
      title: prefix + g.opponent,
      subtitle: [g.location, played ? `${g.final_score_us}-${g.final_score_them}` : null].filter(Boolean).join(" · "),
      week_id: g.week_id, published: g.status === "published",
      scoutPublished: sheetByGame.get(g.id) === "published",
      gamedaySheetId: g.gameday_sheet_id ?? null,
      played,
    });
  }

  for (const e of (eventsRes.data ?? []) as any[]) {
    items.push({
      id: e.id, kind: "event", date: e.event_date, time: e.start_time ?? null,
      title: e.title, subtitle: e.location ?? "", week_id: e.week_id,
      published: true, rosterIds: e.roster_ids ?? [],
    });
  }

  // Group by the week a row's DATE falls in rather than its stored
  // week_id, so a game imported before its week existed still lands in the
  // right place, and a mis-assigned row self-corrects.
  const weeks = ((weeksRes.data ?? []) as any[]).filter(w => !seasonId || !w.season_id || w.season_id === seasonId);
  const grouped: ScheduleWeek[] = weeks.map(w => ({
    id: w.id, name: w.name, start_date: w.start_date, end_date: w.end_date, items: [],
  }));
  const loose: ScheduleItem[] = [];

  for (const item of items) {
    const w = grouped.find(g => g.start_date && g.end_date && item.date >= g.start_date && item.date <= g.end_date)
      ?? grouped.find(g => g.id === item.week_id);
    if (w) w.items.push(item); else loose.push(item);
  }
  if (loose.length) {
    grouped.push({ id: null, name: "Unscheduled", start_date: null, end_date: null, items: loose });
  }

  for (const w of grouped) {
    w.items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"));
  }
  return grouped
    .filter(w => w.items.length > 0)
    .sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"));
}

// ── Quick edit ────────────────────────────────────────────────
//
// Scheduling fields only. Anything structural stays in the owning editor,
// so a practice is still defined in exactly one place.

export async function updateScheduleFields(item: ScheduleItem, patch: {
  date?: string; time?: string | null; location?: string | null;
  opponent?: string; home_away?: string; title?: string;
  gameday_sheet_id?: string | null;
}): Promise<{ error: string | null }> {
  const stamp = new Date().toISOString();
  if (item.kind === "practice") {
    const { error } = await supabase.from("practices").update({
      ...(patch.date ? { practice_date: patch.date } : {}),
      ...(patch.time !== undefined ? { start_time: patch.time } : {}),
      updated_at: stamp,
    }).eq("id", item.id);
    return { error: error?.message ?? null };
  }
  if (item.kind === "game") {
    const { error } = await supabase.from("games").update({
      ...(patch.date ? { game_date: patch.date } : {}),
      ...(patch.time !== undefined ? { tip_time: patch.time } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
      ...(patch.opponent ? { opponent: patch.opponent } : {}),
      ...(patch.home_away ? { home_away: patch.home_away } : {}),
      ...(patch.gameday_sheet_id !== undefined ? { gameday_sheet_id: patch.gameday_sheet_id } : {}),
      updated_at: stamp,
    }).eq("id", item.id);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.from("schedule_events").update({
    ...(patch.date ? { event_date: patch.date } : {}),
    ...(patch.time !== undefined ? { start_time: patch.time } : {}),
    ...(patch.location !== undefined ? { location: patch.location } : {}),
    ...(patch.title ? { title: patch.title } : {}),
    updated_at: stamp,
  }).eq("id", item.id);
  return { error: error?.message ?? null };
}

export async function deleteScheduleItem(item: ScheduleItem): Promise<{ error: string | null }> {
  const table = item.kind === "practice" ? "practices" : item.kind === "game" ? "games" : "schedule_events";
  const { error } = await supabase.from(table).delete().eq("id", item.id);
  return { error: error?.message ?? null };
}

// ── Events ────────────────────────────────────────────────────

export async function createEvent(input: {
  season_id: string | null; event_date: string; start_time?: string | null;
  title: string; location?: string | null; roster_ids?: string[];
}): Promise<{ id: string | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const weekId = await resolveWeek(input.event_date, input.season_id);
  const { data, error } = await supabase.from("schedule_events").insert({
    season_id: input.season_id,
    event_date: input.event_date,
    start_time: input.start_time ?? null,
    title: input.title.trim(),
    location: input.location ?? null,
    roster_ids: input.roster_ids ?? [],
    week_id: weekId,
    created_by: user?.id,
  }).select("id").single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

/** Finds or creates the week containing a date, so nothing has to be filed by hand. */
export async function resolveWeek(date: string, seasonId: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc("week_for_date", { p_date: date, p_season_id: seasonId });
  if (error) { console.error("Could not resolve week:", error); return null; }
  return (data as string) ?? null;
}

/**
 * Formats a date-only column for display.
 *
 * `new Date("2026-08-22")` parses as UTC MIDNIGHT, so anywhere west of
 * Greenwich toLocaleDateString renders it as the day before — a game
 * created for today showed as yesterday. Anchoring at midday puts the
 * instant far enough from either boundary that no timezone shifts the
 * calendar day.
 */
export function formatDateOnly(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, opts);
}
