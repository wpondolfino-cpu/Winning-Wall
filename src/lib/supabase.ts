// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

// ── Grade Categories ──────────────────────────────────────────
export const GRADE_CATEGORIES = [
  "Elementary (3rd-4th Grade)",
  "5th & 6th Grade",
  "7th & 8th Grade",
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
export const STREAK_BONUS_PTS  = 50;  // bonus points awarded

// ── Biweekly period helper ────────────────────────────────────
// Returns the start date of the current 2-week period (anchored to a fixed epoch)
export function currentPeriodStart(): Date {
  const EPOCH = new Date("2024-01-01"); // biweekly anchor
  const now = new Date();
  const msSinceEpoch = now.getTime() - EPOCH.getTime();
  const periodMs = 14 * 24 * 60 * 60 * 1000;
  const periodsSince = Math.floor(msSinceEpoch / periodMs);
  return new Date(EPOCH.getTime() + periodsSince * periodMs);
}

export function currentPeriodEnd(): Date {
  const start = currentPeriodStart();
  return new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
}

// ── Database Types ────────────────────────────────────────────
export type Role = "player" | "coach" | "admin";

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
  profile: Omit<Profile, "id" | "created_at">
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: profile.name,
        role: profile.role,
        grade_category: profile.grade_category,
      },
    },
  });
  if (error) throw error;
  return data;
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
    .select("first_place_pts, second_place_pts, third_place_pts, scoring_type")
    .eq("id", score.workout_id)
    .single();

  const firstPts  = workout?.first_place_pts  ?? 3;
  const secondPts = workout?.second_place_pts ?? 2;
  const thirdPts  = workout?.third_place_pts  ?? 1;

  // 2. Check if a personal best already exists
  const { data: existing } = await supabase
    .from("scores")
    .select("*")
    .eq("player_id", score.player_id)
    .eq("workout_id", score.workout_id)
    .single();

  const previousBest: number | null = existing ? computeRawScore(existing) : null;
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

  // 4. Save personal best raw score to scores table
  let saved: Score;
  if (isPersonalBest) {
    const { data, error } = await supabase
      .from("scores")
      .upsert({ ...score, points: 0 }, { onConflict: "player_id,workout_id" })
      .select().single();
    if (error) throw error;
    saved = data as Score;
  } else {
    saved = existing as Score;
  }

  // 5. Re-rank ALL players for this workout in one atomic SQL call
  const { error: rankError } = await supabase.rpc("rerank_workout", {
    p_workout_id: score.workout_id,
    p_first_pts:  firstPts,
    p_second_pts: secondPts,
    p_third_pts:  thirdPts,
  });
  if (rankError) {
    console.error("Re-rank error:", rankError);
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

  if (newStreak >= STREAK_BONUS_DAYS && prevStreak < STREAK_BONUS_DAYS && !alreadyAwardedToday) {
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
  const periodStart = currentPeriodStart().toISOString();
  const periodEnd   = currentPeriodEnd().toISOString();

  // Find winner per grade group
  const winners: Record<string, LeaderboardEntry> = {};
  for (const entry of leaderboard) {
    const cat = entry.grade_category ?? "Unknown";
    if (!winners[cat] || entry.total_points > winners[cat].total_points) {
      winners[cat] = entry;
    }
  }

  // Clear current champions and set new ones
  await supabase.from("profiles").update({ is_period_champion: false }).neq("id", "none");

  for (const [grade, winner] of Object.entries(winners)) {
    if (!winner.total_points) continue; // don't crown someone with 0 pts

    await supabase.from("profiles")
      .update({ is_period_champion: true, champion_since: new Date().toISOString() })
      .eq("id", winner.id);

    await supabase.from("biweekly_champions").insert({
      player_id: winner.id,
      player_name: winner.name,
      grade_category: grade,
      points: winner.total_points,
      period_start: periodStart,
      period_end: periodEnd,
      crowned_at: new Date().toISOString(),
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
