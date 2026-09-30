// src/lib/streaks.ts
// Streak tracking and bonus point logic

import { supabase, StreakRecord } from "./supabase";

export async function getStreak(playerId: string): Promise<StreakRecord | null> {
  const { data } = await supabase
    .from("streaks").select("*").eq("player_id", playerId).single();
  return data;
}

/**
 * Streaks are updated on the server when a workout is logged (log_workout,
 * migration 154) -- days in the program timezone, +3 every 7 in a row.
 * This only reads the result, for screens that still call it.
 */
export async function updateStreak(
  playerId: string
): Promise<{ newStreak: number; bonusAwarded: boolean }> {
  const existing = await getStreak(playerId);
  return { newStreak: existing?.current_streak ?? 0, bonusAwarded: false };
}
