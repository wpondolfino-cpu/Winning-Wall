// src/lib/practicePaste.ts
// Turns a practice plan pasted from a doc (Google Docs, Word, Notes...)
// into blocks. Read on the device by simple rules, no AI:
//
//   * A line starting with a time ("6:05- Kings drill") starts a block.
//     Its length is the gap to the next time line.
//   * Text after the first " - " on that line, and every line under it
//     without a time, go into the block's notes.
//   * "Water" on its own becomes the water marker on the block before it.
//   * "End" / "Done" on its own just marks when the last block finishes.
//   * A line under a block that starts with a team's name ("JV- Fundamental
//     work") splits the block into team columns. A team named in the block's
//     own line ("...with just Varsity") puts that drill in that team's column.
//   * Lines above the first time: a date ("12/2") fills in the date and
//     "tryout" marks it a tryout practice. Anything else becomes a block with
//     no time that the coach gives a length to, or leaves out.

export interface PastePart {
  /** null = everyone (one combined column). */
  rosterId: string | null;
  title: string;
  notes: string;
}

export interface PasteRow {
  key: string;
  /** Minutes after midnight, from the pasted time. null = no time given. */
  startMin: number | null;
  /** null = unknown: the last block, or a line with no time. */
  minutes: number | null;
  water: boolean;
  parts: PastePart[];
}

export interface PastedPlan {
  /** yyyy-mm-dd if the text named one. */
  date: string | null;
  isTryout: boolean;
  /** "HH:MM" (24h) from the first time line. */
  startTime: string | null;
  rows: PasteRow[];
}

const TIME_LINE = /^(\d{1,2}):(\d{2})\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?=$|[\s\-–—:.)])\s*[-–—:.)]?\s*(.*)$/i;
const SPLIT = /\s*[-–—]\s+|\s+[-–—]\s*/;
const END = /^(end|done|finish|finished|dismiss|dismissed|out|over|end of practice)\b[\s!.]*$/i;
const WATER = /^(water|water break|get water|drink|hydrate)\b[\s!.]*$/i;

function cleanLine(raw: string): string {
  return raw.replace(/ /g, " ").replace(/^\s*(?:[-–—•*▪◦·]|\d+[.)])\s+/, "").trim();
}
const stripDashes = (s: string) => s.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "").trim();

/** Words a team can be called in a plan: its full name, and its last word ("Girls JV" -> "JV") when no other team shares it. */
function teamKeys(rosters: { id: string; name: string }[]): { id: string; key: string }[] {
  const out: { id: string; key: string }[] = [];
  const last = (n: string) => n.trim().split(/\s+/).pop() ?? "";
  for (const r of rosters) {
    out.push({ id: r.id, key: r.name.trim() });
    const l = last(r.name);
    if (l.length >= 2 && l.toLowerCase() !== r.name.trim().toLowerCase()
        && rosters.filter(o => last(o.name).toLowerCase() === l.toLowerCase()).length === 1) out.push({ id: r.id, key: l });
  }
  return out.sort((a, b) => b.key.length - a.key.length);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param rosters the teams this practice is for. Team columns are only
 *   made when there's more than one.
 * @param today used to pick the year for a date like "12/2".
 */
export function parsePastedPlan(text: string, rosters: { id: string; name: string }[], today = new Date()): PastedPlan {
  const lines = text.split(/\r?\n/).map(cleanLine).filter(l => l.length > 0);
  const keys = rosters.length > 1 ? teamKeys(rosters) : [];
  const teamAtStart = (l: string) => {
    for (const k of keys) {
      const m = l.match(new RegExp(`^${esc(k.key)}\\b\\s*(?:[-–—:]\\s*)?(.*)$`, "i"));
      if (m) return { id: k.id, rest: stripDashes(m[1]) };
    }
    return null;
  };
  const teamMentioned = (l: string) => {
    for (const k of keys) if (new RegExp(`\\b${esc(k.key)}\\b`, "i").test(l)) return k.id;
    return null;
  };

  let date: string | null = null;
  let isTryout = false;
  let n = 0;
  const rows: (PasteRow & { _lastPart: PastePart; _hasTeamLine: boolean })[] = [];
  let prevMin: number | null = null;

  for (const line of lines) {
    const tm = line.match(TIME_LINE);
    if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59) {
      // Not a time line.
      if (rows.length === 0 || rows.every(r => r.startMin === null)) {
        // Above the first time.
        const d = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (/tryout/i.test(line)) isTryout = true;
        if (d && !date) {
          const mo = Number(d[1]), da = Number(d[2]);
          if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
            let yr = d[3] ? Number(d[3].length === 2 ? "20" + d[3] : d[3]) : today.getFullYear();
            if (!d[3]) {
              // "12/2" in late November is this year; "1/5" in December is next year.
              const guess = new Date(yr, mo - 1, da);
              if (guess.getTime() < today.getTime() - 60 * 86400000) yr += 1;
            }
            date = `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
          }
        }
        // The title line ("Tryout 12/2", "Practice 1/5") isn't a block.
        if (d) continue;
        if (/^tryouts?\b/i.test(line) && line.length < 30) continue;
        const part: PastePart = { rosterId: null, title: stripDashes(line), notes: "" };
        rows.push({ key: `r${n++}`, startMin: null, minutes: null, water: false, parts: [part], _lastPart: part, _hasTeamLine: false });
        continue;
      }
      // Under a block.
      const row = rows[rows.length - 1];
      const team = teamAtStart(line);
      if (team) {
        const part: PastePart = { rosterId: team.id, title: team.rest || "—", notes: "" };
        row.parts.push(part); row._lastPart = part; row._hasTeamLine = true;
      } else {
        row._lastPart.notes = row._lastPart.notes ? `${row._lastPart.notes}\n${line}` : line;
      }
      continue;
    }

    // A time line.
    let h = Number(tm[1]);
    const mins = Number(tm[2]);
    const ampm = (tm[3] ?? "").toLowerCase().replace(/[^ap]/g, "");
    if (ampm === "p" && h < 12) h += 12;
    if (ampm === "a" && h === 12) h = 0;
    let at = h * 60 + mins;
    if (prevMin === null) {
      // No am/pm: 1:00–9:59 is an afternoon or evening practice; change it on the next screen if not.
      if (!ampm && h >= 1 && h <= 9) at += 12 * 60;
    } else {
      while (at < prevMin) at += 12 * 60;
    }
    prevMin = at;

    const rest = stripDashes(tm[4] ?? "");
    const bits = rest.split(SPLIT).map(stripDashes).filter(Boolean);
    const title = bits[0] ?? "";
    const notes = bits.slice(1).join(" - ");
    if (END.test(title) && !notes) {
      // "7:30 End": only marks when the last block finishes.
      rows.push({ key: `e${n++}`, startMin: at, minutes: 0, water: false, parts: [], _lastPart: { rosterId: null, title: "", notes: "" }, _hasTeamLine: false });
      continue;
    }
    if (WATER.test(title) && !notes) {
      // Water: the marker on the block before. Its minutes aren't a block.
      const before = rows[rows.length - 1];
      if (before) before.water = true;
      rows.push({ key: `w${n++}`, startMin: at, minutes: 0, water: true, parts: [], _lastPart: { rosterId: null, title: "", notes: "" }, _hasTeamLine: false });
      continue;
    }
    const part: PastePart = { rosterId: teamMentioned(rest), title: title || "Untitled", notes };
    rows.push({ key: `r${n++}`, startMin: at, minutes: null, water: false, parts: [part], _lastPart: part, _hasTeamLine: false });
  }

  // Lengths: gap to the next time line (water lines included, so the
  // block before water ends when water starts).
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.startMin === null || r.parts.length === 0) continue;
    const next = rows.slice(i + 1).find(x => x.startMin !== null);
    r.minutes = next && next.startMin! > r.startMin ? next.startMin! - r.startMin : null;
  }

  // Team columns: when a block has a team line, the block's own drill goes
  // to the team its line names, or to the teams that don't have a line.
  for (const r of rows) {
    if (!r._hasTeamLine) continue;
    const main = r.parts[0];
    if (main.rosterId) continue;
    const covered = new Set(r.parts.slice(1).map(p => p.rosterId));
    const rest = rosters.filter(t => !covered.has(t.id));
    if (rest.length === 1) main.rosterId = rest[0].id;
    else if (rest.length > 1) r.parts.splice(0, 1, ...rest.map(t => ({ ...main, rosterId: t.id })));
    else r.parts.shift();
  }

  const firstTimed = rows.find(r => r.startMin !== null);
  const startTime = firstTimed ? `${String(Math.floor(firstTimed.startMin! / 60) % 24).padStart(2, "0")}:${String(firstTimed.startMin! % 60).padStart(2, "0")}` : null;

  return {
    date, isTryout, startTime,
    rows: rows.filter(r => r.parts.length > 0).map(({ _lastPart, _hasTeamLine, ...r }) => r),
  };
}
