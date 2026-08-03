// src/lib/practiceSuggestions.ts
import { supabase } from "./supabase";
import { StatRow, StatGoal } from "./gameStats";

export interface SuggestionItem {
  stat_key: string;
  label: string;
  team: "us" | "opponent";
  side: "offense" | "defense"; // us = offense, opponent = defense (what we allowed)
  value: number;
  goal: number;
  ratio: number; // same normalization as the existing red/yellow/green coloring — <1 under goal, >1 over
  raw?: string;
  note?: string | null; // weaknesses only; strengths never carry a note
  streak: number; // consecutive reports flagged as a weakness (0 for strengths / first-time)
}

export interface PracticeSuggestions {
  weaknesses: SuggestionItem[]; // up to 4 (2 offense + 2 defense), ties shown in full
  strengths: SuggestionItem[];  // up to 4 (2 offense + 2 defense), ties shown in full
}

function sampleFromRaw(raw?: string): number | null {
  if (!raw) return null;
  const m = raw.match(/\/\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function goalFor(goals: StatGoal[], key: string, team: "us" | "opponent"): StatGoal | undefined {
  return goals.find(g => g.stat_key === key && g.team === team);
}

interface Candidate extends SuggestionItem {
  eligible: boolean;
}

function buildCandidates(rows: StatRow[], goals: StatGoal[], team: "us" | "opponent"): Candidate[] {
  const side: "offense" | "defense" = team === "us" ? "offense" : "defense";
  return rows
    .filter(r => r.goal != null)
    .map(r => {
      const g = goalFor(goals, r.key, team);
      const direction = g?.direction ?? "higher_better";
      const ratio = direction === "higher_better" ? r.value / (r.goal as number) : (r.goal as number) / r.value;
      const sample = sampleFromRaw(r.raw);
      const minSample = g?.min_sample_size ?? null;
      const eligible = !(minSample != null && sample != null && sample < minSample);
      return {
        stat_key: r.key, label: r.label, team, side,
        value: r.value, goal: r.goal as number, ratio, raw: r.raw,
        note: g?.note ?? null, streak: 0, eligible,
      };
    });
}

function pickTopTwoEachSide(items: Candidate[], direction: "worst" | "best"): SuggestionItem[] {
  const offense = items.filter(i => i.side === "offense").sort((a, b) => direction === "worst" ? a.ratio - b.ratio : b.ratio - a.ratio);
  const defense = items.filter(i => i.side === "defense").sort((a, b) => direction === "worst" ? a.ratio - b.ratio : b.ratio - a.ratio);

  function withTies(sorted: Candidate[]): Candidate[] {
    if (sorted.length <= 2) return sorted;
    const cutoff = sorted[1].ratio;
    return sorted.filter((c, i) => i < 2 || c.ratio === cutoff);
  }

  return [...withTies(offense), ...withTies(defense)];
}

export async function computePracticeSuggestions(usStats: StatRow[], oppStats: StatRow[], goals: StatGoal[]): Promise<PracticeSuggestions> {
  const all = [...buildCandidates(usStats, goals, "us"), ...buildCandidates(oppStats, goals, "opponent")]
    .filter(c => c.eligible);

  const weaknessCandidates = all.filter(c => c.ratio < 1);
  const strengthCandidates = all.filter(c => c.ratio > 1);

  const weaknesses = pickTopTwoEachSide(weaknessCandidates, "worst");
  const strengths = pickTopTwoEachSide(strengthCandidates, "best");

  // Chronic-flag streaks: increment for anything flagged this time,
  // reset to 0 for anything with a goal that's eligible but wasn't
  // flagged. Stats excluded by the sample-size floor are left alone --
  // not enough information to say whether they're actually fine.
  const flaggedKeys = new Set(weaknesses.map(w => `${w.team}:${w.stat_key}`));

  const { data: existingStreaks } = await supabase.from("stat_flag_streaks").select("*");
  const streakMap = new Map((existingStreaks ?? []).map((s: any) => [`${s.team}:${s.stat_key}`, s.current_streak as number]));

  const streakWrites = all.map(c => {
    const k = `${c.team}:${c.stat_key}`;
    const flagged = flaggedKeys.has(k);
    const nextStreak = flagged ? (streakMap.get(k) ?? 0) + 1 : 0;
    return { stat_key: c.stat_key, team: c.team, current_streak: nextStreak, updated_at: new Date().toISOString() };
  });
  if (streakWrites.length) {
    await supabase.from("stat_flag_streaks").upsert(streakWrites, { onConflict: "stat_key,team" });
  }

  weaknesses.forEach(w => {
    const k = `${w.team}:${w.stat_key}`;
    w.streak = (streakMap.get(k) ?? 0) + 1;
  });

  return { weaknesses, strengths };
}
