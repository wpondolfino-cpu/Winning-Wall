// src/lib/drillTaxonomy.ts
// Categories and tags for both drill libraries, for the Drill Library's
// "Manage categories & tags" tab.
//
//   Team drills   : practice_drill_categories (one per drill, category_name)
//                   practice_drill_tags + practice_drill_tag_links (many)
//   Player drills : drill_categories (one per drill, workouts.category)
//                   workouts.tags (a text array on each drill -- no tag table)
//
// The links already carry renames through to every drill on their own
// (ON UPDATE CASCADE), so a rename here is one update. Merging moves the
// drills over first, then removes the old name. Everything is scoped to
// the current program by the tables' own row security.

import { supabase } from "./supabase";

export type DrillKind = "team" | "player";
export type TaxoWhat = "category" | "tag";
export interface TaxoItem { name: string; count: number }
export interface Taxonomy { categories: TaxoItem[]; tags: TaxoItem[] }

type Result = { error: string | null };
const ok: Result = { error: null };
const fail = (e: any): Result => ({ error: e?.message ?? String(e) });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Every category (in its set order) and tag, with how many drills use each. */
export async function loadTaxonomy(kind: DrillKind): Promise<Taxonomy> {
  if (kind === "team") {
    const [cats, tags, drills, links] = await Promise.all([
      supabase.from("practice_drill_categories").select("name, sort_order").order("sort_order", { ascending: true }),
      supabase.from("practice_drill_tags").select("name").order("name", { ascending: true }),
      supabase.from("practice_drills_library").select("category_name"),
      supabase.from("practice_drill_tag_links").select("tag_name"),
    ]);
    const catCount = new Map<string, number>();
    ((drills.data ?? []) as any[]).forEach(d => d.category_name && catCount.set(d.category_name, (catCount.get(d.category_name) ?? 0) + 1));
    const tagCount = new Map<string, number>();
    ((links.data ?? []) as any[]).forEach(l => tagCount.set(l.tag_name, (tagCount.get(l.tag_name) ?? 0) + 1));
    return {
      categories: ((cats.data ?? []) as any[]).map(c => ({ name: c.name, count: catCount.get(c.name) ?? 0 })),
      tags: ((tags.data ?? []) as any[]).map(t => ({ name: t.name, count: tagCount.get(t.name) ?? 0 })),
    };
  }
  const [cats, drills] = await Promise.all([
    supabase.from("drill_categories").select("name, sort_order").order("sort_order", { ascending: true }).order("name", { ascending: true }),
    supabase.from("workouts").select("category, tags"),
  ]);
  const catCount = new Map<string, number>(), tagCount = new Map<string, number>();
  ((drills.data ?? []) as any[]).forEach(d => {
    if (d.category) catCount.set(d.category, (catCount.get(d.category) ?? 0) + 1);
    ((d.tags ?? []) as string[]).forEach(t => tagCount.set(t, (tagCount.get(t) ?? 0) + 1));
  });
  return {
    categories: ((cats.data ?? []) as any[]).map(c => ({ name: c.name, count: catCount.get(c.name) ?? 0 })),
    tags: [...tagCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Player drills that carry a tag, with their full tag lists. */
async function playerDrillsWithTag(tag: string): Promise<{ id: string; tags: string[] }[]> {
  const { data, error } = await supabase.from("workouts").select("id, tags").contains("tags", [tag]);
  if (error) throw error;
  return ((data ?? []) as any[]).map(w => ({ id: w.id, tags: (w.tags ?? []) as string[] }));
}

/** Renames everywhere it's used. Fails (asks for Merge) if the new name already exists. */
export async function renameTaxo(kind: DrillKind, what: TaxoWhat, from: string, to: string, existing: string[]): Promise<Result> {
  const name = to.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Type a name." };
  if (name === from) return ok;
  if (existing.some(e => e !== from && same(e, name))) return { error: `"${name}" already exists. Use Merge to combine them.` };
  try {
    if (kind === "team") {
      const table = what === "category" ? "practice_drill_categories" : "practice_drill_tags";
      const { error } = await supabase.from(table).update({ name }).eq("name", from);   // drills follow (cascade)
      if (error) throw error;
    } else if (what === "category") {
      const { error } = await supabase.from("drill_categories").update({ name }).eq("name", from);   // drills follow (cascade)
      if (error) throw error;
    } else {
      for (const w of await playerDrillsWithTag(from)) {
        const tags = Array.from(new Set(w.tags.map(t => (t === from ? name : t))));
        const { error } = await supabase.from("workouts").update({ tags }).eq("id", w.id);
        if (error) throw error;
      }
    }
    return ok;
  } catch (e) { return fail(e); }
}

/** Moves every drill from one to another, then removes the first. */
export async function mergeTaxo(kind: DrillKind, what: TaxoWhat, from: string, into: string): Promise<Result> {
  if (from === into) return ok;
  try {
    if (kind === "team" && what === "category") {
      const { error } = await supabase.from("practice_drills_library").update({ category_name: into }).eq("category_name", from);
      if (error) throw error;
      const del = await supabase.from("practice_drill_categories").delete().eq("name", from);
      if (del.error) throw del.error;
    } else if (kind === "team") {
      const [{ data: fromLinks, error: e1 }, { data: intoLinks, error: e2 }] = await Promise.all([
        supabase.from("practice_drill_tag_links").select("drill_id").eq("tag_name", from),
        supabase.from("practice_drill_tag_links").select("drill_id").eq("tag_name", into),
      ]);
      if (e1 || e2) throw e1 ?? e2;
      const already = new Set(((intoLinks ?? []) as any[]).map(l => l.drill_id));
      const add = ((fromLinks ?? []) as any[]).map(l => l.drill_id).filter(id => !already.has(id));
      if (add.length) {
        const { error } = await supabase.from("practice_drill_tag_links").insert(add.map(drill_id => ({ drill_id, tag_name: into })));
        if (error) throw error;
      }
      const del = await supabase.from("practice_drill_tags").delete().eq("name", from);   // its links go with it
      if (del.error) throw del.error;
    } else if (what === "category") {
      const { error } = await supabase.from("workouts").update({ category: into }).eq("category", from);
      if (error) throw error;
      const del = await supabase.from("drill_categories").delete().eq("name", from);
      if (del.error) throw del.error;
    } else {
      for (const w of await playerDrillsWithTag(from)) {
        const tags = Array.from(new Set(w.tags.map(t => (t === from ? into : t))));
        const { error } = await supabase.from("workouts").update({ tags }).eq("id", w.id);
        if (error) throw error;
      }
    }
    return ok;
  } catch (e) { return fail(e); }
}

/**
 * Removes a category or tag. Drills that used it just lose it: team drills
 * go back to no category (the link does that), tags come off. A player
 * drill can't be left without a category, so a player category in use has
 * to be merged instead.
 */
export async function deleteTaxo(kind: DrillKind, what: TaxoWhat, name: string, count: number): Promise<Result> {
  try {
    if (kind === "team") {
      const table = what === "category" ? "practice_drill_categories" : "practice_drill_tags";
      const { error } = await supabase.from(table).delete().eq("name", name);
      if (error) throw error;
    } else if (what === "category") {
      if (count > 0) return { error: "Player drills always need a category. Merge this one into another instead." };
      const { error } = await supabase.from("drill_categories").delete().eq("name", name);
      if (error) throw error;
    } else {
      for (const w of await playerDrillsWithTag(name)) {
        const { error } = await supabase.from("workouts").update({ tags: w.tags.filter(t => t !== name) }).eq("id", w.id);
        if (error) throw error;
      }
    }
    return ok;
  } catch (e) { return fail(e); }
}

/** Saves the order categories appear in (chips and dropdowns). */
export async function reorderCategories(kind: DrillKind, names: string[]): Promise<Result> {
  const table = kind === "team" ? "practice_drill_categories" : "drill_categories";
  try {
    for (let i = 0; i < names.length; i++) {
      const { error } = await supabase.from(table).update({ sort_order: i }).eq("name", names[i]);
      if (error) throw error;
    }
    return ok;
  } catch (e) { return fail(e); }
}

/** Adds a category, or (team drills) a tag ready to be picked. */
export async function addTaxo(kind: DrillKind, what: TaxoWhat, name: string, existing: string[], nextOrder: number): Promise<Result> {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return { error: "Type a name." };
  if (existing.some(e => same(e, n))) return { error: `"${n}" already exists.` };
  try {
    if (what === "category") {
      const table = kind === "team" ? "practice_drill_categories" : "drill_categories";
      const { error } = await supabase.from(table).insert({ name: n, sort_order: nextOrder });
      if (error) throw error;
    } else if (kind === "team") {
      const { error } = await supabase.from("practice_drill_tags").insert({ name: n });
      if (error) throw error;
    } else {
      return { error: "Player drill tags are added on the drill itself." };
    }
    return ok;
  } catch (e) { return fail(e); }
}
