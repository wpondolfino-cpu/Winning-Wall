// src/lib/scores.ts
// Complete rewrite — single source of truth for all scoring paths
// Four scoring types: competitive, multi_spot, flat, self_reported
// Hard rules:
//   - Always strip local_date before any DB write
//   - Always write to scores.points (what the leaderboard view sums)
//   - Never call rerank_workout on flat or self_reported
//   - Never accept a zero/null score on competitive, multi_spot, self_reported
//   - Always log to score_attempts for streak tracking
//   - Award XP on every attempt
//   - Personal best +1 only on competitive/multi_spot when beating a real previous score

import { supabase, Score, ScoreAttempt, PersonalBest, XP_PER_ATTEMPT } from "./supabase";
import { awardXp } from "./xp";
import { checkAndUpdateRecords, refreshGlobalRecords } from "./records";

// ── Raw score calculation ─────────────────────────────────────
// Single function used everywhere — never inline this logic
export function computeRawScore(s: {
  made: number; reps: number; sprint_secs: number; self_points: number;
}): number {
  if (s.self_points > 0) return s.self_points;
  if (s.sprint_secs > 0 && s.made === 0 && s.reps === 0) return -s.sprint_secs;
  return s.made + s.reps;
}

// ── XP helper ─────────────────────────────────────────────────
async function getXpPerAttempt(): Promise<number> {
  const { data } = await supabase
    .from("xp_settings").select("xp_required").eq("perk_key", "_xp_workout").single();
  return data?.xp_required ?? XP_PER_ATTEMPT;
}

// ── Main submit function ──────────────────────────────────────
export async function submitScore(
  score: Omit<Score, "id" | "points" | "logged_at">
): Promise<{ saved: Score; isPersonalBest: boolean; previousBest: number | null }> {

  // Always strip local_date — it's not a DB column, just used for dedup logic
  const { local_date: localDate, ...cleanScore } = score as any;
  const today = localDate ?? new Date().toISOString().split("T")[0];

  // Fetch workout to get scoring type and point values
  const { data: workout } = await supabase
    .from("workouts")
    .select("scoring_type, flat_points, first_place_pts, second_place_pts, third_place_pts")
    .eq("id", score.workout_id)
    .single();

  if (!workout) throw new Error("Workout not found");

  const scoringType = workout.scoring_type ?? "competitive";
  const flatPts     = workout.flat_points ?? 1;
  const firstPts    = workout.first_place_pts ?? 5;
  const secondPts   = workout.second_place_pts ?? 3;
  const thirdPts    = workout.third_place_pts ?? 1;

  const newRaw = computeRawScore(cleanScore);

  // Guard: reject zero scores for non-flat types
  // (flat always has a value, self_reported/competitive need real input)
  if (scoringType !== "flat" && newRaw === 0) {
    throw new Error("Please enter a score before submitting.");
  }

  // Fetch existing score row if any
  const { data: existing } = await supabase
    .from("scores")
    .select("*")
    .eq("player_id", score.player_id)
    .eq("workout_id", score.workout_id)
    .maybeSingle();

  const previousBest: number | null =
    existing && (existing.points ?? 0) > 0 ? (existing.points ?? 0) : null;

  let saved: Score;
  let isPersonalBest = false;

  // ── Flat scoring ──────────────────────────────────────────
  // Everyone gets flat_points per day. Points accumulate across days.
  // No ranking, no competition.
  if (scoringType === "flat") {
    // Already logged today — return existing row, no double points
    if (existing?.last_logged_date === today) {
      saved = existing as Score;
      isPersonalBest = false;
    } else if (existing) {
      // Logged before but not today — add flat points
      const newPoints = (existing.points ?? 0) + flatPts;
      const { data, error } = await supabase.from("scores")
        .update({ points: newPoints, self_points: flatPts, last_logged_date: today })
        .eq("player_id", score.player_id)
        .eq("workout_id", score.workout_id)
        .select().single();
      if (error) throw error;
      saved = data as Score;
      isPersonalBest = true;
    } else {
      // First time logging this workout
      const { data, error } = await supabase.from("scores")
        .insert({ ...cleanScore, points: flatPts, self_points: flatPts, last_logged_date: today })
        .select().single();
      if (error) throw error;
      saved = data as Score;
      isPersonalBest = true;
    }

  // ── Self-reported scoring ─────────────────────────────────
  // Player enters their own point value. Goes directly to points.
  // No ranking. Most recent submission wins (upsert).
  } else if (scoringType === "self_reported") {
    const points = cleanScore.self_points ?? 0;
    const { data, error } = await supabase.from("scores")
      .upsert(
        { ...cleanScore, points, last_logged_date: today },
        { onConflict: "player_id,workout_id" }
      )
      .select().single();
    if (error) throw error;
    saved = data as Score;
    isPersonalBest = previousBest === null || points > (previousBest ?? 0);

  // ── Competitive and Multi-spot scoring ────────────────────
  // Players compete against each other. Rank determines points.
  // rerank_workout RPC assigns 1st/2nd/3rd place points to everyone.
  } else {
    isPersonalBest = previousBest === null || newRaw > (previousBest ?? 0);

    if (isPersonalBest) {
      // Upsert new best — points start at 0 until rerank assigns them
      const { data, error } = await supabase.from("scores")
        .upsert(
          { ...cleanScore, points: 0, last_logged_date: today },
          { onConflict: "player_id,workout_id" }
        )
        .select().single();
      if (error) throw error;
      saved = data as Score;
    } else {
      // Not a new best — keep existing score on leaderboard
      saved = existing as Score;
    }

    // Rerank everyone on this workout
    const { error: rankError } = await supabase.rpc("rerank_workout", {
      p_workout_id: score.workout_id,
      p_first_pts:  firstPts,
      p_second_pts: secondPts,
      p_third_pts:  thirdPts,
    });
    if (rankError) console.error("Re-rank error:", rankError);

    // Personal best bonus point (+1) when genuinely beating a previous score
    if (isPersonalBest && previousBest !== null) {
      try {
        await supabase.from("streak_bonuses").insert({
          player_id:     score.player_id,
          points:        1,
          streak_length: 0,
          awarded_at:    new Date().toISOString(),
          reason:        "personal_best",
        });
      } catch (e) { console.error("Personal best bonus error:", e); }
    }
  }

  // ── Always log attempt (used for streak tracking + history) ──
  await supabase.from("score_attempts").insert({
    player_id:        score.player_id,
    workout_id:       score.workout_id,
    made:             cleanScore.made ?? 0,
    reps:             cleanScore.reps ?? 0,
    sprint_secs:      cleanScore.sprint_secs ?? 0,
    self_points:      cleanScore.self_points ?? 0,
    raw_score:        newRaw,
    is_personal_best: isPersonalBest,
    attempted_at:     new Date().toISOString(),
  });

  // ── Update personal_bests table (survives season resets) ──
  if (isPersonalBest) {
    await supabase.from("personal_bests").upsert({
      player_id:   score.player_id,
      workout_id:  score.workout_id,
      raw_score:   newRaw,
      achieved_at: new Date().toISOString(),
    }, { onConflict: "player_id,workout_id" });
  }

  // ── Award XP on every attempt ─────────────────────────────
  const xpAmount = await getXpPerAttempt();
  awardXp(score.player_id, xpAmount, "workout_attempt").catch(console.error);

  // ── Update Hall of Fame records ───────────────────────────
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
      refreshGlobalRecords(
        score.player_id, prof.name, prof.avatar_url ?? null
      ).catch(console.error);
    }
  }

  return { saved, isPersonalBest, previousBest };
}

// ── Unified score reset ───────────────────────────────────────
// Single source of truth for both bulk reset (PlayersPanel)
// and season reset (AdminSettings).
export async function resetPlayerScores(
  playerIds: string[] | null,
  options: { resetChampions?: boolean; resetPerks?: boolean; } = {}
): Promise<void> {
  const isAll    = playerIds === null;
  const SENTINEL = "00000000-0000-0000-0000-000000000000";

  if (isAll) {
    await supabase.from("scores").update({ points: 0, made: 0, reps: 0, self_points: 0 }).neq("id", SENTINEL);
    await supabase.from("score_attempts").delete().neq("id", SENTINEL);
    await supabase.from("streak_bonuses").delete().neq("id", SENTINEL);
    await supabase.from("streaks").delete().neq("player_id", SENTINEL);
  } else {
    await supabase.from("scores").update({ points: 0, made: 0, reps: 0, self_points: 0 }).in("player_id", playerIds!);
    await supabase.from("score_attempts").delete().in("player_id", playerIds!);
    await supabase.from("streak_bonuses").delete().in("player_id", playerIds!);
    await supabase.from("streaks").delete().in("player_id", playerIds!);
  }

  if (options.resetChampions) {
    if (isAll) {
      await supabase.from("profiles").update({ is_period_champion: false, champion_since: null }).neq("id", SENTINEL);
    } else {
      await supabase.from("profiles").update({ is_period_champion: false, champion_since: null }).in("id", playerIds!);
    }
  }

  if (options.resetPerks) {
    if (isAll) {
      await supabase.from("perk_usage").delete().neq("id", SENTINEL);
    } else {
      await supabase.from("perk_usage").delete().in("player_id", playerIds!);
    }
  }
}

// ── Read helpers ──────────────────────────────────────────────
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

export async function upsertScore(score: Omit<Score, "id" | "points" | "logged_at">) {
  const { data, error } = await supabase
    .from("scores").upsert(score, { onConflict: "player_id,workout_id" }).select().single();
  if (error) throw error;
  return data as Score;
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
