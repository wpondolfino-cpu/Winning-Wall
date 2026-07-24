// src/lib/playCategories.ts
// Play categories live in the plays_categories table, same pattern as
// drill categories in lib/categories.ts. Coach/admin-manageable;
// renaming cascades to every play that uses it (DB-level ON UPDATE
// CASCADE), deleting is blocked while any play still uses it.

import { supabase } from "./supabase";

export interface PlayCategory {
  name: string;
  sort_order: number;
}

export async function getPlayCategories(): Promise<PlayCategory[]> {
  const { data, error } = await supabase
    .from("plays_categories")
    .select("name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) { console.error("Failed to load play categories:", error); return []; }
  return data ?? [];
}

export async function addPlayCategory(name: string): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name can't be empty." };
  const { data: existing } = await supabase.from("plays_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;
  const { error } = await supabase.from("plays_categories").insert({ name: trimmed, sort_order: nextOrder });
  if (error) return { error: error.code === "23505" ? "That category already exists." : error.message };
  return { error: null };
}

export async function renamePlayCategory(oldName: string, newName: string): Promise<{ error: string | null }> {
  const trimmed = newName.trim();
  if (!trimmed) return { error: "Name can't be empty." };
  if (trimmed === oldName) return { error: null };
  const { error } = await supabase.from("plays_categories").update({ name: trimmed }).eq("name", oldName);
  if (error) return { error: error.code === "23505" ? "That category already exists." : error.message };
  return { error: null };
}

export async function deletePlayCategory(name: string): Promise<{ error: string | null }> {
  const { count } = await supabase.from("plays").select("id", { count: "exact", head: true }).eq("category", name);
  if (count && count > 0) return { error: `${count} play${count === 1 ? "" : "s"} still use this category — reassign them first.` };
  const { error } = await supabase.from("plays_categories").delete().eq("name", name);
  if (error) return { error: error.message };
  return { error: null };
}
