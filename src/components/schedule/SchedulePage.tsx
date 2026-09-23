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
  /** Games only. Away games have two times that matter; this is the one you have to be somewhere for. */
  busTime?: string | null;
  homeAway?: string | null;
  rosterIds?: string[];
  /** Practices only: the coach's expected end, if they've set one. */
  expectedEndTime?: string | null;
  /** Games only: which of the optional features this game uses. */
  trackStats?: boolean;
  usesScoutSheet?: boolean;
  usesPlaySheet?: boolean;
  /** Games only: the final score, typed or worked out by the tracker. */
  scoreUs?: number | null;
  scoreThem?: number | null;
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
    supabase.from("practices").select("id, practice_date, start_time, expected_end_time, week_id, status, roster_ids, is_tryout").eq("is_template", false),
    supabase.from("games").select("id, game_date, tip_time, location, opponent, home_away, week_id, final_score_us, final_score_them, status, gameday_sheet_id, bus_time, roster_id, track_stats, uses_scout_sheet, uses_play_sheet"),
    supabase.from("schedule_events").select("*"),
    supabase.from("scout_sheets").select("game_id, status"),
  ]);

  const sheetByGame = new Map<string, string>(
    ((sheetsRes.data ?? []) as any[]).filter(s => s.game_id).map(s => [s.game_id, s.status])
  );

  const items: ScheduleItem[] = [];

  for (const p of (practicesRes.data ?? []) as any[]) {
    // Players see UNPUBLISHED practices too — the practice is a real
    // commitment they need to plan work and rides around, even when the
    // plan itself isn't written yet. Only the plan is gated; the slot
    // isn't.
    //
    // Tryout practices stay coach-only regardless: the pool contains kids
    // who haven't made the team, and the roster shouldn't see them.
    if (opts.playerVisibleOnly && p.is_tryout) continue;
    items.push({
      id: p.id, kind: "practice", date: p.practice_date, time: p.start_time ?? null,
      title: p.is_tryout ? "Tryout" : "Practice",
      subtitle: "", week_id: p.week_id, published: p.status === "published",
      rosterIds: p.roster_ids ?? [],
      expectedEndTime: p.expected_end_time ?? null,
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
      busTime: g.bus_time ?? null,
      homeAway: g.home_away ?? null,
      played,
      rosterIds: g.roster_id ? [g.roster_id] : [],
      trackStats: g.track_stats ?? true,
      usesScoutSheet: g.uses_scout_sheet ?? true,
      usesPlaySheet: g.uses_play_sheet ?? true,
      scoreUs: g.final_score_us ?? null,
      scoreThem: g.final_score_them ?? null,
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
    // Date range only. Falling back to the stored week_id put rows under a
    // header whose dates contradicted them — a practice on Aug 24 showing
    // inside "Aug 17 - 23". A row whose date matches no week gets its own
    // group below rather than being filed somewhere wrong.
    const w = grouped.find(g => g.start_date && g.end_date && item.date >= g.start_date && item.date <= g.end_date);
    if (w) w.items.push(item); else loose.push(item);
  }
  // Loose rows are grouped into their own weeks so they still read as
  // weeks rather than one undifferentiated pile — Sunday to Saturday, to
  // match every real week (migration 125). These were still Monday-start,
  // so a stray item sat under "Sep 21 - 27" beside a real "Sep 20 - 26".
  const looseByWeek = new Map<string, ScheduleItem[]>();
  for (const item of loose) {
    const d = new Date(item.date + "T12:00:00");
    d.setDate(d.getDate() - d.getDay());
    const key = d.toISOString().slice(0, 10);
    (looseByWeek.get(key) ?? looseByWeek.set(key, []).get(key)!).push(item);
  }
  for (const [key, list] of looseByWeek) {
    const end = new Date(key + "T12:00:00");
    end.setDate(end.getDate() + 6);
    grouped.push({ id: null, name: "", start_date: key, end_date: end.toISOString().slice(0, 10), items: list });
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

/**
 * When each practice is expected to finish.
 *
 * The coach's expected end wins when set — a plan rarely includes the
 * warm-up before it or the talk after it. Otherwise it's the start plus
 * the blocks. A practice with neither returns nothing, and shows its start
 * alone rather than inventing an end.
 *
 * Only asked for the practices actually being exported, since working out
 * the plan's length means reading every block of every one.
 */
/**
 * Who a schedule row is for, in words.
 *
 * Shared by the schedule page and its printout so they can't disagree.
 *
 * Shown only when it tells you something. Viewing every team, each row
 * names its team. Viewing one team, every row would repeat that name, so it
 * drops away and a shared practice says who ELSE is there ("With JV"). A
 * practice that isn't your team's at all — a call-up — names the team
 * you're joining, since "With Varsity" would read as a joint session.
 */
export function teamLabelFor(
  ids: string[] | undefined,
  rosters: { id: string; name: string }[],
  viewing: string | null | undefined,
): string {
  const list = ids ?? [];
  const nameOf = (id: string) => rosters.find(r => r.id === id)?.name;
  const everyTeam = rosters.length > 1 && rosters.every(r => list.includes(r.id));
  if (!viewing) {
    if (!list.length) return "Everyone";
    if (everyTeam) return "All teams";
    return list.map(nameOf).filter(Boolean).join(" + ");
  }
  if (list.length && !list.includes(viewing)) return list.map(nameOf).filter(Boolean).join(" + ");
  const others = list.filter(id => id !== viewing);
  if (!others.length) return "";
  if (everyTeam) return "All teams";
  return "With " + others.map(nameOf).filter(Boolean).join(" + ");
}

export async function getPracticeEndTimes(items: ScheduleItem[]): Promise<Record<string, string>> {
  const practices = items.filter(i => i.kind === "practice");
  const out: Record<string, string> = {};
  const needPlan = practices.filter(p => !p.expectedEndTime && p.time);
  for (const p of practices) if (p.expectedEndTime) out[p.id] = p.expectedEndTime;
  if (!needPlan.length) return out;

  const { data: blocks } = await supabase
    .from("practice_blocks").select("practice_id, duration_minutes")
    .in("practice_id", needPlan.map(p => p.id));
  const total = new Map<string, number>();
  for (const b of (blocks ?? []) as any[]) {
    total.set(b.practice_id, (total.get(b.practice_id) ?? 0) + (b.duration_minutes ?? 0));
  }
  for (const p of needPlan) {
    const mins = total.get(p.id);
    if (!mins || !p.time) continue;
    const [h, m] = p.time.split(":").map(Number);
    const end = h * 60 + m + mins;
    out[p.id] = `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}:00`;
  }
  return out;
}

export async function updateScheduleFields(item: ScheduleItem, patch: {
  date?: string; time?: string | null; location?: string | null;
  opponent?: string; home_away?: string; title?: string;
  gameday_sheet_id?: string | null;
  bus_time?: string | null;
  /** Practices only. Empty clears it, handing the end back to the plan. */
  expected_end_time?: string | null;
  /** Games only. How an untracked game gets its score. */
  final_score_us?: number | null;
  final_score_them?: number | null;
  track_stats?: boolean;
  uses_scout_sheet?: boolean;
  uses_play_sheet?: boolean;
}): Promise<{ error: string | null }> {
  const stamp = new Date().toISOString();
  // Moving a date has to move the week too. The schedule places rows by
  // date, so it looked right here — but Practice Builder lists practices
  // by their stored week, so a practice moved to next Monday stayed filed
  // under last week there.
  const weekFor = patch.date ? { week_id: await resolveWeek(patch.date, null) } : {};

  if (item.kind === "practice") {
    const { error } = await supabase.from("practices").update({
      ...(patch.date ? { practice_date: patch.date } : {}),
      ...weekFor,
      ...(patch.time !== undefined ? { start_time: patch.time } : {}),
      ...(patch.expected_end_time !== undefined ? { expected_end_time: patch.expected_end_time } : {}),
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
      ...(patch.bus_time !== undefined ? { bus_time: patch.bus_time } : {}),
      ...(patch.date ? weekFor : {}),
      ...(patch.final_score_us !== undefined ? { final_score_us: patch.final_score_us } : {}),
      ...(patch.final_score_them !== undefined ? { final_score_them: patch.final_score_them } : {}),
      ...(patch.track_stats !== undefined ? { track_stats: patch.track_stats } : {}),
      ...(patch.uses_scout_sheet !== undefined ? { uses_scout_sheet: patch.uses_scout_sheet } : {}),
      ...(patch.uses_play_sheet !== undefined ? { uses_play_sheet: patch.uses_play_sheet } : {}),
      updated_at: stamp,
    }).eq("id", item.id);
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.from("schedule_events").update({
    ...(patch.date ? { event_date: patch.date } : {}),
    ...weekFor,
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
