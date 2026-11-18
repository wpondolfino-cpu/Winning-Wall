// src/components/coach/PracticeOnePage.tsx
// The "One page" printout: the schedule down the left, the groups down
// the right, everything on one sheet so the back can hold the drill
// descriptions.
//
//  * Left: Time | Drill. Notes sit under each drill and the coach beside
//    it. A station block is one row, its stations listed inside it with
//    the letter of the group that starts there.
//  * Right: each set of groups printed once.
//      - A station that splits groups into teams gets a "teams" box: one
//        block per group, each team a column of names. Stations (even in
//        different blocks) that make the same teams share a box.
//      - Groups nobody splits print one line per group, unless a teams box
//        already shows the same people (the box title says so instead).
//      - A regular drill's groups print one line per group.
//  * Fitting: the preview tries a few left/right splits and steps the
//    type down until both columns fit one page, never below 8pt. If it
//    still won't fit, onOverflow says so and the page simply runs on.

import { useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { groupLetter, type PrintPractice, type PrintBlock } from "../../lib/practicePlanner";

const SPLITS = [52, 56, 60, 64, 68];
// 10.5pt down to 8pt, in px (1pt = 4/3px): a light practice prints
// bigger, a packed one shrinks until it fits.
const FONTS = [14, 13.67, 13.33, 13, 12.67, 12.33, 12, 11.67, 11.33, 11, 10.67];

interface Props {
  practice: PrintPractice;
  /** Page size in inches, inside the margins. */
  pageW: number;
  pageH: number;
  formatDate: (d: string) => string;
  formatClock: (t: string) => string;
  onOverflow: (practiceId: string, overflowing: boolean) => void;
}

type Station = NonNullable<PrintBlock["rotation"]>["stations"][number];

// "Group C" -> "C"; an old "Group 9" -> its letter by position;
// "At this station" -> no label; anything typed stays as typed.
function groupTag(label: string, i: number) {
  const m = /^Group ([A-Z]{1,2})$/.exec(label);
  if (m) return m[1];
  if (/^Group \d+$/.test(label)) return groupLetter(i);
  if (label === "At this station" || label === "Group") return "";
  return label;
}
const isLetter = (t: string) => /^[A-Z]{1,2}$/.test(t);
const extraLabel = (label: string | null | undefined) =>
  label && !/^station\s*\d+$/i.test(label.trim()) ? label : null;

// "3:51–4:13 PM" when both ends share AM/PM.
function shortRange(start: string, end: string) {
  const sm = /^(.*)\s(AM|PM)$/.exec(start), em = /^(.*)\s(AM|PM)$/.exec(end);
  return `${sm && em && sm[2] === em[2] ? sm[1] : start}–${end}`;
}
const clockOnly = (t: string) => t.replace(/\s(AM|PM)$/, "");

// Names never break in the middle; the gaps between them can.
const names = (list: string[]) => list.map((nm, i) => (
  <span key={i}><span style={{ whiteSpace: "nowrap" }}>{nm}{i < list.length - 1 ? "," : ""}</span>{i < list.length - 1 ? " " : ""}</span>
));

const membershipKey = (groups: { memberNames: string[] }[]) =>
  JSON.stringify(groups.map(g => [...g.memberNames].sort()));
const teamsKey = (teams: string[][][]) =>
  JSON.stringify(teams.map(parts => parts.map(pt => [...pt].sort()).sort()));

interface TeamsBox {
  kind: "teams";
  key: string;
  titles: string[];       // "3 v 3 Trail Chase"
  nums: number[];         // station numbers, for "Stations 2, 3, 4 · teams"
  stationCount: number;   // stations in the block, for "All stations · teams"
  times: string[];        // "4:18"
  alsoTimes: string[];    // other blocks using these same groups unsplit
  groups: { tag: string; sub?: string; teams: string[][] }[];
  membership: string;
}
interface LinesBox {
  kind: "lines";
  key: string;
  titles: string[];
  times: string[];
  groups: { tag: string; names: string[]; sub?: string }[];
  membership: string;
}
type Box = TeamsBox | LinesBox;

/** Every set of groups in the practice, each once, in order of first use. */
function buildBoxes(p: PrintPractice): Box[] {
  const boxes: Box[] = [];
  const unsplitRotations: { time: string; membership: string; groups: { tag: string; names: string[] }[] }[] = [];

  p.blocks.forEach(b => {
    const time = clockOnly(b.start);
    if (b.rotation) {
      const rot = b.rotation;
      const membership = membershipKey(rot.groups);
      const tags = rot.groups.map((g, i) => groupTag(g.label, i) || groupLetter(i));
      const split = rot.stations.filter(st => st.ruleText !== "keep together");
      const teamsFor = (st: Station, label: string) => st.rounds.find(rd => rd.groupLabel === label)?.parts ?? [];
      split.forEach(st => {
        const num = rot.stations.indexOf(st) + 1;
        const teams = rot.groups.map(g => teamsFor(st, g.label));
        const key = "t" + teamsKey(teams);
        const found = boxes.find(bx => bx.key === key) as TeamsBox | undefined;
        if (found) {
          if (!found.titles.includes(st.title)) found.titles.push(st.title);
          if (!found.nums.includes(num)) found.nums.push(num);
          if (!found.times.includes(time)) found.times.push(time);
          return;
        }
        boxes.push({
          kind: "teams", key, titles: [st.title], nums: [num], stationCount: rot.stations.length, times: [time], alsoTimes: [], membership,
          groups: rot.groups.map((g, i) => ({ tag: tags[i], teams: teams[i] })),
        });
      });
      if (split.length === 0) {
        unsplitRotations.push({ time, membership, groups: rot.groups.map((g, i) => ({ tag: tags[i], names: g.memberNames })) });
      }
      return;
    }
    b.segments.forEach(seg => seg.drills.forEach(d => {
      if (!d.groups.length) return;
      // Groups split into teams (e.g. 4 v 4 at each hoop): a teams box,
      // one block per group headed by its place or letter.
      if (d.groups.some(g => g.teams && g.teams.length > 1)) {
        const t = extraLabel(d.label) ? `${d.title} · ${extraLabel(d.label)}` : d.title;
        const teams = d.groups.map(g => g.teams && g.teams.length > 1 ? g.teams : [g.memberNames]);
        const key = "g" + teamsKey(teams);
        const found = boxes.find(bx => bx.key === key) as TeamsBox | undefined;
        if (found) { if (!found.times.includes(time)) found.times.push(time); return; }
        boxes.push({
          kind: "teams", key, titles: [t], nums: [], stationCount: 0, times: [time], alsoTimes: [], membership: membershipKey(d.groups),
          groups: d.groups.map((g, i) => ({
            tag: g.place || groupTag(g.label, i) || groupLetter(i),
            sub: [g.place ? groupTag(g.label, i) : "", g.coachNames?.length ? g.coachNames.join(" & ") : ""].filter(Boolean).join(" · ") || undefined,
            teams: teams[i],
          })),
        });
        return;
      }
      const membership = membershipKey(d.groups);
      const key = "l" + membership;
      const found = boxes.find(bx => bx.key === key) as LinesBox | undefined;
      if (found) {
        const t = extraLabel(d.label) ? `${d.title} · ${extraLabel(d.label)}` : d.title;
        if (!found.titles.includes(t)) found.titles.push(t);
        if (!found.times.includes(time)) found.times.push(time);
        return;
      }
      boxes.push({
        // "4 v 4 Shell · Hoop 1" when the drill runs at more than one spot.
        kind: "lines", key, titles: [extraLabel(d.label) ? `${d.title} · ${extraLabel(d.label)}` : d.title], times: [time], membership,
        groups: d.groups.map((g, i) => ({
          tag: groupTag(g.label, i),
          names: g.memberNames,
          sub: [g.place, g.coachNames?.length ? `Coach ${g.coachNames.join(" & ")}` : ""].filter(Boolean).join(" · ") || undefined,
        })),
      });
    }));
  });

  // Rotation groups nobody splits: if a teams box already shows the same
  // people, point there instead of printing them twice.
  unsplitRotations.forEach(u => {
    const teamsBox = boxes.find(bx => bx.kind === "teams" && bx.membership === u.membership) as TeamsBox | undefined;
    if (teamsBox) {
      if (!teamsBox.alsoTimes.includes(u.time) && !teamsBox.times.includes(u.time)) teamsBox.alsoTimes.push(u.time);
      return;
    }
    const key = "r" + u.membership;
    const found = boxes.find(bx => bx.key === key) as LinesBox | undefined;
    if (found) { if (!found.times.includes(u.time)) found.times.push(u.time); return; }
    boxes.push({ kind: "lines", key, titles: ["Station groups"], times: [u.time], membership: u.membership, groups: u.groups });
  });
  return boxes;
}

export default function PracticeOnePage({ practice: p, pageW, pageH, formatDate, formatClock, onOverflow }: Props) {
  const boxes = buildBoxes(p);
  const [fit, setFit] = useState({ split: 56, font: FONTS[0] });
  const pageRef = useRef<HTMLDivElement | null>(null);
  const inchRef = useRef<HTMLDivElement | null>(null);

  // Find the split and type size that fit one page.
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const run = () => {
      const pxPerIn = inchRef.current?.offsetWidth || 96;
      const limit = pageH * pxPerIn - 0.15 * pxPerIn;
      const cols = page.querySelector<HTMLElement>("[data-cols]")!;
      const right = page.querySelector<HTMLElement>("[data-right]")!;
      // Height of the page at this size and split; a split where team
      // columns spill past the right edge doesn't count as fitting.
      const try1 = (font: number, split: number) => {
        page.style.fontSize = `${font}px`;
        cols.style.gridTemplateColumns = `${split}% minmax(0, 1fr)`;
        const h = page.getBoundingClientRect().height;
        return right.scrollWidth > right.clientWidth + 1 ? h + 100000 : h;
      };
      let best = { split: SPLITS[1], font: FONTS[FONTS.length - 1], h: Infinity };
      outer: for (const font of FONTS) {
        let bestHere = { split: SPLITS[1], h: Infinity };
        for (const split of SPLITS) {
          const h = try1(font, split);
          if (h < bestHere.h - 0.5) bestHere = { split, h };
        }
        best = { split: bestHere.split, font, h: bestHere.h };
        if (bestHere.h <= limit) break outer;
      }
      try1(best.font, best.split);
      setFit(prev => prev.font === best.font && prev.split === best.split ? prev : { font: best.font, split: best.split });
      onOverflow(p.id, best.h > limit);
    };
    run();
    // Fonts can finish loading after the first pass.
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  const muted = "#555";
  const cell: CSSProperties = { border: "1px solid #888", padding: "0.25em 0.4em", verticalAlign: "top" };
  const sub: CSSProperties = { color: muted, fontSize: "0.88em" };
  const badge = (t: string) => (
    <span style={{ display: "inline-block", minWidth: "1.2em", textAlign: "center", fontWeight: 700, border: "1px solid #333", borderRadius: 3, padding: "0 0.2em", lineHeight: 1.2 }}>{t}</span>
  );
  const coachCell = (list: string[]) => list.length
    ? list.map((c, i) => <div key={i} style={{ whiteSpace: "nowrap" }}>{c}</div>)
    : <span style={{ color: "#999" }}>—</span>;
  const notesCell = (t: string | null | undefined) => t
    ? <div style={{ whiteSpace: "pre-wrap" }}>{t}</div>
    : <span style={{ color: "#999" }}>—</span>;

  // The block's time, small, so its column can be narrow. It spans every
  // row of the block (each station or drill gets its own row so its notes
  // and coach line up with it).
  const timeCell = (b: PrintBlock, rows: number) => (
    <td rowSpan={rows} style={{ ...cell, fontSize: "0.78em", fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap" }}>
      <span style={{ whiteSpace: "nowrap" }}>{shortRange(b.start, b.end)}</span>
      {b.rotation && <div style={{ fontWeight: 400, color: muted }}>{Math.round(b.duration_minutes / Math.max(1, b.rotation.grid.length))} min each</div>}
      {b.water_break && <div style={{ color: "#1f6fb2" }}>💧 Water</div>}
    </td>
  );

  const blockRows = (b: PrintBlock, bi: number): ReactNode[] => {
    const shade = b.rotation ? "#f1f1f1" : undefined;
    if (b.rotation) {
      const rot = b.rotation;
      const drills = b.segments[0]?.drills ?? [];
      const seen = new Set<string>();
      const startAt = (rot.grid[0] ?? []).map(l => { if (seen.has(l)) return null; seen.add(l); return l; });
      const waiting = rot.groups.slice(rot.stations.length).map((g, i) => groupTag(g.label, rot.stations.length + i));
      const n = rot.stations.length;
      return rot.stations.map((st, si) => {
        const d = drills[si];
        return (
          <tr key={`${bi}-${si}`} style={{ background: shade }}>
            {si === 0 && timeCell(b, n)}
            <td style={cell}>
              <div style={{ display: "grid", gridTemplateColumns: "0.9em minmax(0, 1fr) auto", gap: "0 0.35em" }}>
                <span style={{ color: muted }}>{si + 1}</span>
                <div>
                  <span style={{ fontWeight: 700 }}>{st.title}</span>{st.film ? " 🎥" : ""}
                  {(st.ruleText !== "keep together" || extraLabel(d?.label)) && (
                    <div style={sub}>{[st.ruleText !== "keep together" ? st.ruleText : "", extraLabel(d?.label)].filter(Boolean).join(" · ")}</div>
                  )}
                  {si === n - 1 && waiting.length > 0 && <div style={sub}>{waiting.join(", ")} start{waiting.length === 1 ? "s" : ""} waiting; after station {n}, wait your turn</div>}
                </div>
                <div>{startAt[si] ? badge(startAt[si]!) : null}</div>
              </div>
            </td>
            <td style={cell}>{notesCell(d?.goal_text)}</td>
            <td style={cell}>{coachCell(st.coachNames)}</td>
          </tr>
        );
      });
    }
    const all = b.segments.flatMap(seg => seg.drills.map(d => ({ seg, d })));
    if (all.length === 0) return [<tr key={bi}>{timeCell(b, 1)}<td style={cell} colSpan={3}></td></tr>];
    return all.map(({ seg, d }, i) => {
      const letters = d.groups.map((g, gi) => groupTag(g.label, gi)).filter(isLetter);
      const groupNote = letters.length > 1 ? `groups ${letters[0]}–${letters[letters.length - 1]}`
        : letters.length === 1 ? `group ${letters[0]}`
        : d.groups.length && d.groups.every(g => /^Team \d+$/.test(g.label)) ? `${d.groups.length} teams`
        : d.groups.length ? `${d.groups.length} group${d.groups.length === 1 ? "" : "s"}` : "";
      const subLine = [groupNote, extraLabel(d.label), seg.rosterName].filter(Boolean).join(" · ");
      return (
        <tr key={`${bi}-${i}`}>
          {i === 0 && timeCell(b, all.length)}
          <td style={cell}>
            <span style={{ fontWeight: 700 }}>{d.title}</span>{d.film ? " 🎥" : ""}
            {subLine && <div style={sub}>{subLine}</div>}
          </td>
          <td style={cell}>{notesCell(d.goal_text)}</td>
          <td style={cell}>{coachCell(d.coachNames.length ? d.coachNames
            // No drill coach: the groups' coaches, with where each one is.
            : d.groups.flatMap((g, gi) => (g.coachNames ?? []).map(c => `${c} (${g.place || groupTag(g.label, gi) || gi + 1})`)))}</td>
        </tr>
      );
    });
  };

  const boxTitle = (bx: Box) => {
    // One drill: its name. Several stations sharing the same teams: "Station teams".
    const title = bx.kind === "teams"
      ? (bx.nums.length === 0 ? `${bx.titles[0]} · teams`
        : bx.titles.length === 1 ? `${bx.nums[0]} · ${bx.titles[0]} · teams` : (bx.nums.length === bx.stationCount && bx.times.length === 1 ? "All stations · teams" : `Stations ${bx.nums.sort((x, y) => x - y).join(", ")} · teams`))
      : bx.titles.join(", ");
    const when = [bx.times.join(", "), bx.kind === "teams" && bx.alsoTimes.length ? `same groups as ${bx.alsoTimes.join(", ")}` : ""].filter(Boolean).join(" · ");
    return (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 0.6em", fontWeight: 700, borderBottom: "1.5px solid #111", paddingBottom: 1, marginBottom: "0.3em" }}>
        <span style={{ flex: "1 1 auto" }}>{title}</span>
        <span style={{ fontWeight: 400, color: muted, marginLeft: "auto" }}>{when}</span>
      </div>
    );
  };

  // Teams: small teams (4 or fewer) print as labeled columns, so groups
  // can sit side by side; bigger teams print one line per team, which is
  // much shorter than a tall column. Each group takes only the width it
  // needs, so groups pair up whenever they fit.
  const teamsBody = (bx: TeamsBox) => {
    const biggest = Math.max(0, ...bx.groups.flatMap(g => g.teams.map(t => t.length)));
    if (biggest > 4) {
      return (
        <div>
          {bx.groups.map((g, gi) => (
            <div key={gi} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "0 0.45em", marginBottom: "0.25em", breakInside: "avoid" }}>
              <b>{g.tag}</b>
              <div>
                {g.sub && <div style={sub}>{g.sub}</div>}
                {g.teams.map((team, ti) => (
                  <div key={ti} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "0 0.35em" }}>
                    <span style={{ color: muted }}>{ti + 1} ·</span>
                    <span>{names(team)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45em 1.1em" }}>
        {bx.groups.map((g, gi) => (
          <div key={gi} style={{ display: "flex", gap: "0.4em", breakInside: "avoid" }}>
            <div><b style={{ whiteSpace: "nowrap" }}>{g.tag}</b>{g.sub && <div style={{ ...sub, whiteSpace: "nowrap" }}>{g.sub}</div>}</div>
            <div style={{ display: "flex", borderBottom: "0.5px solid #999" }}>
              {g.teams.map((team, ti) => (
                <div key={ti} style={{ padding: ti ? "0 0.45em" : "0 0.45em 0 0", borderLeft: ti ? "1.5px solid #777" : "none" }}>
                  <div style={{ color: muted, fontSize: "0.8em", borderBottom: "0.5px solid #bbb", marginBottom: 1, whiteSpace: "nowrap" }}>Team {ti + 1}</div>
                  {team.map((nm, ni) => <div key={ni} style={{ whiteSpace: "nowrap" }}>{nm}</div>)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const linesBody = (bx: LinesBox) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 24ch), 1fr))", gap: "0.15em 0.9em" }}>
      {bx.groups.map((g, gi) => (
        <div key={gi} style={{ display: "grid", gridTemplateColumns: g.tag ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)", gap: "0 0.4em" }}>
          {g.tag && <b>{g.tag}</b>}
          <div>
            {g.sub && <div style={sub}>{g.sub}</div>}
            {g.names.length ? names(g.names) : <span style={sub}>(empty)</span>}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div ref={pageRef} style={{ fontSize: fit.font, lineHeight: 1.3, color: "#111", fontFamily: "Georgia, serif", width: `${pageW}in`, maxWidth: "100%" }}>
      <div ref={inchRef} aria-hidden style={{ position: "absolute", visibility: "hidden", width: "1in", height: 0 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "2.5px solid #111", paddingBottom: "0.2em", marginBottom: "0.5em" }}>
        <div style={{ fontSize: "1.55em", fontWeight: 700 }}>{formatDate(p.practice_date)}</div>
        <div style={{ color: "#444" }}>{formatClock(p.start_time)} · {p.rosterNames.join(", ") || "No team set"}</div>
      </div>

      <div data-cols style={{ display: "grid", gridTemplateColumns: `${fit.split}% minmax(0, 1fr)`, gap: "0 1em", alignItems: "start" }}>
        {/* Auto layout: Time and Coach shrink to exactly their widest
            entry (whatever the font), Drill gets about a third, Notes the rest. */}
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto", fontSize: "inherit" }}>
          <colgroup>
            <col style={{ width: "1%" }} />
            <col style={{ width: "36%" }} />
            <col />
            <col style={{ width: "1%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: "left", fontSize: "0.78em" }}>Time</th>
              <th style={{ ...cell, textAlign: "left" }}>Drill</th>
              <th style={{ ...cell, textAlign: "left" }}>Notes</th>
              <th style={{ ...cell, textAlign: "left" }}>Coach</th>
            </tr>
          </thead>
          <tbody>
            {p.blocks.flatMap((b, bi) => blockRows(b, bi))}
            {p.blocks.length === 0 && <tr><td colSpan={4} style={{ ...cell, color: "#888" }}>No drills scheduled yet.</td></tr>}
          </tbody>
        </table>

        <div data-right style={{ minWidth: 0 }}>
          {boxes.map(bx => (
            <div key={bx.key} style={{ marginBottom: "0.8em", breakInside: "avoid" }}>
              {boxTitle(bx)}
              {bx.kind === "teams" ? teamsBody(bx) : linesBody(bx)}
            </div>
          ))}
          {boxes.length === 0 && <div style={{ color: "#888" }}>No groups in this practice.</div>}
        </div>
      </div>
    </div>
  );
}
