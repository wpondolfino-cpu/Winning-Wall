// src/components/coach/PracticeBuilder.tsx
// The core practice schedule builder. Time ranges are never stored —
// always computed from practice.start_time + the running duration sum
// of blocks in order, so reordering/editing always stays in sync.
//
// A block defaults to one "combined" segment (applies to every roster
// in the practice at once). Coach can "split by team" to turn it into
// one segment per roster instead (e.g. Varsity runs shell, JV shoots).
// Any segment can hold multiple simultaneous drills (stations) — their
// durations auto-split evenly across the block's time when added.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import {
  Roster, PracticeWeek, Practice, PracticeBlock, BlockSegment, SegmentDrill,
  AttendanceOverride, SavedGrouping, getRosters, getPracticeWeeks, createPracticeWeek,
  suggestNextWeekName, getPractice, createPractice, updatePractice,
  setPracticeStatus, deletePractice, duplicatePractice, getPracticeBlocks,
  createBlock, updateBlock, deleteBlock, reorderBlocks, getSegments,
  createSegment, deleteSegment, getSegmentDrills, createSegmentDrill,
  updateSegmentDrill, deleteSegmentDrill, autoSplitSegmentDrillDurations,
  getAttendanceOverrides, setAttendanceOverride, clearAttendanceOverride,
  computeEffectiveAttendees, computeBlockTimes, totalDurationMinutes,
  formatDuration, columnTotals, getSavedGroupings, getAssignableCoaches, CoachLite, getGroupCountsForDrills,
} from "../../lib/practicePlanner";
import GroupingEditor from "./GroupingEditor";
import PracticeDrillLibrary from "./PracticeDrillLibrary";
import PracticePrintView from "./PracticePrintView";
import type { PracticeDrillLibraryDrill } from "../../lib/practicePlanner";

interface PlayerLite { id: string; name: string; home_roster_id: string | null; }

interface Props {
  practiceId?: string;   // omit to create a new practice
  onClose: () => void;
  onSaved: () => void;   // let the parent (weeks list) refresh
}

export default function PracticeBuilder({ practiceId, onClose, onSaved }: Props) {
  const [practice, setPractice]   = useState<Practice | null>(null);
  const [rosters, setRosters]     = useState<Roster[]>([]);
  const [weeks, setWeeks]         = useState<PracticeWeek[]>([]);
  const [players, setPlayers]     = useState<PlayerLite[]>([]);
  const [overrides, setOverrides] = useState<AttendanceOverride[]>([]);
  const [blocks, setBlocks]       = useState<PracticeBlock[]>([]);
  const [segByBlock, setSegByBlock]     = useState<Record<string, BlockSegment[]>>({});
  const [drillsBySeg, setDrillsBySeg]   = useState<Record<string, SegmentDrill[]>>({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showNewWeek, setShowNewWeek] = useState(false);
  const [newWeekName, setNewWeekName] = useState("");
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [groupingTarget, setGroupingTarget] = useState<{ drill: SegmentDrill; segment: BlockSegment } | null>(null);
  const [savedGroupingsCache, setSavedGroupingsCache] = useState<Record<string, SavedGrouping[]>>({});
  const [drillPickerTarget, setDrillPickerTarget] = useState<{ segment: BlockSegment; block: PracticeBlock; replacing?: SegmentDrill } | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  const [drillsById, setDrillsById] = useState<Record<string, PracticeDrillLibraryDrill>>({});
  const [editingDrillDetails, setEditingDrillDetails] = useState<{ drill: SegmentDrill; block: PracticeBlock } | null>(null);
  const [coachPickerTarget, setCoachPickerTarget] = useState<{ drill: SegmentDrill; block: PracticeBlock } | null>(null);
  const [coachSelection, setCoachSelection] = useState<Set<string>>(new Set());
  const [detailsLabel, setDetailsLabel] = useState("");
  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [blockDurationDrafts, setBlockDurationDrafts] = useState<Record<string, string>>({});
  const [drillDurationDrafts, setDrillDurationDrafts] = useState<Record<string, string>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [groupCounts, setGroupCounts] = useState<Record<string, number>>({});

  function hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean, 16);
    const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Local, editable copies of date/time/roster before saving.
  const [date, setDate]         = useState("");
  const [startTime, setStartTime] = useState("14:00");
  const [rosterIds, setRosterIds] = useState<string[]>([]);
  const [weekId, setWeekId]       = useState<string | null>(null);

  async function cacheDrillTitles(allDrills: SegmentDrill[]) {
    const ids = Array.from(new Set(allDrills.map(d => d.drill_id).filter((id): id is string => !!id)));
    const missing = ids.filter(id => !drillsById[id]);
    if (missing.length === 0) return;
    const { data } = await supabase.from("practice_drills_library").select("*").in("id", missing);
    if (data) setDrillsById(prev => ({ ...prev, ...Object.fromEntries(data.map((d: any) => [d.id, d])) }));
  }

  async function refreshGroupCounts(allDrills: SegmentDrill[]) {
    const counts = await getGroupCountsForDrills(allDrills.map(d => d.id));
    setGroupCounts(prev => ({ ...prev, ...counts }));
  }

  // Patches one drill's fields in local state directly — used after a
  // save we already know succeeded, so there's no need to re-fetch the
  // whole block from the server just to reflect a single field change.
  function patchLocalDrill(segmentId: string, drillId: string, patch: Partial<SegmentDrill>) {
    setDrillsBySeg(prev => ({
      ...prev,
      [segmentId]: (prev[segmentId] ?? []).map(d => d.id === drillId ? { ...d, ...patch } : d),
    }));
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [r, w, c] = await Promise.all([getRosters(), getPracticeWeeks(), getAssignableCoaches()]);
    setRosters(r); setWeeks(w); setCoaches(c);

    const { data: p } = await supabase.from("profiles").select("id,name,home_roster_id").eq("role", "player");
    setPlayers(p ?? []);

    if (practiceId) {
      const pr = await getPractice(practiceId);
      if (pr) {
        setPractice(pr);
        setDate(pr.practice_date); setStartTime(pr.start_time.slice(0, 5));
        setRosterIds(pr.roster_ids); setWeekId(pr.week_id);
        const [ov, bl] = await Promise.all([getAttendanceOverrides(pr.id), getPracticeBlocks(pr.id)]);
        setOverrides(ov); setBlocks(bl);
        const segEntries = await Promise.all(bl.map(async b => [b.id, await getSegments(b.id)] as const));
        const segMap = Object.fromEntries(segEntries);
        setSegByBlock(segMap);
        const allSegs = Object.values(segMap).flat() as BlockSegment[];
        const drillEntries = await Promise.all(allSegs.map(async s => [s.id, await getSegmentDrills(s.id)] as const));
        setDrillsBySeg(Object.fromEntries(drillEntries));
        const allDrills = drillEntries.flatMap(([, ds]) => ds);
        await cacheDrillTitles(allDrills);
        await refreshGroupCounts(allDrills);
      }
    } else {
      setDate(new Date().toISOString().slice(0, 10));
      const suggested = suggestNextWeekName(w);
      setNewWeekName(suggested);
    }
    setLoading(false);
  }, [practiceId]);

  useEffect(() => { load(); }, [load]);

  async function refreshBlock(blockId: string) {
    const segs = await getSegments(blockId);
    setSegByBlock(prev => ({ ...prev, [blockId]: segs }));
    const drillEntries = await Promise.all(segs.map(async s => [s.id, await getSegmentDrills(s.id)] as const));
    setDrillsBySeg(prev => ({ ...prev, ...Object.fromEntries(drillEntries) }));
    const allDrills = drillEntries.flatMap(([, ds]) => ds);
    await cacheDrillTitles(allDrills);
    await refreshGroupCounts(allDrills);
  }

  // ── Save practice metadata (create or update) ───────────────

  async function ensurePracticeSaved(): Promise<string | null> {
    if (practice) {
      await updatePractice(practice.id, { practice_date: date, start_time: startTime, roster_ids: rosterIds, week_id: weekId });
      return practice.id;
    }
    if (!date || rosterIds.length === 0) { alert("Pick a date and at least one roster first."); return null; }
    let finalWeekId = weekId;
    if (showNewWeek && newWeekName.trim()) {
      const { id } = await createPracticeWeek(newWeekName);
      finalWeekId = id;
    }
    const { id, error } = await createPractice({ practice_date: date, start_time: startTime, roster_ids: rosterIds, week_id: finalWeekId });
    if (error || !id) { alert("Couldn't create practice: " + error); return null; }
    const pr = await getPractice(id);
    setPractice(pr); setWeekId(finalWeekId);
    return id;
  }

  async function handleSaveMeta() {
    setSaving(true);
    const id = await ensurePracticeSaved();
    setSaving(false);
    if (id) onSaved();
  }

  // Autosaves a single metadata field the instant it changes, once the
  // practice already exists — matches how every other edit in this
  // builder behaves, so there's nothing left that only saves on a
  // manual button click.
  async function autosaveMeta(patch: Partial<Pick<Practice, "practice_date" | "start_time" | "roster_ids" | "week_id">>) {
    if (!practice) return; // brand-new practice — needs "Create practice" first
    const { error } = await updatePractice(practice.id, patch);
    if (error) alert("Couldn't save: " + error);
  }

  async function handlePublish() {
    const id = await ensurePracticeSaved();
    if (!id) return;
    await setPracticeStatus(id, "published");
    await load(); onSaved();
  }

  async function handleUnpublish() {
    if (!practice) return;
    if (!window.confirm("Move this practice back to draft? It'll disappear from players' schedules until you publish again.")) return;
    await setPracticeStatus(practice.id, "draft");
    await load(); onSaved();
  }

  async function handleDelete() {
    if (!practice) { onClose(); return; }
    if (!window.confirm("Delete this practice? This can't be undone.")) return;
    await deletePractice(practice.id);
    onSaved(); onClose();
  }

  async function handleDuplicate() {
    if (!practice) return;
    const nextDate = prompt("Date for the duplicated practice (YYYY-MM-DD):", practice.practice_date);
    if (!nextDate) return;
    const { id, error } = await duplicatePractice(practice.id, nextDate);
    if (error) { alert("Couldn't duplicate: " + error); return; }
    onSaved();
    alert("Duplicated. Open it from the week list to keep editing the copy.");
  }

  // ── Blocks ───────────────────────────────────────────────────

  async function handleAddBlock() {
    const id = await ensurePracticeSaved();
    if (!id) return;
    const { id: blockId, error: blockErr } = await createBlock(id, 10);
    if (!blockId) {
      alert("Couldn't add the block: " + (blockErr ?? "unknown error"));
      return;
    }
    // New blocks default to one combined segment spanning every roster.
    const { id: segId, error: segErr } = await createSegment(blockId, "combined", null);
    if (segErr || !segId) { alert("Block was created but the segment failed: " + (segErr ?? "unknown error")); return; }
    setBlocks(prev => [...prev, { id: blockId, practice_id: id, order_index: prev.length, duration_minutes: 10 }]);
    setSegByBlock(prev => ({ ...prev, [blockId]: [{ id: segId, block_id: blockId, scope_type: "combined", roster_id: null }] }));
    setDrillsBySeg(prev => ({ ...prev, [segId]: [] }));
  }

  async function handleBlockDuration(block: PracticeBlock, minutes: number) {
    const { error } = await updateBlock(block.id, { duration_minutes: minutes });
    if (error) { alert("Couldn't save duration: " + error); return; }
    setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, duration_minutes: minutes } : b));
    // Re-split any multi-drill segments in this block to the new duration —
    // compute the even split locally instead of re-fetching from the server.
    const segs = segByBlock[block.id] ?? [];
    for (const s of segs) {
      const drills = drillsBySeg[s.id] ?? [];
      if (drills.length > 1) {
        await autoSplitSegmentDrillDurations(s.id, minutes);
        const each = Math.max(1, Math.floor(minutes / drills.length));
        setDrillsBySeg(prev => ({ ...prev, [s.id]: (prev[s.id] ?? []).map(d => ({ ...d, duration_minutes: each })) }));
      }
    }
  }

  async function handleDeleteBlock(blockId: string) {
    if (!window.confirm("Delete this block and everything scheduled inside it?")) return;
    await deleteBlock(blockId);
    setBlocks(prev => prev.filter(b => b.id !== blockId).map((b, i) => ({ ...b, order_index: i })));
    await reorderBlocks(blocks.filter(b => b.id !== blockId).map(b => b.id));
  }

  function handleBlockDragStart(id: string) { setDragBlockId(id); }
  function handleBlockDragOver(overId: string, e: React.DragEvent) {
    e.preventDefault();
    if (dragBlockId === null || dragBlockId === overId) return;
    setBlocks(prev => {
      const next = [...prev];
      const from = next.findIndex(b => b.id === dragBlockId);
      const to = next.findIndex(b => b.id === overId);
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  async function handleBlockDragEnd() {
    setDragBlockId(null);
    await reorderBlocks(blocks.map(b => b.id));
  }

  // ── Segments (team split vs combined) ───────────────────────

  async function toggleSplitByTeam(block: PracticeBlock, currentlySplit: boolean) {
    const segs = segByBlock[block.id] ?? [];
    for (const s of segs) await deleteSegment(s.id);
    if (currentlySplit) {
      await createSegment(block.id, "combined", null);
    } else {
      for (const rid of rosterIds) await createSegment(block.id, "roster", rid);
    }
    await refreshBlock(block.id);
  }

  // ── Segment drills ───────────────────────────────────────────

  function handleAddDrill(segment: BlockSegment, block: PracticeBlock) {
    setDrillPickerTarget({ segment, block });
  }

  async function handlePickDrill(drill: PracticeDrillLibraryDrill) {
    if (!drillPickerTarget) return;
    const { segment, block, replacing } = drillPickerTarget;
    setDrillsById(prev => ({ ...prev, [drill.id]: drill }));

    if (replacing) {
      // Swapping which drill this slot points to — keep its own duration/label/goal/coach as-is.
      const { error } = await updateSegmentDrill(replacing.id, { drill_id: drill.id });
      if (error) { alert("Couldn't change drill: " + error); return; }
      patchLocalDrill(segment.id, replacing.id, { drill_id: drill.id });
      setDrillPickerTarget(null);
      return;
    }

    const existing = drillsBySeg[segment.id] ?? [];
    const label = existing.length > 0 ? `Station ${existing.length + 1}` : null;
    const duration = drill.default_duration_minutes ?? block.duration_minutes;
    const { id: newId, error } = await createSegmentDrill(segment.id, {
      drill_id: drill.id,
      order_index: existing.length,
      // A 2nd+ drill in the same segment is a station split — auto-label it;
      // the first/only drill just takes the drill's own title, no label needed.
      label,
      duration_minutes: duration,
      group_size: drill.default_group_size ?? null,
      num_groups: drill.default_num_groups ?? null,
    });
    if (error || !newId) { alert("Couldn't add drill: " + (error ?? "unknown error")); return; }

    const newDrill: SegmentDrill = {
      id: newId, segment_id: segment.id, drill_id: drill.id, order_index: existing.length,
      label, duration_minutes: duration, goal_text: null, coach_name: null, coach_ids: [],
      group_size: drill.default_group_size ?? null, num_groups: drill.default_num_groups ?? null,
    };
    let updatedList = [...existing, newDrill];

    if (updatedList.length > 1) {
      await autoSplitSegmentDrillDurations(segment.id, block.duration_minutes);
      const each = Math.max(1, Math.floor(block.duration_minutes / updatedList.length));
      updatedList = updatedList.map(d => ({ ...d, duration_minutes: each }));
    }
    setDrillsBySeg(prev => ({ ...prev, [segment.id]: updatedList }));
    setDrillPickerTarget(null);
  }

  async function handleEditDrillDuration(drill: SegmentDrill, blockId: string, minutes: number) {
    const { error } = await updateSegmentDrill(drill.id, { duration_minutes: minutes });
    if (error) { alert("Couldn't save duration: " + error); return; }
    patchLocalDrill(drill.segment_id, drill.id, { duration_minutes: minutes });
  }

  async function handleEditNotes(drill: SegmentDrill, blockId: string, text: string) {
    const { error } = await updateSegmentDrill(drill.id, { goal_text: text.trim() || null });
    if (error) { alert("Couldn't save note: " + error); return; }
    patchLocalDrill(drill.segment_id, drill.id, { goal_text: text.trim() || null });
  }

  async function handleDeleteDrill(drill: SegmentDrill, blockId: string) {
    const { error } = await deleteSegmentDrill(drill.id);
    if (error) { alert("Couldn't delete: " + error); return; }
    setDrillsBySeg(prev => ({ ...prev, [drill.segment_id]: (prev[drill.segment_id] ?? []).filter(d => d.id !== drill.id) }));
  }

  function openDrillDetails(drill: SegmentDrill, block: PracticeBlock) {
    setDetailsLabel(drill.label ?? "");
    setEditingDrillDetails({ drill, block });
  }

  async function saveDrillDetails() {
    if (!editingDrillDetails) return;
    const { drill } = editingDrillDetails;
    const { error } = await updateSegmentDrill(drill.id, {
      label: detailsLabel.trim() || null,
    });
    if (error) { alert("Couldn't save: " + error); return; }
    patchLocalDrill(drill.segment_id, drill.id, { label: detailsLabel.trim() || null });
    setEditingDrillDetails(null);
  }

  function openCoachPicker(drill: SegmentDrill, block: PracticeBlock) {
    setCoachSelection(new Set(drill.coach_ids ?? []));
    setCoachPickerTarget({ drill, block });
  }

  async function saveCoachPicker() {
    if (!coachPickerTarget) return;
    const { drill } = coachPickerTarget;
    const { error } = await updateSegmentDrill(drill.id, { coach_ids: Array.from(coachSelection) });
    if (error) { alert("Couldn't save coaches: " + error); return; }
    patchLocalDrill(drill.segment_id, drill.id, { coach_ids: Array.from(coachSelection) });
    setCoachPickerTarget(null);
  }

  async function openGroupingEditor(drill: SegmentDrill, segment: BlockSegment) {
    const relevantRosterIds = segment.scope_type === "roster" && segment.roster_id ? [segment.roster_id] : rosterIds;
    const missing = relevantRosterIds.filter(id => !savedGroupingsCache[id]);
    if (missing.length > 0) {
      const fetched = await Promise.all(missing.map(async id => [id, await getSavedGroupings(id)] as const));
      setSavedGroupingsCache(prev => ({ ...prev, ...Object.fromEntries(fetched) }));
    }
    setGroupingTarget({ drill, segment });
  }

  // ── Attendance ───────────────────────────────────────────────

  const relevantPlayers = players.filter(p => p.home_roster_id && rosterIds.includes(p.home_roster_id));
  const effectiveAttendees = practice ? computeEffectiveAttendees(players, rosterIds, overrides) : relevantPlayers;
  const excusedIds = new Set(overrides.filter(o => o.override_type === "excused").map(o => o.player_id));
  const calledUpIds = new Set(overrides.filter(o => o.override_type === "call_up").map(o => o.player_id));

  async function toggleExcuse(playerId: string) {
    if (!practice) { alert("Save the practice first."); return; }
    if (excusedIds.has(playerId)) await clearAttendanceOverride(practice.id, playerId);
    else await setAttendanceOverride(practice.id, playerId, "excused");
    setOverrides(await getAttendanceOverrides(practice.id));
  }

  async function addCallUp(playerId: string, targetRosterId: string) {
    if (!practice) { alert("Save the practice first."); return; }
    await setAttendanceOverride(practice.id, playerId, "call_up", undefined, targetRosterId);
    setOverrides(await getAttendanceOverrides(practice.id));
  }

  async function removeCallUp(playerId: string) {
    if (!practice) return;
    await clearAttendanceOverride(practice.id, playerId);
    setOverrides(await getAttendanceOverrides(practice.id));
  }

  // ── Derived display data ────────────────────────────────────

  const timedBlocks = practice ? computeBlockTimes(startTime + ":00", blocks) : [];
  const total = totalDurationMinutes(blocks);
  const colTotals = columnTotals(blocks, segByBlock, rosterIds);
  const colValues = Object.values(colTotals);
  const columnsUnbalanced = rosterIds.length > 1 && colValues.length > 0 && Math.max(...colValues) - Math.min(...colValues) > 0;

  if (loading) return <div style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>Loading…</div>;

  if (showPrint && practice) {
    return <PracticePrintView practiceIds={[practice.id]} onClose={() => setShowPrint(false)} />;
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
      {/* ── Header / metadata ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>
            {practice ? "Edit practice" : "New practice"}
          </div>
          {practice && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
              background: practice.status === "published" ? "rgba(40,180,80,0.15)" : "rgba(240,192,64,0.12)",
              color: practice.status === "published" ? "#5de098" : "var(--gold)",
            }}>
              {practice.status === "published" ? "🌐 Published" : "📝 Draft"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {practice?.status === "published" && <button onClick={handleUnpublish} style={secondaryBtn}>Revert to draft</button>}
          {practice?.status === "draft" && <button onClick={handlePublish} style={primaryBtn}>Publish</button>}
          {practice && <button onClick={() => setShowPrint(true)} style={secondaryBtn}>🖨️ Print</button>}
          {practice && <button onClick={handleDuplicate} style={secondaryBtn}>Duplicate</button>}
          {practice && <button onClick={handleDelete} style={dangerBtn}>Delete</button>}
          <button onClick={onClose} style={secondaryBtn}>Close</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={fieldLabel}>Date</div>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); autosaveMeta({ practice_date: e.target.value }); }} style={inputStyle} />
        </div>
        <div>
          <div style={fieldLabel}>Start time</div>
          <input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); autosaveMeta({ start_time: e.target.value }); }} style={inputStyle} />
        </div>
        <div style={{ minWidth: 220 }}>
          <div style={fieldLabel}>Team(s)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {rosters.map(r => (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text)", cursor: "pointer" }}>
                <input type="checkbox" checked={rosterIds.includes(r.id)}
                  onChange={e => {
                    const next = e.target.checked ? [...rosterIds, r.id] : rosterIds.filter(id => id !== r.id);
                    setRosterIds(next);
                    autosaveMeta({ roster_ids: next });
                  }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.color, display: "inline-block" }} />
                {r.name}
              </label>
            ))}
          </div>
        </div>
        <div style={{ minWidth: 200 }}>
          <div style={fieldLabel}>Week</div>
          {!showNewWeek ? (
            <div style={{ display: "flex", gap: 6 }}>
              <select value={weekId ?? ""} onChange={e => { const v = e.target.value || null; setWeekId(v); autosaveMeta({ week_id: v }); }} style={inputStyle}>
                <option value="">— No week —</option>
                {weeks.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <button onClick={() => setShowNewWeek(true)} style={smallBtn}>+ New</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newWeekName} onChange={e => setNewWeekName(e.target.value)} placeholder="Week 4 - Opponent" style={inputStyle} />
              <button onClick={() => setShowNewWeek(false)} style={smallBtn}>Use existing</button>
            </div>
          )}
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button onClick={handleSaveMeta} disabled={saving} style={primaryBtn}>{saving ? "Saving…" : practice ? "Save changes" : "Create practice"}</button>
          {practice && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Changes above save automatically</div>}
        </div>
      </div>

      {practice && rosterIds.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={() => setShowAttendance(s => !s)} style={smallBtn}>
            {showAttendance ? "Hide" : "Show"} attendance ({effectiveAttendees.length} attending)
          </button>
          {showAttendance && (
            <div style={{ marginTop: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Uncheck a player to excuse them for this practice only. Use "Call up" to pull in a player from another roster.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {relevantPlayers.map(p => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <input type="checkbox" checked={!excusedIds.has(p.id)} onChange={() => toggleExcuse(p.id)} />
                    <span style={{ color: excusedIds.has(p.id) ? "var(--muted)" : "var(--text)", textDecoration: excusedIds.has(p.id) ? "line-through" : "none" }}>{p.name}</span>
                  </label>
                ))}
              </div>
              {calledUpIds.size > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--gold)", marginBottom: 4 }}>Called up:</div>
                  {players.filter(p => calledUpIds.has(p.id)).map(p => {
                    const ov = overrides.find(o => o.player_id === p.id && o.override_type === "call_up");
                    const targetRoster = rosters.find(r => r.id === ov?.called_up_to_roster_id);
                    return (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                        <span>{p.name}{targetRoster && rosterIds.length > 1 && <span style={{ color: "var(--muted)" }}> — to {targetRoster.name}</span>}</span>
                        <button onClick={() => removeCallUp(p.id)} style={{ ...smallBtn, padding: "2px 8px" }}>Remove</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {rosterIds.length > 1 ? (
                rosters.filter(r => rosterIds.includes(r.id)).map(r => (
                  <select key={r.id} onChange={e => { if (e.target.value) addCallUp(e.target.value, r.id); e.target.value = ""; }} style={{ ...inputStyle, marginBottom: 6 }} defaultValue="">
                    <option value="">+ Call up a player to {r.name}…</option>
                    {players.filter(p => !relevantPlayers.some(x => x.id === p.id) && !calledUpIds.has(p.id)).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ))
              ) : (
                <select onChange={e => { if (e.target.value) addCallUp(e.target.value, rosterIds[0]); e.target.value = ""; }} style={inputStyle} defaultValue="">
                  <option value="">+ Call up a player…</option>
                  {players.filter(p => !relevantPlayers.some(r => r.id === p.id) && !calledUpIds.has(p.id)).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}

      {!practice && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>Create the practice above, then add blocks below.</div>}

      {practice && (
        <>
          {/* ── Schedule table ── */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface)", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)", width: 120 }}>Time</th>
                  <th style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)" }}>Drill</th>
                  <th style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)" }}>Notes</th>
                  <th style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)", width: 130 }}>Group</th>
                  <th style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)", width: 140 }}>Coach</th>
                </tr>
              </thead>
              <tbody>
                {timedBlocks.flatMap((block, blockIndex) => {
                  const segs = segByBlock[block.id] ?? [];
                  const isSplit = segs.length > 1 || (segs.length === 1 && segs[0].scope_type === "roster");
                  const dataRowCount = segs.reduce((sum, s) => sum + (drillsBySeg[s.id] ?? []).length, 0);
                  const totalRows = Math.max(1, dataRowCount + segs.length);
                  let rowsRenderedSoFar = 0;

                  const timeCell = (
                    <td rowSpan={totalRows} style={{ padding: "10px", verticalAlign: "top", borderRight: "1px solid var(--border)", borderTop: blockIndex > 0 ? "2px solid var(--border)" : undefined }}>
                      <div draggable onDragStart={() => handleBlockDragStart(block.id)} onDragOver={e => handleBlockDragOver(block.id, e)} onDragEnd={handleBlockDragEnd} style={{ cursor: "grab" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--gold)", whiteSpace: "nowrap" }}>
                          <span style={{ color: "var(--muted)" }}>⠿</span> {block.start}–{block.end}
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}>
                          <input type="number" min={1}
                            value={blockDurationDrafts[block.id] ?? String(block.duration_minutes)}
                            onChange={e => setBlockDurationDrafts(prev => ({ ...prev, [block.id]: e.target.value }))}
                            onBlur={e => {
                              const n = Math.max(1, parseInt(e.target.value) || block.duration_minutes);
                              setBlockDurationDrafts(prev => { const next = { ...prev }; delete next[block.id]; return next; });
                              handleBlockDuration(block, n);
                            }}
                            style={{ ...inputStyle, width: 40, padding: "2px 4px", fontSize: 11 }} />
                          <span style={{ fontSize: 9, color: "var(--muted)" }}>min</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {rosterIds.length > 1 && (
                            <button onClick={() => toggleSplitByTeam(block, isSplit)} style={{ ...smallBtn, fontSize: 9, padding: "3px 6px" }}>
                              {isSplit ? "Combine" : "Split"}
                            </button>
                          )}
                          <button onClick={() => handleDeleteBlock(block.id)} style={{ ...dangerSmallBtn, fontSize: 9, padding: "3px 6px" }}>Delete</button>
                        </div>
                      </div>
                    </td>
                  );

                  const blockRows: JSX.Element[] = [];

                  segs.forEach(seg => {
                    const roster = seg.roster_id ? rosters.find(r => r.id === seg.roster_id) : null;
                    const drills = drillsBySeg[seg.id] ?? [];
                    const rowBg = roster ? hexToRgba(roster.color, 0.12) : "transparent";
                    const rowBorder = roster ? hexToRgba(roster.color, 0.35) : "var(--border)";

                    drills.forEach(d => {
                      const isVeryFirstRow = rowsRenderedSoFar === 0;
                      rowsRenderedSoFar++;
                      const gCount = groupCounts[d.id] ?? 0;
                      blockRows.push(
                        <tr key={d.id} style={{ background: rowBg, borderTop: isVeryFirstRow && blockIndex > 0 ? undefined : `1px solid ${rowBorder}` }}>
                          {isVeryFirstRow && timeCell}
                          <td style={{ padding: "10px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 600 }}>
                                {d.drill_id ? (drillsById[d.drill_id]?.title ?? "Loading…") : (d.label ?? "Untitled drill")}
                              </span>
                              <span onClick={() => openDrillDetails(d, block)} title="Edit" style={{ cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>✎</span>
                              <span onClick={() => handleDeleteDrill(d, block.id)} title="Remove" style={{ cursor: "pointer", color: "#ff7b7b", fontSize: 12, marginLeft: "auto" }}>✕</span>
                            </div>
                            {(roster || (d.drill_id && d.label)) && (
                              <div style={{ fontSize: 10, color: roster ? roster.color : "var(--muted)", marginTop: 2, fontWeight: roster ? 700 : 400 }}>
                                {roster ? roster.name : d.label}
                              </div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                              <input type="number" min={1}
                                value={drillDurationDrafts[d.id] ?? String(d.duration_minutes)}
                                onChange={e => setDrillDurationDrafts(prev => ({ ...prev, [d.id]: e.target.value }))}
                                onBlur={e => {
                                  const n = Math.max(1, parseInt(e.target.value) || d.duration_minutes);
                                  setDrillDurationDrafts(prev => { const next = { ...prev }; delete next[d.id]; return next; });
                                  handleEditDrillDuration(d, block.id, n);
                                }}
                                style={{ ...inputStyle, width: 40, padding: "2px 4px", fontSize: 10 }} />
                              <span style={{ fontSize: 9, color: "var(--muted)" }}>min</span>
                            </div>
                          </td>
                          <td style={{ padding: "10px" }}>
                            <input
                              value={notesDrafts[d.id] ?? (d.goal_text ?? "")}
                              onChange={e => setNotesDrafts(prev => ({ ...prev, [d.id]: e.target.value }))}
                              onBlur={e => {
                                setNotesDrafts(prev => { const next = { ...prev }; delete next[d.id]; return next; });
                                handleEditNotes(d, block.id, e.target.value);
                              }}
                              placeholder="Add a note…"
                              style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px dashed transparent", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", padding: "2px 0" }}
                              onFocus={e => { e.target.style.borderBottom = "1px dashed var(--border)"; }}
                            />
                          </td>
                          <td style={{ padding: "10px" }}>
                            <button onClick={() => openGroupingEditor(d, seg)} style={smallBtn}>
                              {gCount > 0 ? `${gCount} group${gCount === 1 ? "" : "s"}` : "+ Groups"}
                            </button>
                          </td>
                          <td style={{ padding: "10px" }}>
                            <button onClick={() => openCoachPicker(d, block)} style={smallBtn}>
                              {(d.coach_ids ?? []).length > 0
                                ? d.coach_ids.map(id => coaches.find(c => c.id === id)?.name).filter(Boolean).join(", ")
                                : "+ Coach"}
                            </button>
                          </td>
                        </tr>
                      );
                    });

                    const isVeryFirstRow = rowsRenderedSoFar === 0;
                    rowsRenderedSoFar++;
                    blockRows.push(
                      <tr key={`${seg.id}-add`} style={{ borderTop: isVeryFirstRow && blockIndex > 0 ? undefined : "1px dashed var(--border)" }}>
                        {isVeryFirstRow && timeCell}
                        <td colSpan={4} style={{ padding: "6px 10px" }}>
                          <button onClick={() => handleAddDrill(seg, block)} style={{ ...smallBtn, fontSize: 11 }}>
                            + {roster ? `Add drill for ${roster.name}` : drills.length > 0 ? "Add station/drill" : "Add drill"}
                          </button>
                        </td>
                      </tr>
                    );
                  });

                  return blockRows;
                })}
              </tbody>
            </table>
          </div>

          <button onClick={handleAddBlock} style={{ ...secondaryBtn, width: "100%", padding: "10px", border: "1px dashed var(--border)" }}>
            + Add time block
          </button>

          {/* ── Totals ── */}
          <div style={{ marginTop: 14, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "var(--text)" }}>Total: <strong style={{ color: "var(--gold)" }}>{formatDuration(total)}</strong></div>
            {rosterIds.length > 1 && (
              <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--muted)" }}>
                {rosterIds.map(rid => {
                  const r = rosters.find(x => x.id === rid);
                  return <span key={rid}>{r?.name}: {formatDuration(colTotals[rid] ?? 0)}</span>;
                })}
                {columnsUnbalanced && <span style={{ color: "var(--gold)" }}>⚠ columns don't match</span>}
              </div>
            )}
          </div>
        </>
      )}

      {editingDrillDetails && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setEditingDrillDetails(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(420px, 96vw)", padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", marginBottom: 10 }}>
              Edit — {editingDrillDetails.drill.drill_id ? (drillsById[editingDrillDetails.drill.drill_id]?.title ?? "Drill") : "Drill"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={fieldLabel}>Station/sub-label (optional)</div>
                <input value={detailsLabel} onChange={e => setDetailsLabel(e.target.value)} placeholder="e.g. Station 1, Guards" style={inputStyle} />
              </div>
              <button
                onClick={() => {
                  const seg = Object.entries(segByBlock).flatMap(([, segs]) => segs).find(s => (drillsBySeg[s.id] ?? []).some(d => d.id === editingDrillDetails.drill.id));
                  if (seg) { setDrillPickerTarget({ segment: seg, block: editingDrillDetails.block, replacing: editingDrillDetails.drill }); setEditingDrillDetails(null); }
                }}
                style={smallBtn}>
                Change which drill this is
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button onClick={saveDrillDetails} style={primaryBtn}>Save</button>
                <button onClick={() => setEditingDrillDetails(null)} style={smallBtn}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {coachPickerTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setCoachPickerTarget(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 16, width: "min(360px, 96vw)", padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", marginBottom: 10 }}>Coaches</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 8, marginBottom: 12 }}>
              {coaches.map(c => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={coachSelection.has(c.id)}
                    onChange={() => setCoachSelection(prev => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                      return next;
                    })} />
                  {c.name}
                </label>
              ))}
              {coaches.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>No coach accounts found.</div>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveCoachPicker} style={primaryBtn}>Save</button>
              <button onClick={() => setCoachPickerTarget(null)} style={smallBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {drillPickerTarget && (
        <PracticeDrillLibrary canManage={true} onPick={handlePickDrill} onClose={() => setDrillPickerTarget(null)} />
      )}

      {groupingTarget && (
        <GroupingEditor
          drill={groupingTarget.drill}
          attendees={
            groupingTarget.segment.scope_type === "roster" && groupingTarget.segment.roster_id
              ? effectiveAttendees.filter(p => p.home_roster_id === groupingTarget.segment.roster_id)
              : effectiveAttendees
          }
          excusedIds={excusedIds}
          savedGroupings={
            groupingTarget.segment.scope_type === "roster" && groupingTarget.segment.roster_id
              ? savedGroupingsCache[groupingTarget.segment.roster_id] ?? []
              : rosterIds.flatMap(id => savedGroupingsCache[id] ?? [])
          }
          onClose={() => setGroupingTarget(null)}
          onChanged={() => {
            getGroupCountsForDrills([groupingTarget.drill.id]).then(counts => {
              setGroupCounts(prev => ({ ...prev, [groupingTarget.drill.id]: counts[groupingTarget.drill.id] ?? 0 }));
            });
          }}
        />
      )}
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
const secondaryBtn: React.CSSProperties = {
  background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 16px", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  background: "rgba(226,75,74,0.1)", color: "#ff7b7b", border: "1px solid rgba(226,75,74,0.3)", borderRadius: 8,
  padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
const dangerSmallBtn: React.CSSProperties = {
  background: "rgba(226,75,74,0.08)", border: "1px solid rgba(226,75,74,0.2)", color: "#ff7b7b", borderRadius: 6,
  padding: "3px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
