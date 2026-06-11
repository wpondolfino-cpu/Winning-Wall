// src/lib/streaks.ts
// Streak tracking and bonus point logic

import { supabase, StreakRecord, STREAK_BONUS_DAYS, STREAK_BONUS_PTS } from "./supabase";

export async function getStreak(playerId: string): Promise<StreakRecord | null> {
  const { data } = await supabase
    .from("streaks").select("*").eq("player_id", playerId).single();
  return data;
}

export async function updateStreak(
  playerId: string
): Promise<{ newStreak: number; bonusAwarded: boolean }> {
  const today    = new Date().toISOString().split("T")[0];
  const existing = await getStreak(playerId);

  let newStreak    = 1;
  let bonusAwarded = false;

  if (existing) {
    const lastDate  = new Date(existing.last_logged_date);
    const todayDate = new Date(today);
    const diffDays  = Math.floor(
      (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) {
      return { newStreak: existing.current_streak, bonusAwarded: false };
    } else if (diffDays === 1) {
      newStreak = existing.current_streak + 1;
    } else {
      newStreak = 1;
    }
  }

  const prevStreak          = existing?.current_streak ?? 0;
  const alreadyAwardedToday = existing?.bonus_awarded_at === today;
  const crossedNewMilestone =
    Math.floor(newStreak / STREAK_BONUS_DAYS) > Math.floor(prevStreak / STREAK_BONUS_DAYS);

  if (crossedNewMilestone && !alreadyAwardedToday) {
    bonusAwarded = true;
    await supabase.from("streak_bonuses").insert({
      player_id:     playerId,
      points:        STREAK_BONUS_PTS,
      streak_length: newStreak,
      awarded_at:    new Date().toISOString(),
    });
  }

  await supabase.from("streaks").upsert({
    player_id:        playerId,
    current_streak:   newStreak,
    longest_streak:   Math.max(newStreak, existing?.longest_streak ?? 0),
    last_logged_date: today,
    bonus_awarded_at: bonusAwarded ? today : existing?.bonus_awarded_at,
  }, { onConflict: "player_id" });

  return { newStreak, bonusAwarded };
}
