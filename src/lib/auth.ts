// src/lib/auth.ts
// Authentication — sign in, sign up, sign out, profile, avatar

import { supabase, Profile } from "./supabase";

export async function signUp(
  email: string,
  password: string,
  profile: Omit<Profile, "id" | "created_at">,
  selfRegistered = true
) {
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

export async function updateProfileName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ name }).eq("id", userId);
  if (error) throw error;
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext  = file.name.split(".").pop() ?? "jpg";
  const path = `${userId}/avatar.${ext}`;

  await supabase.storage.from("avatars").remove([
    `${userId}/avatar.jpg`,
    `${userId}/avatar.png`,
    `${userId}/avatar.webp`,
    `${userId}/avatar.svg`,
  ]);

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const publicUrl = data.publicUrl + `?t=${Date.now()}`;

  const { error: profileError } = await supabase
    .from("profiles").update({ avatar_url: publicUrl }).eq("id", userId);
  if (profileError) throw profileError;

  return publicUrl;
}

export async function markAvatarPromptSeen(userId: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ avatar_prompt_seen: true }).eq("id", userId);
  if (error) throw error;
}

export async function approveUser(userId: string, role: "player" | "coach"): Promise<void> {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;
}

export async function rejectUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_pending_user", { target_user_id: userId });
  if (error) throw error;
}
