// src/lib/badges.ts
import { supabase } from "./supabase";

export interface Badge {
  id: string;
  icon: string;
  name: string;
  description: string;
  trigger_type: "workouts" | "points" | "streak" | "champion" | "top_score" | "challenges_won" | "team_wins";
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
  challengesWon?: number;
  teamWins?: number;
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
    case "workouts":        return stats.totalWorkouts >= badge.trigger_value;
    case "points":          return stats.totalPoints >= badge.trigger_value;
    case "streak":          return stats.currentStreak >= badge.trigger_value;
    case "champion":        return stats.isGroupChampion;
    case "top_score":       return stats.hasPerfectScore;
    case "challenges_won":  return (stats.challengesWon ?? 0) >= badge.trigger_value;
    case "team_wins":       return (stats.teamWins ?? 0) >= badge.trigger_value;
    default: return false;
  }
}
