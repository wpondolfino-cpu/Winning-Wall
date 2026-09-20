// src/lib/gameDaySheets.ts
import { supabase } from "./supabase";

/**
 * A section key. Still text, and the thirteen built-ins keep the keys
 * they have always had — which is why turning sections into rows moved no
 * call data at all. A custom section gets a generated key.
 */
export type GameDaySection = string;

export type SectionGroup = "offense" | "blobsSlobs" | "defense" | "specials";

export const SECTION_GROUPS: { key: SectionGroup; label: string }[] = [
  { key: "offense", label: "Offense" },
  { key: "blobsSlobs", label: "BLOBs & SLOBs" },
  { key: "defense", label: "Defense" },
  { key: "specials", label: "Specials" },
];

/**
 * What a NEW sheet starts with. Eleven, not thirteen.
 *
 * Splitting BLOBs and SLOBs by half is one program's habit, not a
 * universal one, and a base model shouldn't carry another staff's
 * vocabulary. Anyone who works that way adds the halves themselves now
 * that sections can be added.
 *
 * Existing sheets are untouched: they keep the thirteen they were seeded
 * with in migration 135, including their calls. This list only decides
 * what a sheet created from here gets.
 */
export const DEFAULT_SECTIONS: { key: string; group: SectionGroup; label: string }[] = [
  { key: "offense_man_triggers", group: "offense", label: "Man — triggers" },
  { key: "offense_man_sets", group: "offense", label: "Man — sets" },
  { key: "offense_zone", group: "offense", label: "Zone" },
  { key: "blob_man", group: "blobsSlobs", label: "BLOB — man" },
  { key: "blob_zone", group: "blobsSlobs", label: "BLOB zone" },
  { key: "slob", group: "blobsSlobs", label: "SLOB" },
  { key: "defense_man", group: "defense", label: "Man" },
  { key: "defense_zone", group: "defense", label: "Zone" },
  { key: "defense_press", group: "defense", label: "Press" },
  { key: "specials_press_break", group: "specials", label: "Press breaks" },
  { key: "specials_eog", group: "specials", label: "End of game" },
];

/** @deprecated The seed, not the set — read a sheet's own sections instead. */
export const GAMEDAY_SECTIONS = DEFAULT_SECTIONS;

export interface GameDaySectionRow {
  id: string;
  sheet_id: string;
  key: string;
  label: string;
  group: SectionGroup;
  sort_order: number;
  hidden: boolean;
  is_builtin: boolean;
}

export async function getSections(sheetId: string): Promise<GameDaySectionRow[]> {
  const { data, error } = await supabase
    .from("gameday_sections").select("*")
    .eq("sheet_id", sheetId).order("sort_order", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map(r => ({ ...r, group: r.group as SectionGroup }));
}

/** Give a sheet the default thirteen. Idempotent. */
export async function seedSections(sheetId: string): Promise<void> {
  const { error } = await supabase.from("gameday_sections").upsert(
    DEFAULT_SECTIONS.map((d, i) => ({
      sheet_id: sheetId, key: d.key, label: d.label, group: d.group,
      sort_order: i, hidden: false, is_builtin: true,
    })),
    { onConflict: "sheet_id,key", ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function addSection(
  sheetId: string, label: string, group: SectionGroup
): Promise<GameDaySectionRow> {
  const existing = await getSections(sheetId);
  const { data, error } = await supabase.from("gameday_sections").insert({
    sheet_id: sheetId,
    // Generated so it can't collide with a built-in key or another custom one.
    key: `custom_${crypto.randomUUID().slice(0, 8)}`,
    label: label.trim(), group,
    sort_order: Math.max(0, ...existing.map(s => s.sort_order)) + 1,
    is_builtin: false,
  }).select().single();
  if (error) throw error;
  return data as GameDaySectionRow;
}

export async function updateSection(
  id: string, patch: Partial<Pick<GameDaySectionRow, "label" | "hidden" | "group" | "sort_order">>
): Promise<void> {
  const { error } = await supabase.from("gameday_sections").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Delete a custom section, and the calls in it.
 *
 * Built-ins can't be deleted — only hidden. Their keys are shared by every
 * other sheet, and a delete here would look local while orphaning calls
 * elsewhere.
 */
export async function deleteSection(section: GameDaySectionRow): Promise<void> {
  if (section.is_builtin) throw new Error("Built-in sections can be hidden, not deleted.");
  await supabase.from("gameday_calls").delete().eq("sheet_id", section.sheet_id).eq("section", section.key);
  const { error } = await supabase.from("gameday_sections").delete().eq("id", section.id);
  if (error) throw error;
}

export interface GameDaySheet {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** @deprecated Superseded by the gameday_sections table. */
  section_labels?: Record<string, string>;
  /** @deprecated Superseded by the gameday_sections table. */
  hidden_sections?: string[];
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
  await seedSections(data.id);
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
