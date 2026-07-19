// src/lib/categories.ts
// Drill categories now live in the drill_categories table instead of a
// hardcoded frontend list, so any component that needs the list of
// categories fetches it here.

import { supabase } from "./supabase";

export interface DrillCategory {
  name: string;
  sort_order: number;
}

export async function getCategories(): Promise<DrillCategory[]> {
  const { data, error } = await supabase
    .from("drill_categories")
    .select("name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) { console.error("Failed to load categories:", error); return []; }
  return data ?? [];
}

export async function addCategory(name: string): Promise<{ error: string | null }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name can't be empty." };
  const { data: existing } = await supabase.from("drill_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;
  const { error } = await supabase.from("drill_categories").insert({ name: trimmed, sort_order: nextOrder });
  if (error) return { error: error.code === "23505" ? "That category already exists." : error.message };
  return { error: null };
}

export async function renameCategory(oldName: string, newName: string): Promise<{ error: string | null }> {
  const trimmed = newName.trim();
  if (!trimmed) return { error: "Name can't be empty." };
  if (trimmed === oldName) return { error: null };
  const { error } = await supabase.from("drill_categories").update({ name: trimmed }).eq("name", oldName);
  if (error) return { error: error.code === "23505" ? "That category already exists." : error.message };
  return { error: null };
}

export async function deleteCategory(name: string): Promise<{ error: string | null }> {
  const { count } = await supabase.from("workouts").select("id", { count: "exact", head: true }).eq("category", name);
  if (count && count > 0) return { error: `${count} drill${count === 1 ? "" : "s"} still use this category — reassign them first.` };
  const { error } = await supabase.from("drill_categories").delete().eq("name", name);
  if (error) return { error: error.message };
  return { error: null };
}
