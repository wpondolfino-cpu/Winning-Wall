// src/lib/leaderboard.ts
// Leaderboard queries and competition crowning

import { supabase, LeaderboardEntry, BiweeklyChampion } from "./supabase";
import type { Competition } from "./periods";
import { getPracticeWinStandings, PracticeWinStanding } from "./practiceWins";
import { getCurrentSeason } from "./records";

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase
    .from("leaderboard").select("*").order("rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getBiweeklyChampions(): Promise<BiweeklyChampion[]> {
  const { data, error } = await supabase
    .from("biweekly_champions").select("*").order("crowned_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Standings for one competition -- same math as the Leaderboard's
// "Current" tab (drill points on drills logged in its window, plus streak
// bonuses awarded in it). Used for crowning and the History snapshot.
// Takes the competition explicitly: the old version worked out "the
// period that just ended" as the 14 days before today's, which is wrong
// for any other length.
export async function getCompetitionStandings(c: Pick<Competition, "starts_at" | "ends_at">): Promise<LeaderboardEntry[]> {
  const periodStart = new Date(c.starts_at);
  const periodEnd = new Date(c.ends_at);

  const [{ data: psc }, { data: pr }, { data: bon }, { data: sc }] = await Promise.all([
    supabase.from("score_attempts").select("*")
      .gte("attempted_at", periodStart.toISOString())
      .lt("attempted_at", periodEnd.toISOString()),
    supabase.from("profiles").select("id,name,grade_category,is_period_champion,avatar_url").eq("role", "player"),
    supabase.from("streak_bonuses").select("*")
      .gte("awarded_at", periodStart.toISOString())
      .lt("awarded_at", periodEnd.toISOString()),
    supabase.from("scores").select("*"),
  ]);

  const periodScores = psc ?? [];
  const profiles = pr ?? [];
  const periodBonuses = bon ?? [];
  const allScores = sc ?? [];

  const periodActivity: Record<string, Set<string>> = {};
  for (const s of periodScores as any[]) {
    if (!periodActivity[s.player_id]) periodActivity[s.player_id] = new Set();
    periodActivity[s.player_id].add(s.workout_id);
  }

  const entries: LeaderboardEntry[] = [];
  for (const playerId of Object.keys(periodActivity)) {
    const p = (profiles as any[]).find(pr => pr.id === playerId);
    if (!p) continue;
    const workoutIds = Array.from(periodActivity[playerId]);
    const playerScores = (allScores as any[]).filter(s => s.player_id === playerId && workoutIds.includes(s.workout_id));
    const drillPoints = playerScores.reduce((sum, s) => sum + (s.points ?? 0), 0);
    const bonusPoints = (periodBonuses as any[]).filter(b => b.player_id === playerId).reduce((sum, b) => sum + (b.points ?? 0), 0);
    entries.push({
      id: playerId, name: p.name, grade_category: p.grade_category,
      total_points: drillPoints + bonusPoints,
      workouts_completed: periodActivity[playerId].size,
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

  await supabase.from("profiles").update({ is_period_champion: false }).neq("id", "none");

  const crowned = new Set<string>();
  for (const [grade, winner] of Object.entries(winners)) {
    if (!winner.total_points) continue;
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

  await supabase.from("profiles").update({ is_period_champion: false }).neq("id", "none");

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
