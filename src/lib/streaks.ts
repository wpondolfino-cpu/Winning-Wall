// src/lib/streaks.ts
// Streak tracking and bonus point logic

import { supabase, StreakRecord } from "./supabase";

export async function getStreak(playerId: string): Promise<StreakRecord | null> {
  const { data } = await supabase
    .from("streaks").select("*").eq("player_id", playerId).single();
  return data;
}

