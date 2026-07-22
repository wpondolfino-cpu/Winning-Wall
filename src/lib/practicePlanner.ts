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
  coach_name: string | null;
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
