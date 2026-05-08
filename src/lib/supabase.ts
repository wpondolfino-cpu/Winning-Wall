// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

// ── Database Types ──────────────────────────────────────────
export type Role = "player" | "coach";

export interface Profile {
  id: string;
  name: string;
  role: Role;
  position?: string;
  jersey?: number;
  avatar_url?: string;
  created_at: string;
}

export interface Workout {
  id: string;
  coach_id: string;
  title: string;
  description?: string;
  category: "Shooting" | "Conditioning" | "Strength" | "Skills";
  video_url?: string;
  emoji: string;
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
  points: number;         // generated column
  logged_at: string;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  position?: string;
  jersey?: number;
  avatar_url?: string;
  total_points: number;
  total_made: number;
  total_attempts: number;
  best_sprint: number;
  workouts_completed: number;
  last_logged_at?: string;
  rank: number;
}

// ── Auth helpers ────────────────────────────────────────────
export async function signUp(email: string, password: string, profile: Omit<Profile, "id" | "created_at">) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: profile.name,
        role: profile.role,
        position: profile.position,
        jersey: profile.jersey,
      }
    }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
}

// ── Workout helpers ─────────────────────────────────────────
export async function getWorkouts(): Promise<Workout[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createWorkout(workout: Omit<Workout, "id" | "created_at" | "coach_id">) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("workouts")
    .insert({ ...workout, coach_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data as Workout;
}

// ── Score helpers ────────────────────────────────────────────
export async function upsertScore(score: Omit<Score, "id" | "points" | "logged_at">) {
  const { data, error } = await supabase
    .from("scores")
    .upsert(score, { onConflict: "player_id,workout_id" })
    .select()
    .single();
  if (error) throw error;
  return data as Score;
}

export async function getMyScores(playerId: string): Promise<Score[]> {
  const { data, error } = await supabase
    .from("scores")
    .select("*")
    .eq("player_id", playerId)
    .order("logged_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAllScores(): Promise<Score[]> {
  const { data, error } = await supabase
    .from("scores")
    .select("*");
  if (error) throw error;
  return data ?? [];
}

// ── Leaderboard helper ───────────────────────────────────────
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .order("rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ── YouTube embed helper ─────────────────────────────────────
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
