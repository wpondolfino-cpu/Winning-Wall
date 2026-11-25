// src/components/coach/GroupingEditor.tsx
// Manages the groups for one segment_drill. "Generate" replaces
// whatever's there with a fresh balanced split; dragging a player
// chip between groups (or the bench) is a manual override that never
// gets undone by regenerating unless you hit Generate again. Loading a
// saved grouping (e.g. "Varsity Starters") SNAPSHOTS its current
// members in — editing the saved grouping later never changes this.

import { supabase } from "../../lib/supabase";
import { useState, useEffect, useCallback, useRef } from "react";
import { SavedGrouping, SegmentDrillGroup, SegmentDrill, getSegmentDrillGroups, generateBalancedGroups, generateGroupsByGrade, generateGradeMixedGroups, saveGeneratedGroups, assignSavedArrangementToSegmentDrill, createSavedArrangement, getSavedGroupingArrangement, deleteSavedGrouping, clearSegmentDrillGroups, removeGroupMember, addGroupMember, updateSegmentDrill, getCurrentSeason, splitGroupingsBySeason, setDrillSplitRule, clearSplitOverrides, setAllSplitOverrides, teamsInGroup, updateGroupPlaceAndCoaches, getAssignableCoaches, setGroupMemberOrder, type CoachLite } from "../../lib/practicePlanner";

interface PlayerLite { id: string; name: string; home_roster_id: string | null; grade?: number | null; }

interface Props {
  drill: SegmentDrill;
  attendees: PlayerLite[];       // effective attendees available to this segment
  // On a tryout practice the parent supplies pool names here in PlayerLite
  // shape, and lists their ids below. Keeping them in one flat list means
  // none of the drag-and-drop or naming logic needs to know the difference
  // — only the writes do, because they go to a different column.
  tryoutIds?: Set<string>;
  excusedIds: Set<string>;       // excused for this practice — drives the yellow flag
  rosterId: string | null;       // where a newly saved arrangement is filed
  onGroupingsChanged?: () => void; // the saved list changed — parent refetches
  savedGroupings: SavedGrouping[]; // relevant to the roster(s) in this segment
  onClose: () => void;
  onChanged: () => void;
}

export default function GroupingEditor({ drill, attendees, excusedIds, rosterId, tryoutIds, savedGroupings, onGroupingsChanged, onClose, onChanged }: Props) {
  const [groups, setGroups]     = useState<SegmentDrillGroup[]>([]);
  const [loading, setLoading]   = useState(true);
  const [groupSize, setGroupSize] = useState(drill.group_size ?? 5);
  // How Generate splits: across teams (the original), one group per grade,
  // or the chosen number of groups with grades spread evenly.
  const [splitBy, setSplitBy] = useState<"teams" | "grade" | "gradeMix">("teams");
  const noGradeCount = attendees.filter(p => p.grade == null || p.grade < 9 || p.grade > 12).length;
  const [numGroups, setNumGroups] = useState(drill.num_groups ?? 2);
  const [groupSizeDraft, setGroupSizeDraft] = useState<string | null>(null);
  const [numGroupsDraft, setNumGroupsDraft] = useState<string | null>(null);
  const [dragPlayer, setDragPlayer] = useState<{ id: string; from: string | null } | null>(null);
  const [showSaveBox, setShowSaveBox] = useState(false);
  const [newArrangementName, setNewArrangementName] = useState("");
  const [savingArrangement, setSavingArrangement] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  // Everything here writes as you do it — there's no unsaved state and no
  // Save button. But it looks like a form, so people hesitate over Close.
  // This is the reassurance: a marker that shows the write happened,
  // rather than a Confirm button that would imply it hadn't.
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  function flashSaved() {
    setJustSaved(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setJustSaved(false), 1600);
  }
  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current); }, []);
  const [showPicker, setShowPicker] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string[][]>>({});
  // This season's saved groups by default; older ones behind a toggle
  // (migration 145). Last year's "3s Week 1" is graduated names.
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  useEffect(() => { getCurrentSeason().then(s => setCurrentSeasonId(s?.id ?? null)); }, []);
  const { current: thisSeasonGroupings, previous: earlierGroupings } = splitGroupingsBySeason<SavedGrouping>(savedGroupings, currentSeasonId);
  const visibleGroupings = showEarlier ? [...thisSeasonGroupings, ...earlierGroupings] : thisSeasonGroupings;

  // Teams in each group: e.g. three groups at three hoops, each playing
  // 4 v 4. The rule and any hand-made swaps live on the drill (the same
  // fields a fixed station uses), applied to each group separately.
  type TeamRule = "none" | "teams" | "size" | "size_exact";
  const [teamRule, setTeamRule] = useState<TeamRule>((drill.split_rule as TeamRule) ?? "none");
  const [teamN, setTeamN] = useState<number>(drill.split_n ?? 4);
  const [teamNDraft, setTeamNDraft] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string[][]>>(drill.split_overrides ?? {});
  const splitDrill = { split_rule: teamRule, split_n: teamN, split_overrides: overrides };
  // Teams are worked out once (after Generate, or when the rule changes)
  // and saved for every group. After that, dragging only moves the player
  // dragged; nobody else's team changes, and evening them out is the
  // coach's call.
  const groupsRef = useRef<SegmentDrillGroup[]>([]);
  const overridesRef = useRef<Record<string, string[][]>>(drill.split_overrides ?? {});
  async function writeOverrides(next: Record<string, string[][]>) {
    setOverrides(next); overridesRef.current = next;
    await setAllSplitOverrides(drill.id, next);
  }
  function frozenTeams(gs: SegmentDrillGroup[], rule: TeamRule, n: number, keep: Record<string, string[][]>) {
    const next: Record<string, string[][]> = {};
    gs.forEach((g, gi) => {
      next[String(gi)] = keep[String(gi)] ?? teamsInGroup({ split_rule: rule, split_n: n, split_overrides: {} }, gi, g.member_ids);
    });
    return next;
  }
  async function changeTeamRule(rule: TeamRule, n: number) {
    setTeamRule(rule); setTeamN(n);
    await setDrillSplitRule(drill.id, rule, rule === "none" ? null : n);
    if (rule === "none") { setOverrides({}); await clearSplitOverrides(drill.id); }
    else await writeOverrides(frozenTeams(groupsRef.current, rule, n, {}));
    onChanged(); flashSaved();
  }
  const [dragTeam, setDragTeam] = useState<{ id: string; groupIndex: number; teamIndex: number } | null>(null);
  /** Moves a player to another team in the same group (saved as that group's own split). */
  async function moveToTeam(groupIndex: number, teamIndex: number, beforeId?: string) {
    const drag = dragTeam; setDragTeam(null); setDropAt(null);
    if (!drag || drag.groupIndex !== groupIndex) return;
    if (drag.teamIndex === teamIndex && (!beforeId || beforeId === drag.id)) return;
    if (teamIndex >= teamsInGroup(splitDrill, groupIndex, groups[groupIndex].member_ids).length
      && teamsInGroup(splitDrill, groupIndex, groups[groupIndex].member_ids)[drag.teamIndex]?.length === 1) return; // already alone
    const g = groups[groupIndex];
    const parts = teamsInGroup(splitDrill, groupIndex, g.member_ids).map(t => t.filter(id => id !== drag.id));
    // Dropped on "+ New team": a team of one, to fill by dragging.
    if (teamIndex >= parts.length) parts.push([drag.id]);
    else parts[teamIndex] = insertBefore(parts[teamIndex], drag.id, beforeId);
    setDragPlayer(null);
    const next = { ...overridesRef.current, [String(groupIndex)]: parts.filter(t => t.length > 0) };
    await writeOverrides(next);
    onChanged(); flashSaved();
  }

  /** Redoes the teams for one group only, by the current rule. */
  async function resplitGroup(groupIndex: number) {
    const g = groups[groupIndex];
    const next = { ...overridesRef.current, [String(groupIndex)]: teamsInGroup({ split_rule: teamRule, split_n: teamN, split_overrides: {} }, groupIndex, g.member_ids) };
    await writeOverrides(next);
    onChanged(); flashSaved();
  }

  // Coaches, for each group's coach pick.
  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  useEffect(() => { getAssignableCoaches().then(setCoaches); }, []);
  async function setPlace(g: SegmentDrillGroup, value: string) {
    const v = value.trim() || null;
    if ((g.location ?? null) === v) return;
    setGroups(prev => prev.map(x => x.id === g.id ? { ...x, location: v } : x));
    await updateGroupPlaceAndCoaches(g.id, { location: v });
    onChanged(); flashSaved();
  }
  async function setCoach(g: SegmentDrillGroup, coachId: string) {
    const ids = coachId ? [coachId] : [];
    setGroups(prev => prev.map(x => x.id === g.id ? { ...x, coach_ids: ids } : x));
    await updateGroupPlaceAndCoaches(g.id, { coach_ids: ids });
    onChanged(); flashSaved();
  }
  /** Fills every empty place with "Hoop 1", "Hoop 2"… by position. */
  async function nameHoops() {
    for (let i = 0; i < groups.length; i++) if (!groups[i].location) await updateGroupPlaceAndCoaches(groups[i].id, { location: `Hoop ${i + 1}` });
    await load(); onChanged(); flashSaved();
  }

  // Names of the coaches set on groups (from the drill's Coach button).
  const [coachNames, setCoachNames] = useState<Record<string, string>>({});
  // "Loading…" only the first time. After that, refreshes happen quietly
  // behind what's on screen, so a drag doesn't blank the groups.
  const loadedOnce = useRef(false);
  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    // The groups and the drill's saved teams, both fresh from the database.
    // The drill handed in by the builder can be out of date (it was loaded
    // when the builder opened), and teams worked out from an old copy are
    // what put a moved player back in a different spot.
    const [gs, fresh] = await Promise.all([
      getSegmentDrillGroups(drill.id),
      supabase.from("segment_drills").select("split_rule, split_n, split_overrides").eq("id", drill.id).maybeSingle(),
    ]);
    const f = (fresh.data ?? null) as { split_rule: TeamRule | null; split_n: number | null; split_overrides: Record<string, string[][]> | null } | null;
    const ov = f?.split_overrides ?? {};
    if (f) { setTeamRule(f.split_rule ?? "none"); if (f.split_n) setTeamN(f.split_n); setOverrides(ov); overridesRef.current = ov; }
    setGroups(gs);
    groupsRef.current = gs;
    const ids = Array.from(new Set(gs.flatMap(g => g.coach_ids ?? [])));
    if (ids.length) {
      const { data } = await supabase.from("profiles").select("id, name").in("id", ids);
      setCoachNames(Object.fromEntries(((data ?? []) as any[]).map(p => [p.id, p.name])));
    }
    setLoading(false);
    loadedOnce.current = true;
    return { gs, rule: (f?.split_rule ?? "none") as TeamRule, n: f?.split_n ?? 4, ov };
  }, [drill.id]);

  useEffect(() => {
    load().then(({ gs, rule, n, ov }) => {
      // Teams set before they were saved per group: save them as they
      // look now, so the first drag doesn't reshuffle anyone.
      if (rule !== "none" && gs.some((_, gi) => !ov[String(gi)])) {
        void writeOverrides(frozenTeams(gs, rule, n, ov));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const assignedIds = new Set(groups.flatMap(g => g.member_ids));
  const bench = attendees.filter(p => !assignedIds.has(p.id));
  // Assigned players who aren't among today's attendees. Covers a saved
  // arrangement loaded with someone out sick and one loaded with someone
  // who left the team -- the cause doesn't change what the coach does next,
  // so one count covers both.
  const unavailableCount = [...assignedIds].filter(id => !attendees.some(p => p.id === id)).length;
  const nameOf = (id: string) => attendees.find(p => p.id === id)?.name ?? "Unknown";

  // Generate / Clear are off while one is saving, so a double tap can't
  // start a second save on top of the first.
  const [busy, setBusy] = useState(false);
  async function handleGenerate() {
    if (busy) return;
    setBusy(true);
    try {
      if (splitBy === "grade") {
        const { groups: generated, labels } = generateGroupsByGrade(attendees);
        const { error } = await saveGeneratedGroups(drill.id, generated, tryoutIds, labels);
        if (error) { setSaveMsg(`Groups didn't fully save (${error}). Tap Generate again.`); await load(); return; }
      } else {
        const { groups: generated } = splitBy === "gradeMix"
          ? generateGradeMixedGroups(attendees, numGroups)
          : generateBalancedGroups(attendees, groupSize, numGroups);
        const { error } = await saveGeneratedGroups(drill.id, generated, tryoutIds);
        if (error) { setSaveMsg(`Groups didn't fully save (${error}). Tap Generate again.`); await load(); return; }
        await updateSegmentDrill(drill.id, { group_size: groupSize, num_groups: numGroups });
      }
      // New groups get fresh teams, worked out once and saved.
      const { gs } = await load();
      if (teamRule !== "none") await writeOverrides(frozenTeams(gs, teamRule, teamN, {}));
      else if (Object.keys(overrides).length) { await clearSplitOverrides(drill.id); setOverrides({}); }
      onChanged(); flashSaved();
    } finally { setBusy(false); }
  }

  /** Removes every group on this drill; everyone goes back to the bench. */
  async function handleClear() {
    if (busy || groups.length === 0) return;
    if (!window.confirm("Clear all groups for this drill? Everyone goes back to the bench.")) return;
    setBusy(true);
    try {
      const { error } = await clearSegmentDrillGroups(drill.id);
      if (error) { setSaveMsg(error); return; }
      // The teams belonged to the groups that are gone.
      if (Object.keys(overridesRef.current).length) { await clearSplitOverrides(drill.id); setOverrides({}); overridesRef.current = {}; }
      await load(); onChanged(); flashSaved();
    } finally { setBusy(false); }
  }

  /**
   * Loads a saved arrangement over whatever is currently on screen.
   *
   * Replaces rather than appends. Picking "3s Week 1" means you want those
   * threes, not those threes bolted onto the groups already there -- and
   * appending silently produced 6 groups from a 3-group pick, which looked
   * like a bug. Everything stays draggable afterwards, so a swap or two on
   * top of a loaded arrangement works exactly as before.
   */
  async function handleAssignSaved(groupingId: string) {
    const grouping = savedGroupings.find(g => g.id === groupingId);
    if (!grouping) return;
    if (groups.length > 0 && !window.confirm(`Load "${grouping.name}"? It replaces the groups currently on screen.`)) return;
    await clearSegmentDrillGroups(drill.id);
    const { error } = await assignSavedArrangementToSegmentDrill(drill.id, grouping, 0, tryoutIds);
    if (error) { setSaveMsg(error); return; }
    setShowPicker(false);
    const { gs } = await load();
    const ts = grouping.team_split;
    if (ts && ts.teams?.length) {
      // Saved with teams: bring back the rule and every group's teams.
      setTeamRule(ts.rule); setTeamN(ts.n);
      await setDrillSplitRule(drill.id, ts.rule, ts.n);
      await writeOverrides(Object.fromEntries(gs.map((_, gi) => [String(gi), ts.teams[gi] ?? []]).filter(([, t]) => (t as string[][]).length)));
    } else if (teamRule !== "none") {
      // No saved teams: make fresh ones for these groups (the old teams
      // belonged to the groups that were just replaced).
      await writeOverrides(frozenTeams(gs, teamRule, teamN, {}));
    }
    onChanged(); flashSaved();
  }

  /** Loads a preview of each saved arrangement so the picker can show what's inside rather than just a name. */
  async function openPicker() {
    setShowPicker(true);
    setSaveMsg(null);
    const entries = await Promise.all(
      savedGroupings.map(async g => [g.id, await getSavedGroupingArrangement(g.id)] as const)
    );
    setPreviews(Object.fromEntries(entries));
  }

  async function handleDeleteSaved(g: SavedGrouping) {
    if (!window.confirm(`Delete "${g.name}"? Practices that already used it keep their groups.`)) return;
    await deleteSavedGrouping(g.id);
    setPreviews(prev => { const next = { ...prev }; delete next[g.id]; return next; });
    onGroupingsChanged?.();
  }

  /**
   * Saves the split currently on screen so it can be reused.
   *
   * This is what was missing: the generator wrote straight to this
   * practice and stopped, so a good set of threes couldn't survive to next
   * week. Saves the whole arrangement rather than one group at a time.
   */
  async function handleSaveArrangement() {
    const name = newArrangementName.trim();
    if (!name) { setSaveMsg("Give it a name first."); return; }
    if (!rosterId) { setSaveMsg("This drill has no roster to save against."); return; }
    const payload = groups.filter(g => g.member_ids.length > 0).map(g => g.member_ids);
    if (!payload.length) { setSaveMsg("Nothing to save — build some groups first."); return; }
    const labels = groups.filter(g => g.member_ids.length > 0).map(g => g.group_label || null);
    // The teams inside each group go with it, so loading it later brings
    // back the whole thing.
    const teamSplit = teamRule !== "none"
      ? { rule: teamRule, n: teamN, teams: groups.map((g, gi) => ({ g, gi })).filter(x => x.g.member_ids.length > 0).map(({ g, gi }) => teamsInGroup(splitDrill, gi, g.member_ids)) }
      : null;
    setSavingArrangement(true);
    const { error, teamsSkipped } = await createSavedArrangement(name, rosterId, payload, labels, tryoutIds, teamSplit);
    setSavingArrangement(false);
    setSaveMsg(error ?? (teamsSkipped
      ? `Saved "${name}" — the groups, but not the teams. Run SQL 213 in Supabase so teams save too.`
      : `Saved "${name}" — ${payload.length} group${payload.length === 1 ? "" : "s"}${teamSplit ? ", with their teams" : ""}. Find it under "Pick saved group".`));
    if (!error) { setNewArrangementName(""); setShowSaveBox(false); onChanged(); onGroupingsChanged?.(); }
  }

  function handleDragStart(playerId: string, from: string | null) { setDragPlayer({ id: playerId, from }); }
  // Where a dragged player would land: above this player (shown as a line).
  const [dropAt, setDropAt] = useState<string | null>(null);
  /** The list with `id` put just above `beforeId` (or at the end). */
  const insertBefore = (list: string[], id: string, beforeId?: string) => {
    const rest = list.filter(x => x !== id);
    const at = beforeId ? rest.indexOf(beforeId) : -1;
    return at < 0 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)];
  };
  /** Drags a player up or down inside a group with no teams, or into a spot in another one. */
  async function dropInGroup(to: string, beforeId: string) {
    if (!dragPlayer) return;
    const { id: playerId, from } = dragPlayer;
    setDropAt(null);
    if (playerId === beforeId) { setDragPlayer(null); return; }
    if (from !== to) await handleDrop(to);
    const g = groupsRef.current.find(x => x.id === to);
    if (!g) return;
    const order = insertBefore(g.member_ids, playerId, beforeId);
    const moved = groupsRef.current.map(x => x.id === to ? { ...x, member_ids: order } : x);
    setGroups(moved); groupsRef.current = moved;
    setDragPlayer(null);
    const { error } = await setGroupMemberOrder(to, order, tryoutIds);
    if (error) { setSaveMsg(error); return; }
    onChanged(); flashSaved();
  }

  /**
   * Moves a player between groups (or to/from the bench). With teams on,
   * only that player's team changes: they leave their old team and join
   * the team they were dropped on (the last team if dropped elsewhere on
   * the card). Everyone else stays put.
   */
  async function handleDrop(to: string | null, toTeam?: number, beforeId?: string) {
    setDragTeam(null); setDropAt(null);
    if (!dragPlayer) return;
    const { id: playerId, from } = dragPlayer;
    if (from === to) { setDragPlayer(null); return; }
    const isTryout = Boolean(tryoutIds?.has(playerId));
    // Show the move right away; the saves follow.
    const moved = groupsRef.current.map(g =>
      g.id === from ? { ...g, member_ids: g.member_ids.filter(id => id !== playerId) }
      : g.id === to ? { ...g, member_ids: [...g.member_ids, playerId] } : g);
    if (teamRule !== "none") {
      const gs = groupsRef.current;
      const next = frozenTeams(gs, teamRule, teamN, overridesRef.current);
      const fi = from ? gs.findIndex(g => g.id === from) : -1;
      const ti = to ? gs.findIndex(g => g.id === to) : -1;
      if (fi >= 0) next[String(fi)] = next[String(fi)].map(t => t.filter(id => id !== playerId)).filter(t => t.length > 0);
      if (ti >= 0) {
        const parts = next[String(ti)].length ? next[String(ti)].map(t => [...t]) : [[]];
        if (toTeam != null && toTeam >= parts.length && parts[0].length) parts.push([playerId]); // "+ New team"
        else { const t = toTeam != null && toTeam < parts.length ? toTeam : parts.length - 1; parts[t] = insertBefore(parts[t], playerId, beforeId); }
        next[String(ti)] = parts;
      }
      setOverrides(next); overridesRef.current = next;
      setGroups(moved); groupsRef.current = moved;
      setDragPlayer(null);
      await setAllSplitOverrides(drill.id, next);
    } else {
      setGroups(moved); groupsRef.current = moved;
    }
    if (from) await removeGroupMember(from, playerId, isTryout);
    if (to) await addGroupMember(to, playerId, isTryout);
    setDragPlayer(null);
    await load(); onChanged(); flashSaved();
  }

  async function handleQuickSwap(groupId: string, excusedPlayerId: string, replacementId: string) {
    // With teams on, the replacement takes the excused player's spot on their team.
    const gi = groupsRef.current.findIndex(g => g.id === groupId);
    const teams = gi >= 0 ? overridesRef.current[String(gi)] : undefined;
    if (teamRule !== "none" && teams?.some(t => t.includes(excusedPlayerId))) {
      await writeOverrides({ ...overridesRef.current, [String(gi)]: teams.map(t => t.map(id => id === excusedPlayerId ? replacementId : id)) });
    }
    await removeGroupMember(groupId, excusedPlayerId, Boolean(tryoutIds?.has(excusedPlayerId)));
    await addGroupMember(groupId, replacementId, Boolean(tryoutIds?.has(replacementId)));
    await load(); onChanged(); flashSaved();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(720px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--title)" }}>Groups — {drill.label}</div>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--success-text)", opacity: justSaved ? 1 : 0, transition: "opacity .25s" }}>✓ Saved</span>
            <button onClick={onClose} style={smallBtn}>Done</button>
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>Drag a player chip to move them between groups or the bench. Generate replaces the current split; manual moves stick until you generate again. Everything saves as you go — there’s nothing to submit.</div>

        {/* How Generate splits everyone up. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ ...fieldLabel, marginBottom: 0 }}>Split</span>
          {([["teams", "Mix teams"], ["grade", "By grade"], ["gradeMix", "Grades mixed evenly"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setSplitBy(k)}
              style={{ ...inputStyle, padding: "5px 11px", fontSize: 12, cursor: "pointer",
                ...(splitBy === k ? { background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" } : {}) }}>{label}</button>
          ))}
          {splitBy !== "teams" && noGradeCount > 0 && (
            <span style={{ fontSize: 11, color: "var(--gold-text)" }}>{noGradeCount} with no grade will stay on the bench</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
          {splitBy === "grade" ? (
            <div style={{ fontSize: 12, color: "var(--muted)", paddingBottom: 8 }}>One group per grade: Seniors, Juniors, Sophomores, Freshmen.</div>
          ) : (<>
          <div>
            <div style={fieldLabel}># of groups</div>
            <input type="number" min={1}
              value={numGroupsDraft ?? String(numGroups)}
              onChange={e => setNumGroupsDraft(e.target.value)}
              onBlur={e => { setNumGroups(Math.max(1, parseInt(e.target.value) || numGroups)); setNumGroupsDraft(null); }}
              style={{ ...inputStyle, width: 60 }} />
          </div>
          <div>
            <div style={fieldLabel}>Group size</div>
            <input type="number" min={1}
              value={groupSizeDraft ?? String(groupSize)}
              onChange={e => setGroupSizeDraft(e.target.value)}
              onBlur={e => { setGroupSize(Math.max(1, parseInt(e.target.value) || groupSize)); setGroupSizeDraft(null); }}
              style={{ ...inputStyle, width: 60 }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", paddingBottom: 8 }}>
            {/* One number per group: 3 groups of 15 reads "15v15v15". */}
            {Array(numGroups).fill(groupSize).join("v")}
          </div>
          </>)}
          <button onClick={handleGenerate} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Generate"}</button>
          {groups.length > 0 && (
            <button onClick={handleClear} disabled={busy} style={{ ...inputStyle, width: "auto", padding: "8px 14px", cursor: busy ? "wait" : "pointer" }}>Clear groups</button>
          )}
          {/* Always shown, even with nothing saved yet -- a button that
              vanishes when the list is empty is how you end up saving a
              grouping and then being unable to find it. */}
          <button onClick={openPicker} style={inputStyle}>📂 Pick saved group</button>
          {groups.length > 0 && rosterId && (
            <button onClick={() => { setShowSaveBox(v => !v); setSaveMsg(null); }} style={inputStyle}>
              💾 Save these groups
            </button>
          )}
        </div>

        {/* Teams inside each group, e.g. three hoops each playing 4 v 4. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ ...fieldLabel, marginBottom: 0 }}>Teams in each group</span>
          {([["none", "None"], ["size", "Groups of"], ["teams", "Split into"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => changeTeamRule(k, teamN)}
              style={{ ...inputStyle, padding: "5px 11px", fontSize: 12, cursor: "pointer",
                ...(teamRule === k ? { background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" } : {}) }}>{label}</button>
          ))}
          {teamRule !== "none" && (<>
            <input type="number" min={1} value={teamNDraft ?? String(teamN)}
              onChange={e => setTeamNDraft(e.target.value)}
              onBlur={e => { const n = Math.max(1, parseInt(e.target.value) || teamN); setTeamNDraft(null); if (n !== teamN) changeTeamRule(teamRule, n); }}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{ ...inputStyle, width: 52 }} />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{teamRule === "teams" ? "teams" : "players"} · drag a name to move it between teams</span>
          </>)}
        </div>

        {showPicker && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 12, background: "var(--surface2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Saved groups</div>
              <button onClick={() => setShowPicker(false)} style={{ ...inputStyle, padding: "4px 10px" }}>Close</button>
            </div>
            {visibleGroupings.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {earlierGroupings.length > 0
                  ? "Nothing saved for this roster this season yet."
                  : <>Nothing saved for this roster yet. Build some groups and hit "Save these groups".</>}
              </div>
            ) : (
              visibleGroupings.map(g => {
                const isEarlier = earlierGroupings.includes(g);
                const preview = previews[g.id] ?? [];
                const labels = (g as any).group_labels as (string | null)[] | null;
                return (
                  <div key={g.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => handleAssignSaved(g.id)} style={{ ...primaryBtn, padding: "6px 12px" }}>Use</button>
                      <div style={{ flex: 1, fontSize: 13, color: "var(--text)", fontWeight: 600 }}>
                        {g.name}
                        {isEarlier && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 5px" }}>earlier season</span>}
                      </div>
                      <button onClick={() => handleDeleteSaved(g)} title="Delete this saved group" style={{ ...inputStyle, padding: "4px 9px", color: "var(--muted)" }}>✕</button>
                    </div>
                    {/* Names, not just a count -- "3s Week 1" and "3s Week 2"
                        are indistinguishable otherwise. */}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                      {g.team_split?.teams?.length ? (
                        <div style={{ fontWeight: 600 }}>
                          With teams: {g.team_split.rule === "teams" ? `${g.team_split.n} teams per group` : `teams of ${g.team_split.n}`}
                        </div>
                      ) : null}
                      {preview.length === 0 ? "…" : preview.map((ids, gi) => (
                        <div key={gi}>
                          <strong>{labels?.[gi] || `Group ${gi + 1}`}:</strong>{" "}
                          {g.team_split?.teams?.[gi]?.length
                            ? g.team_split.teams[gi].map(t => t.map(nameOf).join(", ")).join("  ┃  ")
                            : ids.map(nameOf).join(", ")}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            {earlierGroupings.length > 0 && (
              <button onClick={() => setShowEarlier(v => !v)} style={{ ...inputStyle, padding: "4px 10px", marginTop: 8, fontSize: 12 }}>
                {showEarlier ? "Hide earlier seasons" : `Show earlier seasons (${earlierGroupings.length})`}
              </button>
            )}
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              Loading one replaces the groups on screen. You can still drag players afterwards.
            </div>
          </div>
        )}

        {showSaveBox && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              value={newArrangementName}
              onChange={e => setNewArrangementName(e.target.value)}
              placeholder="Name it — e.g. 3s Week 1, or Starters"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={handleSaveArrangement} disabled={savingArrangement} style={primaryBtn}>
              {savingArrangement ? "Saving…" : "Save"}
            </button>
          </div>
        )}

        {saveMsg && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{saveMsg}</div>}

        {unavailableCount > 0 && (
          <div style={{ fontSize: 12, color: "var(--tx-c9a227)", marginBottom: 10 }}>
            ⚠ {unavailableCount} assigned {unavailableCount === 1 ? "player isn't" : "players aren't"} available today — swap or move them to the bench.
          </div>
        )}

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>Loading…</div>
        ) : (
          <>
            {groups.length > 1 && groups.some(g => !g.location) && (
              <button onClick={nameHoops} style={{ ...inputStyle, padding: "4px 10px", marginBottom: 8, cursor: "pointer" }}>
                Name them Hoop 1–{groups.length}
              </button>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
              {groups.map((g, gi) => {
                const hasExcused = g.member_ids.some(id => excusedIds.has(id));
                return (
                  <div key={g.id}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop(g.id)}
                    style={{
                      background: hasExcused ? "rgba(240,192,64,0.1)" : "var(--surface2)",
                      border: hasExcused ? "1px solid rgba(240,192,64,0.5)" : "1px solid var(--border)",
                      borderRadius: 10, padding: 10, minHeight: 90,
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: hasExcused ? "var(--gold-text)" : "var(--text)", marginBottom: 6 }}>
                      {hasExcused && "⚠ "}{g.group_label}
                      {(g.coach_ids ?? []).length > 1 && (
                        <span style={{ fontWeight: 500, color: "var(--muted)" }}> · Coaches {(g.coach_ids ?? []).map(id => coachNames[id]).filter(Boolean).join(" & ")}</span>
                      )}
                    </div>
                    {/* Where this group goes and who runs it. */}
                    <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input key={`place-${g.id}-${g.location ?? ""}`} defaultValue={g.location ?? ""} placeholder={`Hoop ${gi + 1}`}
                        onBlur={e => setPlace(g, e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "4px 7px", fontSize: 11 }} />
                      <select value={(g.coach_ids ?? [])[0] ?? ""} onChange={e => setCoach(g, e.target.value)}
                        style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "4px 5px", fontSize: 11 }}>
                        <option value="">Coach</option>
                        {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    {teamRule !== "none" && g.member_ids.length > 0 ? (<>
                      {teamsInGroup(splitDrill, gi, g.member_ids).map((team, ti) => (
                        <div key={ti}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => {
                            e.stopPropagation();
                            if (dragTeam && dragTeam.groupIndex === gi) moveToTeam(gi, ti);
                            else handleDrop(g.id, ti);
                          }}
                          style={{ borderTop: "1px solid var(--border)", paddingTop: 4, marginTop: 4 }}>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>Team {ti + 1}</div>
                          {team.map(pid => (
                            <div key={pid} draggable
                              onDragStart={() => { handleDragStart(pid, g.id); setDragTeam({ id: pid, groupIndex: gi, teamIndex: ti }); }}
                              onDragEnd={() => { setDragTeam(null); setDropAt(null); }}
                              // Drop on a player to put the dragged one just above them.
                              onDragOver={e => { e.preventDefault(); if (dropAt !== pid) setDropAt(pid); }}
                              onDrop={e => {
                                e.stopPropagation();
                                if (dragTeam && dragTeam.groupIndex === gi) moveToTeam(gi, ti, pid);
                                else handleDrop(g.id, ti, pid);
                              }}
                              style={{ fontSize: 12, padding: "3px 6px", marginBottom: 2, borderRadius: 6, cursor: "grab",
                                boxShadow: dropAt === pid && dragPlayer?.id !== pid ? "0 -2px 0 0 var(--royal)" : "none",
                                background: excusedIds.has(pid) ? "rgba(226,75,74,0.12)" : "var(--surface)",
                                color: excusedIds.has(pid) ? "var(--tx-ff9b9b)" : "var(--text)" }}>
                              {excusedIds.has(pid) ? "⚠ " : ""}{nameOf(pid)}
                            </div>
                          ))}
                        </div>
                      ))}
                      {/* Drag a player here to start another team. */}
                      {(() => {
                        const count = teamsInGroup(splitDrill, gi, g.member_ids).length;
                        return (
                          <div
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                              e.stopPropagation();
                              if (dragTeam && dragTeam.groupIndex === gi) moveToTeam(gi, count);
                              else handleDrop(g.id, count);
                            }}
                            style={{ marginTop: 6, border: "1px dashed var(--border)", borderRadius: 6, padding: "5px 6px", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                            + New team <span style={{ opacity: 0.8 }}>· drag a player here</span>
                          </div>
                        );
                      })()}
                      <button onClick={() => resplitGroup(gi)}
                        style={{ marginTop: 6, background: "none", border: "none", padding: 0, fontSize: 11, color: "var(--royal)", cursor: "pointer", fontFamily: "inherit" }}>
                        ↻ Re-split into {teamRule === "teams" ? `${teamN} teams` : `teams of ${teamN}`}
                      </button>
                    </>) : g.member_ids.map(pid => {
                      const excused = excusedIds.has(pid);
                      return (
                        <div key={pid} draggable onDragStart={() => handleDragStart(pid, g.id)}
                          onDragEnd={() => setDropAt(null)}
                          // Drop on a player to put the dragged one just above them.
                          onDragOver={e => { e.preventDefault(); if (dropAt !== pid) setDropAt(pid); }}
                          onDrop={e => { e.stopPropagation(); dropInGroup(g.id, pid); }}
                          style={{
                            boxShadow: dropAt === pid && dragPlayer?.id !== pid ? "0 -2px 0 0 var(--royal)" : "none",
                            fontSize: 12, padding: "4px 6px", marginBottom: 3, borderRadius: 6, cursor: "grab",
                            background: excused ? "rgba(226,75,74,0.12)" : "var(--surface)",
                            color: excused ? "var(--tx-ff9b9b)" : "var(--text)",
                            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6,
                          }}>
                          <span>{excused ? "⚠ " : ""}{nameOf(pid)}</span>
                          {excused && bench.length > 0 && (
                            <select onChange={e => { if (e.target.value) handleQuickSwap(g.id, pid, e.target.value); e.target.value = ""; }} defaultValue=""
                              style={{ fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)" }}>
                              <option value="">swap…</option>
                              {bench.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div onDragOver={e => e.preventDefault()} onDrop={() => handleDrop(null)}
              style={{ background: "var(--surface2)", border: "1px dashed var(--border)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Bench / unassigned ({bench.length})</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {bench.map(p => (
                  <div key={p.id} draggable onDragStart={() => handleDragStart(p.id, null)}
                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, background: "var(--surface)", cursor: "grab", color: excusedIds.has(p.id) ? "var(--muted)" : "var(--text)" }}>
                    {p.name}
                  </div>
                ))}
                {bench.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>Everyone's assigned.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = { fontSize: 11, color: "var(--muted)", marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
