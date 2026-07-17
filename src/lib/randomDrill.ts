// src/lib/randomDrill.ts
// Shared pool/pick logic for the Random Drill Generator, used by both
// RandomDrillModal (initial generate/reroll in the Library) and
// WorkoutsPanel (the "Same filters" reroll after logging a score).

import { Workout } from "./supabase";

export interface RandomDrillFilters {
  category: string; // "All" or a specific category
  tags: string[];    // OR-matched — empty means no tag filter
}

export function randomDrillPool(drills: Workout[], filters: RandomDrillFilters): Workout[] {
  return drills.filter(d => {
    if ((d as any).library_archived === true) return false;
    const matchCategory = filters.category === "All" || d.category === filters.category;
    const matchTags = filters.tags.length === 0 || filters.tags.some(t => ((d as any).tags ?? []).includes(t));
    return matchCategory && matchTags;
  });
}

export function pickRandomDrill(candidates: Workout[], excludeId?: string): Workout | null {
  if (candidates.length === 0) return null;
  const options = excludeId && candidates.length > 1 ? candidates.filter(d => d.id !== excludeId) : candidates;
  return options[Math.floor(Math.random() * options.length)];
}
