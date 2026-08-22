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
export function parsePastedTable(raw: string, seasonStartYear: number): ImportRow[] {
  return raw.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const cols = line.split(/\t|\s{2,}/).map(c => c.trim());
    const dt = cols[0] ?? "";
    const m = dt.match(/^(\w{3})[a-z]*\.?\s+(\w{3})[a-z]*\.?\s+(\d{1,2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);

    const row: ImportRow = {
      date: null, time: null,
      opponent: cols[2] ?? "",
      location: cols[3] || null,
      home_away: (cols[1] ?? "").trim() === "@" ? "away" : (cols[1] ?? "").trim().toLowerCase() === "vs" ? "home" : "neutral",
      game_type: (cols[4] ?? "").trim().toUpperCase() === "T" ? "tournament" : "regular",
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
export async function reconcile(rows: ImportRow[], season: string): Promise<ImportRow[]> {
  const { data } = await supabase
    .from("games").select("id, opponent, game_date, tip_time, external_uid").eq("season", season);
  const existing = (data ?? []) as any[];

  return rows.map(r => {
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
export async function commitImport(rows: ImportRow[], season: string, seasonId: string | null, userId: string) {
  let created = 0, updated = 0;
  for (const r of rows) {
    if (r.status === "problem" || r.status === "unchanged" || !r.date) continue;
    const weekId = await resolveWeek(r.date, seasonId);
    const payload = {
      opponent: r.opponent, game_date: r.date, tip_time: r.time,
      location: r.location, home_away: r.home_away, game_type: r.game_type,
      week_id: weekId, external_uid: r.external_uid, season,
    };
    if (r.existingId) {
      await supabase.from("games").update(payload).eq("id", r.existingId);
      updated++;
    } else {
      await supabase.from("games").insert({ ...payload, created_by: userId });
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
