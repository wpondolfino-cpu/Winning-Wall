// src/lib/scores.ts
// Scoring. Logging a workout or a Drill Library practice runs entirely on
// the server (log_workout / log_library_practice, migration 154): the
// browser sends what the player did and gets back what happened.
// Four scoring types: competitive, multi_spot, flat, self_reported.

import { supabase, Score, ScoreAttempt, PersonalBest, XP_PER_ATTEMPT } from "./supabase";
import { getLeaderboard } from "./leaderboard";

// ── Raw score calculation ─────────────────────────────────────
// Single function used everywhere — never inline this logic
export function computeRawScore(s: {
  made: number; reps: number; sprint_secs: number; self_points: number;
  tiebreak_value?: number | null;
}): number {
  if (s.self_points > 0) return s.self_points;
  if (s.sprint_secs > 0 && s.made === 0 && s.reps === 0) return -s.sprint_secs;
  return s.made + s.reps;
}

// ── Logging, on the server ──────────────────────────────────────
// Option B (migrations 154/155): every scoring rule -- the saved result,
// placings, personal bests and their bonus, the streak and its bonus,
// XP (first 3 logs of a drill per day), flat points -- runs in one
// server function. The browser only sends what the player did. Pushes
// ("you were passed", "your best was beaten") are still sent from here
// using what the server reports back.

async function notifyAfterLog(workoutId: string, result: any, oldAllTimeTotal: number | null, playerId: string) {
  // Their #1 on this drill was just taken.
  if (result?.overtaken_player) {
    try {
      const { data: wo } = await supabase.from("workouts").select("title").eq("id", workoutId).single();
      await supabase.functions.invoke("send-push", {
        body: {
          title: "⚡ Personal best overtaken!",
          message: `Someone just beat your personal best in ${wo?.title ?? "a drill"}!`,
          playerIds: [result.overtaken_player],
        },
      });
    } catch (e) { console.error("Push notification failed to send:", e); }
  }

  // Passed anyone on the overall leaderboard?
  if (oldAllTimeTotal == null) return;
  try {
    const afterBoard = await getLeaderboard();
    const newTotal = afterBoard.find(e => e.id === playerId)?.total_points ?? 0;
    if (newTotal > oldAllTimeTotal) {
      const overtaken = afterBoard.filter(e => e.id !== playerId && e.total_points > oldAllTimeTotal && e.total_points < newTotal);
      if (overtaken.length > 0) {
        const { data: prof } = await supabase.from("profiles").select("name").eq("id", playerId).single();
        await supabase.functions.invoke("send-push", {
          body: {
            title: "📈 You've been passed!",
            message: `${prof?.name ?? "Someone"} just passed you on the All-Time leaderboard!`,
            playerIds: overtaken.map(e => e.id),
          },
        });
      }
    }
  } catch (e) { console.error("All-time overtaken check failed:", e); }
}

/** A readable message from a server refusal ("Scores can't be negative..."). */
function serverError(error: any): Error {
  return new Error(error?.message ?? "Couldn't save that score.");
}

export interface LogResult {
  saved: Score;
  isPersonalBest: boolean;
  previousBest: number | null;
  newStreak: number;
  streakBonus: boolean;
  personalBestBonus: boolean;
  xp: number;
}

export async function submitScore(
  score: Omit<Score, "id" | "points" | "logged_at">
): Promise<LogResult> {
  const s = score as any;

  let oldAllTimeTotal: number | null = null;
  try {
    const beforeBoard = await getLeaderboard();
    oldAllTimeTotal = beforeBoard.find(e => e.id === s.player_id)?.total_points ?? 0;
  } catch (e) { console.error("Leaderboard snapshot (before) failed:", e); }

  const { data: result, error } = await supabase.rpc("log_workout", {
    p_workout_id:     s.workout_id,
    p_made:           s.made ?? 0,
    p_reps:           s.reps ?? 0,
    p_sprint_secs:    s.sprint_secs ?? 0,
    p_self_points:    s.self_points ?? 0,
    p_tiebreak_value: s.tiebreak_value ?? null,
    p_spot_scores:    s.spot_scores ?? null,
  });
  if (error) throw serverError(error);
  const r: any = result ?? {};

  const { data: saved } = await supabase.from("scores").select("*")
    .eq("player_id", s.player_id).eq("workout_id", s.workout_id).maybeSingle();

  // Hall of Fame: worked out on the server from its own numbers.
  if (r.is_personal_best) {
    supabase.rpc("refresh_my_records", { p_workout_id: s.workout_id }).then(({ error: e }) => { if (e) console.error(e); });
  }
  notifyAfterLog(s.workout_id, r, oldAllTimeTotal, s.player_id).catch(console.error);

  return {
    saved: (saved ?? {}) as Score,
    isPersonalBest: !!r.is_personal_best,
    previousBest: r.previous_best ?? null,
    newStreak: r.streak ?? 0,
    streakBonus: !!r.streak_bonus,
    personalBestBonus: !!r.personal_best_bonus,
    xp: r.xp ?? 0,
  };
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

export async function awardChallengeWinBonus(playerId: string, challengeId: string): Promise<void> {
  const { error } = await supabase.from("streak_bonuses").insert({
    player_id:     playerId,
    points:        1,
    streak_length: 0,
    awarded_at:    new Date().toISOString(),
    reason:        "challenge_win",
    challenge_id:  challengeId,
  });
  // 23505 = unique_violation — this challenge already paid out its bonus.
  // That's expected on a double-click/retry, not a real error.
  if (error && error.code !== "23505") throw error;
}

// ── Drill Library practice scoring ─────────────────────────────
// For drills a player practices outside the currently-assigned group.
// Rules:
//   - Flat 1 point, capped at once per drill per day (enforced by a
//     unique constraint on library_practice_log — no repeat-farming).
//   - A genuine personal best is NOT capped by that daily limit — it
//     always earns its own bonus and can still set the drill's Hall of
//     Fame record, same as official scoring.
//   - Still extends the daily streak and awards normal per-attempt XP.
export async function submitLibraryPracticeScore(
  playerId: string,
  workoutId: string,
  perf: { made?: number; reps?: number; sprint_secs?: number; self_points?: number }
): Promise<{ creditedToday: boolean; isPersonalBest: boolean; newStreak: number; streakBonus: boolean }> {
  const { data: result, error } = await supabase.rpc("log_library_practice", {
    p_workout_id:  workoutId,
    p_made:        perf.made ?? 0,
    p_reps:        perf.reps ?? 0,
    p_sprint_secs: perf.sprint_secs ?? 0,
    p_self_points: perf.self_points ?? 0,
  });
  if (error) throw serverError(error);
  const r: any = result ?? {};
  if (r.is_personal_best) {
    supabase.rpc("refresh_my_records", { p_workout_id: workoutId }).then(({ error: e }) => { if (e) console.error(e); });
  }
  notifyAfterLog(workoutId, r, null, playerId).catch(console.error);
  return { creditedToday: !!r.credited_today, isPersonalBest: !!r.is_personal_best, newStreak: r.streak ?? 0, streakBonus: !!r.streak_bonus };
}
