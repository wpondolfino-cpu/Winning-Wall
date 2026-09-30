// src/lib/leaderboard.ts
// Leaderboard queries and competition crowning

import { supabase, LeaderboardEntry, BiweeklyChampion } from "./supabase";
import type { Competition } from "./periods";
import { getPracticeWinStandings, PracticeWinStanding } from "./practiceWins";
import { getCurrentSeason } from "./records";

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const [{ data, error }, { data: totals, error: totalsErr }] = await Promise.all([
    supabase.from("leaderboard").select("*").order("rank", { ascending: true }),
    // Overall = starting balance + every competition + bonuses (migration
    // 154/155). Empty until go-live, when the view's totals still apply.
    supabase.rpc("overall_points"),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as LeaderboardEntry[];
  if (totalsErr || !totals || (totals as any[]).length === 0) return rows;

  const byId = new Map((totals as any[]).map(t => [t.player_id as string, Number(t.total)]));
  const merged = rows.map(r => ({ ...r, total_points: byId.get(r.id) ?? 0 }));
  merged.sort((x, y) => y.total_points - x.total_points);
  // Standard ranking: tied totals share a rank.
  let rank = 0;
  merged.forEach((r, i) => {
    if (i === 0 || r.total_points !== merged[i - 1].total_points) rank = i + 1;
    (r as any).rank = rank;
  });
  return merged;
}

/** One drill's placing inside a competition (window_points). */
export interface CompetitionDrillRow {
  player_id: string;
  workout_id: string;
  points: number;
  source: "placing" | "self_reported";
  best_raw: number | null;
  place: number | null;
}

/** The running (or any) competition's per-drill placings and self-reported points. */
export async function getCompetitionDrillRows(c: Pick<Competition, "starts_at" | "ends_at">): Promise<CompetitionDrillRow[]> {
  const { data, error } = await supabase.rpc("window_points", {
    p_start: c.starts_at, p_end: c.ends_at, p_with_placings: true,
  });
  if (error) { console.error("Competition placings failed:", error); return []; }
  return (data ?? []) as CompetitionDrillRow[];
}

/** A player's overall points split by competition (Overall dropdown). */
export interface OverallBreakdownRow {
  label: string;
  competition_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  points: number;
  running: boolean;
  won: boolean;
}

export async function getOverallBreakdown(playerId: string): Promise<OverallBreakdownRow[]> {
  const { data, error } = await supabase.rpc("overall_breakdown", { p_player: playerId });
  if (error) { console.error("Overall breakdown failed:", error); return []; }
  return ((data ?? []) as any[]).map(r => ({ ...r, points: Number(r.points) }));
}

export async function getBiweeklyChampions(): Promise<BiweeklyChampion[]> {
  const { data, error } = await supabase
    .from("biweekly_champions").select("*").order("crowned_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Standings for one competition: each player's best result per drill
// logged inside its dates, placed within grade group, plus self-reported
// points and bonuses earned in it (competition_standings, migration 154).
// The same numbers as the Current tab. Used for crowning and History.
export async function getCompetitionStandings(c: Pick<Competition, "id" | "starts_at" | "ends_at">): Promise<LeaderboardEntry[]> {
  const [{ data: st, error }, { data: pr }, { data: att }] = await Promise.all([
    supabase.rpc("competition_standings", { p_competition_id: c.id }),
    supabase.from("profiles").select("id,name,grade_category,is_period_champion,avatar_url").eq("role", "player"),
    supabase.from("score_attempts").select("player_id,workout_id")
      .gte("attempted_at", c.starts_at).lt("attempted_at", c.ends_at),
  ]);
  if (error) throw error;

  const drills: Record<string, Set<string>> = {};
  for (const a of (att ?? []) as any[]) { if (!drills[a.player_id]) drills[a.player_id] = new Set(); drills[a.player_id].add(a.workout_id); }
  const profiles = new Map(((pr ?? []) as any[]).map(p => [p.id, p]));

  const entries: LeaderboardEntry[] = [];
  for (const row of (st ?? []) as any[]) {
    const p = profiles.get(row.player_id);
    if (!p) continue;
    entries.push({
      id: row.player_id, name: p.name, grade_category: p.grade_category,
      total_points: Number(row.points),
      workouts_completed: drills[row.player_id]?.size ?? 0,
      avatar_url: p.avatar_url, is_period_champion: p.is_period_champion,
    } as unknown as LeaderboardEntry);
  }
  return entries.sort((a, b) => b.total_points - a.total_points);
}

/**
 * Crowns the top scorer in each leaderboard group for one competition.
 * Marks the competition crowned even when nobody scored -- the old
 * version wrote no rows in that case, so the reminder never stopped.
 */
export async function crownCompetition(c: Competition, leaderboard: LeaderboardEntry[]): Promise<Set<string>> {
  const season = await getCurrentSeason();
  const crownedAt = new Date().toISOString();

  const winners: Record<string, LeaderboardEntry> = {};
  for (const entry of leaderboard) {
    const cat = entry.grade_category ?? "Unknown";
    if (!winners[cat] || entry.total_points > winners[cat].total_points) winners[cat] = entry;
  }

  // Nobody scored: leave the reigning champions their crowns. Only a
  // crowning that actually crowns someone takes the old crowns away.
  const scoring = Object.entries(winners).filter(([, w]) => w.total_points);
  if (scoring.length) {
    await supabase.from("profiles").update({ is_period_champion: false }).neq("id", "none");
  }

  const crowned = new Set<string>();
  for (const [grade, winner] of scoring) {
    crowned.add(winner.id);

    const { data: prof } = await supabase
      .from("profiles").select("avatar_url").eq("id", winner.id).single();

    await supabase.from("profiles")
      .update({ is_period_champion: true, champion_since: crownedAt })
      .eq("id", winner.id);

    const { count: periodsWon } = await supabase
      .from("biweekly_champions")
      .select("id", { count: "exact", head: true })
      .eq("player_id", winner.id);

    try {
      await supabase.rpc("upsert_record", {
        p_type:          "most_periods_won",
        p_workout_id:    null,
        p_workout_title: null,
        p_workout_desc:  null,
        p_player_id:     winner.id,
        p_player_name:   winner.name,
        p_avatar_url:    prof?.avatar_url ?? null,
        p_value:         (periodsWon ?? 0) + 1,
        p_display_value: `${(periodsWon ?? 0) + 1} competition${((periodsWon ?? 0) + 1) !== 1 ? "s" : ""}`,
        p_season:        season,
      });
    } catch (e) { console.error(e); }

    // Table keeps its old name; renaming it would touch every query.
    await supabase.from("biweekly_champions").insert({
      player_id:      winner.id,
      player_name:    winner.name,
      grade_category: grade,
      points:         winner.total_points,
      period_start:   c.starts_at,
      period_end:     c.ends_at,
      competition_id: c.id,
      crowned_at:     crownedAt,
      avatar_url:     prof?.avatar_url ?? null,
    });
  }

  await supabase.from("competitions").update({ crowned_at: crownedAt, skipped_at: null }).eq("id", c.id);
  return crowned;
}

/**
 * In-season crowning (migration 148): most practice wins on each team,
 * counted inside the competition's dates. Ties are co-champions; a team
 * with no wins gets no crown. The win count goes in `points`.
 */
export async function crownCompetitionByWins(c: Competition): Promise<{ crowned: Set<string>; snapshot: any[] }> {
  const season = await getCurrentSeason();
  const crownedAt = new Date().toISOString();
  const standings: PracticeWinStanding[] = await getPracticeWinStandings(new Date(c.starts_at), new Date(c.ends_at));
  const [{ data: rosters }, { data: profs }] = await Promise.all([
    supabase.from("rosters").select("id, name"),
    supabase.from("profiles").select("id, grade_category, avatar_url").eq("role", "player"),
  ]);
  const teamName = new Map<string, string>((rosters ?? []).map((r: any) => [r.id, r.name]));
  const prof = new Map<string, { grade_category: string | null; avatar_url: string | null }>((profs ?? []).map((p: any) => [p.id, p]));

  // Top win count on each team.
  const best = new Map<string, number>();
  for (const s of standings) {
    if (!s.home_roster_id) continue;
    best.set(s.home_roster_id, Math.max(best.get(s.home_roster_id) ?? 0, s.wins));
  }
  const winners = standings.filter(s => s.home_roster_id && s.wins > 0 && s.wins === best.get(s.home_roster_id));

  // No wins anywhere: leave the reigning champions their crowns.
  if (winners.length) {
    await supabase.from("profiles").update({ is_period_champion: false }).neq("id", "none");
  }

  const crowned = new Set<string>();
  for (const w of winners) {
    crowned.add(w.player_id);
    const p = prof.get(w.player_id);
    await supabase.from("profiles")
      .update({ is_period_champion: true, champion_since: crownedAt })
      .eq("id", w.player_id);

    const { count: periodsWon } = await supabase
      .from("biweekly_champions")
      .select("id", { count: "exact", head: true })
      .eq("player_id", w.player_id);
    try {
      await supabase.rpc("upsert_record", {
        p_type: "most_periods_won", p_workout_id: null, p_workout_title: null, p_workout_desc: null,
        p_player_id: w.player_id, p_player_name: w.name, p_avatar_url: p?.avatar_url ?? null,
        p_value: (periodsWon ?? 0) + 1,
        p_display_value: `${(periodsWon ?? 0) + 1} competition${((periodsWon ?? 0) + 1) !== 1 ? "s" : ""}`,
        p_season: season,
      });
    } catch (e) { console.error(e); }

    await supabase.from("biweekly_champions").insert({
      player_id: w.player_id,
      player_name: w.name,
      grade_category: p?.grade_category ?? null,
      team_name: teamName.get(w.home_roster_id!) ?? null,
      points: w.wins,
      period_start: c.starts_at,
      period_end: c.ends_at,
      competition_id: c.id,
      crowned_at: crownedAt,
      avatar_url: p?.avatar_url ?? null,
    });
  }

  await supabase.from("competitions").update({ crowned_at: crownedAt, skipped_at: null }).eq("id", c.id);

  const snapshot = standings.filter(s => s.wins > 0).map((s, i) => ({
    rank: i + 1,
    player_id: s.player_id,
    name: s.name,
    grade_category: prof.get(s.player_id)?.grade_category ?? null,
    team_name: s.home_roster_id ? teamName.get(s.home_roster_id) ?? null : null,
    total_points: s.wins,
    workouts_completed: 0,
    avatar_url: prof.get(s.player_id)?.avatar_url ?? null,
    is_period_champion: crowned.has(s.player_id),
  }));
  return { crowned, snapshot };
}
