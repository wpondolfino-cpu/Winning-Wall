// src/lib/leaderboard.ts
// Leaderboard queries and biweekly champion logic

import { supabase, LeaderboardEntry, BiweeklyChampion } from "./supabase";
import { currentPeriodStart, currentPeriodEnd, getPeriodNumber } from "./periods";
import { getCurrentSeason } from "./records";

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from("leaderboard").select("*").order("rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getBiweeklyChampions(): Promise<BiweeklyChampion[]> {
  const { data, error } = await supabase
    .from("biweekly_champions").select("*").order("crowned_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function crownBiweeklyWinners(leaderboard: LeaderboardEntry[]): Promise<void> {
  const periodStart  = currentPeriodStart().toISOString();
  const periodEnd    = currentPeriodEnd().toISOString();
  const periodNumber = getPeriodNumber();
  const season       = await getCurrentSeason();

  const winners: Record<string, LeaderboardEntry> = {};
  for (const entry of leaderboard) {
    const cat = entry.grade_category ?? "Unknown";
    if (!winners[cat] || entry.total_points > winners[cat].total_points) {
      winners[cat] = entry;
    }
  }

  await supabase.from("profiles").update({ is_period_champion: false }).neq("id", "none");

  for (const [grade, winner] of Object.entries(winners)) {
    if (!winner.total_points) continue;

    const { data: prof } = await supabase
      .from("profiles").select("avatar_url").eq("id", winner.id).single();

    await supabase.from("profiles")
      .update({ is_period_champion: true, champion_since: new Date().toISOString() })
      .eq("id", winner.id);

    const { count: periodsWon } = await supabase
      .from("biweekly_champions")
      .select("id", { count: "exact", head: true })
      .eq("player_id", winner.id);

    try {
      await supabase.rpc("upsert_record", {
        p_type:          "most_periods_won",
        p_workout_id:    null,
        p_workout_title: null,
        p_workout_desc:  null,
        p_player_id:     winner.id,
        p_player_name:   winner.name,
        p_avatar_url:    prof?.avatar_url ?? null,
        p_value:         (periodsWon ?? 0) + 1,
        p_display_value: `${(periodsWon ?? 0) + 1} period${((periodsWon ?? 0) + 1) !== 1 ? "s" : ""}`,
        p_season:        season,
      });
    } catch (e) { console.error(e); }

    await supabase.from("biweekly_champions").insert({
      player_id:      winner.id,
      player_name:    winner.name,
      grade_category: grade,
      points:         winner.total_points,
      period_start:   periodStart,
      period_end:     periodEnd,
      period_number:  periodNumber,
      crowned_at:     new Date().toISOString(),
      avatar_url:     prof?.avatar_url ?? null,
    });
  }
}
