// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

// ── Grade Categories ──────────────────────────────────────────
export const GRADE_CATEGORIES = [
  "Underclassman (9th-10th Grade)",
  "Upperclassman (11th-12th Grade)",
  "Alumni",
] as const;
export type GradeCategory = typeof GRADE_CATEGORIES[number];

// ── Scoring Types ─────────────────────────────────────────────
// "competitive"   — ranked within grade group (1st=3pts, 2nd=2pts, 3rd=1pt)
// "self_reported" — player types in their own point value
// "flat"          — everyone who logs gets the same fixed points
export type ScoringType = "competitive" | "self_reported" | "flat";

// ── Streak bonus ──────────────────────────────────────────────
export const STREAK_BONUS_DAYS = 7;   // consecutive days to trigger bonus
export const STREAK_BONUS_PTS  = 3;   // bonus points awarded every 7 days

// ── Biweekly period helper ────────────────────────────────────
// Uses a configurable anchor date stored in the database settings
// Admin can change the period start from the Admin panel

export function getPeriodAnchor(): Date {
  // Check localStorage for admin-set anchor date
  const stored = localStorage.getItem("period_anchor");
  if (stored) return new Date(stored);
  // Default anchor — admin should set this via Admin panel
  return new Date("2025-05-03");
}

export function setPeriodAnchor(date: Date) {
  localStorage.setItem("period_anchor", date.toISOString());
}

export function currentPeriodStart(): Date {
  const EPOCH = getPeriodAnchor();
  const now = new Date();
  const msSinceEpoch = now.getTime() - EPOCH.getTime();
  const periodMs = 14 * 24 * 60 * 60 * 1000;
  if (msSinceEpoch < 0) return EPOCH; // before anchor, use anchor as start
  const periodsSince = Math.floor(msSinceEpoch / periodMs);
  return new Date(EPOCH.getTime() + periodsSince * periodMs);
}

export function currentPeriodEnd(): Date {
  const start = currentPeriodStart();
  return new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
}

export function getPeriodNumber(): number {
  const EPOCH = getPeriodAnchor();
  const now = new Date();
  const msSinceEpoch = now.getTime() - EPOCH.getTime();
  const periodMs = 14 * 24 * 60 * 60 * 1000;
  return Math.floor(msSinceEpoch / periodMs) + 1;
}

// ── Database Types ────────────────────────────────────────────
export type Role = "player" | "coach" | "admin" | "inactive" | "pending_player" | "pending_coach";

export interface Profile {
  id: string;
  name: string;
  role: Role;
  position?: string;
  jersey?: number;
  grade_category?: GradeCategory;
  avatar_url?: string;
  is_period_champion?: boolean;
  champion_since?: string;
  must_change_password?: boolean;
  team_id?: string;
  created_at: string;
}

export interface Workout {
  id: string;
  coach_id: string;
  title: string;
  description?: string;
  category: "Dribbling" | "Finishing" | "Shooting" | "Competing" | "Strength";
  video_url?: string;
  emoji: string;
  scoring_type: ScoringType;
  scoring_metric?: string;
  flat_points?: number;
  first_place_pts?: number;   // custom points for 1st place (competitive)
  second_place_pts?: number;  // custom points for 2nd place (competitive)
  third_place_pts?: number;   // custom points for 3rd place (competitive)
  group_name?: string;
  is_active?: boolean;
  deadline?: string;
  leaderboard_active?: boolean;
  created_at: string;
}

export interface Score {
  id: string;
  player_id: string;
  workout_id: string;
  made: number;
  attempts: number;
  sprint_secs: number;
  reps: number;
  self_points: number;
  points: number;
  logged_at: string;
}

export interface ScoreAttempt {
  id: string;
  player_id: string;
  workout_id: string;
  made: number;
  reps: number;
  sprint_secs: number;
  self_points: number;
  raw_score: number;     // computed: made + reps or self_points
  is_personal_best: boolean;
  attempted_at: string;
}

export interface StreakRecord {
  id: string;
  player_id: string;
  current_streak: number;
  longest_streak: number;
  last_logged_date: string;
  bonus_awarded_at?: string;
}

export interface BiweeklyChampion {
  id: string;
  player_id: string;
  player_name: string;
  grade_category: GradeCategory;
  points: number;
  period_start: string;
  period_end: string;
  crowned_at: string;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  position?: string;
  jersey?: number;
  grade_category?: GradeCategory;
  avatar_url?: string;
  total_points: number;
  total_made: number;
  total_attempts: number;
  best_sprint: number;
  workouts_completed: number;
  last_logged_at?: string;
  rank: number;
  is_period_champion?: boolean;
  current_streak?: number;
}

// ── Auth helpers ──────────────────────────────────────────────
export async function signUp(
  email: string,
  password: string,
  profile: Omit<Profile, "id" | "created_at">,
  selfRegistered = true  // true = needs approval, false = added by coach/admin
) {
  // Self-registered accounts go into pending state for approval
  const pendingRole = selfRegistered
    ? (profile.role === "coach" ? "pending_coach" : "pending_player")
    : profile.role;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: profile.name,
        role: pendingRole,
        grade_category: profile.grade_category,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function awardChallengeWinBonus(playerId: string): Promise<void> {
  // Award +1 point for winning a head-to-head challenge
  await supabase.from("streak_bonuses").insert({
    player_id: playerId,
    points: 1,
    streak_length: 0,
    awarded_at: new Date().toISOString(),
    reason: "challenge_win",
  });
}

export async function approveUser(userId: string, role: "player" | "coach"): Promise<void> {
  const { error } = await supabase.from("profiles")
    .update({ role })
    .eq("id", userId);
  if (error) throw error;
}

export async function rejectUser(userId: string): Promise<void> {
  // Use RPC to delete both the profile and auth user with elevated privileges
  const { error } = await supabase.rpc("delete_pending_user", { target_user_id: userId });
  if (error) throw error;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  return data;
}

// ── Workout helpers ───────────────────────────────────────────
export async function getWorkouts(): Promise<Workout[]> {
  const { data, error } = await supabase
    .from("workouts").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createWorkout(
  workout: Omit<Workout, "id" | "created_at" | "coach_id">
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("workouts").insert({ ...workout, coach_id: user.id }).select().single();
  if (error) throw error;
  return data as Workout;
}

// ── Score helpers ─────────────────────────────────────────────

// Computes the single "raw score" number used for ranking
export function computeRawScore(s: { made: number; reps: number; sprint_secs: number; self_points: number }): number {
  if (s.self_points > 0) return s.self_points;
  if (s.sprint_secs > 0 && s.made === 0 && s.reps === 0) return -s.sprint_secs; // lower = better for time
  return s.made + s.reps;
}

export async function submitScore(
  score: Omit<Score, "id" | "points" | "logged_at">
): Promise<{ saved: Score; isPersonalBest: boolean; previousBest: number | null }> {

  const newRaw = computeRawScore(score);

  // 1. Fetch the workout to get custom rank points + scoring type
  const { data: workout } = await supabase
    .from("workouts")
    .select("first_place_pts, second_place_pts, third_place_pts, scoring_type, flat_points")
    .eq("id", score.workout_id)
    .single();

  const scoringType = workout?.scoring_type ?? "competitive";
  const firstPts    = workout?.first_place_pts  ?? 3;
  const secondPts   = workout?.second_place_pts ?? 2;
  const thirdPts    = workout?.third_place_pts  ?? 1;

  // 2. Check if a personal best already exists
  const { data: existing } = await supabase
    .from("scores")
    .select("*")
    .eq("player_id", score.player_id)
    .eq("workout_id", score.workout_id)
    .single();

  const previousBest: number | null = (existing && computeRawScore(existing) > 0) ? computeRawScore(existing) : null;
  const isPersonalBest = previousBest === null || newRaw > previousBest;

  // 3. Always log this attempt for streak + history
  await supabase.from("score_attempts").insert({
    player_id: score.player_id,
    workout_id: score.workout_id,
    made: score.made,
    reps: score.reps,
    sprint_secs: score.sprint_secs,
    self_points: score.self_points,
    raw_score: newRaw,
    is_personal_best: isPersonalBest,
    attempted_at: new Date().toISOString(),
  });

  // 4. Save score and assign points based on scoring type
  let saved: Score;

  // Strip client-only fields before saving to DB
  const { local_date: _ld, ...cleanScore } = score as any;

  if (scoringType === "flat") {
    // ── Flat: award points once per calendar day (local timezone) ──
    const flatPts = workout?.flat_points ?? 0;
    // Use local date passed in score object, fallback to UTC date
    const localToday = (score as any).local_date ?? new Date().toISOString().split("T")[0];

    const { data: existingRow } = await supabase.from("scores")
      .select("*").eq("player_id", score.player_id).eq("workout_id", score.workout_id).maybeSingle();

    if (existingRow && existingRow.last_logged_date === localToday) {
      // Already logged today in their timezone — no new points
      saved = existingRow as Score;
    } else if (existingRow) {
      // Different day — add flat points
      const newPoints = (existingRow.points ?? 0) + flatPts;
      const { data, error } = await supabase.from("scores")
        .update({ points: newPoints, self_points: flatPts, last_logged_date: localToday })
        .eq("player_id", score.player_id).eq("workout_id", score.workout_id)
        .select().single();
      if (error) throw error;
      saved = data as Score;
    } else {
      // First ever log — insert fresh
      const { data, error } = await supabase.from("scores")
        .insert({ ...score, points: flatPts, self_points: flatPts, last_logged_date: localToday }).select().single();
      if (error) throw error;
      saved = data as Score;
    }

  } else if (scoringType === "self_reported") {
    // ── Self-reported: points = exactly what the player typed in ──
    const { data, error } = await supabase
      .from("scores")
      .upsert({ ...cleanScore, points: score.self_points }, { onConflict: "player_id,workout_id" })
      .select().single();
    if (error) throw error;
    saved = data as Score;

  } else {
    // ── Competitive: save raw score first, then re-rank everyone ──
    if (isPersonalBest) {
      const { data, error } = await supabase
        .from("scores")
        .upsert({ ...cleanScore, points: 0 }, { onConflict: "player_id,workout_id" })
        .select().single();
      if (error) throw error;
      saved = data as Score;
    } else {
      saved = existing as Score;
    }
    // Re-rank all players atomically
    const { error: rankError } = await supabase.rpc("rerank_workout", {
      p_workout_id: score.workout_id,
      p_first_pts:  firstPts,
      p_second_pts: secondPts,
      p_third_pts:  thirdPts,
    });
    if (rankError) console.error("Re-rank error:", rankError);
  }

  // Award XP for this attempt (use admin-configured value)
  getXpActionValue("_xp_workout", XP_PER_ATTEMPT).then(xp =>
    awardXp(score.player_id, xp, "workout_attempt").catch(console.error)
  );

  // Award +3 bonus points for beating personal best
  if (isPersonalBest && previousBest !== null && scoringType === "competitive") {
    // Only award for competitive workouts — not self-reported or flat
    try {
      await supabase.from("streak_bonuses").insert({
        player_id: score.player_id,
        points: 1,
        streak_length: 0,
        awarded_at: new Date().toISOString(),
        reason: "personal_best",
      });
    } catch (e) { console.error(e); }
  }

  // Check and update all-time records (fire and forget — don't block the return)
  if (isPersonalBest) {
    const { data: prof } = await supabase.from("profiles").select("name,avatar_url").eq("id", score.player_id).single();
    const { data: wo } = await supabase.from("workouts").select("title,description").eq("id", score.workout_id).single();
    if (prof && wo) {
      checkAndUpdateRecords(
        score.player_id, prof.name, prof.avatar_url ?? null,
        score.workout_id, wo.title, wo.description ?? "",
        newRaw
      ).catch(console.error);
    }
    // Refresh global stats records (points, workouts, challenges) in background
    refreshGlobalRecords(score.player_id, prof?.name ?? "", prof?.avatar_url ?? null).catch(console.error);
  }

  return { saved, isPersonalBest, previousBest };
}

// Keep old upsertScore as alias for coach manual edits
export async function upsertScore(
  score: Omit<Score, "id" | "points" | "logged_at">
) {
  const { data, error } = await supabase
    .from("scores")
    .upsert(score, { onConflict: "player_id,workout_id" })
    .select().single();
  if (error) throw error;
  return data as Score;
}

export async function getMyAttempts(playerId: string): Promise<ScoreAttempt[]> {
  const { data, error } = await supabase
    .from("score_attempts")
    .select("*")
    .eq("player_id", playerId)
    .order("attempted_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
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

// ── Streak helpers ────────────────────────────────────────────
export async function getStreak(playerId: string): Promise<StreakRecord | null> {
  const { data } = await supabase
    .from("streaks").select("*").eq("player_id", playerId).single();
  return data;
}

// Call this every time a player logs a score
export async function updateStreak(playerId: string): Promise<{ newStreak: number; bonusAwarded: boolean }> {
  const today = new Date().toISOString().split("T")[0];
  const existing = await getStreak(playerId);

  let newStreak = 1;
  let bonusAwarded = false;

  if (existing) {
    const lastDate = new Date(existing.last_logged_date);
    const todayDate = new Date(today);
    const diffDays = Math.floor(
      (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) {
      // Already logged today — keep streak as is
      return { newStreak: existing.current_streak, bonusAwarded: false };
    } else if (diffDays === 1) {
      // Consecutive day — extend streak
      newStreak = existing.current_streak + 1;
    } else {
      // Streak broken
      newStreak = 1;
    }
  }

  // Check if bonus should be awarded
  const prevStreak = existing?.current_streak ?? 0;
  const prevBonusAt = existing?.bonus_awarded_at;
  const alreadyAwardedToday = prevBonusAt === today;

  // Award bonus every 7 days (7, 14, 21, etc.)
  const crossedNewMilestone = Math.floor(newStreak / STREAK_BONUS_DAYS) > Math.floor(prevStreak / STREAK_BONUS_DAYS);
  if (crossedNewMilestone && !alreadyAwardedToday) {
    bonusAwarded = true;
    // Award streak bonus points as a special score entry
    await supabase.from("streak_bonuses").insert({
      player_id: playerId,
      points: STREAK_BONUS_PTS,
      streak_length: newStreak,
      awarded_at: new Date().toISOString(),
    });
  }

  // Upsert streak record
  await supabase.from("streaks").upsert({
    player_id: playerId,
    current_streak: newStreak,
    longest_streak: Math.max(newStreak, existing?.longest_streak ?? 0),
    last_logged_date: today,
    bonus_awarded_at: bonusAwarded ? today : existing?.bonus_awarded_at,
  }, { onConflict: "player_id" });

  return { newStreak, bonusAwarded };
}

// ── Biweekly champion helpers ─────────────────────────────────
export async function getBiweeklyChampions(): Promise<BiweeklyChampion[]> {
  const { data, error } = await supabase
    .from("biweekly_champions")
    .select("*")
    .order("crowned_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Called by a Supabase cron Edge Function every 2 weeks,
// but also exposed here so coaches can manually trigger it
export async function crownBiweeklyWinners(leaderboard: LeaderboardEntry[]): Promise<void> {
  const periodStart  = currentPeriodStart().toISOString();
  const periodEnd    = currentPeriodEnd().toISOString();
  const periodNumber = getPeriodNumber();

  // Find winner per grade group
  const winners: Record<string, LeaderboardEntry> = {};
  for (const entry of leaderboard) {
    const cat = entry.grade_category ?? "Unknown";
    if (!winners[cat] || entry.total_points > winners[cat].total_points) {
      winners[cat] = entry;
    }
  }

  // Clear current champions
  await supabase.from("profiles").update({ is_period_champion: false }).neq("id", "none");

  for (const [grade, winner] of Object.entries(winners)) {
    if (!winner.total_points) continue;

    // Fetch avatar_url for this winner
    const { data: prof } = await supabase
      .from("profiles").select("avatar_url").eq("id", winner.id).single();

    await supabase.from("profiles")
      .update({ is_period_champion: true, champion_since: new Date().toISOString() })
      .eq("id", winner.id);

    // Update most periods won record
    const { count: periodsWon } = await supabase
      .from("biweekly_champions")
      .select("id", { count: "exact", head: true })
      .eq("player_id", winner.id);
    const season = await getCurrentSeason();
    try {
      await supabase.rpc("upsert_record", {
        p_type: "most_periods_won", p_workout_id: null,
        p_workout_title: null, p_workout_desc: null,
        p_player_id: winner.id, p_player_name: winner.name,
        p_avatar_url: prof?.avatar_url ?? null,
        p_value: (periodsWon ?? 0) + 1,
        p_display_value: `${(periodsWon ?? 0) + 1} period${((periodsWon ?? 0) + 1) !== 1 ? "s" : ""}`,
        p_season: season,
      });
    } catch (e) { console.error(e); }

    await supabase.from("biweekly_champions").insert({
      player_id:     winner.id,
      player_name:   winner.name,
      grade_category: grade,
      points:        winner.total_points,
      period_start:  periodStart,
      period_end:    periodEnd,
      period_number: periodNumber,
      crowned_at:    new Date().toISOString(),
      avatar_url:    prof?.avatar_url ?? null,
    });
  }
}

// ── Leaderboard ───────────────────────────────────────────────
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from("leaderboard").select("*").order("rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}


// ── Records ───────────────────────────────────────────────────

export async function getCurrentSeason(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Season runs roughly June-May
  return month >= 6 ? `${year}-${year+1}` : `${year-1}-${year}`;
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
  // Check best score for this drill
  await supabase.rpc("upsert_record", {
    p_type: "best_score",
    p_workout_id: workoutId,
    p_workout_title: workoutTitle,
    p_workout_desc: workoutDesc,
    p_player_id: playerId,
    p_player_name: playerName,
    p_avatar_url: avatarUrl,
    p_value: newScore,
    p_display_value: newScore.toString(),
    p_season: season,
  });
}

export async function refreshGlobalRecords(playerId: string, playerName: string, avatarUrl: string | null): Promise<void> {
  const season = await getCurrentSeason();

  // Most total points all-time (from leaderboard view)
  const { data: lb } = await supabase.from("leaderboard").select("id,name,total_points,avatar_url,workouts_completed").eq("id", playerId).single();
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

  // Most challenges won
  const { count: wins } = await supabase.from("challenges")
    .select("id", { count: "exact", head: true })
    .eq("winner_id", playerId)
    .eq("status", "completed");
  if (wins && wins > 0) {
    await supabase.rpc("upsert_record", {
      p_type: "most_challenges_won", p_workout_id: null,
      p_workout_title: null, p_workout_desc: null,
      p_player_id: playerId, p_player_name: playerName, p_avatar_url: avatarUrl,
      p_value: wins, p_display_value: `${wins} wins`, p_season: season,
    });
  }

  // Best win rate (min 10 challenges)
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

  // Longest streak (from streaks table)
  const { data: streak } = await supabase.from("streaks")
    .select("longest_streak").eq("player_id", playerId).single();
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
    .from("records")
    .select("*")
    .order("record_type")
    .order("value", { ascending: false });
  return data ?? [];
}

export async function getBestScoreRecords() {
  const { data } = await supabase
    .from("records")
    .select("*")
    .eq("record_type", "best_score")
    .order("workout_title");
  return data ?? [];
}


// ── Teams ─────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  color: string;
  competition_id: string;
}

export interface TeamCompetition {
  id: string;
  is_active: boolean;
  bonus_points: number;
  start_date: string | null;
  end_date: string | null;
  winning_team_id: string | null;
}

export const TEAM_CATEGORIES: Record<string, string[]> = {
  "🏀 Basketball": ["The Buckets","The Ballers","The Bombers","The Handles","The Swishes","The Bricks","The Dunkers","The Drainers"],
  "🐾 Animals":    ["The Wolves","The Hawks","The Bulls","The Bears","The Falcons","The Lions","The Vipers","The Sharks"],
  "🍕 Food":       ["The Hotdogs","The Wings","The Slices","The Tacos","The Nuggets","The Subs","The Cookies","The Nachos"],
  "🎨 Colors":     ["The Crimsons","The Golds","The Navys","The Scarlets","The Royals","The Silvers","The Blacks","The Whites"],
  "🌊 Elements":   ["The Storms","The Flames","The Frosts","The Bolts","The Tides","The Shadows","The Blaze","The Thunder"],
  "🎯 Attitude":   ["The Grinders","The Dawgs","The Hoopers","The Warriors","The Underdogs","The Elites","The Hungry","The Relentless"],
};

export const TEAM_COLORS = ["#1a5fd4","#e53935","#43a047","#f57c00","#8e24aa","#00838f","#d81b60","#546e7a"];

export async function getActiveTeamCompetition(): Promise<TeamCompetition | null> {
  const { data } = await supabase.from("team_competitions").select("*").eq("is_active", true).single();
  return data;
}

export async function getTeams(competitionId: string): Promise<Team[]> {
  const { data: teams } = await supabase.from("teams").select("*").eq("competition_id", competitionId);
  if (!teams) return [];

  // Calculate each team's score by summing points of its members
  const teamsWithScores = await Promise.all(teams.map(async team => {
    // Get players on this team
    const { data: members } = await supabase.from("profiles")
      .select("id").eq("team_id", team.id);
    const memberIds = (members ?? []).map((m: any) => m.id);
    if (memberIds.length === 0) return { ...team, score: 0, memberCount: 0 };

    // Sum their leaderboard points
    const { data: lb } = await supabase.from("leaderboard")
      .select("id,total_points,rank").in("id", memberIds);
    const drillScore = (lb ?? []).reduce((sum: number, p: any) => sum + (p.total_points ?? 0), 0);
    // Map individual points keyed by player id
    const playerPoints: Record<string, number> = {};
    (lb ?? []).forEach((p: any) => { playerPoints[p.id] = p.total_points ?? 0; });

    // Check if any member has team_bonus perk unlocked — adds +3 to team starting score
    // If XP system is disabled, all perks are unlocked so boost always applies
    const { data: xpToggle } = await supabase.from("xp_settings")
      .select("xp_required").eq("perk_key", "_xp_enabled").single();
    const xpEnabled = (xpToggle?.xp_required ?? 1) !== 0;
    let hasTeamBoost = false;
    if (!xpEnabled) {
      // XP off — all perks unlocked, boost applies if team has any members
      hasTeamBoost = memberIds.length > 0;
    } else {
      const { data: xpSettings } = await supabase.from("xp_settings")
        .select("xp_required").eq("perk_key", "team_bonus").single();
      const teamBonusThreshold = xpSettings?.xp_required ?? 1250;
      const { data: memberXp } = await supabase.from("profiles")
        .select("total_xp").in("id", memberIds).gte("total_xp", teamBonusThreshold).limit(1);
      hasTeamBoost = (memberXp ?? []).length > 0;
    }
    const score = drillScore + (hasTeamBoost ? 3 : 0);

    return { ...team, score, memberCount: memberIds.length, playerPoints, hasTeamBoost };
  }));

  return teamsWithScores;
}

export async function saveTeamCompetition(
  numTeams: number,
  teamNames: string[],
  playerAssignments: Record<string, string[]>, // teamName -> playerId[]
  bonusPoints: number,
  startDate: string,
  endDate: string,
): Promise<void> {
  // Deactivate any existing competition
  await supabase.from("team_competitions").update({ is_active: false }).eq("is_active", true);

  // Create new competition
  const { data: comp, error: compErr } = await supabase.from("team_competitions").insert({
    is_active: true,
    bonus_points: bonusPoints,
    start_date: startDate,
    end_date: endDate,
  }).select().single();
  if (compErr) throw compErr;

  // Create teams and assign players
  for (let i = 0; i < numTeams; i++) {
    const name = teamNames[i];
    const color = TEAM_COLORS[i % TEAM_COLORS.length];
    const { data: team } = await supabase.from("teams").insert({
      name, color, competition_id: comp.id,
    }).select().single();
    if (!team) continue;
    // Assign players to this team
    const playerIds = playerAssignments[name] ?? [];
    if (playerIds.length > 0) {
      if (playerIds.length > 0) {
        await supabase.from("profiles").update({ team_id: team.id }).in("id", playerIds);
      }
    }
  }
}

export async function endTeamCompetition(competitionId: string): Promise<{ winnerName: string; winnerScore: number } | null> {
  // Get all teams with their scores
  const teams = await getTeams(competitionId);
  if (!teams.length) return null;

  // Find winning team (highest score)
  const winner = teams.reduce((best: any, t: any) => (t.score ?? 0) > (best.score ?? 0) ? t : best, teams[0]);

  // Get all players on winning team
  const { data: winningPlayers } = await supabase.from("profiles")
    .select("id,name").eq("team_id", winner.id);

  const { data: comp } = await supabase.from("team_competitions")
    .select("bonus_points").eq("id", competitionId).single();
  const bonusPts = comp?.bonus_points ?? 3;

  // Award bonus points to each winning player
  for (const player of (winningPlayers ?? [])) {
    await supabase.from("streak_bonuses").insert({
      player_id: player.id,
      points: bonusPts,
      streak_length: 0,
      reason: "team_win",
      awarded_at: new Date().toISOString(),
    });
    // Increment team_wins on profile (for season history / badges)
    // Increment team_wins on profile
    try {
      const { data: pw } = await supabase.from("profiles").select("team_wins").eq("id", player.id).single();
      await supabase.from("profiles").update({ team_wins: ((pw as any)?.team_wins ?? 0) + 1 }).eq("id", player.id);
    } catch(e) { console.error("team_wins update error:", e); }
  }

  // Mark competition as inactive
  await supabase.from("team_competitions").update({ is_active: false }).eq("id", competitionId);

  return { winnerName: winner.name, winnerScore: winner.score ?? 0 };
}

export async function toggleTeamCompetition(active: boolean): Promise<void> {
  await supabase.from("team_competitions").update({ is_active: active }).eq("is_active", !active);
}


// ── XP System ─────────────────────────────────────────────────

export const XP_PER_ATTEMPT    = 10; // default fallback
export const XP_CHALLENGE_SENT = 2;  // default fallback
export const XP_CHALLENGE_DONE = 3;  // default fallback

async function getXpActionValue(key: string, fallback: number): Promise<number> {
  const { data } = await supabase.from("xp_settings").select("xp_required").eq("perk_key", key).single();
  return data?.xp_required ?? fallback;
}

export interface XpPerk {
  perk_key:    string;
  perk_name:   string;
  xp_required: number;
  description: string;
}

export const DEFAULT_PERKS: XpPerk[] = [
  { perk_key: "challenges_unlocked", perk_name: "Challenges Unlocked",  xp_required: 150,  description: "Head-to-head challenges & avatar on leaderboard." },
  { perk_key: "team_eligible",       perk_name: "Team Eligible",         xp_required: 300,  description: "Can be picked for team competitions. Light gray avatar outline." },
  { perk_key: "streak_shield",       perk_name: "Streak Shield",         xp_required: 750,  description: "One missed-day streak save per biweekly period. Silver avatar outline." },
  { perk_key: "team_bonus",          perk_name: "Team Boost",            xp_required: 1250, description: "Your team starts with +3 pts. Blue avatar outline." },
  { perk_key: "score_boost",         perk_name: "Score Boost",           xp_required: 2000, description: "+5 to one workout score per period. Gold avatar outline." },
];

export async function getXpPerks(): Promise<XpPerk[]> {
  const { data } = await supabase.from("xp_settings").select("*").order("xp_required");
  return data && data.length > 0 ? data : DEFAULT_PERKS;
}

export async function getPlayerXp(playerId: string): Promise<number> {
  const { data } = await supabase.from("profiles").select("total_xp").eq("id", playerId).single();
  return data?.total_xp ?? 0;
}

export async function awardXp(playerId: string, amount: number, reason: string): Promise<void> {
  await supabase.from("xp_log").insert({ player_id: playerId, xp_amount: amount, reason });
  await supabase.from("profiles").update({ total_xp: supabase.rpc as any }).eq("id", playerId);
  // Use increment via RPC-less approach
  const { data: prof } = await supabase.from("profiles").select("total_xp").eq("id", playerId).single();
  const current = prof?.total_xp ?? 0;
  await supabase.from("profiles").update({ total_xp: current + amount }).eq("id", playerId);
}

export function getPlayerTier(xp: number, perks: XpPerk[]): { tier: number; perk: XpPerk | null; nextPerk: XpPerk | null; avatarOutline: string } {
  const sorted = [...perks].sort((a, b) => a.xp_required - b.xp_required);
  let currentPerk: XpPerk | null = null;
  let nextPerk: XpPerk | null = null;

  for (let i = 0; i < sorted.length; i++) {
    if (xp >= sorted[i].xp_required) {
      currentPerk = sorted[i];
    } else {
      nextPerk = sorted[i];
      break;
    }
  }

  const tier = currentPerk ? sorted.indexOf(currentPerk) + 1 : 0;

  const outlineColors: Record<string, string> = {
    "team_eligible":  "#9ca3af",  // light gray
    "streak_shield":  "#c0c0c0",  // silver
    "team_bonus":     "#2550d4",  // royal blue
    "score_boost":    "#f0c040",  // gold
  };
  const avatarOutline = currentPerk ? (outlineColors[currentPerk.perk_key] ?? "var(--border)") : "var(--border)";

  return { tier, perk: currentPerk, nextPerk, avatarOutline };
}

export async function hasPerkUsedThisPeriod(playerId: string, perkKey: string): Promise<boolean> {
  const periodStart = currentPeriodStart().toISOString().split("T")[0];
  const { data } = await supabase.from("perk_usage")
    .select("id").eq("player_id", playerId).eq("perk_key", perkKey).eq("period_start", periodStart).single();
  return !!data;
}

export async function usePerk(playerId: string, perkKey: string, workoutId?: string): Promise<boolean> {
  const periodStart = currentPeriodStart().toISOString().split("T")[0];
  const { error } = await supabase.from("perk_usage").insert({
    player_id: playerId, perk_key: perkKey, period_start: periodStart,
  });
  return !error;
}

// ── YouTube helpers ───────────────────────────────────────────
export function getEmbedUrl(url?: string): string {
  if (!url) return "";
  if (url.includes("/embed/")) return url;
  const m = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : "";
}

export function getVideoId(url?: string): string {
  const embed = getEmbedUrl(url);
  const m = embed.match(/embed\/([^?]+)/);
  return m ? m[1] : "";
}

// ── Profile update helpers ────────────────────────────────────

export async function updateProfileName(userId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ name })
    .eq("id", userId);
  if (error) throw error;
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${userId}/avatar.${ext}`;

  // Remove old avatar first (ignore error if none exists)
  await supabase.storage.from("avatars").remove([`${userId}/avatar.jpg`, `${userId}/avatar.png`, `${userId}/avatar.webp`]);

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const publicUrl = data.publicUrl + `?t=${Date.now()}`; // bust cache

  // Save URL to profile
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", userId);
  if (profileError) throw profileError;

  return publicUrl;
}
