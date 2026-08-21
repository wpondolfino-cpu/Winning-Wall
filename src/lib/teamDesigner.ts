// teamDesigner.ts — data layer for the Team Designer.
//
// The board is a PLAN, not a roster. Nothing here writes to rosters;
// rosters stay built by hand. That separation is what lets a plan hold
// people who don't have accounts yet, and lets you rearrange a depth
// chart without changing who's actually on a team.
//
// A slot always carries display_name as a snapshot alongside its
// reference, so clearing the tryout pool after cuts leaves the board
// intact — the names stay, only the links go.

import { supabase } from "./supabase";

export interface TeamPosition { id: string; name: string; order_index: number; }
export interface TeamPlan { id: string; season_id: string | null; name: string; created_at: string; updated_at: string; }
export interface TeamPlanLane { id: string; plan_id: string; name: string; order_index: number; }

export type SlotZone = "lane" | "bubble" | "unplaced";

export interface TeamPlanSlot {
  id: string;
  plan_id: string;
  zone: SlotZone;
  lane_id: string | null;
  position_id: string | null;
  rank: number;
  display_name: string;
  profile_id: string | null;
  tryout_player_id: string | null;
}

/** A card on the board, with everything the UI needs already resolved. */
export interface BoardCard extends TeamPlanSlot {
  /** Graduation year, from the linked profile. Null for a name-only card. */
  graduation_year: number | null;
  /** True once the card points at a real account — it's then live, and can show stats. */
  linked: boolean;
}

export const DEFAULT_POSITIONS = ["Ball handler", "Combo guard", "Wing", "Big wing", "Big"];
export const DEFAULT_LANES = ["Varsity", "JV", "Freshman"];

// ── Grades ────────────────────────────────────────────────────
//
// Graduation year is stored; grade is derived. A stored grade is wrong
// every June and would need a bulk update annually forever.
//
// The school year rolls in August, so anything from August onward counts
// as the next academic year.

export function currentAcademicYear(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

/** 9-12 during high school, 13+ once graduated (treat as alumni), <9 for an incoming class. */
export function gradeFromGradYear(gradYear: number | null, now = new Date()): number | null {
  if (!gradYear) return null;
  return 12 - (gradYear - currentAcademicYear(now));
}

export function isAlumni(gradYear: number | null, now = new Date()): boolean {
  const g = gradeFromGradYear(gradYear, now);
  return g != null && g > 12;
}

/** Derives the existing leaderboard grouping key, which is left as the source of truth for ranking. */
export function gradeCategoryFromGradYear(gradYear: number | null, now = new Date()): string | null {
  const g = gradeFromGradYear(gradYear, now);
  if (g == null) return null;
  if (g > 12) return "Alumni";
  if (g >= 11) return "Upperclassman (11th-12th Grade)";
  if (g >= 9) return "Underclassman (9th-10th Grade)";
  return null;
}

export function gradYearFromGrade(grade: number, now = new Date()): number {
  return currentAcademicYear(now) + (12 - grade);
}

/** Distinct colour per graduating class. Stable per year rather than per grade, so a class keeps its colour as it ages. */
export function gradeColor(gradYear: number | null): string {
  if (!gradYear) return "#6b7280";
  const palette = ["#2f6fd0", "#2f9e63", "#c48a1f", "#8a4fbf", "#b8342e"];
  return palette[gradYear % palette.length];
}

// ── Positions ─────────────────────────────────────────────────

export async function getPositions(): Promise<TeamPosition[]> {
  const { data, error } = await supabase.from("team_positions").select("*").order("order_index");
  if (error) { console.error("Failed to load positions:", error); return []; }
  return data ?? [];
}

/** Seeds the five defaults the first time the designer opens with none, so the board isn't a blank grid. */
export async function ensurePositions(): Promise<TeamPosition[]> {
  const existing = await getPositions();
  if (existing.length) return existing;
  const { data } = await supabase.from("team_positions")
    .insert(DEFAULT_POSITIONS.map((name, i) => ({ name, order_index: i })))
    .select();
  return (data as TeamPosition[]) ?? [];
}

export async function addPosition(name: string, orderIndex: number) {
  return supabase.from("team_positions").insert({ name: name.trim(), order_index: orderIndex }).select("id").single();
}

export async function renamePosition(id: string, name: string) {
  return supabase.from("team_positions").update({ name: name.trim() }).eq("id", id);
}

/** Slots referencing it get position_id nulled by the FK, which drops them back to unplaced rather than deleting anyone. */
export async function deletePosition(id: string) {
  await supabase.from("team_plan_slots").update({ zone: "unplaced", lane_id: null, position_id: null }).eq("position_id", id);
  return supabase.from("team_positions").delete().eq("id", id);
}

// ── Plans ─────────────────────────────────────────────────────

export async function getPlans(seasonId: string | null): Promise<TeamPlan[]> {
  let q = supabase.from("team_plans").select("*");
  if (seasonId) q = q.eq("season_id", seasonId);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) { console.error("Failed to load plans:", error); return []; }
  return data ?? [];
}

export async function createPlan(seasonId: string | null, name: string, lanes = DEFAULT_LANES): Promise<{ id: string | null; error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("team_plans")
    .insert({ season_id: seasonId, name: name.trim(), created_by: user?.id })
    .select("id").single();
  if (error || !data) return { id: null, error: error?.message ?? "Could not create plan." };
  await supabase.from("team_plan_lanes")
    .insert(lanes.map((name, i) => ({ plan_id: data.id, name, order_index: i })));
  return { id: data.id, error: null };
}

export async function renamePlan(id: string, name: string) {
  return supabase.from("team_plans").update({ name: name.trim(), updated_at: new Date().toISOString() }).eq("id", id);
}

export async function deletePlan(id: string) {
  return supabase.from("team_plans").delete().eq("id", id);
}

/** Copies lanes and slots. This is what both "project next year" and "start summer league from the depth chart" use. */
export async function duplicatePlan(id: string, name: string): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("duplicate_team_plan", { p_plan_id: id, p_name: name.trim() });
  return { id: (data as string) ?? null, error: error?.message ?? null };
}

// ── Lanes ─────────────────────────────────────────────────────

export async function getLanes(planId: string): Promise<TeamPlanLane[]> {
  const { data, error } = await supabase.from("team_plan_lanes").select("*").eq("plan_id", planId).order("order_index");
  if (error) return [];
  return data ?? [];
}

export async function addLane(planId: string, name: string, orderIndex: number) {
  return supabase.from("team_plan_lanes").insert({ plan_id: planId, name: name.trim(), order_index: orderIndex }).select("id").single();
}

export async function renameLane(id: string, name: string) {
  return supabase.from("team_plan_lanes").update({ name: name.trim() }).eq("id", id);
}

/** Cascades slots away, so the confirm in the UI has to say so. */
export async function deleteLane(id: string) {
  return supabase.from("team_plan_lanes").delete().eq("id", id);
}

// ── Slots ─────────────────────────────────────────────────────

export async function getSlots(planId: string): Promise<BoardCard[]> {
  const { data, error } = await supabase
    .from("team_plan_slots")
    .select("*, profiles:profile_id (graduation_year), tryout_players:tryout_player_id (grade, linked_profile_id)")
    .eq("plan_id", planId)
    .order("rank");
  if (error) { console.error("Failed to load slots:", error); return []; }
  return (data ?? []).map((row: any) => {
    // A tryout record that's been linked resolves through to the profile,
    // so linking once covers every plan the person appears in.
    const linkedId = row.profile_id ?? row.tryout_players?.linked_profile_id ?? null;
    const gradYear = row.profiles?.graduation_year
      ?? (row.tryout_players?.grade ? gradYearFromGrade(row.tryout_players.grade) : null);
    return { ...row, graduation_year: gradYear ?? null, linked: Boolean(linkedId) };
  });
}

export async function addSlot(planId: string, card: {
  display_name: string;
  profile_id?: string | null;
  tryout_player_id?: string | null;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from("team_plan_slots").insert({
    plan_id: planId,
    zone: "unplaced",
    display_name: card.display_name,
    profile_id: card.profile_id ?? null,
    tryout_player_id: card.tryout_player_id ?? null,
  });
  // The partial unique indexes reject a second slot for the same person,
  // which is the "no player on two teams" rule doing its job.
  if (error?.code === "23505") return { error: `${card.display_name} is already on this board.` };
  return { error: error?.message ?? null };
}

/**
 * Moves a card. Passing lane/position null drops it to a working area
 * below the board -- 'unplaced' or 'bubble' -- which is where anyone not
 * on a team ends up, and what the cut button reads.
 */
export async function moveSlot(slotId: string, target: {
  zone: SlotZone; lane_id?: string | null; position_id?: string | null; rank?: number;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from("team_plan_slots").update({
    zone: target.zone,
    lane_id: target.zone === "lane" ? target.lane_id ?? null : null,
    position_id: target.zone === "lane" ? target.position_id ?? null : null,
    rank: target.rank ?? 0,
  }).eq("id", slotId);
  return { error: error?.message ?? null };
}

/** Rewrites rank for a whole column after a drop, so the depth order is contiguous rather than drifting. */
export async function reorderColumn(slotIds: string[]): Promise<void> {
  await Promise.all(slotIds.map((id, i) => supabase.from("team_plan_slots").update({ rank: i }).eq("id", id)));
}

export async function removeSlot(slotId: string) {
  return supabase.from("team_plan_slots").delete().eq("id", slotId);
}

// ── Cuts ──────────────────────────────────────────────────────

/**
 * Deletes every tryout player NOT placed in a lane on this plan.
 *
 * The keep signal is placement, not linking: accounts get created weeks
 * after cuts, so at this moment almost nobody is linked and a link-based
 * rule would delete the whole team. Bubble and unplaced both count as not
 * kept, so emptying the bubble is the same action as making the cut.
 */
export async function cutPlayersNotInPlan(planId: string): Promise<{ deleted: number; error: string | null }> {
  const { data, error } = await supabase.rpc("cut_tryout_players_not_in_plan", { p_plan_id: planId });
  return { deleted: (data as number) ?? 0, error: error?.message ?? null };
}
