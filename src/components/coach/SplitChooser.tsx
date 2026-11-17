// src/components/coach/SplitChooser.tsx
// "How do you want to split them?" -- used by the Stations window for both
// rotation groups and fixed stations. The number of groups is the number
// of stations (so nobody is idle); this only decides who goes where.
//
//   Mixed evenly         random, even sizes
//   By grade             you choose the group for each grade
//                        (So -> A, Jr + Sr -> B)
//   Grades mixed evenly  every group gets a fair share of each class
//   By team              you choose the group for each team (Varsity, JV...)
//   By position          you choose the group for each Team Designer
//                        position (Ball handler, Wing...)
//   Same as another block  reuse groups already made in this practice
//
// Anyone the chosen way can't place (no grade set, not on the board, on two
// teams) is used to even out the group sizes. Nothing here saves: it hands
// the groups back, and the Stations window's Save does the saving.

import { useEffect, useMemo, useState } from "react";
import { inputStyle } from "../../lib/inputStyle";
import { generateGradeMixedGroups } from "../../lib/practicePlanner";

export interface SplitPlayer {
  id: string;
  name: string;
  grade?: number | null;
  /** Teams this kid belongs to (their roster, or a tryout kid's team tags). */
  teamIds: string[];
  /** Team Designer position, if their card is placed on the board. */
  positionId?: string | null;
}

type Mode = "mix" | "grade" | "gmix" | "team" | "position" | "copy";
const GRADE_SHORT: Record<number, string> = { 9: "Fr", 10: "So", 11: "Jr", 12: "Sr" };

interface Props {
  players: SplitPlayer[];
  /** What each group is called: "Group A" / the station names. */
  targetNames: string[];
  teams: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  /** Groups already made in other blocks of this practice. */
  sources: { blockId: string; label: string; groups: string[][] }[];
  onApply: (groups: string[][]) => void;
  onCancel: () => void;
}

function shuffle<T>(a: T[]): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
/** Puts each leftover kid in whichever group is smallest at the time. */
function balanceIn(groups: string[][], ids: string[]) {
  for (const id of shuffle(ids)) {
    let k = 0;
    groups.forEach((g, i) => { if (g.length < groups[k].length) k = i; });
    groups[k].push(id);
  }
}
/** A starting choice for "which group": spread the list across the groups in order. */
function spread<T extends string | number>(keys: T[], n: number): Record<string, number> {
  return Object.fromEntries(keys.map((k, i) => [String(k), Math.min(n - 1, Math.ceil((i * n) / Math.max(1, keys.length)))]));
}

export default function SplitChooser({ players, targetNames, teams, positions, sources, onApply, onCancel }: Props) {
  const n = targetNames.length;
  const [mode, setMode] = useState<Mode>("mix");

  const grades = useMemo(() => [9, 10, 11, 12].filter(g => players.some(p => p.grade === g)), [players]);
  const teamsHere = useMemo(() => teams.filter(t => players.some(p => p.teamIds.includes(t.id))), [players, teams]);
  const positionsHere = useMemo(() => positions.filter(pos => players.some(p => p.positionId === pos.id)), [players, positions]);

  const [gradeTo, setGradeTo] = useState<Record<string, number>>({});
  const [teamTo, setTeamTo] = useState<Record<string, number>>({});
  const [posTo, setPosTo] = useState<Record<string, number>>({});
  const [sourceId, setSourceId] = useState<string>("");
  useEffect(() => { setGradeTo(spread(grades, n)); }, [grades.join(","), n]);
  useEffect(() => { setTeamTo(spread(teamsHere.map(t => t.id), n)); }, [teamsHere.map(t => t.id).join(","), n]);
  useEffect(() => { setPosTo(spread(positionsHere.map(p => p.id), n)); }, [positionsHere.map(p => p.id).join(","), n]);
  useEffect(() => { if (!sourceId && sources[0]) setSourceId(sources[0].blockId); }, [sources]);

  const noGrade = players.filter(p => !p.grade || !GRADE_SHORT[p.grade]).length;
  const multiTeam = players.filter(p => p.teamIds.filter(id => teamsHere.some(t => t.id === id)).length !== 1).length;
  const noPos = players.filter(p => !p.positionId || !positionsHere.some(x => x.id === p.positionId)).length;

  function make(): string[][] {
    const groups: string[][] = Array.from({ length: n }, () => []);
    const here = new Set(players.map(p => p.id));
    if (mode === "mix") { shuffle(players).forEach((p, i) => groups[i % n].push(p.id)); return groups; }
    if (mode === "gmix") {
      const graded = players.filter(p => p.grade && GRADE_SHORT[p.grade]);
      generateGradeMixedGroups(graded, n).groups.forEach((g, i) => groups[i].push(...g));
      balanceIn(groups, players.filter(p => !(p.grade && GRADE_SHORT[p.grade])).map(p => p.id));
      return groups;
    }
    if (mode === "copy") {
      const src = sources.find(s => s.blockId === sourceId);
      const placed = new Set<string>();
      (src?.groups ?? []).forEach((g, i) => g.forEach(id => { if (here.has(id) && !placed.has(id)) { groups[i % n].push(id); placed.add(id); } }));
      balanceIn(groups, players.filter(p => !placed.has(p.id)).map(p => p.id));
      return groups;
    }
    const leftovers: string[] = [];
    for (const p of players) {
      let k: number | undefined;
      if (mode === "grade") k = p.grade != null ? gradeTo[String(p.grade)] : undefined;
      else if (mode === "team") {
        const mine = p.teamIds.filter(id => teamTo[id] !== undefined);
        const targets = Array.from(new Set(mine.map(id => teamTo[id])));
        k = targets.length === 1 ? targets[0] : undefined;      // on two teams that go different ways: evens things out
      } else if (mode === "position") k = p.positionId ? posTo[p.positionId] : undefined;
      if (k === undefined) leftovers.push(p.id); else groups[k].push(p.id);
    }
    balanceIn(groups, leftovers);
    return groups;
  }

  const pill = (m: Mode, label: string, disabled = false) => (
    <button key={m} type="button" disabled={disabled} onClick={() => setMode(m)} title={disabled ? "Nothing to go on for this group of players" : undefined}
      style={{ fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: disabled ? "default" : "pointer", fontFamily: "inherit", opacity: disabled ? 0.4 : 1,
        background: mode === m ? "var(--royal)" : "transparent", color: mode === m ? "#fff" : "var(--text)",
        border: mode === m ? "1px solid var(--royal)" : "1px solid var(--border)" }}>{label}</button>
  );
  const picker = (label: string, count: number, value: number | undefined, onPick: (i: number) => void, key: string) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, margin: "5px 0", flexWrap: "wrap" }}>
      <span style={{ width: 130, fontSize: 12.5 }}>{label} <span style={{ color: "var(--muted)" }}>({count})</span></span>
      <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", flexWrap: "wrap" }}>
        {targetNames.map((t, i) => (
          <button key={i} type="button" onClick={() => onPick(i)}
            style={{ fontSize: 11.5, padding: "4px 10px", border: "none", cursor: "pointer", fontFamily: "inherit",
              background: value === i ? "var(--royal)" : "transparent", color: value === i ? "#fff" : "var(--muted)" }}>{t}</button>
        ))}
      </span>
    </div>
  );
  const note = (text: string) => <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{text}</div>;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 11, marginBottom: 12, background: "var(--surface2)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>How do you want to split them?</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {pill("mix", "Mixed evenly")}
        {pill("grade", "By grade", grades.length < 2)}
        {pill("gmix", "Grades mixed evenly", grades.length < 2)}
        {pill("team", "By team", teamsHere.length < 2)}
        {pill("position", "By position", positionsHere.length < 2)}
        {pill("copy", "Same as another block", sources.length === 0)}
      </div>

      <div style={{ fontSize: 12.5 }}>
        {mode === "mix" && note("Random, with even group sizes.")}
        {mode === "gmix" && note("Every group gets a fair share of each class.")}
        {mode === "grade" && (<>
          {grades.map(g => picker(GRADE_SHORT[g], players.filter(p => p.grade === g).length, gradeTo[String(g)], i => setGradeTo(x => ({ ...x, [String(g)]: i })), `g${g}`))}
          {noGrade > 0 && note(`${noGrade} with no grade set will even out the group sizes.`)}
        </>)}
        {mode === "team" && (<>
          {teamsHere.map(t => picker(t.name, players.filter(p => p.teamIds.includes(t.id)).length, teamTo[t.id], i => setTeamTo(x => ({ ...x, [t.id]: i })), `t${t.id}`))}
          {multiTeam > 0 && note(`${multiTeam} on more than one team (or none) will even out the group sizes.`)}
        </>)}
        {mode === "position" && (<>
          {positionsHere.map(pos => picker(pos.name, players.filter(p => p.positionId === pos.id).length, posTo[pos.id], i => setPosTo(x => ({ ...x, [pos.id]: i })), `p${pos.id}`))}
          {noPos > 0 && note(`${noPos} not placed on the Team Designer board will even out the group sizes.`)}
        </>)}
        {mode === "copy" && (<>
          <select value={sourceId} onChange={e => setSourceId(e.target.value)} style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}>
            {sources.map(s => <option key={s.blockId} value={s.blockId}>{s.label} ({s.groups.map(g => g.length).join(" / ")})</option>)}
          </select>
          {note("Anyone not in that block's groups (or here instead of absent) evens out the sizes.")}
        </>)}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
        <button type="button" onClick={() => onApply(make())}
          style={{ ...inputStyle, background: "var(--royal)", color: "#fff", border: "none", fontWeight: 600, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>
          Make {n} groups
        </button>
        <button type="button" onClick={onCancel} style={{ ...inputStyle, padding: "7px 11px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}
