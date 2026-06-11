// src/lib/xp.ts
// XP system — awarding XP, perks, player tier, perk notifications
// XP enabled/disabled reads from database only (no localStorage)

import { supabase, XpPerk, DEFAULT_PERKS } from "./supabase";
import { currentPeriodStart } from "./periods";

export const XP_PER_ATTEMPT    = 10;
export const XP_CHALLENGE_SENT = 2;
export const XP_CHALLENGE_DONE = 3;

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
  }, { onConflict: "perk_key" });
}

export async function getXpPerks(): Promise<XpPerk[]> {
  const { data } = await supabase.from("xp_settings").select("*").order("xp_required");
  return data && data.length > 0 ? data : DEFAULT_PERKS;
}

export async function getPlayerXp(playerId: string): Promise<number> {
  const { data } = await supabase
    .from("profiles").select("total_xp").eq("id", playerId).single();
  return data?.total_xp ?? 0;
}

export async function awardXp(playerId: string, amount: number, reason: string): Promise<void> {
  await supabase.from("xp_log").insert({ player_id: playerId, xp_amount: amount, reason });
  const { data: prof } = await supabase
    .from("profiles").select("total_xp").eq("id", playerId).single();
  const current = prof?.total_xp ?? 0;
  await supabase.from("profiles").update({ total_xp: current + amount }).eq("id", playerId);
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

export async function hasPerkUsedThisPeriod(playerId: string, perkKey: string): Promise<boolean> {
  const periodStart = currentPeriodStart().toISOString().split("T")[0];
  const { data } = await supabase
    .from("perk_usage").select("id")
    .eq("player_id", playerId).eq("perk_key", perkKey).eq("period_start", periodStart).single();
  return !!data;
}

export async function usePerk(
  playerId: string,
  perkKey: string,
  workoutId?: string
): Promise<boolean> {
  const periodStart = currentPeriodStart().toISOString().split("T")[0];
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
