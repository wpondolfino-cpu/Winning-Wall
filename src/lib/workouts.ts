// src/lib/workouts.ts
// Workout CRUD + YouTube URL helpers

import { supabase, Workout } from "./supabase";

export async function getWorkouts(): Promise<Workout[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createWorkout(
  workout: Omit<Workout, "id" | "created_at" | "coach_id">
) {
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

export function getEmbedUrl(url?: string): string {
  if (!url) return "";
  if (url.includes("/embed/")) return url;
  const m = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : "";
}

export function getVideoId(url?: string): string {
  const embed = getEmbedUrl(url);
  const m     = embed.match(/embed\/([^?]+)/);
  return m ? m[1] : "";
}
