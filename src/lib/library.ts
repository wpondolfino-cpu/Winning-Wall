// src/lib/library.ts
// The Shared Library (migration 194). The platform admin copies drills,
// templates, plays and lifting programs into it; head coaches see what's
// offered under "New" and add copies of their own. The copies live in a
// hidden "Shared Library" program only the platform admin can enter.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type LibraryKind = "drill" | "team_drill" | "template" | "play" | "lifting";

export const KIND_LABEL: Record<LibraryKind, string> = {
  drill: "Player drill",
  team_drill: "Team drill",
  template: "Practice template",
  play: "Play",
  lifting: "Lifting program",
};

/** Where each kind is edited, as an app tab. */
export const KIND_TAB: Record<LibraryKind, string> = {
  drill: "library",
  team_drill: "practicelibrary",
  template: "practices",
  play: "plays",
  lifting: "lifting",
};

export interface LibraryItem {
  id: string; kind: LibraryKind; ref_id: string; title: string; meta: string | null;
  source: string; source_org: string | null; created_at: string;
  starter: boolean; offered: boolean; added: number; dismissed: number;
}
export interface LibraryOverview { library_program_id: string | null; programs: number; items: LibraryItem[]; }
export interface NewItem { id: string; kind: LibraryKind; title: string; meta: string | null; offered_at: string | null; }

// ── Platform admin ───────────────────────────────────────────

let adminCheck: Promise<boolean> | null = null;
/** Whether the signed-in person is the platform admin (asked once per load). */
export function checkPlatformAdmin(): Promise<boolean> {
  if (!adminCheck) {
    adminCheck = (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { adminCheck = null; return false; }   // ask again once signed in
      const { data } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id);
      return (data ?? []).length > 0;
    })().catch(() => false);
  }
  return adminCheck;
}

export function usePlatformAdmin(): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => { let on = true; checkPlatformAdmin().then(v => { if (on) setYes(v); }); return () => { on = false; }; }, []);
  return yes;
}

export async function addToLibrary(kind: LibraryKind, id: string): Promise<{ status: "added" | "already"; title: string }> {
  const { data, error } = await supabase.rpc("library_add", { p_kind: kind, p_id: id });
  if (error) throw error;
  return data as any;
}

export interface BrowseRow { id: string; title: string; meta: string | null; in_library: boolean; }

/** One program's drills / templates / plays / lifting programs, to pick from. */
export async function browseProgram(programId: string, kind: LibraryKind): Promise<BrowseRow[]> {
  const { data, error } = await supabase.rpc("library_browse", { p_program: programId, p_kind: kind });
  if (error) throw error;
  return (data ?? []) as BrowseRow[];
}

/** Of these ids, the ones already in the Shared Library. */
export async function inLibrary(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await supabase.rpc("library_in_library", { p_ids: ids });
  return new Set(((data ?? []) as string[]));
}

export async function loadLibrary(): Promise<LibraryOverview> {
  const { data, error } = await supabase.rpc("platform_library");
  if (error) throw error;
  return data as LibraryOverview;
}

export async function setLibraryFlags(itemId: string, flags: { starter?: boolean; offered?: boolean }): Promise<void> {
  const { error } = await supabase.rpc("library_set", {
    p_item: itemId, p_starter: flags.starter ?? null, p_offered: flags.offered ?? null,
  });
  if (error) throw error;
}

export async function removeFromLibrary(itemId: string): Promise<void> {
  const { error } = await supabase.rpc("library_remove", { p_item: itemId });
  if (error) throw error;
}

/** Switch into the hidden Shared Library program, on the page that edits this kind. */
export async function openInLibrary(libraryProgramId: string, kind: LibraryKind): Promise<void> {
  const { error } = await supabase.rpc("set_active_program", { pid: libraryProgramId });
  if (error) throw error;
  window.location.href = `/?tab=${KIND_TAB[kind]}`;
}

// ── Head coaches ─────────────────────────────────────────────

/** Offered items this program hasn't added or put off yet. Empty for anyone but a head coach. */
export async function loadNew(kinds: LibraryKind[]): Promise<NewItem[]> {
  const { data, error } = await supabase.rpc("library_new", { p_kinds: kinds });
  if (error) return [];
  return (data ?? []) as NewItem[];
}

export async function pickNew(itemId: string, add: boolean): Promise<{ title: string; kind: LibraryKind }> {
  const { data, error } = await supabase.rpc("library_pick", { p_item: itemId, p_add: add });
  if (error) throw error;
  return data as any;
}
