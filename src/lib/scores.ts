// src/lib/scores.ts
// Score submission, personal bests, attempt history, and unified reset logic

import { supabase, Score, ScoreAttempt, PersonalBest, XP_PER_ATTEMPT } from "./supabase";
import { awardXp } from "./xp";
import { checkAndUpdateRecords, refreshGlobalRecords } from "./records";

export function computeRawScore(s: {
  made: number; reps: number; sprint_secs: number; self_points: number;
}): number {
  if (s.self_points > 0) return s.self_points;
  if (s.sprint_secs > 0 && s.made === 0 && s.reps === 0) return -s.sprint_secs;
  return s.made + s.reps;
}

// ── Unified reset ─────────────────────────────────────────────
// Single source of truth for both bulk reset (PlayersPanel)
// and season reset (AdminSettings).
// playerIds = null resets ALL players.
// resetChampions = true for season reset only.
export async function resetPlayerScores(
  playerIds: string[] | null,
  options: {
    resetChampions?: boolean;
    resetPerks?: boolean;
  } = {}
): Promise<void> {
  const isAll    = playerIds === null;
  const SENTINEL = "00000000-0000-0000-0000-000000000000";

  // 1. Zero ALL score fields
  if (isAll) {
    await supabase.from("scores")
      .update({ points: 0, made: 0, reps: 0, self_points: 0 }).neq("id", SENTINEL);
  } else {
    await supabase.from("scores")
      .update({ points: 0, made: 0, reps: 0, self_points: 0 }).in("player_id", playerIds!);
  }

  // 2. Delete attempt history
  if (isAll) {
    await supabase.from("score_attempts").delete().neq("id", SENTINEL);
  } else {
    await supabase.from("score_attempts").delete().in("player_id", playerIds!);
  }

  // 3. Delete streak bonuses
  if (isAll) {
    await supabase.from("streak_bonuses").delete().neq("id", SENTINEL);
  } else {
    await supabase.from("streak_bonuses").delete().in("player_id", playerIds!);
  }

  // 4. Delete streaks
  if (isAll) {
    await supabase.from("streaks").delete().neq("player_id", SENTINEL);
  } else {
    await supabase.from("streaks").delete().in("player_id", playerIds!);
  }

  // 5. Clear champion status (season reset only)
  if (options.resetChampions) {
    if (isAll) {
      await supabase.from("profiles")
        .update({ is_period_champion: false, champion_since: null }).neq("id", SENTINEL);
    } else {
      await supabase.from("profiles")
        .update({ is_period_champion: false, champion_since: null }).in("id", playerIds!);
    }
  }

  // 6. Clear perk usage (optional)
  if (options.resetPerks) {
    if (isAll) {
      await supabase.from("perk_usage").delete().neq("id", SENTINEL);
    } else {
      await supabase.from("perk_usage").delete().in("player_id", playerIds!);
    }
  }
}

// ── Score submission ──────────────────────────────────────────
export async function submitScore(
  score: Omit<Score, "id" | "points" | "logged_at">
): Promise<{ saved: Score; isPersonalBest: boolean; previousBest: number | null }> {

  const newRaw = computeRawScore(score);

  const { data: workout } = await supabase
    .from("workouts")
    .select("first_place_pts, second_place_pts, third_place_pts, scoring_type, flat_points")
    .eq("id", score.workout_id)
    .single();

  const scoringType = workout?.scoring_type ?? "competitive";
  const firstPts    = workout?.first_place_pts  ?? 3;
  const secondPts   = workout?.second_place_pts ?? 2;
  const thirdPts    = workout?.third_place_pts  ?? 1;

  const { data: existing } = await supabase
    .from("scores")
    .select("*")
    .eq("player_id", score.player_id)
    .eq("workout_id", score.workout_id)
    .single();

  const previousBest: number | null =
    existing && computeRawScore(existing) > 0 ? computeRawScore(existing) : null;
  const isPersonalBest = previousBest === null || newRaw > previousBest;

  // Always log attempt for streak + history
  await supabase.from("score_attempts").insert({
    player_id:        score.player_id,
    workout_id:       score.workout_id,
    made:             score.made,
    reps:             score.reps,
    sprint_secs:      score.sprint_secs,
    self_points:      score.self_points,
    raw_score:        newRaw,
    is_personal_best: isPersonalBest,
    attempted_at:     new Date().toISOString(),
  });

  let saved: Score;
  const { local_date: _ld, ...cleanScore } = score as any;

  if (scoringType === "flat") {
    const flatPts    = workout?.flat_points ?? 0;
    const localToday = (score as any).local_date ?? new Date().toISOString().split("T")[0];
    const { data: existingRow } = await supabase
      .from("scores").select("*")
      .eq("player_id", score.player_id).eq("workout_id", score.workout_id).maybeSingle();

    if (existingRow && existingRow.last_logged_date === localToday) {
      saved = existingRow as Score;
    } else if (existingRow) {
      const newPoints = (existingRow.points ?? 0) + flatPts;
      const { data, error } = await supabase.from("scores")
        .update({ points: newPoints, self_points: flatPts, last_logged_date: localToday })
        .eq("player_id", score.player_id).eq("workout_id", score.workout_id)
        .select().single();
      if (error) throw error;
      saved = data as Score;
    } else {
      const { data, error } = await supabase.from("scores")
        .insert({ ...cleanScore, points: flatPts, self_points: flatPts, last_logged_date: localToday })
        .select().single();
      if (error) throw error;
      saved = data as Score;
    }

  } else if (scoringType === "self_reported") {
    const { data, error } = await supabase.from("scores")
      .upsert({ ...cleanScore, points: score.self_points }, { onConflict: "player_id,workout_id" })
      .select().single();
    if (error) throw error;
    saved = data as Score;

  } else {
    if (isPersonalBest) {
      const { data, error } = await supabase.from("scores")
        .upsert({ ...cleanScore, points: 0 }, { onConflict: "player_id,workout_id" })
        .select().single();
      if (error) throw error;
      saved = data as Score;
    } else {
      saved = existing as Score;
    }
    const { error: rankError } = await supabase.rpc("rerank_workout", {
      p_workout_id: score.workout_id,
      p_first_pts:  firstPts,
      p_second_pts: secondPts,
      p_third_pts:  thirdPts,
    });
    if (rankError) console.error("Re-rank error:", rankError);
  }

  // Save to personal_bests — survives season resets
  if (isPersonalBest) {
    await supabase.from("personal_bests").upsert({
      player_id:   score.player_id,
      workout_id:  score.workout_id,
      raw_score:   newRaw,
      achieved_at: new Date().toISOString(),
    }, { onConflict: "player_id,workout_id" });
  }

  // Award XP
  getXpActionValue("_xp_workout", XP_PER_ATTEMPT).then(xp =>
    awardXp(score.player_id, xp, "workout_attempt").catch(console.error)
  );

  // Award personal best bonus point
  if (isPersonalBest && previousBest !== null && scoringType === "competitive") {
    try {
      await supabase.from("streak_bonuses").insert({
        player_id:     score.player_id,
        points:        1,
        streak_length: 0,
        awarded_at:    new Date().toISOString(),
        reason:        "personal_best",
      });
    } catch (e) { console.error(e); }
  }

  // Update Hall of Fame records in background
  if (isPersonalBest) {
    const { data: prof } = await supabase
      .from("profiles").select("name,avatar_url").eq("id", score.player_id).single();
    const { data: wo } = await supabase
      .from("workouts").select("title,description").eq("id", score.workout_id).single();
    if (prof && wo) {
      checkAndUpdateRecords(
        score.player_id, prof.name, prof.avatar_url ?? null,
        score.workout_id, wo.title, wo.description ?? "", newRaw
      ).catch(console.error);
    }
    refreshGlobalRecords(
      score.player_id, prof?.name ?? "", prof?.avatar_url ?? null
    ).catch(console.error);
  }

  return { saved, isPersonalBest, previousBest };
}

export async function upsertScore(score: Omit<Score, "id" | "points" | "logged_at">) {
  const { data, error } = await supabase
    .from("scores").upsert(score, { onConflict: "player_id,workout_id" }).select().single();
  if (error) throw error;
  return data as Score;
}

export async function getMyScores(playerId: string): Promise<Score[]> {
  const { data, error } = await supabase
    .from("scores").select("*").eq("player_id", playerId)
    .order("logged_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAllScores(): Promise<Score[]> {
  const { data, error } = await supabase.from("scores").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function getMyAttempts(playerId: string): Promise<ScoreAttempt[]> {
  const { data, error } = await supabase
    .from("score_attempts").select("*").eq("player_id", playerId)
    .order("attempted_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getMyPersonalBests(playerId: string): Promise<PersonalBest[]> {
  const { data, error } = await supabase
    .from("personal_bests").select("*").eq("player_id", playerId)
    .order("achieved_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function awardChallengeWinBonus(playerId: string): Promise<void> {
  await supabase.from("streak_bonuses").insert({
    player_id:     playerId,
    points:        1,
    streak_length: 0,
    awarded_at:    new Date().toISOString(),
    reason:        "challenge_win",
  });
}

async function getXpActionValue(key: string, fallback: number): Promise<number> {
  const { data } = await supabase
    .from("xp_settings").select("xp_required").eq("perk_key", key).single();
  return data?.xp_required ?? fallback;
}
