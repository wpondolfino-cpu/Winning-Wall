// src/lib/index.ts
// Barrel file — re-exports everything from all lib modules.
// Any component importing from "../lib/supabase" continues
// working unchanged. Or import from the specific file directly.

export * from "./supabase";
export * from "./periods";
export * from "./auth";
export * from "./workouts";
export * from "./scores";
export * from "./streaks";
export * from "./leaderboard";
export * from "./records";
export * from "./teams";
export * from "./xp";
