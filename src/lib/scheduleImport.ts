// scheduleImport.ts — parsing for the two import paths.
//
// Two parsers, ONE review-and-commit path. Whether rows arrive as pasted
// table text or as iCal, they become the same ImportRow[] and go through
// the same preview. Nothing is written until the coach presses Import.
//
// Deliberately NOT a PDF parser. A misread date sends a kid to the wrong
// gym, and silent wrong data in a schedule is worse than an empty one.
// Pasted table text and iCal are both structured enough to fail loudly.

import { supabase } from "./supabase";
import { createGame, seasonForDate, defaultGameFeatures } from "./gameStats";
import { resolveWeek } from "./schedule";

export interface ImportRow {
  date: string | null;        // ISO
  time: string | null;        // HH:MM
  opponent: string;
  location: string | null;
  home_away: "home" | "away" | "neutral";
  game_type: string;
  external_uid: string | null;
  /** "new" | "unchanged" | "moved" | "problem" — decided against what's already in the database. */
  status: string;
  /** Which opponent this will link to, decided during reconcile. */
  opponentId?: string | null;
  /** The name of that opponent, so the preview can show what you'll get. */
  opponentMatch?: string | null;
  note: string | null;
  existingId?: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A season spans New Year's, so a schedule row reading "Dec 15" and one
 * reading "Jan 8" belong to different calendar years. Anything from August
 * onwards is the earlier year.
 */
function inferYear(month: number, seasonStartYear: number): number {
  return month >= 7 ? seasonStartYear : seasonStartYear + 1;
}

/**
 * Parses table text copied straight off a schedule page.
 *
 * Browsers copy an HTML table as tab-separated text, so the columns arrive
 * intact. Expected shape, matching what a public schedule page produces:
 *   Date/Time  |  @ or vs  |  Opponent  |  Location  |  Type
 */
const DATE_START = /^(\w{3})[a-z]*\.?\s+(\w{3})[a-z]*\.?\s+(\d{1,2})\b/i;

/**
 * Gathers the lines of a paste into one record per game.
 *
 * A browser copying an HTML table gives one tab-separated line per row,
 * but plenty of schedule pages are built from stacked blocks, and those
 * paste as several lines per game:
 *
 *   Tue Dec 15 6:30 PM
 *   @
 *   Foxborough High School
 *
 * Read line by line, that's a row with a date and no opponent — which is
 * what every row in such a paste used to report. A line beginning with a
 * weekday and date starts a new game; everything after it belongs to that
 * game until the next one starts.
 *
 * A single-line paste still comes out as one record, because the first
 * line is a date line and no others follow it, so both shapes work.
 */
function toRecords(raw: string): string[][] {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const records: string[][] = [];
  for (const line of lines) {
    // A tab-separated line is already a whole row.
    const parts = line.split(/\t|\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (DATE_START.test(line)) { records.push(parts); continue; }
    if (!records.length) { records.push(parts); continue; }
    records[records.length - 1].push(...parts);
  }
  return records;
}

export function parsePastedTable(raw: string, seasonStartYear: number): ImportRow[] {
  return toRecords(raw).map(cols => {
    const line = cols.join(" ");
    const dt = cols[0] ?? "";
    const m = (dt.match(DATE_START) ? dt : line).match(/^(\w{3})[a-z]*\.?\s+(\w{3})[a-z]*\.?\s+(\d{1,2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);

    // Everything after the date, read by what it looks like rather than by
    // position: a stacked paste puts "@" on its own line, and a tab-copied
    // table puts it in the second column.
    const rest = cols.slice(1);
    const marker = rest.find(c => /^(@|at|vs\.?|home|away)$/i.test(c)) ?? "";
    const isType = (c: string) => /^[TN]$/i.test(c);
    const words = rest.filter(c => c !== marker && !isType(c));

    const row: ImportRow = {
      date: null, time: null,
      opponent: words[0] ?? "",
      location: words[1] || null,
      home_away: /^(@|at|away)$/i.test(marker) ? "away" : /^(vs\.?|home)$/i.test(marker) ? "home" : "neutral",
      game_type: rest.some(c => c.trim().toUpperCase() === "T") ? "tournament" : "regular",
      external_uid: null,
      status: "new", note: null,
    };

    if (!m) { row.status = "problem"; row.note = "couldn't read the date"; return row; }

    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month === undefined) { row.status = "problem"; row.note = "couldn't read the month"; return row; }
    const year = inferYear(month, seasonStartYear);
    const d = new Date(year, month, parseInt(m[3], 10));
    row.date = iso(d);

    // The weekday in the source is a free checksum on the inferred year:
    // if the name doesn't match the date, the year guess was wrong.
    if (DAYS[d.getDay()].toLowerCase() !== m[1].slice(0, 3).toLowerCase()) {
      row.status = "problem";
      row.note = `${m[1]} isn't a ${DAYS[d.getDay()]} in ${year} — check the year`;
      return row;
    }

    if (m[4]) {
      let h = parseInt(m[4], 10) % 12;
      if (m[6].toUpperCase() === "PM") h += 12;
      row.time = `${String(h).padStart(2, "0")}:${m[5]}`;
    } else {
      row.note = "no tip time";
    }
    if (!row.opponent) { row.status = "problem"; row.note = "no opponent"; }
    return row;
  });
}

/** Parses an iCal feed. Only VEVENTs with a date are taken; everything else is skipped rather than guessed at. */
export function parseICal(raw: string): ImportRow[] {
  // Unfold continuation lines first — iCal wraps long values onto lines
  // beginning with a space, and a wrapped SUMMARY would otherwise lose
  // half the opponent's name.
  const text = raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  return blocks.map(block => {
    const get = (k: string) => {
      const m = block.match(new RegExp("^" + k + "[^:]*:(.*)$", "m"));
      return m ? m[1].trim() : null;
    };
    const dtRaw = get("DTSTART");
    const summary = get("SUMMARY") ?? "";
    const row: ImportRow = {
      date: null, time: null,
      opponent: summary.replace(/^\s*(vs\.?|@|at)\s+/i, "").trim(),
      location: get("LOCATION"),
      home_away: /^\s*(@|at)\s/i.test(summary) ? "away" : /^\s*vs/i.test(summary) ? "home" : "neutral",
      game_type: "regular",
      external_uid: get("UID"),
      status: "new", note: null,
    };
    if (!dtRaw) { row.status = "problem"; row.note = "no start date"; return row; }
    const m = dtRaw.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) { row.status = "problem"; row.note = "couldn't read the start date"; return row; }
    row.date = `${m[1]}-${m[2]}-${m[3]}`;
    if (m[4]) row.time = `${m[4]}:${m[5]}`; else row.note = "no tip time";
    if (!row.opponent) { row.status = "problem"; row.note = "no opponent in the summary"; }
    return row;
  });
}

/**
 * Compares parsed rows against what's already in the database.
 *
 * This is what makes a SECOND import safe. Schedules change all season —
 * without reconciliation, re-pasting doubles the schedule and the feature
 * dies in December. Matching is on external_uid where a feed provides one,
 * otherwise on opponent plus a nearby date, since a moved game keeps its
 * opponent but not its date.
 */
/**
 * Loose comparison of two opponent names.
 *
 * "Foxborough High School", "Foxborough HS" and "foxborough" are the same
 * school written three ways, and a schedule page rarely writes it the way
 * you did. Case, punctuation and the school-type words come off before
 * comparing.
 *
 * Deliberately NOT fuzzy beyond that: "Foxboro" and "Foxborough" are
 * different strings, and a rule loose enough to join them would also join
 * two genuinely different schools. The preview shows which opponent each
 * row will link to so that case is caught by eye.
 */
function normaliseOpponent(name: string): string {
  return name.toLowerCase()
    .replace(/[.,'"]/g, "")
    .replace(/\b(high school|high|hs|school|academy|regional|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function reconcile(rows: ImportRow[], season: string): Promise<ImportRow[]> {
  const [{ data }, { data: opps }] = await Promise.all([
    supabase.from("games").select("id, opponent, game_date, tip_time, external_uid").eq("season", season),
    supabase.from("opponents").select("id, name"),
  ]);
  const existing = (data ?? []) as any[];
  const opponents = (opps ?? []) as { id: string; name: string }[];

  return rows.map(r => {
    // Which opponent this row will link to — shown in the preview, because
    // a schedule page writing "Foxboro" where your list says "Foxborough"
    // is only catchable by eye.
    const match = opponents.find(o => normaliseOpponent(o.name) === normaliseOpponent(r.opponent));
    r = { ...r, opponentId: match?.id ?? null, opponentMatch: match?.name ?? null };
    if (r.status === "problem") return r;
    const byUid = r.external_uid ? existing.find(g => g.external_uid === r.external_uid) : null;
    const byName = byUid ?? existing.find(g =>
      g.opponent.trim().toLowerCase() === r.opponent.trim().toLowerCase() &&
      Math.abs(daysBetween(g.game_date, r.date!)) <= 21
    );
    if (!byName) return { ...r, status: "new" };

    const sameDate = byName.game_date === r.date;
    const sameTime = (byName.tip_time ?? "").slice(0, 5) === (r.time ?? "");
    if (sameDate && sameTime) return { ...r, status: "unchanged", existingId: byName.id };
    return {
      ...r, status: "moved", existingId: byName.id,
      note: sameDate ? `time was ${(byName.tip_time ?? "—").slice(0, 5)}` : `was ${byName.game_date}`,
    };
  });
}

/** Writes only rows the coach can see and has approved. Weeks are created from dates as needed. */
export async function commitImport(rows: ImportRow[], season: string, seasonId: string | null, userId: string, rosterId?: string | null) {
  let created = 0, updated = 0;
  const features = await defaultGameFeatures(rosterId ?? null);
  for (const r of rows) {
    if (r.status === "problem" || r.status === "unchanged" || !r.date) continue;
    if (r.existingId) {
      // The season follows the game's date, not the label passed in — that
      // label is the practice season's name ("2025-26"), a different format
      // from the one reports group games by.
      const weekId = await resolveWeek(r.date, seasonId);
      await supabase.from("games").update({
        opponent: r.opponent, game_date: r.date, tip_time: r.time,
        location: r.location, home_away: r.home_away, game_type: r.game_type,
        week_id: weekId, external_uid: r.external_uid, season: seasonForDate(r.date),
        ...(rosterId ? { roster_id: rosterId } : {}),
      }).eq("id", r.existingId);
      updated++;
    } else {
      // An opponent the list doesn't have yet is created, so the game is
      // linked from the start — an imported game used to carry the name as
      // text only, which meant a scout sheet for that opponent could never
      // find it.
      let oppId = r.opponentId ?? null;
      if (!oppId) {
        const { data: made } = await supabase.from("opponents")
          .insert({ name: r.opponent.trim(), created_by: userId }).select("id").single();
        oppId = (made as any)?.id ?? null;
      }
      await createGame({
        opponent: r.opponent, opponent_id: oppId, game_date: r.date, tip_time: r.time,
        location: r.location, home_away: r.home_away ?? "home", game_type: r.game_type ?? "regular",
        external_uid: r.external_uid,
        roster_id: rosterId ?? null,
        // A freshman schedule arrives set up like the rest of their games,
        // rather than every imported game turning up tracked.
        ...features,
      });
      created++;
    }
  }
  return { created, updated };
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(a: string, b: string) {
  return (new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}
