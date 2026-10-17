// src/lib/xp.ts
// XP system — awarding XP, perks, player tier, perk notifications
// Note: XP_PER_ATTEMPT, XP_CHALLENGE_SENT, XP_CHALLENGE_DONE constants
// live in supabase.ts to avoid duplicate export conflicts.

import { supabase, XpPerk, DEFAULT_PERKS } from "./supabase";
import { ensureCompetitionLoaded, currentPerkPeriodKey } from "./periods";

// ── XP enabled state — database only, no localStorage ────────
export async function getXpEnabled(): Promise<boolean> {
  const { data } = await supabase
    .from("xp_settings").select("xp_required").eq("perk_key", "_xp_enabled").single();
  return (data?.xp_required ?? 1) !== 0;
}

export async function setXpEnabled(enabled: boolean): Promise<void> {
  await supabase.from("xp_settings").upsert({
    perk_key:    "_xp_enabled",
    perk_name:   "XP System Enabled",
    xp_required: enabled ? 1 : 0,
    description: "Master toggle",
    updated_at:  new Date().toISOString(),
  }, { onConflict: "program_id,perk_key" });
}

export async function getXpPerks(): Promise<XpPerk[]> {
  const { data } = await supabase.from("xp_settings").select("*").order("xp_required");
  return data && data.length > 0 ? data : DEFAULT_PERKS;
}

// XP is per program: it lives on the player's membership in the program
// you're in (migration 185), not on their profile.
export async function getPlayerXp(playerId: string): Promise<number> {
  const { data } = await supabase.rpc("member_xp", { p_user: playerId });
  return (data as number | null) ?? 0;
}

// XP is awarded by the server when workouts and challenges are logged
// (log_workout / respond_challenge). Nothing in the app calls this any
// more; kept so old imports still compile.
export async function awardXp(_playerId: string, _amount: number, _reason: string): Promise<void> {
  console.warn("awardXp is no longer used -- XP is awarded on the server.");
}

export function getPlayerTier(
  xp: number,
  perks: XpPerk[]
): { tier: number; perk: XpPerk | null; nextPerk: XpPerk | null; avatarOutline: string } {
  const sorted = [...perks].sort((a, b) => a.xp_required - b.xp_required);
  let currentPerk: XpPerk | null = null;
  let nextPerk:    XpPerk | null = null;

  for (let i = 0; i < sorted.length; i++) {
    if (xp >= sorted[i].xp_required) {
      currentPerk = sorted[i];
    } else {
      nextPerk = sorted[i];
      break;
    }
  }

  const tier = currentPerk ? sorted.indexOf(currentPerk) + 1 : 0;

  const outlineColors: Record<string, string> = {
    "team_eligible": "#9ca3af",
    "streak_shield": "#c0c0c0",
    "team_bonus":    "#2550d4",
    "score_boost":   "#f0c040",
  };
  const avatarOutline = currentPerk
    ? (outlineColors[currentPerk.perk_key] ?? "var(--border)")
    : "var(--border)";

  return { tier, perk: currentPerk, nextPerk, avatarOutline };
}

// Perks reset with each competition, whatever its length -- one use in a
// one-day competition, one in a month-long one -- and can't be used while
// no competition is running. Uses are recorded under the competition's
// start date (currentPerkPeriodKey), the same dates the old 14-day periods
// used, so uses from before the switch still count.

/** True if used this competition. Also true when nothing is running, since there's nothing to use it on -- check getCurrentCompetition() to tell the two apart. */
export async function hasPerkUsedThisPeriod(playerId: string, perkKey: string): Promise<boolean> {
  await ensureCompetitionLoaded();
  const periodStart = currentPerkPeriodKey();
  if (!periodStart) return true;
  const { data } = await supabase
    .from("perk_usage").select("id")
    .eq("player_id", playerId).eq("perk_key", perkKey).eq("period_start", periodStart).maybeSingle();
  return !!data;
}

/** False if no competition is running or the insert failed. */
export async function usePerk(
  playerId: string,
  perkKey: string,
  workoutId?: string
): Promise<boolean> {
  await ensureCompetitionLoaded();
  const periodStart = currentPerkPeriodKey();
  if (!periodStart) return false;
  const { error } = await supabase.from("perk_usage").insert({
    player_id:    playerId,
    perk_key:     perkKey,
    period_start: periodStart,
  });
  return !error;
}

// ── Perk notification helper ──────────────────────────────────
// Returns perk keys the player has unlocked but hasn't seen
// the tutorial for yet. Used by App.tsx for badge + toast.
export async function checkUnseenPerks(
  playerId: string,
  currentXp: number,
  perks: XpPerk[]
): Promise<string[]> {
  if (!playerId || perks.length === 0) return [];

  const { data: seen } = await supabase
    .from("tutorials_seen").select("tutorial_key").eq("player_id", playerId);

  const seenKeys = new Set((seen ?? []).map((r: any) => r.tutorial_key));

  const TUTORIAL_KEYS = new Set([
    "challenges_unlocked",
    "team_eligible",
    "streak_shield",
    "team_bonus",
    "score_boost",
  ]);

  return perks
    .filter(p =>
      TUTORIAL_KEYS.has(p.perk_key) &&
      currentXp >= p.xp_required &&
      !seenKeys.has(p.perk_key)
    )
    .sort((a, b) => a.xp_required - b.xp_required)
    .map(p => p.perk_key);
}
