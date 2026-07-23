// src/lib/practicePlanner.ts
// Shared types + data access for the Practice Planner feature.
// Time ranges are never stored — always computed from a practice's
// start_time plus the running sum of prior blocks' duration_minutes,
// so reordering or editing a duration reflows automatically.

import { supabase } from "./supabase";

// ── Types ────────────────────────────────────────────────────

export interface Roster {
  id: string;
  name: string;
  color: string;
  roster_type: "permanent" | "seasonal";
  status: "active" | "archived";
  default_coach_name: string | null;
  sort_order: number;
  created_at: string;
}

export interface RosterWithCount extends Roster {
  member_count: number;
}

export interface AttendanceOverride {
  id: string;
  practice_id: string;
  player_id: string;
  override_type: "call_up" | "excused";
  reason: string | null;
}

export interface PracticeWeek {
  id: string;
  name: string;
  created_at: string;
}

export interface Practice {
  id: string;
  week_id: string | null;
  practice_date: string;
  start_time: string; // "HH:MM:SS"
  roster_ids: string[];
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
}

export interface PracticeBlock {
  id: string;
  practice_id: string;
  order_index: number;
  duration_minutes: number;
}

export interface BlockSegment {
  id: string;
  block_id: string;
  scope_type: "roster" | "combined";
  roster_id: string | null;
}

export interface SegmentDrill {
  id: string;
  segment_id: string;
  drill_id: string | null;
  order_index: number;
  label: string | null;
  duration_minutes: number;
  goal_text: string | null;
  coach_name: string | null; // legacy single free-text field, superseded by coach_ids
  coach_ids: string[];       // real coach/admin profile ids — supports multiple coaches per drill
  group_size: number | null;
  num_groups: number | null;
}

// ── Rosters ──────────────────────────────────────────────────

export async function getRosters(includeArchived = false): Promise<RosterWithCount[]> {
  let query = supabase.from("rosters").select("*").order("sort_order", { ascending: true });
  if (!includeArchived) query = query.eq("status", "active");
  const { data: rosters, error } = await query;
  if (error) { console.error("Failed to load rosters:", error); return []; }

  const { data: counts } = await supabase
    .from("profiles")
    .select("home_roster_id")
    .not("home_roster_id", "is", null);

  const countMap: Record<string, number> = {};
  (counts ?? []).forEach((p: any) => {
    countMap[p.home_roster_id] = (countMap[p.home_roster_id] ?? 0) + 1;
  });

  return (rosters ?? []).map(r => ({ ...r, member_count: countMap[r.id] ?? 0 }));
}

export async function createRoster(input: {
  name: string;
  color: string;
  roster_type: "permanent" | "seasonal";
  default_coach_name?: string;
}): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: existing } = await supabase.from("rosters").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;
  const { error } = await supabase.from("rosters").insert({
    name: input.name.trim(),
    color: input.color,
    roster_type: input.roster_type,
    default_coach_name: input.default_coach_name?.trim() || null,
    sort_order: nextOrder,
    created_by: user?.id,
  });
  if (error) return { error: error.code === "23505" ? "A roster with that name already exists." : error.message };
  return { error: null };
}

export async function updateRoster(id: string, patch: Partial<Pick<Roster, "name" | "color" | "default_coach_name">>): Promise<{ error: string | null }> {
  const { error } = await supabase.from("rosters").update(patch).eq("id", id);
  return { error: error?.message ?? null };
}

export async function archiveRoster(id: string): Promise<{ error: string | null }> {
  // Only seasonal rosters should ever be archived — permanent ones
  // (Varsity/JV/Freshman) always stay in the active picker.
  const { error } = await supabase.from("rosters").update({ status: "archived" }).eq("id", id);
  return { error: error?.message ?? null };
}

export async function restoreRoster(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("rosters").update({ status: "active" }).eq("id", id);
  return { error: error?.message ?? null };
}

export async function setPlayerRoster(playerId: string, rosterId: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase.from("profiles").update({ home_roster_id: rosterId }).eq("id", playerId);
  return { error: error?.message ?? null };
}

// ── Attendance overrides (per-practice, never touches home roster) ─

export async function getAttendanceOverrides(practiceId: string): Promise<AttendanceOverride[]> {
  const { data, error } = await supabase
    .from("practice_attendance_overrides")
    .select("*")
    .eq("practice_id", practiceId);
  if (error) { console.error("Failed to load attendance overrides:", error); return []; }
  return data ?? [];
}

export async function setAttendanceOverride(
  practiceId: string,
  playerId: string,
  overrideType: "call_up" | "excused",
  reason?: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("practice_attendance_overrides")
    .upsert(
      { practice_id: practiceId, player_id: playerId, override_type: overrideType, reason: reason?.trim() || null },
      { onConflict: "practice_id,player_id" }
    );
  return { error: error?.message ?? null };
}

export async function clearAttendanceOverride(practiceId: string, playerId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("practice_attendance_overrides")
    .delete()
    .eq("practice_id", practiceId)
    .eq("player_id", playerId);
  return { error: error?.message ?? null };
}

// Computes who actually shows up to a practice: home-roster members
// of the practice's roster_ids, minus anyone excused, plus any
// call-ups. Mirrors the public.is_effective_attendee() SQL function
// so the UI can show this list before saving.
export function computeEffectiveAttendees<
  P extends { id: string; home_roster_id: string | null }
>(allPlayers: P[], practiceRosterIds: string[], overrides: AttendanceOverride[]): P[] {
  const excused = new Set(overrides.filter(o => o.override_type === "excused").map(o => o.player_id));
  const calledUpIds = overrides.filter(o => o.override_type === "call_up").map(o => o.player_id);

  const base = allPlayers.filter(
    p => p.home_roster_id && practiceRosterIds.includes(p.home_roster_id) && !excused.has(p.id)
  );
  const calledUp = allPlayers.filter(p => calledUpIds.includes(p.id) && !base.some(b => b.id === p.id));
  return [...base, ...calledUp];
}

// ── Time math — the core "no stored time ranges" rule ───────

export interface TimedBlock extends PracticeBlock {
  start: string; // "H:MM AM/PM"
  end: string;
}

function formatClock(totalMinutesFromMidnight: number): string {
  let h = Math.floor(totalMinutesFromMidnight / 60) % 24;
  const m = totalMinutesFromMidnight % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

// startTime is "HH:MM:SS" (24-hour, as stored in Postgres `time`).
// Blocks must already be sorted by order_index.
export function computeBlockTimes(startTime: string, blocks: PracticeBlock[]): TimedBlock[] {
  const [sh, sm] = startTime.split(":").map(Number);
  let cursor = sh * 60 + sm;
  return blocks.map(b => {
    const start = formatClock(cursor);
    cursor += b.duration_minutes;
    const end = formatClock(cursor);
    return { ...b, start, end };
  });
}

export function totalDurationMinutes(blocks: PracticeBlock[]): number {
  return blocks.reduce((sum, b) => sum + b.duration_minutes, 0);
}

export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Per-roster column totals, for the "columns don't match" soft warning.
export function columnTotals(
  blocks: PracticeBlock[],
  segmentsByBlock: Record<string, BlockSegment[]>,
  rosterIds: string[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  rosterIds.forEach(id => { totals[id] = 0; });
  blocks.forEach(b => {
    const segs = segmentsByBlock[b.id] ?? [];
    const combined = segs.some(s => s.scope_type === "combined");
    if (combined) {
      // A combined segment counts toward every column at once.
      rosterIds.forEach(id => { totals[id] += b.duration_minutes; });
    } else {
      segs.forEach(s => {
        if (s.roster_id && totals[s.roster_id] !== undefined) totals[s.roster_id] += b.duration_minutes;
      });
    }
  });
  return totals;
}

// ── Practice weeks ───────────────────────────────────────────

export async function getPracticeWeeks(): Promise<PracticeWeek[]> {
  const { data, error } = await supabase
    .from("practice_weeks")
    .select("*")
    .order("created_at", { ascending: false }); // newest first, per spec
  if (error) { console.error("Failed to load practice weeks:", error); return []; }
  return data ?? [];
}

export async function createPracticeWeek(name: string): Promise<{ id: string | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("practice_weeks")
    .insert({ name: name.trim(), created_by: user?.id })
    .select("id")
    .single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

// Suggests "Week N" (opponent left blank) based on the highest
// "Week <number>" name found so far — a typing saver, not a hard rule.
export function suggestNextWeekName(existingWeeks: PracticeWeek[]): string {
  let maxN = 0;
  existingWeeks.forEach(w => {
    const match = w.name.match(/week\s*(\d+)/i);
    if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
  });
  return `Week ${maxN + 1}`;
}

// ── Practices CRUD ───────────────────────────────────────────

export async function createPractice(input: {
  practice_date: string;
  start_time: string;
  roster_ids: string[];
  week_id?: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("practices")
    .insert({
      practice_date: input.practice_date,
      start_time: input.start_time,
      roster_ids: input.roster_ids,
      week_id: input.week_id ?? null,
      status: "draft",
      created_by: user?.id,
    })
    .select("id")
    .single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function updatePractice(id: string, patch: Partial<Pick<Practice, "practice_date" | "start_time" | "roster_ids" | "week_id">>): Promise<{ error: string | null }> {
  const { error } = await supabase.from("practices").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  return { error: error?.message ?? null };
}

export async function setPracticeStatus(id: string, status: "draft" | "published"): Promise<{ error: string | null }> {
  const { error } = await supabase.from("practices").update({ status }).eq("id", id);
  return { error: error?.message ?? null };
}

export async function deletePractice(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("practices").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export async function getPractice(id: string): Promise<Practice | null> {
  const { data, error } = await supabase.from("practices").select("*").eq("id", id).single();
  if (error) { console.error("Failed to load practice:", error); return null; }
  return data;
}

export async function getPracticesInWeek(weekId: string): Promise<Practice[]> {
  const { data, error } = await supabase.from("practices").select("*").eq("week_id", weekId).order("practice_date", { ascending: true });
  if (error) { console.error("Failed to load practices:", error); return []; }
  return data ?? [];
}

// Clones a whole practice — blocks, segments, and drills — into a new
// draft practice. Attendance overrides and group assignments are NOT
// copied (those are day-specific), so the copy starts clean.
export async function duplicatePractice(id: string, newDate: string): Promise<{ id: string | null; error: string | null }> {
  const original = await getPractice(id);
  if (!original) return { id: null, error: "Practice not found." };

  const { id: newId, error: createErr } = await createPractice({
    practice_date: newDate,
    start_time: original.start_time,
    roster_ids: original.roster_ids,
    week_id: original.week_id,
  });
  if (createErr || !newId) return { id: null, error: createErr };

  const blocks = await getPracticeBlocks(id);
  for (const block of blocks) {
    const { id: newBlockId } = await createBlock(newId, block.duration_minutes, block.order_index);
    if (!newBlockId) continue;
    const segments = await getSegments(block.id);
    for (const seg of segments) {
      const { id: newSegId } = await createSegment(newBlockId, seg.scope_type, seg.roster_id);
      if (!newSegId) continue;
      const drills = await getSegmentDrills(seg.id);
      for (const d of drills) {
        await createSegmentDrill(newSegId, {
          drill_id: d.drill_id, order_index: d.order_index, label: d.label,
          duration_minutes: d.duration_minutes, goal_text: d.goal_text,
          coach_name: d.coach_name, group_size: d.group_size, num_groups: d.num_groups,
        });
      }
    }
  }
  return { id: newId, error: null };
}

// ── Blocks ───────────────────────────────────────────────────

export async function getPracticeBlocks(practiceId: string): Promise<PracticeBlock[]> {
  const { data, error } = await supabase.from("practice_blocks").select("*").eq("practice_id", practiceId).order("order_index", { ascending: true });
  if (error) { console.error("Failed to load blocks:", error); return []; }
  return data ?? [];
}

export async function createBlock(practiceId: string, durationMinutes: number, orderIndex?: number): Promise<{ id: string | null; error: string | null }> {
  let idx = orderIndex;
  if (idx === undefined) {
    const existing = await getPracticeBlocks(practiceId);
    idx = existing.length;
  }
  const { data, error } = await supabase.from("practice_blocks")
    .insert({ practice_id: practiceId, duration_minutes: durationMinutes, order_index: idx })
    .select("id").single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function updateBlock(id: string, patch: Partial<Pick<PracticeBlock, "duration_minutes" | "order_index">>): Promise<{ error: string | null }> {
  const { error } = await supabase.from("practice_blocks").update(patch).eq("id", id);
  return { error: error?.message ?? null };
}

export async function deleteBlock(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("practice_blocks").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export async function reorderBlocks(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => supabase.from("practice_blocks").update({ order_index: i }).eq("id", id)));
}

// ── Segments ─────────────────────────────────────────────────

export async function getSegments(blockId: string): Promise<BlockSegment[]> {
  const { data, error } = await supabase.from("block_segments").select("*").eq("block_id", blockId);
  if (error) { console.error("Failed to load segments:", error); return []; }
  return data ?? [];
}

export async function createSegment(blockId: string, scopeType: "roster" | "combined", rosterId: string | null): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.from("block_segments")
    .insert({ block_id: blockId, scope_type: scopeType, roster_id: scopeType === "roster" ? rosterId : null })
    .select("id").single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function deleteSegment(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("block_segments").delete().eq("id", id);
  return { error: error?.message ?? null };
}

// ── Segment drills ───────────────────────────────────────────

export async function getSegmentDrills(segmentId: string): Promise<SegmentDrill[]> {
  const { data, error } = await supabase.from("segment_drills").select("*").eq("segment_id", segmentId).order("order_index", { ascending: true });
  if (error) { console.error("Failed to load segment drills:", error); return []; }
  return data ?? [];
}

export async function createSegmentDrill(segmentId: string, input: Partial<Omit<SegmentDrill, "id" | "segment_id">>): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.from("segment_drills")
    .insert({ segment_id: segmentId, ...input })
    .select("id").single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function updateSegmentDrill(id: string, patch: Partial<Omit<SegmentDrill, "id" | "segment_id">>): Promise<{ error: string | null }> {
  const { error } = await supabase.from("segment_drills").update(patch).eq("id", id);
  return { error: error?.message ?? null };
}

export async function deleteSegmentDrill(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("segment_drills").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export async function reorderSegmentDrills(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => supabase.from("segment_drills").update({ order_index: i }).eq("id", id)));
}

// Evenly re-splits a segment's drills across the parent block's
// duration (e.g. 4 stations in a 20-min block -> 5 min each). Called
// when a drill is added to/removed from a multi-drill segment; any
// manual per-drill edit made afterward is left alone until the next
// add/remove.
export async function autoSplitSegmentDrillDurations(segmentId: string, blockDurationMinutes: number): Promise<void> {
  const drills = await getSegmentDrills(segmentId);
  if (drills.length === 0) return;
  const each = Math.max(1, Math.floor(blockDurationMinutes / drills.length));
  await Promise.all(drills.map(d => updateSegmentDrill(d.id, { duration_minutes: each })));
}

// ── Saved groupings (coach-only, e.g. "Varsity Starters") ────

export interface SavedGrouping {
  id: string;
  name: string;
  roster_id: string;
  updated_at: string;
}

export async function getSavedGroupings(rosterId: string): Promise<SavedGrouping[]> {
  const { data, error } = await supabase.from("saved_groupings").select("*").eq("roster_id", rosterId).order("name", { ascending: true });
  if (error) { console.error("Failed to load saved groupings:", error); return []; }
  return data ?? [];
}

export async function getSavedGroupingMembers(groupingId: string): Promise<string[]> {
  const { data, error } = await supabase.from("saved_grouping_members").select("player_id").eq("grouping_id", groupingId);
  if (error) return [];
  return (data ?? []).map((r: any) => r.player_id);
}

export async function createSavedGrouping(name: string, rosterId: string, memberIds: string[]): Promise<{ id: string | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("saved_groupings")
    .insert({ name: name.trim(), roster_id: rosterId, created_by: user?.id })
    .select("id").single();
  if (error || !data?.id) return { id: null, error: error?.code === "23505" ? "A grouping with that name already exists for this roster." : error?.message ?? "Unknown error" };
  if (memberIds.length > 0) {
    await supabase.from("saved_grouping_members").insert(memberIds.map(pid => ({ grouping_id: data.id, player_id: pid })));
  }
  return { id: data.id, error: null };
}

export async function updateSavedGroupingMembers(groupingId: string, memberIds: string[]): Promise<{ error: string | null }> {
  await supabase.from("saved_grouping_members").delete().eq("grouping_id", groupingId);
  if (memberIds.length > 0) {
    const { error } = await supabase.from("saved_grouping_members").insert(memberIds.map(pid => ({ grouping_id: groupingId, player_id: pid })));
    if (error) return { error: error.message };
  }
  await supabase.from("saved_groupings").update({ updated_at: new Date().toISOString() }).eq("id", groupingId);
  return { error: null };
}

export async function renameSavedGrouping(groupingId: string, name: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("saved_groupings").update({ name: name.trim() }).eq("id", groupingId);
  return { error: error?.message ?? null };
}

export async function deleteSavedGrouping(groupingId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("saved_groupings").delete().eq("id", groupingId);
  return { error: error?.message ?? null };
}

// ── Group generation (client-side algorithm) ────────────────

// Distributes players into `numGroups` groups of up to `groupSize`,
// spreading each roster's players round-robin across the groups so a
// mixed segment ends up close to even per team (e.g. 4 Varsity/2 JV
// when counts don't divide evenly is fine — see chat). Anyone beyond
// a group's size cap lands in `bench`.
export function generateBalancedGroups<P extends { id: string; home_roster_id: string | null }>(
  players: P[], groupSize: number, numGroups: number
): { groups: string[][]; bench: string[] } {
  const groups: string[][] = Array.from({ length: numGroups }, () => []);
  const byRoster: Record<string, P[]> = {};
  players.forEach(p => {
    const key = p.home_roster_id ?? "_none";
    (byRoster[key] ??= []).push(p);
  });
  Object.values(byRoster).forEach(list => {
    list.forEach((p, i) => groups[i % numGroups].push(p.id));
  });
  const bench: string[] = [];
  groups.forEach(g => {
    while (g.length > groupSize) {
      const removed = g.pop();
      if (removed) bench.push(removed);
    }
  });
  return { groups, bench };
}

const GROUP_LABELS = ["Group A", "Group B", "Group C", "Group D", "Group E", "Group F", "Group G", "Group H"];

// Replaces whatever groups currently exist on a segment_drill with a
// freshly generated set. This is the "snapshot" moment — editing a
// saved grouping later never touches what gets written here.
export async function saveGeneratedGroups(segmentDrillId: string, groups: string[][]): Promise<{ error: string | null }> {
  await supabase.from("segment_drill_groups").delete().eq("segment_drill_id", segmentDrillId);
  for (let i = 0; i < groups.length; i++) {
    const { data, error } = await supabase.from("segment_drill_groups")
      .insert({ segment_drill_id: segmentDrillId, group_label: GROUP_LABELS[i] ?? `Group ${i + 1}`, order_index: i })
      .select("id").single();
    if (error || !data?.id) return { error: error?.message ?? "Failed to create group" };
    if (groups[i].length > 0) {
      await supabase.from("segment_drill_group_members").insert(groups[i].map(pid => ({ group_id: data.id, player_id: pid })));
    }
  }
  return { error: null };
}

// Drops a saved grouping (e.g. "Varsity Starters") into a segment_drill
// as one snapshotted group, alongside whatever else is already there.
export async function assignSavedGroupingToSegmentDrill(segmentDrillId: string, grouping: SavedGrouping, orderIndex: number): Promise<{ error: string | null }> {
  const memberIds = await getSavedGroupingMembers(grouping.id);
  const { data, error } = await supabase.from("segment_drill_groups")
    .insert({ segment_drill_id: segmentDrillId, group_label: grouping.name, source_saved_grouping_id: grouping.id, order_index: orderIndex })
    .select("id").single();
  if (error || !data?.id) return { error: error?.message ?? "Failed to assign grouping" };
  if (memberIds.length > 0) {
    await supabase.from("segment_drill_group_members").insert(memberIds.map(pid => ({ group_id: data.id, player_id: pid })));
  }
  return { error: null };
}

export interface SegmentDrillGroup {
  id: string;
  segment_drill_id: string;
  group_label: string | null;
  source_saved_grouping_id: string | null;
  order_index: number;
  member_ids: string[];
}

export async function getSegmentDrillGroups(segmentDrillId: string): Promise<SegmentDrillGroup[]> {
  const { data: groups, error } = await supabase.from("segment_drill_groups").select("*").eq("segment_drill_id", segmentDrillId).order("order_index", { ascending: true });
  if (error || !groups) return [];
  const { data: members } = await supabase.from("segment_drill_group_members").select("group_id,player_id").in("group_id", groups.map((g: any) => g.id));
  return groups.map((g: any) => ({
    ...g,
    member_ids: (members ?? []).filter((m: any) => m.group_id === g.id).map((m: any) => m.player_id),
  }));
}

export async function movePlayerBetweenGroups(fromGroupId: string, toGroupId: string, playerId: string): Promise<{ error: string | null }> {
  await supabase.from("segment_drill_group_members").delete().eq("group_id", fromGroupId).eq("player_id", playerId);
  const { error } = await supabase.from("segment_drill_group_members").insert({ group_id: toGroupId, player_id: playerId });
  return { error: error?.message ?? null };
}

export async function removeGroupMember(groupId: string, playerId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("segment_drill_group_members").delete().eq("group_id", groupId).eq("player_id", playerId);
  return { error: error?.message ?? null };
}

export async function addGroupMember(groupId: string, playerId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("segment_drill_group_members").insert({ group_id: groupId, player_id: playerId });
  return { error: error?.message ?? null };
}

// Counts how many groups across a whole practice contain a player
// who's excused for that practice — drives the "N groups need
// attention" badge in the weeks list without opening every block.
export async function getPracticeAttentionCount(practiceId: string): Promise<number> {
  const overrides = await getAttendanceOverrides(practiceId);
  const excused = new Set(overrides.filter(o => o.override_type === "excused").map(o => o.player_id));
  if (excused.size === 0) return 0;

  const blocks = await getPracticeBlocks(practiceId);
  let count = 0;
  for (const block of blocks) {
    const segs = await getSegments(block.id);
    for (const seg of segs) {
      const drills = await getSegmentDrills(seg.id);
      for (const drill of drills) {
        const groups = await getSegmentDrillGroups(drill.id);
        count += groups.filter(g => g.member_ids.some(pid => excused.has(pid))).length;
      }
    }
  }
  return count;
}

// ── Practice drill library (Phase 2) ─────────────────────────

export interface PracticeDrillCategory { name: string; sort_order: number; }

export interface PracticeDrillLibraryDrill {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  category_name: string | null;
  default_duration_minutes: number | null;
  default_group_size: number | null;
  default_num_groups: number | null;
  linked_play_id: string | null;
  is_starred: boolean;
  created_at: string;
}

export async function getPracticeDrillCategories(): Promise<PracticeDrillCategory[]> {
  const { data, error } = await supabase.from("practice_drill_categories").select("*").order("sort_order", { ascending: true });
  if (error) { console.error("Failed to load practice drill categories:", error); return []; }
  return data ?? [];
}

export async function createPracticeDrillCategory(name: string): Promise<{ error: string | null }> {
  const { data: existing } = await supabase.from("practice_drill_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;
  const { error } = await supabase.from("practice_drill_categories").insert({ name: name.trim(), sort_order: nextOrder });
  return { error: error?.code === "23505" ? "That category already exists." : error?.message ?? null };
}

export async function getPracticeDrillTags(): Promise<string[]> {
  const { data, error } = await supabase.from("practice_drill_tags").select("name").order("name", { ascending: true });
  if (error) return [];
  return (data ?? []).map((r: any) => r.name);
}

async function ensureTagsExist(tagNames: string[]): Promise<void> {
  if (tagNames.length === 0) return;
  await supabase.from("practice_drill_tags").upsert(tagNames.map(name => ({ name })), { onConflict: "name", ignoreDuplicates: true });
}

export interface DrillFilters {
  categoryName?: string | null;
  tags?: string[];
  starredOnly?: boolean;
  search?: string;
}

// Returns drills plus a tag map (drillId -> tag names) so the UI can
// filter/display without an extra round trip per card.
export async function getPracticeDrillLibrary(filters: DrillFilters = {}): Promise<{ drills: PracticeDrillLibraryDrill[]; tagsByDrill: Record<string, string[]> }> {
  let query = supabase.from("practice_drills_library").select("*").order("title", { ascending: true });
  if (filters.categoryName) query = query.eq("category_name", filters.categoryName);
  if (filters.starredOnly) query = query.eq("is_starred", true);
  if (filters.search) query = query.ilike("title", `%${filters.search}%`);
  const { data: drills, error } = await query;
  if (error) { console.error("Failed to load practice drill library:", error); return { drills: [], tagsByDrill: {} }; }

  const ids = (drills ?? []).map(d => d.id);
  const { data: tagLinks } = ids.length > 0
    ? await supabase.from("practice_drill_tag_links").select("drill_id,tag_name").in("drill_id", ids)
    : { data: [] as any[] };
  const tagsByDrill: Record<string, string[]> = {};
  (tagLinks ?? []).forEach((t: any) => { (tagsByDrill[t.drill_id] ??= []).push(t.tag_name); });

  let result = drills ?? [];
  if (filters.tags && filters.tags.length > 0) {
    result = result.filter(d => filters.tags!.every(t => (tagsByDrill[d.id] ?? []).includes(t)));
  }
  return { drills: result, tagsByDrill };
}

export async function createPracticeDrill(input: {
  title: string; description?: string; video_url?: string; category_name?: string | null;
  default_duration_minutes?: number | null; default_group_size?: number | null; default_num_groups?: number | null;
  linked_play_id?: string | null; tags?: string[];
}): Promise<{ id: string | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("practice_drills_library").insert({
    title: input.title.trim(),
    description: input.description?.trim() || null,
    video_url: input.video_url?.trim() || null,
    category_name: input.category_name || null,
    default_duration_minutes: input.default_duration_minutes ?? null,
    default_group_size: input.default_group_size ?? null,
    default_num_groups: input.default_num_groups ?? null,
    linked_play_id: input.linked_play_id || null,
    created_by: user?.id,
  }).select("id").single();
  if (error || !data?.id) return { id: null, error: error?.message ?? "Failed to create drill" };
  if (input.tags && input.tags.length > 0) {
    await ensureTagsExist(input.tags);
    await supabase.from("practice_drill_tag_links").insert(input.tags.map(t => ({ drill_id: data.id, tag_name: t })));
  }
  return { id: data.id, error: null };
}

export async function updatePracticeDrill(id: string, input: Partial<{
  title: string; description: string | null; video_url: string | null; category_name: string | null;
  default_duration_minutes: number | null; default_group_size: number | null; default_num_groups: number | null;
  linked_play_id: string | null; tags: string[];
}>): Promise<{ error: string | null }> {
  const { tags, ...rest } = input;
  const { error } = await supabase.from("practice_drills_library").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message };
  if (tags !== undefined) {
    await supabase.from("practice_drill_tag_links").delete().eq("drill_id", id);
    if (tags.length > 0) {
      await ensureTagsExist(tags);
      await supabase.from("practice_drill_tag_links").insert(tags.map(t => ({ drill_id: id, tag_name: t })));
    }
  }
  return { error: null };
}

export async function deletePracticeDrill(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("practice_drills_library").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export async function toggleDrillStar(id: string, starred: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase.from("practice_drills_library").update({ is_starred: starred }).eq("id", id);
  return { error: error?.message ?? null };
}

// Last several distinct drills used across any practice, most recent
// first — surfaced at the top of the picker per the "recently used" ask.
export async function getRecentlyUsedDrills(limit = 8): Promise<PracticeDrillLibraryDrill[]> {
  const { data: recent, error } = await supabase
    .from("segment_drills")
    .select("drill_id,created_at")
    .not("drill_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(50); // over-fetch, then dedupe client-side
  if (error || !recent) return [];
  const orderedIds: string[] = [];
  recent.forEach((r: any) => { if (!orderedIds.includes(r.drill_id)) orderedIds.push(r.drill_id); });
  const ids = orderedIds.slice(0, limit);
  if (ids.length === 0) return [];
  const { data: drills } = await supabase.from("practice_drills_library").select("*").in("id", ids);
  const byId = Object.fromEntries((drills ?? []).map((d: any) => [d.id, d]));
  return ids.map(id => byId[id]).filter(Boolean);
}

export async function getPlaysForLinking(): Promise<{ id: string; title: string }[]> {
  const { data, error } = await supabase.from("plays").select("id,title").order("title", { ascending: true });
  if (error) return [];
  return data ?? [];
}

// ── Assignable coaches (for the multi-coach picker on a drill) ────

export interface CoachLite { id: string; name: string; }

export async function getAssignableCoaches(): Promise<CoachLite[]> {
  const { data, error } = await supabase.from("profiles").select("id,name").in("role", ["coach", "admin"]).order("name", { ascending: true });
  if (error) { console.error("Failed to load coaches:", error); return []; }
  return data ?? [];
}

// Permanently removes a roster. Any player whose home_roster_id
// pointed here reverts to "no roster" (the FK is ON DELETE SET NULL).
// Saved groupings tied to this roster are deleted too (their own FK
// cascades). Past practices keep whatever roster ids they already
// stored — this doesn't rewrite practice history, it just means that
// id no longer resolves to a real roster name if displayed later.
export async function deleteRoster(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("rosters").delete().eq("id", id);
  return { error: error?.message ?? null };
}

// ── Bulk roster assignment (used by the "Add Players" picker) ────

export interface PlayerForRosterPicker { id: string; name: string; home_roster_id: string | null; }

export async function getAllPlayersLite(): Promise<PlayerForRosterPicker[]> {
  const { data, error } = await supabase.from("profiles").select("id,name,home_roster_id").eq("role", "player").order("name", { ascending: true });
  if (error) { console.error("Failed to load players:", error); return []; }
  return data ?? [];
}

export async function bulkSetPlayerRoster(playerIds: string[], rosterId: string): Promise<{ error: string | null }> {
  if (playerIds.length === 0) return { error: null };
  const { error } = await supabase.from("profiles").update({ home_roster_id: rosterId }).in("id", playerIds);
  return { error: error?.message ?? null };
}
