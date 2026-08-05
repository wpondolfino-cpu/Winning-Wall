// src/lib/gameDaySheets.ts
import { supabase } from "./supabase";

export type GameDaySection =
  | "offense_man_triggers" | "offense_man_sets" | "offense_zone"
  | "blob_1st" | "blob_2nd" | "blob_zone"
  | "slob_1st" | "slob_2nd"
  | "defense_man" | "defense_zone" | "defense_press"
  | "specials_press_break" | "specials_eog";

// Fixed category structure — permanent shape, per design discussion.
export const GAMEDAY_SECTIONS: { key: GameDaySection; group: "offense" | "blobsSlobs" | "defense" | "specials"; label: string }[] = [
  { key: "offense_man_triggers", group: "offense", label: "Man — triggers" },
  { key: "offense_man_sets", group: "offense", label: "Man — sets" },
  { key: "offense_zone", group: "offense", label: "Zone" },
  { key: "blob_1st", group: "blobsSlobs", label: "BLOB — 1st half" },
  { key: "blob_2nd", group: "blobsSlobs", label: "BLOB — 2nd half" },
  { key: "blob_zone", group: "blobsSlobs", label: "BLOB zone" },
  { key: "slob_1st", group: "blobsSlobs", label: "SLOB — 1st half" },
  { key: "slob_2nd", group: "blobsSlobs", label: "SLOB — 2nd half" },
  { key: "defense_man", group: "defense", label: "Man" },
  { key: "defense_zone", group: "defense", label: "Zone" },
  { key: "defense_press", group: "defense", label: "Press" },
  { key: "specials_press_break", group: "specials", label: "Press breaks" },
  { key: "specials_eog", group: "specials", label: "End of game" },
];

export interface GameDaySheet {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GameDayCall {
  id: string;
  sheet_id: string;
  section: GameDaySection;
  call_name: string;
  play_id: string | null;
  sort_order: number;
  created_at: string;
}

export async function getGameDaySheets(): Promise<GameDaySheet[]> {
  const { data, error } = await supabase.from("gameday_sheets").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getGameDaySheet(id: string): Promise<GameDaySheet | null> {
  const { data, error } = await supabase.from("gameday_sheets").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createGameDaySheet(name: string): Promise<GameDaySheet> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("gameday_sheets").insert({ name: name.trim(), created_by: user.id }).select().single();
  if (error) throw error;
  return data;
}

export async function renameGameDaySheet(id: string, name: string) {
  const { error } = await supabase.from("gameday_sheets").update({ name: name.trim(), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteGameDaySheet(id: string) {
  const { error } = await supabase.from("gameday_sheets").delete().eq("id", id);
  if (error) throw error;
}

// Clones every call from a chosen source sheet into a brand-new sheet.
export async function duplicateGameDaySheet(sourceSheetId: string, newName: string): Promise<GameDaySheet> {
  const calls = await getGameDayCalls(sourceSheetId);
  const newSheet = await createGameDaySheet(newName);
  if (calls.length) {
    const { error } = await supabase.from("gameday_calls").insert(
      calls.map(({ id, sheet_id, created_at, ...rest }) => ({ ...rest, sheet_id: newSheet.id }))
    );
    if (error) throw error;
  }
  return newSheet;
}

export async function getGameDayCalls(sheetId: string): Promise<GameDayCall[]> {
  const { data, error } = await supabase.from("gameday_calls").select("*").eq("sheet_id", sheetId).order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function createGameDayCall(sheetId: string, section: GameDaySection, callName: string, playId: string | null, sortOrder: number): Promise<GameDayCall> {
  const { data, error } = await supabase.from("gameday_calls")
    .insert({ sheet_id: sheetId, section, call_name: callName.trim(), play_id: playId, sort_order: sortOrder })
    .select().single();
  if (error) throw error;
  return data;
}

// Bulk import: one row per entry, all landing in one section at the
// end of whatever's already there. Used by both the paste-in text
// import (playId always null) and the Play Design library picker
// (playId set, callName defaulted from the play's title).
export async function bulkCreateGameDayCalls(
  sheetId: string,
  section: GameDaySection,
  entries: { callName: string; playId?: string | null }[],
  startSortOrder: number
): Promise<GameDayCall[]> {
  const rows = entries
    .filter(e => e.callName.trim())
    .map((e, i) => ({ sheet_id: sheetId, section, call_name: e.callName.trim(), play_id: e.playId ?? null, sort_order: startSortOrder + i }));
  if (!rows.length) return [];
  const { data, error } = await supabase.from("gameday_calls").insert(rows).select();
  if (error) throw error;
  return data ?? [];
}

export async function updateGameDayCall(id: string, patch: Partial<Pick<GameDayCall, "call_name" | "play_id" | "sort_order">>) {
  const { error } = await supabase.from("gameday_calls").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteGameDayCall(id: string) {
  const { error } = await supabase.from("gameday_calls").delete().eq("id", id);
  if (error) throw error;
}

// Batch delete — used to undo a bulk import (paste or play-library) in one shot.
export async function deleteGameDayCalls(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("gameday_calls").delete().in("id", ids);
  if (error) throw error;
}

// Persists a full reordering of one section's calls after a drag.
export async function reorderGameDayCalls(orderedIds: string[]) {
  await Promise.all(orderedIds.map((id, i) => supabase.from("gameday_calls").update({ sort_order: i }).eq("id", id)));
}

// ── Re-importable export (hidden data embedded in a PDF) ────────
// Already fully self-contained -- call names are plain text, and the
// only reference (an optional linked Play) degrades gracefully to
// "unlinked" on import if that specific play no longer exists.
export const GAMEDAY_SHEET_EXPORT_SCHEMA_VERSION = 1;

export async function gameDaySheetToExportPayload(sheetId: string) {
  const sheet = await getGameDaySheet(sheetId);
  if (!sheet) throw new Error("Game day sheet not found");
  const calls = await getGameDayCalls(sheetId);
  return {
    name: sheet.name,
    calls: calls.map(({ id, sheet_id, created_at, ...rest }) => rest),
  };
}

export async function importGameDaySheetFromExportPayload(payload: Awaited<ReturnType<typeof gameDaySheetToExportPayload>>): Promise<GameDaySheet> {
  const sheet = await createGameDaySheet(`${payload.name} (imported)`);
  if (payload.calls.length) {
    const { error } = await supabase.from("gameday_calls").insert(
      payload.calls.map((c: any) => ({ ...c, sheet_id: sheet.id, play_id: null }))
    );
    if (error) throw error;
  }
  return sheet;
}
