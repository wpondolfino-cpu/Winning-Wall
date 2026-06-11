// src/lib/teams.ts
// Team competition logic

import { supabase, Team, TeamCompetition, TEAM_COLORS } from "./supabase";

export async function getActiveTeamCompetition(): Promise<TeamCompetition | null> {
  const { data } = await supabase
    .from("team_competitions").select("*").eq("is_active", true).single();
  return data;
}

export async function getTeams(competitionId: string): Promise<Team[]> {
  const { data: teams } = await supabase
    .from("teams").select("*").eq("competition_id", competitionId);
  if (!teams) return [];

  const teamsWithScores = await Promise.all(teams.map(async team => {
    const { data: members } = await supabase
      .from("profiles").select("id").eq("team_id", team.id);
    const memberIds = (members ?? []).map((m: any) => m.id);
    if (memberIds.length === 0) return { ...team, score: 0, memberCount: 0 };

    const { data: lb } = await supabase
      .from("leaderboard").select("id,total_points,rank").in("id", memberIds);
    const drillScore = (lb ?? []).reduce((sum: number, p: any) => sum + (p.total_points ?? 0), 0);
    const playerPoints: Record<string, number> = {};
    (lb ?? []).forEach((p: any) => { playerPoints[p.id] = p.total_points ?? 0; });

    const { data: xpToggle } = await supabase
      .from("xp_settings").select("xp_required").eq("perk_key", "_xp_enabled").single();
    const xpEnabled = (xpToggle?.xp_required ?? 1) !== 0;

    let hasTeamBoost = false;
    if (!xpEnabled) {
      hasTeamBoost = memberIds.length > 0;
    } else {
      const { data: xpSettings } = await supabase
        .from("xp_settings").select("xp_required").eq("perk_key", "team_bonus").single();
      const threshold = xpSettings?.xp_required ?? 1250;
      const { data: memberXp } = await supabase
        .from("profiles").select("total_xp")
        .in("id", memberIds).gte("total_xp", threshold).limit(1);
      hasTeamBoost = (memberXp ?? []).length > 0;
    }

    const score = drillScore + (hasTeamBoost ? 3 : 0);
    return { ...team, score, memberCount: memberIds.length, playerPoints, hasTeamBoost };
  }));

  return teamsWithScores;
}

export async function saveTeamCompetition(
  numTeams: number,
  teamNames: string[],
  playerAssignments: Record<string, string[]>,
  bonusPoints: number,
  startDate: string,
  endDate: string,
): Promise<void> {
  await supabase.from("team_competitions").update({ is_active: false }).eq("is_active", true);

  const { data: comp, error: compErr } = await supabase.from("team_competitions")
    .insert({ is_active: true, bonus_points: bonusPoints, start_date: startDate, end_date: endDate })
    .select().single();
  if (compErr) throw compErr;

  for (let i = 0; i < numTeams; i++) {
    const name  = teamNames[i];
    const color = TEAM_COLORS[i % TEAM_COLORS.length];
    const { data: team } = await supabase.from("teams")
      .insert({ name, color, competition_id: comp.id }).select().single();
    if (!team) continue;
    const playerIds = playerAssignments[name] ?? [];
    if (playerIds.length > 0) {
      await supabase.from("profiles").update({ team_id: team.id }).in("id", playerIds);
    }
  }
}

export async function endTeamCompetition(
  competitionId: string
): Promise<{ winnerName: string; winnerScore: number; bonusErrors: number; playerCount: number } | null> {
  const teams = await getTeams(competitionId);

  if (!teams.length) {
    await supabase.rpc("close_team_competition", { p_competition_id: competitionId, p_winning_team_id: null });
    return { winnerName: "Unknown", winnerScore: 0, bonusErrors: 0, playerCount: 0 };
  }

  const winner = teams.reduce(
    (best: any, t: any) => (t.score ?? 0) > (best.score ?? 0) ? t : best,
    teams[0]
  );

  const { data: winningPlayers } = await supabase
    .from("profiles").select("id,name").eq("team_id", winner.id);

  const { data: comp } = await supabase
    .from("team_competitions").select("bonus_points").eq("id", competitionId).single();
  const bonusPts = comp?.bonus_points ?? 3;

  const playerList = winningPlayers ?? [];
  let bonusErrors  = 0;

  if (playerList.length > 0) {
    const playerIds = playerList.map((p: any) => p.id);
    const { error: bonusErr } = await supabase.rpc("award_team_bonus", {
      p_player_ids: playerIds, p_points: bonusPts, p_reason: "team_win",
    });
    if (bonusErr) {
      console.error("Bonus RPC error:", bonusErr.message);
      bonusErrors = playerList.length;
    }
    await supabase.rpc("increment_team_wins", { p_player_ids: playerIds });
  }

  return {
    winnerName:  winner.name,
    winnerScore: winner.score ?? 0,
    bonusErrors,
    playerCount: playerList.length,
  };
}

export async function toggleTeamCompetition(active: boolean): Promise<void> {
  await supabase.from("team_competitions").update({ is_active: active }).eq("is_active", !active);
}
