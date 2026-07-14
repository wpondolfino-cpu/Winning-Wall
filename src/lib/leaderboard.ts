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

// Computes real Current Period standings (same math as the Leaderboard's
// "Current" tab) — used for crowning and history snapshots, since those
// should reflect the two-week period, not all-time totals. Returned in
// the same shape as LeaderboardEntry so crownBiweeklyWinners and the
// snapshot-save logic don't need to change at all — only the data
// source feeding them does.
export async function getCurrentPeriodStandings(): Promise<LeaderboardEntry[]> {
  const periodStart = currentPeriodStart();
  const periodEnd = currentPeriodEnd();

  const [{ data: psc }, { data: pr }, { data: bon }, { data: sc }] = await Promise.all([
    supabase.from("score_attempts").select("*")
      .gte("attempted_at", periodStart.toISOString())
      .lte("attempted_at", periodEnd.toISOString()),
    supabase.from("profiles").select("id,name,grade_category,is_period_champion,avatar_url").eq("role", "player"),
    supabase.from("streak_bonuses").select("*")
      .gte("awarded_at", periodStart.toISOString())
      .lte("awarded_at", periodEnd.toISOString()),
    supabase.from("scores").select("*"),
  ]);

  const periodScores = psc ?? [];
  const profiles = pr ?? [];
  const periodBonuses = bon ?? [];
  const allScores = sc ?? [];

  const periodActivity: Record<string, Set<string>> = {};
  for (const s of periodScores as any[]) {
    if (!periodActivity[s.player_id]) periodActivity[s.player_id] = new Set();
    periodActivity[s.player_id].add(s.workout_id);
  }

  const entries: LeaderboardEntry[] = [];
  for (const playerId of Object.keys(periodActivity)) {
    const p = (profiles as any[]).find(pr => pr.id === playerId);
    if (!p) continue;
    const workoutIds = Array.from(periodActivity[playerId]);
    const playerScores = (allScores as any[]).filter(s => s.player_id === playerId && workoutIds.includes(s.workout_id));
    const drillPoints = playerScores.reduce((sum, s) => sum + (s.points ?? 0), 0);
    const bonusPoints = (periodBonuses as any[]).filter(b => b.player_id === playerId).reduce((sum, b) => sum + (b.points ?? 0), 0);
    entries.push({
      id: playerId, name: p.name, grade_category: p.grade_category,
      total_points: drillPoints + bonusPoints,
      workouts_completed: periodActivity[playerId].size,
      avatar_url: p.avatar_url, is_period_champion: p.is_period_champion,
    } as unknown as LeaderboardEntry);
  }
  return entries.sort((a, b) => b.total_points - a.total_points);
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
