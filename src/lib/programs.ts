// src/lib/programs.ts
// Which programs (teams) the signed-in user can work in, and switching
// between them. The database decides what "current program" means
// (profiles.active_program_id, checked by current_program_id()); every
// program-scoped table only shows rows from it. Switching updates that
// one setting and reloads, so every page refetches cleanly.

import { supabase } from "./supabase";

export type ProgramRole = "head_coach" | "coach" | "player";

export interface ProgramInfo {
  id: string;
  name: string;
  orgName: string;
  orgShort: string;
  primary: string;   // badge background
  accent: string;    // badge text
  role: ProgramRole | null;   // null = reachable only as platform admin
}

export interface MyPrograms {
  programs: ProgramInfo[];
  activeProgramId: string | null;
  isPlatformAdmin: boolean;
}

const DEFAULT_PRIMARY = "#1a3fa8";
const DEFAULT_ACCENT  = "#f0c040";

function shortFrom(name: string): string {
  const letters = name.split(/\s+/).filter(Boolean).map(w => w[0]).join("");
  return (letters || name).slice(0, 3).toUpperCase();
}

export async function loadMyPrograms(userId: string): Promise<MyPrograms> {
  const [adminRes, progRes, memberRes, profileRes] = await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id", userId),
    supabase.from("programs")
      .select("id, name, primary_color, accent_color, organizations(name, short_name, primary_color, accent_color)")
      .eq("is_active", true)
      .order("name"),
    supabase.from("program_members").select("program_id, role, status").eq("user_id", userId),
    supabase.from("profiles").select("active_program_id").eq("id", userId).single(),
  ]);

  const roleByProgram = new Map<string, ProgramRole>();
  for (const m of (memberRes.data ?? []) as any[]) {
    if (m.status === "active") roleByProgram.set(m.program_id, m.role);
  }

  const programs: ProgramInfo[] = ((progRes.data ?? []) as any[]).map(p => {
    const org = p.organizations ?? {};
    return {
      id: p.id,
      name: p.name,
      orgName: org.name ?? "",
      orgShort: org.short_name ?? shortFrom(org.name ?? p.name),
      primary: p.primary_color ?? org.primary_color ?? DEFAULT_PRIMARY,
      accent:  p.accent_color  ?? org.accent_color  ?? DEFAULT_ACCENT,
      role: roleByProgram.get(p.id) ?? null,
    };
  });

  return {
    programs,
    activeProgramId: (profileRes.data as any)?.active_program_id ?? null,
    isPlatformAdmin: (adminRes.data ?? []).length > 0,
  };
}

export async function switchProgram(programId: string): Promise<void> {
  const { error } = await supabase.rpc("set_active_program", { pid: programId });
  if (error) throw error;
  // A full reload is the simplest way to guarantee no page keeps showing
  // the previous program's data from its own state.
  window.location.reload();
}

export function roleLabel(role: ProgramRole | null): string {
  switch (role) {
    case "head_coach": return "Head coach";
    case "coach":      return "Assistant coach";
    case "player":     return "Player";
    default:           return "Platform admin access";
  }
}
