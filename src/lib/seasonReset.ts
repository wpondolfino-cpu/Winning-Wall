// src/lib/seasonReset.ts
// The highest-risk piece of the season-mode toggle: archiving snapshots
// BEFORE any reset/delete proceeds, sequentially, so a failed snapshot
// aborts before any data is touched. Both functions throw on any
// failure rather than silently continuing partway.

import { supabase } from "./supabase";
import { resetPlayerScores } from "./scores";

// ── Offseason: extracted from AdminSettings' existing reset flow ──
// (season_history snapshot + resetPlayerScores) so the new toggle and
// the original Settings button can eventually share one implementation.
export async function archiveAndResetOffseason(seasonLabel: string): Promise<void> {
  const [{ data: profiles }, { data: allScores }, { data: chalWins }, { data: drillBests }] = await Promise.all([
    supabase.from("profiles").select("id,grade_category").eq("role", "player"),
    supabase.from("scores").select("player_id,points"),
    supabase.from("challenges").select("winner_id").eq("status", "completed").not("winner_id", "is", null),
    supabase.from("scores").select("player_id,workout_id,points"),
  ]);
  if (!profiles || !allScores) throw new Error("Couldn't load data to archive — aborting before any reset.");

  const ptMap: Record<string, number> = {};
  allScores.forEach((s: any) => { ptMap[s.player_id] = (ptMap[s.player_id] || 0) + (s.points || 0); });
  // Rank only among currently-active players -- a deactivated account's
  // old leftover scores must never occupy a rank slot and skew everyone
  // else's computed rank down by one.
  const activeIds = new Set(profiles.map((p: any) => p.id));
  const sorted = Object.entries(ptMap).filter(([id]) => activeIds.has(id)).sort((a, b) => b[1] - a[1]);

  const drillWinMap: Record<string, number> = {};
  const workoutIds = [...new Set((drillBests ?? []).map((s: any) => s.workout_id))];
  workoutIds.forEach(wid => {
    const top = (drillBests ?? []).filter((s: any) => s.workout_id === wid).sort((a: any, b: any) => b.points - a.points)[0];
    if (top) drillWinMap[top.player_id] = (drillWinMap[top.player_id] || 0) + 1;
  });

  const h2hMap: Record<string, number> = {};
  (chalWins ?? []).forEach((c: any) => { h2hMap[c.winner_id] = (h2hMap[c.winner_id] || 0) + 1; });

  const gradeGroups: Record<string, string[]> = {};
  profiles.forEach((p: any) => {
    if (!gradeGroups[p.grade_category]) gradeGroups[p.grade_category] = [];
    gradeGroups[p.grade_category].push(p.id);
  });
  const gradeRankMap: Record<string, number> = {};
  Object.entries(gradeGroups).forEach(([, ids]) => {
    ids.sort((a, b) => (ptMap[b] || 0) - (ptMap[a] || 0)).forEach((id, i) => { gradeRankMap[id] = i + 1; });
  });

  const snapshots = profiles.map((p: any) => ({
    player_id: p.id,
    season_label: seasonLabel,
    overall_rank: sorted.findIndex(([id]) => id === p.id) + 1 || null,
    group_rank: gradeRankMap[p.id] || null,
    grade_category: p.grade_category,
    total_points: ptMap[p.id] || 0,
    drill_wins: drillWinMap[p.id] || 0,
    h2h_wins: h2hMap[p.id] || 0,
    team_wins: 0,
  }));

  const { error: snapshotErr } = await supabase.from("season_history").insert(snapshots);
  if (snapshotErr) throw snapshotErr; // abort before touching live data

  // Only reset once the archive is confirmed written.
  await resetPlayerScores(null, { resetChampions: true });
}

// ── In-season: same shape, new data source ──
export async function archiveAndResetInSeason(seasonLabel: string): Promise<void> {
  const [{ data: wins }, { data: players }, { data: rosters }] = await Promise.all([
    supabase.from("practice_wins").select("player_id"),
    supabase.from("profiles").select("id, home_roster_id").eq("role", "player").not("home_roster_id", "is", null),
    supabase.from("rosters").select("id, name"),
  ]);
  if (!wins || !players) throw new Error("Couldn't load data to archive — aborting before any reset.");

  const rosterName = new Map((rosters ?? []).map((r: any) => [r.id, r.name]));
  const counts: Record<string, number> = {};
  wins.forEach((w: any) => { counts[w.player_id] = (counts[w.player_id] || 0) + 1; });

  const sorted = [...players].sort((a: any, b: any) => (counts[b.id] || 0) - (counts[a.id] || 0));
  const rosterGroups: Record<string, any[]> = {};
  players.forEach((p: any) => {
    const key = p.home_roster_id ?? "none";
    if (!rosterGroups[key]) rosterGroups[key] = [];
    rosterGroups[key].push(p);
  });
  const rosterRankMap: Record<string, number> = {};
  Object.values(rosterGroups).forEach(group => {
    group.sort((a: any, b: any) => (counts[b.id] || 0) - (counts[a.id] || 0)).forEach((p: any, i: number) => { rosterRankMap[p.id] = i + 1; });
  });

  const snapshots = players.map((p: any) => ({
    player_id: p.id,
    season_label: seasonLabel,
    roster_id: p.home_roster_id,
    roster_name: p.home_roster_id ? rosterName.get(p.home_roster_id) ?? null : null,
    overall_rank: sorted.findIndex((sp: any) => sp.id === p.id) + 1 || null,
    roster_rank: rosterRankMap[p.id] || null,
    total_wins: counts[p.id] || 0,
  }));

  const { error: snapshotErr } = await supabase.from("inseason_history").insert(snapshots);
  if (snapshotErr) throw snapshotErr; // abort before touching live data

  // Only clear the log once the archive is confirmed written.
  const { error: clearErr } = await supabase.from("practice_wins").delete().not("id", "is", null);
  if (clearErr) throw clearErr;
}
