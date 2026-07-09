// src/lib/supabase.ts
// Supabase client + all shared types and constants.
// Re-exports everything from the split lib files so all existing
// component imports from "../lib/supabase" continue to work unchanged.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = (import.meta as any).env.VITE_SUPABASE_URL as string;
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
export type ScoringType = "competitive" | "self_reported" | "flat" | "multi_spot";

// ── Roles ─────────────────────────────────────────────────────
export type Role = "player" | "coach" | "admin" | "inactive" | "pending_player" | "pending_coach";

// ── Streak constants ──────────────────────────────────────────
export const STREAK_BONUS_DAYS = 7;
export const STREAK_BONUS_PTS  = 3;

// ── XP constants ─────────────────────────────────────────────
export const XP_PER_ATTEMPT    = 10;
export const XP_CHALLENGE_SENT = 2;
export const XP_CHALLENGE_DONE = 3;

// ── Team constants ────────────────────────────────────────────
export const TEAM_CATEGORIES: Record<string, string[]> = {
  "🏀 Basketball": ["The Buckets","The Ballers","The Bombers","The Handles","The Swishes","The Bricks","The Dunkers","The Drainers"],
  "🐾 Animals":    ["The Wolves","The Hawks","The Bulls","The Bears","The Falcons","The Lions","The Vipers","The Sharks"],
  "🍕 Food":       ["The Hotdogs","The Wings","The Slices","The Tacos","The Nuggets","The Subs","The Cookies","The Nachos"],
  "🎨 Colors":     ["The Crimsons","The Golds","The Navys","The Scarlets","The Royals","The Silvers","The Blacks","The Whites"],
  "🌊 Elements":   ["The Storms","The Flames","The Frosts","The Bolts","The Tides","The Shadows","The Blaze","The Thunder"],
  "🎯 Attitude":   ["The Grinders","The Dawgs","The Hoopers","The Warriors","The Underdogs","The Elites","The Hungry","The Relentless"],
};

export const TEAM_COLORS = ["#1a5fd4","#e53935","#43a047","#f57c00","#8e24aa","#00838f","#d81b60","#546e7a"];

// ── Database Interfaces ───────────────────────────────────────

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
  first_place_pts?: number;
  second_place_pts?: number;
  third_place_pts?: number;
  group_name?: string;
  is_active?: boolean;
  deadline?: string;
  leaderboard_active?: boolean;
  library_archived?: boolean;
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
  raw_score: number;
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
  total_xp?: number;
}

export interface PersonalBest {
  id: string;
  player_id: string;
  workout_id: string;
  raw_score: number;
  achieved_at: string;
}

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

// ── Re-export everything from split files ─────────────────────
// This keeps all existing component imports working unchanged.
// Components import from "../lib/supabase" as before — this file
// forwards everything so nothing breaks.
export * from "./periods";
export * from "./auth";
export * from "./workouts";
export * from "./scores";
export * from "./streaks";
export * from "./leaderboard";
export * from "./records";
export * from "./teams";
export { 
  getXpEnabled,
  setXpEnabled,
  getXpPerks,
  getPlayerXp,
  awardXp,
  getPlayerTier,
  hasPerkUsedThisPeriod,
  usePerk,
  checkUnseenPerks,
} from "./xp";
