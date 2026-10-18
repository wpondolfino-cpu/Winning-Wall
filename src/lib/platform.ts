// src/lib/platform.ts
// Platform admin page: schools, programs, head coaches (migration 189).
// Every call is platform-admin only; the database checks it.

import { supabase } from "./supabase";
import type { FeatureKey } from "./features";

export interface PlatformPerson { id: string; name: string; email: string | null; }

export interface PlatformProgram {
  id: string;
  name: string;
  is_active: boolean;
  join_code: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
  players: number;
  coaches: number;
  pending: number;
  head_coaches: PlatformPerson[];
  features_off: FeatureKey[];
}

export interface PlatformSchool {
  id: string;
  name: string;
  short_name: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
  timezone: string | null;
  programs: PlatformProgram[];
}

export interface PersonMatch { id: string; name: string; email: string | null; profile_role: string; programs: string | null; }

export async function loadPlatform(): Promise<PlatformSchool[]> {
  const { data, error } = await supabase.rpc("platform_programs");
  if (error) throw error;
  return (data ?? []) as PlatformSchool[];
}

export async function searchPeople(q: string): Promise<PersonMatch[]> {
  const { data, error } = await supabase.rpc("platform_search_people", { p_query: q });
  if (error) throw error;
  return (data ?? []) as PersonMatch[];
}

export async function setHeadCoach(programId: string, userId: string, head: boolean): Promise<void> {
  const { error } = await supabase.rpc("platform_set_head_coach", { p_program: programId, p_user: userId, p_head: head });
  if (error) throw error;
}

export async function newJoinCode(programId: string): Promise<string> {
  const { data, error } = await supabase.rpc("platform_new_join_code", { p_program: programId });
  if (error) throw error;
  return data as string;
}

export async function createProgram(schoolId: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc("platform_create_program", { p_org: schoolId, p_name: name });
  if (error) throw error;
  return data as string;
}

export async function createSchool(s: { name: string; short_name: string; primary_color: string; secondary_color: string; accent_color: string }): Promise<void> {
  const { error } = await supabase.from("organizations").insert({ ...s, kind: "school", timezone: "America/New_York" });
  if (error) throw error;
}

export async function updateSchool(id: string, patch: Partial<Omit<PlatformSchool, "id" | "programs">>): Promise<void> {
  const { error } = await supabase.from("organizations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function updateProgram(id: string, patch: Partial<Pick<PlatformProgram, "name" | "is_active" | "primary_color" | "secondary_color" | "accent_color" | "logo_url">>): Promise<void> {
  const { error } = await supabase.from("programs").update(patch).eq("id", id);
  if (error) throw error;
}

/** Uploads a logo image and returns its public address. Kept with the
 *  opponent logos, which coaches can already upload to. */
export async function uploadLogo(kind: "program" | "school", id: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const path = `${kind}s/${id}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("opponent-logos").upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("opponent-logos").getPublicUrl(path).data.publicUrl;
}

export function inviteLink(code: string): string {
  return `${window.location.origin}/?join=${code}`;
}
