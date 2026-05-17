// src/lib/badges.ts
import { supabase } from "./supabase";

export interface Badge {
  id: string;
  icon: string;
  name: string;
  description: string;
  trigger_type: "workouts" | "points" | "streak" | "champion" | "top_score";
  trigger_value: number;
  is_active: boolean;
}

export interface PlayerStats {
  totalPoints: number;
  totalWorkouts: number;
  currentStreak: number;
  longestStreak: number;
  isGroupChampion: boolean;
  hasPerfectScore: boolean;
  daysActive: number;
}

export async function getActiveBadges(): Promise<Badge[]> {
  const { data } = await supabase
    .from("badges")
    .select("*")
    .eq("is_active", true)
    .order("trigger_type")
    .order("trigger_value");
  return data ?? [];
}

export function checkBadge(badge: Badge, stats: PlayerStats): boolean {
  switch (badge.trigger_type) {
    case "workouts":  return stats.totalWorkouts >= badge.trigger_value;
    case "points":    return stats.totalPoints >= badge.trigger_value;
    case "streak":    return stats.currentStreak >= badge.trigger_value;
    case "champion":  return stats.isGroupChampion;
    case "top_score": return stats.hasPerfectScore;
    default: return false;
  }
}

export function checkNewBadges(stats: PlayerStats, badges: Badge[], alreadyEarned: string[]): Badge[] {
  return badges.filter(b => !alreadyEarned.includes(b.id) && checkBadge(b, stats));
}

// Default badges to seed on first load
export const DEFAULT_BADGES = [
  { icon: "🏀", name: "First Rep",      description: "Logged your first workout",   trigger_type: "workouts",  trigger_value: 1,   is_active: true },
  { icon: "💪", name: "Getting Reps",   description: "Logged 5 workouts",           trigger_type: "workouts",  trigger_value: 5,   is_active: true },
  { icon: "🔟", name: "Grinder",        description: "Logged 10 workouts",          trigger_type: "workouts",  trigger_value: 10,  is_active: true },
  { icon: "⚡", name: "Workhorse",      description: "Logged 25 workouts",          trigger_type: "workouts",  trigger_value: 25,  is_active: true },
  { icon: "🔥", name: "On Fire",        description: "3-day logging streak",        trigger_type: "streak",    trigger_value: 3,   is_active: true },
  { icon: "🌟", name: "Week Warrior",   description: "7-day logging streak",        trigger_type: "streak",    trigger_value: 7,   is_active: true },
  { icon: "💯", name: "Two Week Grind", description: "14-day logging streak",       trigger_type: "streak",    trigger_value: 14,  is_active: true },
  { icon: "🥉", name: "On the Board",   description: "Earned 10 total points",      trigger_type: "points",    trigger_value: 10,  is_active: true },
  { icon: "🥈", name: "Rising Star",    description: "Earned 25 total points",      trigger_type: "points",    trigger_value: 25,  is_active: true },
  { icon: "🥇", name: "Elite",          description: "Earned 50 total points",      trigger_type: "points",    trigger_value: 50,  is_active: true },
  { icon: "💎", name: "Century Club",   description: "Earned 100 total points",     trigger_type: "points",    trigger_value: 100, is_active: true },
  { icon: "👑", name: "Champion",       description: "Won a biweekly period",       trigger_type: "champion",  trigger_value: 1,   is_active: true },
  { icon: "🎯", name: "Sharpshooter",   description: "Scored #1 on any drill",      trigger_type: "top_score", trigger_value: 1,   is_active: true },
];
