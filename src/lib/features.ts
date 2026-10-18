// src/lib/features.ts
// Feature groups a program can have switched on or off (Platform page).
// Stored in program_features: no row = on, a row with enabled=false = off.
// Turning a group off hides its pages for everyone in that program; their
// data stays and comes back when it's switched on again.

import { supabase } from "./supabase";

export type FeatureKey = "offseason" | "lifting" | "inseason" | "playbook" | "quizzes";

export interface FeatureGroup {
  key: FeatureKey | "core";
  name: string;
  items: string;
  locked?: boolean;
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  { key: "core",      name: "Core", items: "Schedule · Players & Coaches · Announcements · Settings · Profile", locked: true },
  { key: "offseason", name: "Offseason training", items: "Manage Workouts · Leaderboard · Player Drills · Challenges & Class Clash · Hall of Fame · XP & perks" },
  { key: "lifting",   name: "Lifting", items: "Lifting Programs · lifting logs & records" },
  { key: "inseason",  name: "In-season coaching", items: "Practices · Team Drills · Analytics · Scout Sheets · Game Day · lineups & rotations" },
  { key: "playbook",  name: "Playbook", items: "Plays · playbooks shared with players" },
  { key: "quizzes",   name: "Quizzes", items: "Quizzes · live quizzes · review deck" },
];

// Which feature each page (nav tab) belongs to. Pages not listed are core.
const TAB_FEATURE: Record<string, FeatureKey> = {
  workouts: "offseason", leaderboard: "offseason", library: "offseason", challenges: "offseason",
  h2h: "offseason", hof: "offseason", progress: "offseason", admin: "offseason",
  lifting: "lifting",
  practices: "inseason", practicelibrary: "inseason", gamestats: "inseason", scoutsheets: "inseason", gameday: "inseason",
  plays: "playbook", playbooks: "playbook",
  quizzes: "quizzes",
};

export function featureOfTab(tab: string): FeatureKey | null {
  return TAB_FEATURE[tab] ?? null;
}

/** Feature keys switched off for a program. */
export async function loadFeaturesOff(programId: string | null | undefined): Promise<Set<FeatureKey>> {
  if (!programId) return new Set();
  const { data } = await supabase.from("program_features")
    .select("feature_key, enabled").eq("program_id", programId).eq("enabled", false);
  return new Set(((data ?? []) as any[]).map(r => r.feature_key as FeatureKey));
}

/** The pages hidden in a program, given its features that are off. */
export function tabsOff(off: Set<FeatureKey>): Set<string> {
  const s = new Set<string>();
  for (const [tab, f] of Object.entries(TAB_FEATURE)) if (off.has(f)) s.add(tab);
  return s;
}

export async function setFeature(programId: string, key: FeatureKey, enabled: boolean): Promise<void> {
  const { error } = await supabase.from("program_features")
    .upsert({ program_id: programId, feature_key: key, enabled }, { onConflict: "program_id,feature_key" });
  if (error) throw error;
}
