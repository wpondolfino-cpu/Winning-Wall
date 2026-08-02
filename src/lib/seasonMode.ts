// src/lib/seasonMode.ts
// Global in-season/off-season mode — same app_settings cache pattern
// as periods.ts (period_anchor). Drives which nav icons show and
// which Leaderboard tab opens by default. A player with no roster
// assignment (home_roster_id null) always sees the offseason nav
// regardless of this setting -- see isRostered() below.

import { supabase } from "./supabase";

export type SeasonMode = "offseason" | "inseason";

let _modeCache: SeasonMode = "offseason";

export async function loadSeasonMode(): Promise<SeasonMode> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "season_mode")
    .maybeSingle();
  const mode: SeasonMode = data?.value === "inseason" ? "inseason" : "offseason";
  _modeCache = mode;
  return mode;
}

export async function saveSeasonMode(mode: SeasonMode): Promise<void> {
  await supabase.from("app_settings").upsert(
    { key: "season_mode", value: mode, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  _modeCache = mode;
}

export function getSeasonMode(): SeasonMode {
  return _modeCache;
}

// A player only ever sees the in-season nav/leaderboard if BOTH the
// app is in-season AND they're actually on a roster. No roster ->
// always offseason, regardless of the global toggle.
export function isRostered(profile: { home_roster_id?: string | null } | null | undefined): boolean {
  return !!profile?.home_roster_id;
}

export function effectiveModeFor(profile: { home_roster_id?: string | null } | null | undefined): SeasonMode {
  if (getSeasonMode() === "inseason" && isRostered(profile)) return "inseason";
  return "offseason";
}
