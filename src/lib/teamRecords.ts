// src/lib/teamRecords.ts
// Team records for the Hall of Fame. Worked out here (on a coach's
// device) from finished games, tracked possessions and box scores, then
// saved with replace_team_records so players can read the ones the coach
// has ticked. Only regular season and postseason games count — a summer
// blowout or a scrimmage never holds a record.
import { supabase } from "./supabase";
import { countedPossessions, type Possession } from "./gameStats";
import { sumCounts, type BoxCounts } from "./boxScores";

export interface TeamRecordDef {
  key: string;
  label: string;
  scope: "game" | "season";
  lowerBetter?: boolean;
  description: string;
}

/** Tracked games need this many possessions before their PPP can hold a record. */
const MIN_GAME_POSS = 30;
/** Seasons need this many tracked / box score games before a season rate counts. */
const MIN_SEASON_GAMES = 3;

export const TEAM_RECORD_DEFS: TeamRecordDef[] = [
  { key: "most_points", label: "Most points in a game", scope: "game", description: "Final score, from finished games." },
  { key: "fewest_allowed", label: "Fewest points allowed in a game", scope: "game", lowerBetter: true, description: "Final score, from finished games." },
  { key: "biggest_win", label: "Biggest win", scope: "game", description: "Largest winning margin." },
  { key: "most_threes", label: "Most 3s made in a game", scope: "game", description: "From box scores." },
  { key: "most_assists", label: "Most assists in a game", scope: "game", description: "From box scores." },
  { key: "most_steals", label: "Most steals in a game", scope: "game", description: "From box scores." },
  { key: "fewest_turnovers", label: "Fewest turnovers in a game", scope: "game", lowerBetter: true, description: "From the box score, or the tracker when there's no box score." },
  { key: "best_off_ppp", label: "Best offensive PPP in a game", scope: "game", description: `Points per possession on offense, tracked games with at least ${MIN_GAME_POSS} possessions.` },
  { key: "best_def_ppp", label: "Best defensive PPP in a game", scope: "game", lowerBetter: true, description: `Points per possession allowed, tracked games with at least ${MIN_GAME_POSS} possessions.` },
  { key: "most_wins", label: "Most wins in a season", scope: "season", description: "Wins in regular season and postseason games." },
  { key: "longest_win_streak", label: "Longest winning streak", scope: "season", description: "Most wins in a row, counted across seasons; shown with the season it ended in." },
  { key: "season_off_ppp", label: "Best offensive PPP, season", scope: "season", description: `Tracked games only, at least ${MIN_SEASON_GAMES} in the season.` },
  { key: "season_def_ppp", label: "Best defensive PPP, season", scope: "season", lowerBetter: true, description: `Tracked games only, at least ${MIN_SEASON_GAMES} in the season.` },
  { key: "season_to_pct", label: "Best turnover %, season", scope: "season", lowerBetter: true, description: `Turnovers per 100 possessions, tracked games only, at least ${MIN_SEASON_GAMES} in the season.` },
  { key: "season_ft_pct", label: "Best free throw %, season", scope: "season", description: `From box scores, at least ${MIN_SEASON_GAMES} games and 20 free throws tried.` },
];

export interface TeamRecordRow {
  record_key: string;
  value: number;
  display: string;
  game_id: string | null;
  season_id: string | null;
  season_name: string | null;
  opponent: string | null;
  game_date: string | null;
}

interface G { id: string; opponent: string; game_date: string; season_id: string | null; final_score_us: number | null; final_score_them: number | null }

const pct = (n: number) => `${n.toFixed(1)}%`;
const ppp = (n: number) => n.toFixed(2);

/** Work out a team's records (doesn't save). Exported for testing. */
export function computeTeamRecords(
  games: G[], seasonNames: Map<string, string>,
  boxByGame: Map<string, BoxCounts>, possByGame: Map<string, Possession[]>,
): TeamRecordRow[] {
  const out: TeamRecordRow[] = [];
  const gameRow = (key: string, value: number, display: string, g: G): TeamRecordRow => ({
    record_key: key, value, display, game_id: g.id, season_id: g.season_id,
    season_name: g.season_id ? seasonNames.get(g.season_id) ?? null : null, opponent: g.opponent, game_date: g.game_date,
  });
  const seasonRow = (key: string, value: number, display: string, sid: string | null, last?: G): TeamRecordRow => ({
    record_key: key, value, display, game_id: last?.id ?? null, season_id: sid,
    season_name: sid ? seasonNames.get(sid) ?? null : null, opponent: last?.opponent ?? null, game_date: last?.game_date ?? null,
  });
  // Keep every candidate that ties the best.
  const best = (rows: TeamRecordRow[], lower = false) => {
    if (!rows.length) return;
    const top = lower ? Math.min(...rows.map((r) => r.value)) : Math.max(...rows.map((r) => r.value));
    rows.filter((r) => Math.abs(r.value - top) < 1e-9).forEach((r) => out.push(r));
  };

  const final = games.filter((g) => g.final_score_us != null && g.final_score_them != null);
  best(final.map((g) => gameRow("most_points", g.final_score_us!, String(g.final_score_us), g)));
  best(final.map((g) => gameRow("fewest_allowed", g.final_score_them!, String(g.final_score_them), g)), true);
  best(final.filter((g) => g.final_score_us! > g.final_score_them!)
    .map((g) => gameRow("biggest_win", g.final_score_us! - g.final_score_them!, `+${g.final_score_us! - g.final_score_them!} (${g.final_score_us}-${g.final_score_them})`, g)));

  const boxed = games.filter((g) => boxByGame.has(g.id));
  best(boxed.map((g) => gameRow("most_threes", boxByGame.get(g.id)!.fgm3, String(boxByGame.get(g.id)!.fgm3), g)).filter((r) => r.value > 0));
  best(boxed.map((g) => gameRow("most_assists", boxByGame.get(g.id)!.ast, String(boxByGame.get(g.id)!.ast), g)).filter((r) => r.value > 0));
  best(boxed.map((g) => gameRow("most_steals", boxByGame.get(g.id)!.stl, String(boxByGame.get(g.id)!.stl), g)).filter((r) => r.value > 0));

  const tracked = new Map<string, { off: number; offPts: number; def: number; defPts: number; tov: number }>();
  games.forEach((g) => {
    const poss = possByGame.get(g.id);
    if (!poss?.length) return;
    const c = countedPossessions(poss);
    const off = c.filter((p) => p.team === "us"), def = c.filter((p) => p.team !== "us");
    tracked.set(g.id, {
      off: off.length, offPts: off.reduce((s, p) => s + (p.points ?? 0), 0),
      def: def.length, defPts: def.reduce((s, p) => s + (p.points ?? 0), 0),
      tov: off.filter((p) => p.outcome === "turnover").length,
    });
  });

  best(games.flatMap((g) => {
    const box = boxByGame.get(g.id), t = tracked.get(g.id);
    const v = box ? box.tov : t ? t.tov : null;
    return v == null ? [] : [gameRow("fewest_turnovers", v, String(v), g)];
  }), true);
  best(games.flatMap((g) => {
    const t = tracked.get(g.id);
    return t && t.off >= MIN_GAME_POSS ? [gameRow("best_off_ppp", Math.round((t.offPts / t.off) * 100) / 100, ppp(t.offPts / t.off), g)] : [];
  }));
  best(games.flatMap((g) => {
    const t = tracked.get(g.id);
    return t && t.def >= MIN_GAME_POSS ? [gameRow("best_def_ppp", Math.round((t.defPts / t.def) * 100) / 100, ppp(t.defPts / t.def), g)] : [];
  }), true);

  // Seasons.
  const bySeason = new Map<string | null, G[]>();
  games.forEach((g) => bySeason.set(g.season_id, [...(bySeason.get(g.season_id) ?? []), g]));
  const wins: TeamRecordRow[] = [], offS: TeamRecordRow[] = [], defS: TeamRecordRow[] = [], toS: TeamRecordRow[] = [], ftS: TeamRecordRow[] = [];
  bySeason.forEach((gs, sid) => {
    const sortedGs = [...gs].sort((a, b) => a.game_date.localeCompare(b.game_date));
    const last = sortedGs[sortedGs.length - 1];
    const w = gs.filter((g) => g.final_score_us != null && g.final_score_them != null && g.final_score_us > g.final_score_them).length;
    if (w > 0) wins.push(seasonRow("most_wins", w, String(w), sid, last));
    const tg = gs.map((g) => tracked.get(g.id)).filter(Boolean) as { off: number; offPts: number; def: number; defPts: number; tov: number }[];
    if (tg.length >= MIN_SEASON_GAMES) {
      const off = tg.reduce((s, t) => s + t.off, 0), offPts = tg.reduce((s, t) => s + t.offPts, 0);
      const def = tg.reduce((s, t) => s + t.def, 0), defPts = tg.reduce((s, t) => s + t.defPts, 0);
      const tov = tg.reduce((s, t) => s + t.tov, 0);
      if (off) offS.push(seasonRow("season_off_ppp", Math.round((offPts / off) * 100) / 100, ppp(offPts / off), sid));
      if (def) defS.push(seasonRow("season_def_ppp", Math.round((defPts / def) * 100) / 100, ppp(defPts / def), sid));
      if (off) toS.push(seasonRow("season_to_pct", Math.round((tov / off) * 1000) / 10, pct((tov / off) * 100), sid));
    }
    const bx = gs.map((g) => boxByGame.get(g.id)).filter(Boolean) as BoxCounts[];
    if (bx.length >= MIN_SEASON_GAMES) {
      const t = sumCounts(bx);
      if (t.fta >= 20) ftS.push(seasonRow("season_ft_pct", Math.round((t.ftm / t.fta) * 1000) / 10, `${pct((t.ftm / t.fta) * 100)} (${t.ftm}/${t.fta})`, sid));
    }
  });
  best(wins); best(offS); best(defS, true); best(toS, true); best(ftS);

  // Longest win streak, across seasons, in date order.
  const ordered = final.slice().sort((a, b) => a.game_date.localeCompare(b.game_date));
  let run = 0, bestRun = 0;
  const ends: G[] = [];
  ordered.forEach((g) => {
    if (g.final_score_us! > g.final_score_them!) {
      run += 1;
      if (run > bestRun) { bestRun = run; ends.length = 0; ends.push(g); }
      else if (run === bestRun) ends.push(g);
    } else run = 0;
  });
  if (bestRun > 0) ends.forEach((g) => out.push(seasonRow("longest_win_streak", bestRun, `${bestRun} straight`, g.season_id, g)));

  return out;
}

/** Recompute a team's records and save them. Coaches only (the database checks). */
export async function recomputeTeamRecords(rosterId: string): Promise<number> {
  const { data: gameRows, error } = await supabase
    .from("games")
    .select("id, opponent, game_date, season_id, final_score_us, final_score_them, game_type")
    .eq("roster_id", rosterId)
    .in("game_type", ["regular", "postseason"]);
  if (error) throw new Error(error.message);
  const games = (gameRows ?? []) as G[];
  const ids = games.map((g) => g.id);

  const [{ data: seasons }, { data: lines }, { data: poss }] = await Promise.all([
    supabase.from("seasons").select("id, name"),
    ids.length ? supabase.from("player_box_lines").select("*").in("game_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from("possessions").select("game_id, team, points, outcome, possession_type").in("game_id", ids) : Promise.resolve({ data: [] as any[] }),
  ]);
  const seasonNames = new Map(((seasons ?? []) as any[]).map((s) => [s.id as string, s.name as string]));
  const boxByGame = new Map<string, BoxCounts>();
  const linesByGame = new Map<string, any[]>();
  ((lines ?? []) as any[]).forEach((l) => linesByGame.set(l.game_id, [...(linesByGame.get(l.game_id) ?? []), l]));
  linesByGame.forEach((ls, id) => boxByGame.set(id, sumCounts(ls)));
  const possByGame = new Map<string, Possession[]>();
  ((poss ?? []) as any[]).forEach((p) => possByGame.set(p.game_id, [...(possByGame.get(p.game_id) ?? []), p as Possession]));

  const rows = computeTeamRecords(games, seasonNames, boxByGame, possByGame);
  const { data, error: saveErr } = await supabase.rpc("replace_team_records", { p_roster: rosterId, p_rows: rows });
  if (saveErr) throw new Error(saveErr.message);
  return data as number;
}

export async function getTeamRecords(rosterId: string): Promise<TeamRecordRow[]> {
  const { data, error } = await supabase.from("team_records").select("*").eq("roster_id", rosterId);
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamRecordRow[];
}
