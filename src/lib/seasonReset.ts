// src/lib/seasonReset.ts
// The highest-risk piece of the season-mode toggle. archiveAndResetBoth()
// writes BOTH archives (offseason and in-season) before clearing ANYTHING.
// It used to archive-and-clear offseason, then archive-and-clear in-season,
// so a failed in-season archive left offseason points already wiped with
// the mode unswitched. Now any archive failure leaves every live number
// exactly as it was.

import { supabase } from "./supabase";
import { resetPlayerScores } from "./scores";

// ── Offseason: extracted from AdminSettings' existing reset flow ──
// (season_history snapshot + resetPlayerScores) so the new toggle and
// the original Settings button can eventually share one implementation.
/** Writes the offseason archive and returns the new rows' ids (for rollback). Clears nothing. */
async function archiveOffseason(seasonLabel: string, seasonId?: string | null): Promise<string[]> {
  const [{ data: profiles }, { data: allScores }, { data: chalWins }, { data: drillBests }] = await Promise.all([
    supabase.from("profiles").select("id,grade_category").eq("role", "player"),
    supabase.from("scores").select("player_id,points"),
    supabase.from("challenges").select("winner_id").eq("status", "completed").not("winner_id", "is", null),
    supabase.from("scores").select("player_id,workout_id,points"),
  ]);
  if (!profiles || !allScores) throw new Error("Couldn't load data to archive — aborting before any reset.");

  const ptMap: Record<string, number> = {};
  allScores.forEach((s: any) => { ptMap[s.player_id] = (ptMap[s.player_id] || 0) + (s.points || 0); });
  // Once the new scoring is live, the season total is the overall total
  // (every competition + bonuses) -- the number players actually saw.
  const { data: overall } = await supabase.rpc("overall_points");
  if (overall && (overall as any[]).length > 0) {
    for (const k of Object.keys(ptMap)) delete ptMap[k];
    (overall as any[]).forEach(o => { ptMap[o.player_id] = Number(o.total); });
  }
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
    // The season this belongs to. The label stays for archives written
    // before seasons were linked, which are matched by name instead.
    season_id: seasonId ?? null,
    overall_rank: sorted.findIndex(([id]) => id === p.id) + 1 || null,
    group_rank: gradeRankMap[p.id] || null,
    grade_category: p.grade_category,
    total_points: ptMap[p.id] || 0,
    drill_wins: drillWinMap[p.id] || 0,
    h2h_wins: h2hMap[p.id] || 0,
    team_wins: 0,
  }));

  const { data: written, error: snapshotErr } = await supabase.from("season_history").insert(snapshots).select("id");
  if (snapshotErr) throw snapshotErr; // abort before touching live data
  return (written ?? []).map((r: any) => r.id);
}

// ── In-season: same shape, new data source ──
/** Writes the in-season archive. Clears nothing. */
async function archiveInSeason(seasonLabel: string, seasonId?: string | null): Promise<void> {
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
    // The season this belongs to. The label stays for archives written
    // before seasons were linked, which are matched by name instead.
    season_id: seasonId ?? null,
    roster_id: p.home_roster_id,
    roster_name: p.home_roster_id ? rosterName.get(p.home_roster_id) ?? null : null,
    overall_rank: sorted.findIndex((sp: any) => sp.id === p.id) + 1 || null,
    roster_rank: rosterRankMap[p.id] || null,
    total_wins: counts[p.id] || 0,
  }));

  const { error: snapshotErr } = await supabase.from("inseason_history").insert(snapshots);
  if (snapshotErr) throw snapshotErr; // abort before touching live data
}

/**
 * Archive both leaderboards, then clear both. Throws before clearing
 * anything if either archive fails.
 */
export async function archiveAndResetBoth(seasonLabel: string, seasonId?: string | null): Promise<void> {
  // 1. Both archives first.
  const offseasonArchiveIds = await archiveOffseason(seasonLabel, seasonId);
  try {
    await archiveInSeason(seasonLabel, seasonId);
  } catch (e) {
    // Take back the offseason archive so a retry doesn't write it twice.
    if (offseasonArchiveIds.length) {
      const { error } = await supabase.from("season_history").delete().in("id", offseasonArchiveIds);
      if (error) {
        throw new Error(`The in-season archive failed, so nothing was reset. The offseason archive was saved and couldn't be removed, so a retry will save it a second time. (${(e as any)?.message ?? e})`);
      }
    }
    throw e;
  }

  // 2. Only now clear the live data.
  await resetPlayerScores(null, { resetChampions: true });
  // Points record starts over from zero for the new season (migration 155).
  const { error: restartErr } = await supabase.rpc("restart_scoring_season");
  if (restartErr) throw new Error(`Scores were reset, but the new season's points couldn't be restarted: ${restartErr.message}. Both archives are saved.`);
  const { error: clearErr } = await supabase.from("practice_wins").delete().not("id", "is", null);
  if (clearErr) throw new Error(`Offseason data was reset, but practice wins couldn't be cleared: ${clearErr.message}. Both archives are saved.`);
}
