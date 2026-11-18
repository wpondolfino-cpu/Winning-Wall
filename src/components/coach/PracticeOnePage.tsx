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

const SPLITS = [52, 56, 60, 64];
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
  times: string[];        // "4:18"
  alsoTimes: string[];    // other blocks using these same groups unsplit
  groups: { tag: string; teams: string[][] }[];
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
        const teams = rot.groups.map(g => teamsFor(st, g.label));
        const key = "t" + teamsKey(teams);
        const found = boxes.find(bx => bx.key === key) as TeamsBox | undefined;
        if (found) {
          if (!found.titles.includes(st.title)) found.titles.push(st.title);
          if (!found.times.includes(time)) found.times.push(time);
          return;
        }
        boxes.push({
          kind: "teams", key, titles: [st.title], times: [time], alsoTimes: [], membership,
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
      const membership = membershipKey(d.groups);
      const key = "l" + membership;
      const found = boxes.find(bx => bx.key === key) as LinesBox | undefined;
      if (found) {
        if (!found.titles.includes(d.title)) found.titles.push(d.title);
        if (!found.times.includes(time)) found.times.push(time);
        return;
      }
      boxes.push({
        kind: "lines", key, titles: [d.title], times: [time], membership,
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
      const try1 = (font: number, split: number) => {
        page.style.fontSize = `${font}px`;
        cols.style.gridTemplateColumns = `${split}% minmax(0, 1fr)`;
        return page.getBoundingClientRect().height;
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
  const coachTag = (list: string[]) => list.length ? <span style={sub}> · {names(list)}</span> : null;

  const drillCell = (b: PrintBlock): ReactNode => {
    if (b.rotation) {
      const rot = b.rotation;
      const drills = b.segments[0]?.drills ?? [];
      const seen = new Set<string>();
      const startAt = (rot.grid[0] ?? []).map(l => { if (seen.has(l)) return null; seen.add(l); return l; });
      const waiting = rot.groups.slice(rot.stations.length).map((g, i) => groupTag(g.label, rot.stations.length + i));
      return (
        <>
          {rot.stations.map((st, si) => {
            const d = drills[si];
            return (
              <div key={si} style={{ display: "grid", gridTemplateColumns: "1em minmax(0, 1fr) auto", gap: "0 0.4em", marginTop: si ? "0.3em" : 0 }}>
                <span style={{ color: muted }}>{si + 1}</span>
                <div>
                  <span style={{ fontWeight: 600 }}>{st.title}</span>{st.film ? " 🎥" : ""}{coachTag(st.coachNames)}
                  {st.ruleText !== "keep together" && <span style={sub}> · {st.ruleText}</span>}
                  {extraLabel(d?.label) && <div style={sub}>{extraLabel(d?.label)}</div>}
                  {d?.goal_text && <div style={{ whiteSpace: "pre-wrap" }}>{d.goal_text}</div>}
                </div>
                <div>{startAt[si] ? badge(startAt[si]!) : null}</div>
              </div>
            );
          })}
          {waiting.length > 0 && <div style={{ ...sub, marginTop: "0.2em" }}>{waiting.join(", ")} start{waiting.length === 1 ? "s" : ""} waiting; after station {rot.stations.length}, wait your turn</div>}
        </>
      );
    }
    const all = b.segments.flatMap(seg => seg.drills.map(d => ({ seg, d })));
    return all.map(({ seg, d }, i) => {
      const tags = d.groups.map((g, gi) => groupTag(g.label, gi));
      const letters = tags.filter(isLetter);
      return (
        <div key={i} style={{ marginTop: i ? "0.35em" : 0 }}>
          <span style={{ fontWeight: 600 }}>{d.title}</span>{d.film ? " 🎥" : ""}{coachTag(d.coachNames)}
          {letters.length > 1 && <span style={sub}> · groups {letters[0]}–{letters[letters.length - 1]}</span>}
          {letters.length === 1 && <span style={sub}> · group {letters[0]}</span>}
          {letters.length === 0 && d.groups.length > 0 && <span style={sub}> · {d.groups.length} group{d.groups.length === 1 ? "" : "s"}</span>}
          {(extraLabel(d.label) || seg.rosterName) && <div style={sub}>{[extraLabel(d.label), seg.rosterName].filter(Boolean).join(" · ")}</div>}
          {d.goal_text && <div style={{ whiteSpace: "pre-wrap" }}>{d.goal_text}</div>}
        </div>
      );
    });
  };

  const boxTitle = (bx: Box) => {
    // One drill: its name. Several stations sharing the same teams: "Station teams".
    const title = bx.kind === "teams"
      ? (bx.titles.length === 1 ? `${bx.titles[0]} · teams` : "Station teams")
      : bx.titles.join(", ");
    const when = [bx.times.join(", "), bx.kind === "teams" && bx.alsoTimes.length ? `same groups as ${bx.alsoTimes.join(", ")}` : ""].filter(Boolean).join(" · ");
    return (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 0.6em", fontWeight: 700, borderBottom: "1.5px solid #111", paddingBottom: 1, marginBottom: "0.3em" }}>
        <span style={{ flex: "1 1 auto" }}>{title}</span>
        <span style={{ fontWeight: 400, color: muted, marginLeft: "auto" }}>{when}</span>
      </div>
    );
  };

  const teamsBody = (bx: TeamsBox) => {
    // Each group is wide enough for its team columns at the longest name,
    // so names never wrap: wide teams mean fewer groups per row.
    const longest = Math.max(4, ...bx.groups.flatMap(g => g.teams.flat().map(n => n.length)));
    const maxTeams = Math.max(1, ...bx.groups.map(g => g.teams.length));
    const groupMin = maxTeams * (longest * 0.85 + 1);
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${groupMin}ch), 1fr))`, gap: "0.35em 0.9em" }}>
        {bx.groups.map((g, gi) => (
          <div key={gi}>
            <div style={{ fontWeight: 700, borderBottom: "0.5px solid #999", marginBottom: 1 }}>{g.tag}</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, g.teams.length)}, max-content)`, gap: "0 0.9em" }}>
              {g.teams.map((team, ti) => (
                <div key={ti}>{team.map((nm, ni) => <div key={ni} style={{ whiteSpace: "nowrap" }}>{nm}</div>)}</div>
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
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: "inherit" }}>
          <colgroup><col style={{ width: "7.3em" }} /><col /></colgroup>
          <thead>
            <tr><th style={{ ...cell, textAlign: "left" }}>Time</th><th style={{ ...cell, textAlign: "left" }}>Drill</th></tr>
          </thead>
          <tbody>
            {p.blocks.map((b, bi) => (
              <tr key={bi} style={{ background: b.rotation ? "#f1f1f1" : undefined }}>
                <td style={{ ...cell, fontWeight: 700 }}>
                  <span style={{ whiteSpace: "nowrap" }}>{shortRange(b.start, b.end)}</span>
                  {b.rotation && <div style={{ ...sub, fontWeight: 400 }}>{Math.round(b.duration_minutes / Math.max(1, b.rotation.grid.length))} min each</div>}
                  {b.water_break && <div style={{ color: "#1f6fb2", fontWeight: 700, fontSize: "0.88em" }}>💧 Water</div>}
                </td>
                <td style={cell}>{drillCell(b)}</td>
              </tr>
            ))}
            {p.blocks.length === 0 && <tr><td colSpan={2} style={{ ...cell, color: "#888" }}>No drills scheduled yet.</td></tr>}
          </tbody>
        </table>

        <div>
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
