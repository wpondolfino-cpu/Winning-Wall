// src/lib/practiceWins.ts
import { supabase } from "./supabase";

export interface PracticeWin {
  id: string;
  practice_id: string;
  player_id: string;
  drill_name: string | null;
  logged_by: string;
  created_at: string;
}

export async function getPracticeWins(practiceId: string): Promise<PracticeWin[]> {
  const { data, error } = await supabase.from("practice_wins").select("*")
    .eq("practice_id", practiceId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Logs one win per selected player (a multi-winner tap for a
// team-format drill) — all sharing the same drill name and timestamp
// cluster, which is also what a single Undo removes as a group.
export async function logPracticeWin(practiceId: string, playerIds: string[], drillName: string): Promise<PracticeWin[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const rows = playerIds.map(playerId => ({
    practice_id: practiceId,
    player_id: playerId,
    drill_name: drillName.trim() || null,
    logged_by: user.id,
  }));
  const { data, error } = await supabase.from("practice_wins").insert(rows).select();
  if (error) throw error;
  return data ?? [];
}

export async function deletePracticeWins(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("practice_wins").delete().in("id", ids);
  if (error) throw error;
}

export interface PracticeWinStanding {
  player_id: string;
  name: string;
  home_roster_id: string | null;
  wins: number;
}

// Standings for the in-season leaderboard. periodStart/periodEnd scope
// to the current biweekly window (Current tab); omit both for the
// season-long cumulative total (Season tab). Filters to rostered
// players only -- non-rostered players never appear on this
// leaderboard, matching the nav/mode rules.
export async function getPracticeWinStandings(periodStart?: Date, periodEnd?: Date): Promise<PracticeWinStanding[]> {
  let query = supabase.from("practice_wins").select("player_id, created_at");
  if (periodStart) query = query.gte("created_at", periodStart.toISOString());
  if (periodEnd) query = query.lt("created_at", periodEnd.toISOString());
  const [{ data: wins, error: winsErr }, { data: players, error: playersErr }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, name, home_roster_id").eq("role", "player").not("home_roster_id", "is", null),
  ]);
  if (winsErr) throw winsErr;
  if (playersErr) throw playersErr;

  const counts = new Map<string, number>();
  (wins ?? []).forEach(w => counts.set(w.player_id, (counts.get(w.player_id) ?? 0) + 1));

  return (players ?? [])
    .map(p => ({ player_id: p.id, name: p.name, home_roster_id: p.home_roster_id, wins: counts.get(p.id) ?? 0 }))
    .sort((a, b) => b.wins - a.wins);
}
