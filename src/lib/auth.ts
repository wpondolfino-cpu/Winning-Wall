// src/lib/auth.ts
// Authentication — sign in, sign up, sign out, profile, avatar

import { supabase, Profile } from "./supabase";
import { unlinkDevice } from "./onesignal";

export async function signUp(
  email: string,
  password: string,
  profile: Omit<Profile, "id" | "created_at">,
  selfRegistered = true,
  joinCode?: string,
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
        // Picked up by the trigger in migration 114. Stored as a
        // graduation year rather than a grade so it advances by itself
        // each August instead of needing a bulk update every summer.
        graduation_year: profile.graduation_year ?? null,
        // Which program the request goes to (migration 179). The database
        // looks the code up and files the request with that program's coaches.
        join_code: joinCode ? joinCode.trim().toUpperCase() : null,
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
  // Unlink this device from the account first, so it stops receiving
  // this player's notifications once they're signed out.
  await unlinkDevice();
  await supabase.auth.signOut();
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (!data) return data;
  // A test player is stored as "test_player" so every player list leaves
  // it out; the app itself treats it as an ordinary player.
  if ((data as any).role === "test_player") return { ...data, role: "player", is_test: true };

  // Which screens you get follows your role in the program you're in
  // (migration 187): head coach -> admin screens, coach -> coach screens.
  // The platform admin gets admin screens in every program. Pending and
  // inactive accounts keep their profile role.
  const pid = (data as any).active_program_id as string | null;
  if (pid && ["player", "coach", "admin"].includes((data as any).role)) {
    const [{ data: pa }, { data: m }] = await Promise.all([
      supabase.from("platform_admins").select("user_id").eq("user_id", userId),
      supabase.from("program_members").select("role,status")
        .eq("program_id", pid).eq("user_id", userId).maybeSingle(),
    ]);
    if ((pa ?? []).length > 0) {
      // Head coach here too -> "Head Coach"; otherwise just platform access.
      const here = m && (m as any).status === "active" && (m as any).role === "head_coach";
      return { ...data, role: "admin", admin_label: here ? "Head Coach" : "Platform Admin", is_platform_admin: true } as Profile;
    }
    if (m && (m as any).status === "active") {
      const r = (m as any).role === "head_coach" ? "admin" : (m as any).role === "coach" ? "coach" : "player";
      return { ...data, role: r } as Profile;
    }
  }
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

export async function saveAvatarConfig(userId: string, config: Record<string, string>): Promise<void> {
  const { error } = await supabase.from("profiles").update({ avatar_config: config }).eq("id", userId);
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

/**
 * Resets someone's password through the reset-password edge function and
 * returns the one-time temporary password to pass on to them. The function
 * checks the caller: admins can reset anyone, coaches only players. The
 * player is prompted to set their own at next login.
 */
export async function resetPasswordFor(playerId: string, requestId?: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
    body: JSON.stringify({ player_id: playerId, request_id: requestId }),
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(json.error ?? "Reset failed");
  if (!json.temp_password) {
    // The old function is still deployed: it reset to the old shared password.
    throw new Error("The password was reset to the old shared password, because the reset-password function on Supabase hasn't been updated yet. Update it, then reset again.");
  }
  return json.temp_password as string;
}

/**
 * Emails live in profile_emails (migration 151), readable by coaches and
 * admins only. Select with `profile_emails(email)` and flatten here.
 */
export function withEmail<T extends { profile_emails?: any }>(rows: T[] | null): (T & { email: string | null })[] {
  return (rows ?? []).map(r => {
    const pe = Array.isArray(r.profile_emails) ? r.profile_emails[0] : r.profile_emails;
    return { ...r, email: pe?.email ?? null };
  });
}
