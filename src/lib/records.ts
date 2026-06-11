// src/lib/records.ts
// Hall of Fame records — best scores and all-time stats

import { supabase } from "./supabase";

export async function getCurrentSeason(): Promise<string> {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export async function checkAndUpdateRecords(
  playerId: string,
  playerName: string,
  avatarUrl: string | null,
  workoutId: string,
  workoutTitle: string,
  workoutDesc: string,
  newScore: number,
): Promise<void> {
  const season = await getCurrentSeason();
  await supabase.rpc("upsert_record", {
    p_type:          "best_score",
    p_workout_id:    workoutId,
    p_workout_title: workoutTitle,
    p_workout_desc:  workoutDesc,
    p_player_id:     playerId,
    p_player_name:   playerName,
    p_avatar_url:    avatarUrl,
    p_value:         newScore,
    p_display_value: newScore.toString(),
    p_season:        season,
  });
}

export async function refreshGlobalRecords(
  playerId: string,
  playerName: string,
  avatarUrl: string | null,
): Promise<void> {
  const season = await getCurrentSeason();

  const { data: lb } = await supabase
    .from("leaderboard")
    .select("id,name,total_points,avatar_url,workouts_completed")
    .eq("id", playerId).single();

  if (lb) {
    await supabase.rpc("upsert_record", {
      p_type: "most_points_alltime", p_workout_id: null,
      p_workout_title: null, p_workout_desc: null,
      p_player_id: playerId, p_player_name: playerName, p_avatar_url: avatarUrl,
      p_value: lb.total_points, p_display_value: `${lb.total_points} pts`, p_season: season,
    });
    await supabase.rpc("upsert_record", {
      p_type: "most_workouts_alltime", p_workout_id: null,
      p_workout_title: null, p_workout_desc: null,
      p_player_id: playerId, p_player_name: playerName, p_avatar_url: avatarUrl,
      p_value: (lb as any).workouts_completed ?? 0,
      p_display_value: `${(lb as any).workouts_completed ?? 0} workouts`, p_season: season,
    });
  }

  const { count: wins } = await supabase.from("challenges")
    .select("id", { count: "exact", head: true })
    .eq("winner_id", playerId).eq("status", "completed");

  if (wins && wins > 0) {
    await supabase.rpc("upsert_record", {
      p_type: "most_challenges_won", p_workout_id: null,
      p_workout_title: null, p_workout_desc: null,
      p_player_id: playerId, p_player_name: playerName, p_avatar_url: avatarUrl,
      p_value: wins, p_display_value: `${wins} wins`, p_season: season,
    });
  }

  const { count: total } = await supabase.from("challenges")
    .select("id", { count: "exact", head: true })
    .or(`challenger_id.eq.${playerId},opponent_id.eq.${playerId}`)
    .eq("status", "completed");

  if (total && total >= 10 && wins) {
    const rate = Math.round(((wins as number) / total) * 100);
    await supabase.rpc("upsert_record", {
      p_type: "best_win_rate", p_workout_id: null,
      p_workout_title: null, p_workout_desc: null,
      p_player_id: playerId, p_player_name: playerName, p_avatar_url: avatarUrl,
      p_value: rate, p_display_value: `${rate}% (${wins}/${total})`, p_season: season,
    });
  }

  const { data: streak } = await supabase
    .from("streaks").select("longest_streak").eq("player_id", playerId).single();

  if (streak?.longest_streak) {
    await supabase.rpc("upsert_record", {
      p_type: "longest_streak", p_workout_id: null,
      p_workout_title: null, p_workout_desc: null,
      p_player_id: playerId, p_player_name: playerName, p_avatar_url: avatarUrl,
      p_value: streak.longest_streak,
      p_display_value: `${streak.longest_streak} days`, p_season: season,
    });
  }
}

export async function getRecords() {
  const { data } = await supabase
    .from("records").select("*")
    .order("record_type").order("value", { ascending: false });
  return data ?? [];
}

export async function getBestScoreRecords() {
  const { data } = await supabase
    .from("records").select("*")
    .eq("record_type", "best_score").order("workout_title");
  return data ?? [];
}
