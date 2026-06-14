// src/components/lifting/lifting.ts
// All Supabase queries for the lifting module

import { supabase } from "../../lib/supabase";

export type MuscleGroup = "Chest" | "Back" | "Legs" | "Shoulders" | "Arms" | "Core" | "Athletic" | "Other";
export const MUSCLE_GROUPS: MuscleGroup[] = ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Athletic", "Other"];

export interface BankExercise {
  id: string;
  name: string;
  muscle_group: MuscleGroup;
  video_url?: string;
  default_rest_secs: number;
  created_by?: string;
  created_at: string;
}

export interface LiftingProgram {
  id: string;
  title: string;
  description?: string;
  visibility: "public" | "assigned" | "personal";
  is_active: boolean;
  archived: boolean;
  created_by: string;
  start_date?: string;
  created_at: string;
}

export interface LiftingDay {
  id: string;
  program_id: string;
  name: string;
  day_number: number;
  is_rest_day: boolean;
}

export interface DayExercise {
  id: string;
  day_id: string;
  bank_exercise_id: string;
  target_sets?: number;
  target_reps?: number;
  target_weight?: number;
  rest_secs: number;
  superset_group?: number;
  sort_order: number;
  // joined from bank
  exercise?: BankExercise;
}

export interface LiftingLog {
  id: string;
  player_id: string;
  exercise_id: string; // bank_exercise_id
  logged_at: string;
  sets_data: { reps: number; weight: number }[];
  notes?: string;
}

// ── Exercise Bank ─────────────────────────────────────────────

export async function getExerciseBank(): Promise<BankExercise[]> {
  const { data, error } = await supabase
    .from("lifting_exercise_bank")
    .select("*")
    .order("muscle_group")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function upsertBankExercise(
  name: string,
  muscle_group: MuscleGroup,
  video_url: string | null,
  default_rest_secs: number,
  created_by: string
): Promise<BankExercise> {
  const { data, error } = await supabase
    .from("lifting_exercise_bank")
    .upsert({ name, muscle_group, video_url: video_url || null, default_rest_secs, created_by }, { onConflict: "name" })
    .select().single();
  if (error) throw error;
  return data as BankExercise;
}

// ── Programs ──────────────────────────────────────────────────

export async function getVisiblePrograms(playerId: string, canManage: boolean): Promise<LiftingProgram[]> {
  const { data: progs } = await supabase
    .from("lifting_programs")
    .select("*")
    .eq("is_active", true)
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (!progs) return [];

  if (canManage) return progs.filter(p => p.visibility !== "personal");

  const { data: assignments } = await supabase
    .from("lifting_program_assignments")
    .select("program_id")
    .eq("player_id", playerId);
  const assignedIds = new Set((assignments ?? []).map((a: any) => a.program_id));
  return progs.filter(p =>
    p.visibility === "public" ||
    assignedIds.has(p.id) ||
    (p.visibility === "personal" && p.created_by === playerId)
  );
}

export async function getArchivedPrograms(canManage: boolean): Promise<LiftingProgram[]> {
  const { data } = await supabase
    .from("lifting_programs")
    .select("*")
    .eq("is_active", true)
    .eq("archived", true)
    .order("created_at", { ascending: false });
  if (!canManage) return [];
  return (data ?? []).filter(p => p.visibility !== "personal");
}

export async function saveProgram(
  programId: string | null,
  fields: Partial<LiftingProgram>,
  createdBy: string
): Promise<string> {
  if (programId) {
    await supabase.from("lifting_programs").update(fields).eq("id", programId);
    return programId;
  }
  const { data, error } = await supabase.from("lifting_programs").insert({
    ...fields, created_by: createdBy, is_active: true, archived: false,
  }).select().single();
  if (error) throw error;
  return data.id;
}

export async function archiveProgram(programId: string) {
  await supabase.from("lifting_programs").update({ archived: true }).eq("id", programId);
}

export async function restoreProgram(programId: string) {
  await supabase.from("lifting_programs").update({ archived: false }).eq("id", programId);
}

export async function getAssignedPlayers(programId: string): Promise<string[]> {
  const { data } = await supabase
    .from("lifting_program_assignments")
    .select("player_id")
    .eq("program_id", programId);
  return (data ?? []).map((a: any) => a.player_id);
}

export async function saveAssignments(programId: string, playerIds: string[]) {
  await supabase.from("lifting_program_assignments").delete().eq("program_id", programId);
  if (playerIds.length > 0) {
    await supabase.from("lifting_program_assignments").insert(
      playerIds.map(pid => ({ program_id: programId, player_id: pid }))
    );
  }
}

// ── Days ─────────────────────────────────────────────────────

export async function getDaysForPrograms(programIds: string[]): Promise<LiftingDay[]> {
  if (programIds.length === 0) return [];
  const { data } = await supabase
    .from("lifting_days")
    .select("*")
    .in("program_id", programIds)
    .order("day_number");
  return data ?? [];
}

export async function saveDays(
  programId: string,
  days: Omit<LiftingDay, "id" | "program_id">[]
): Promise<LiftingDay[]> {
  await supabase.from("lifting_days").delete().eq("program_id", programId);
  if (days.length === 0) return [];
  const { data, error } = await supabase.from("lifting_days").insert(
    days.map(d => ({ ...d, program_id: programId }))
  ).select();
  if (error) throw error;
  return data ?? [];
}

// ── Day Exercises ─────────────────────────────────────────────

export async function getExercisesForDays(dayIds: string[]): Promise<(DayExercise & { exercise: BankExercise })[]> {
  if (dayIds.length === 0) return [];
  const { data } = await supabase
    .from("lifting_day_exercises")
    .select("*, exercise:lifting_exercise_bank(*)")
    .in("day_id", dayIds)
    .order("sort_order");
  return (data ?? []) as any;
}

export async function saveDayExercises(
  dayId: string,
  exs: Omit<DayExercise, "id" | "day_id">[]
) {
  await supabase.from("lifting_day_exercises").delete().eq("day_id", dayId);
  if (exs.length === 0) return;
  await supabase.from("lifting_day_exercises").insert(
    exs.map(e => ({ ...e, day_id: dayId }))
  );
}

// ── Logs ─────────────────────────────────────────────────────

export async function getLogsForExercises(
  playerId: string,
  bankExerciseIds: string[]
): Promise<LiftingLog[]> {
  if (bankExerciseIds.length === 0) return [];
  const { data } = await supabase
    .from("lifting_logs")
    .select("*")
    .eq("player_id", playerId)
    .in("exercise_id", bankExerciseIds)
    .order("logged_at", { ascending: false });
  return data ?? [];
}

export async function getAllLogsForProgram(
  dayIds: string[],
  bankExerciseIds: string[]
): Promise<any[]> {
  if (bankExerciseIds.length === 0) return [];
  const { data } = await supabase
    .from("lifting_logs")
    .select("*, player:profiles(id,name,avatar_url)")
    .in("exercise_id", bankExerciseIds)
    .order("logged_at", { ascending: true });
  return data ?? [];
}

export async function saveLog(
  playerId: string,
  bankExerciseId: string,
  setsData: { reps: number; weight: number }[],
  notes: string
): Promise<void> {
  await supabase.from("lifting_logs").insert({
    player_id: playerId,
    exercise_id: bankExerciseId,
    logged_at: new Date().toISOString(),
    sets_data: setsData,
    notes: notes || null,
  });
}

export async function updateLiftingRecord(
  playerId: string,
  playerName: string,
  avatarUrl: string | null,
  bankExerciseId: string,
  bestWeight: number,
  best1RM: number
): Promise<void> {
  const { data: existing } = await supabase
    .from("lifting_records")
    .select("best_1rm")
    .eq("player_id", playerId)
    .eq("exercise_id", bankExerciseId)
    .single();
  if (!existing || best1RM > existing.best_1rm) {
    await supabase.from("lifting_records").upsert({
      player_id: playerId,
      exercise_id: bankExerciseId,
      player_name: playerName,
      avatar_url: avatarUrl,
      best_weight: bestWeight,
      best_1rm: best1RM,
      achieved_at: new Date().toISOString(),
    }, { onConflict: "player_id,exercise_id" });
  }
}

// ── Helpers ───────────────────────────────────────────────────

export function calc1RM(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

export function getBestSet(setsData: { reps: number; weight: number }[]): { reps: number; weight: number } | null {
  if (!setsData || setsData.length === 0) return null;
  return setsData.reduce((max, s) => calc1RM(s.weight, s.reps) > calc1RM(max.weight, max.reps) ? s : max);
}

export function calcVolume(setsData: { reps: number; weight: number }[]): number {
  return setsData.reduce((sum, s) => sum + s.reps * s.weight, 0);
}

export function estimateDuration(dayExercises: DayExercise[]): number {
  // ~45s per set + rest time
  return dayExercises.reduce((mins, ex) => {
    const sets = ex.target_sets ?? 3;
    const rest = ex.rest_secs ?? 90;
    return mins + (sets * 45 + (sets - 1) * rest) / 60;
  }, 0);
}

export function getYouTubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  return match ? match[1] : null;
}
