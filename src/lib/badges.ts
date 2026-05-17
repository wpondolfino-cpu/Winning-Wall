// src/lib/badges.ts
// Milestone badge definitions and logic

export interface Badge {
  id: string;
  icon: string;
  name: string;
  description: string;
  check: (stats: PlayerStats) => boolean;
}

export interface PlayerStats {
  totalPoints: number;
  totalWorkouts: number;
  currentStreak: number;
  longestStreak: number;
  isGroupChampion: boolean;
  hasPerfectScore: boolean;  // scored highest possible on a drill
  daysActive: number;
}

export interface EarnedBadge {
  badgeId: string;
  earnedAt: string;
  playerId: string;
}

// All available milestone badges
export const BADGES: Badge[] = [
  {
    id: "first_workout",
    icon: "🏀",
    name: "First Rep",
    description: "Logged your first workout",
    check: (s) => s.totalWorkouts >= 1,
  },
  {
    id: "five_workouts",
    icon: "💪",
    name: "Getting Reps",
    description: "Logged 5 workouts",
    check: (s) => s.totalWorkouts >= 5,
  },
  {
    id: "ten_workouts",
    icon: "🔟",
    name: "Grinder",
    description: "Logged 10 workouts",
    check: (s) => s.totalWorkouts >= 10,
  },
  {
    id: "twenty_five_workouts",
    icon: "⚡",
    name: "Workhorse",
    description: "Logged 25 workouts",
    check: (s) => s.totalWorkouts >= 25,
  },
  {
    id: "streak_3",
    icon: "🔥",
    name: "On Fire",
    description: "3-day logging streak",
    check: (s) => s.currentStreak >= 3,
  },
  {
    id: "streak_7",
    icon: "🔥🔥",
    name: "Week Warrior",
    description: "7-day logging streak",
    check: (s) => s.currentStreak >= 7,
  },
  {
    id: "streak_14",
    icon: "🌟",
    name: "Two Week Grind",
    description: "14-day logging streak",
    check: (s) => s.currentStreak >= 14,
  },
  {
    id: "points_10",
    icon: "🥉",
    name: "On the Board",
    description: "Earned 10 total points",
    check: (s) => s.totalPoints >= 10,
  },
  {
    id: "points_25",
    icon: "🥈",
    name: "Rising Star",
    description: "Earned 25 total points",
    check: (s) => s.totalPoints >= 25,
  },
  {
    id: "points_50",
    icon: "🥇",
    name: "Elite",
    description: "Earned 50 total points",
    check: (s) => s.totalPoints >= 50,
  },
  {
    id: "points_100",
    icon: "💯",
    name: "Century Club",
    description: "Earned 100 total points",
    check: (s) => s.totalPoints >= 100,
  },
  {
    id: "group_champion",
    icon: "👑",
    name: "Champion",
    description: "Won a biweekly period in your group",
    check: (s) => s.isGroupChampion,
  },
  {
    id: "top_scorer",
    icon: "🎯",
    name: "Sharpshooter",
    description: "Scored #1 on any drill",
    check: (s) => s.hasPerfectScore,
  },
];

export function checkNewBadges(
  stats: PlayerStats,
  alreadyEarned: string[]
): Badge[] {
  return BADGES.filter(
    (b) => !alreadyEarned.includes(b.id) && b.check(stats)
  );
}
