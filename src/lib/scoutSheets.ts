// src/lib/scoutSheets.ts
// Types + CRUD for the Scout Sheet feature: opponents, scout_sheets,
// scout_players, scout_offense_sets, scout_specials, scout_defense.
// Mirrors the style of plays.ts / workouts.ts — thin wrappers around
// supabase-js, no business logic beyond what the DB/RLS already enforces.

import { supabase } from "./supabase";
import { createGame } from "./gameStats";

// ── Opponents ────────────────────────────────────────────────
export interface Opponent {
  id: string;
  name: string;
  logo_url: string | null;
  created_by: string;
  created_at: string;
}

export async function getOpponents(): Promise<Opponent[]> {
  const { data, error } = await supabase.from("opponents").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getOpponent(id: string): Promise<Opponent | null> {
  const { data, error } = await supabase.from("opponents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createOpponent(name: string): Promise<Opponent> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase.from("opponents").insert({ name: name.trim(), created_by: user.id }).select().single();
  if (error) throw error;
  return data;
}

/**
 * Renames an opponent.
 *
 * Also updates the free-text `opponent` column on every game linked to
 * them, so a typo fixed here doesn't leave games still displaying the old
 * spelling. games.opponent is a denormalised copy that predates
 * opponent_id and is still what most screens render.
 */
export async function renameOpponent(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name can't be blank.");
  const { error } = await supabase.from("opponents").update({ name: trimmed }).eq("id", id);
  if (error) throw error;
  await supabase.from("games").update({ opponent: trimmed }).eq("opponent_id", id);
}

/**
 * Deletes an opponent.
 *
 * Refuses while anything still points at them rather than cascading:
 * removing an opponent shouldn't quietly take scout sheets, or orphan
 * games that have possessions and a place on the schedule.
 */
export async function deleteOpponent(id: string): Promise<{ error: string | null }> {
  const [{ count: sheetCount }, { count: gameCount }] = await Promise.all([
    supabase.from("scout_sheets").select("id", { count: "exact", head: true }).eq("opponent_id", id),
    supabase.from("games").select("id", { count: "exact", head: true }).eq("opponent_id", id),
  ]);
  if ((sheetCount ?? 0) > 0 || (gameCount ?? 0) > 0) {
    return { error: `Still in use — ${sheetCount ?? 0} scout sheet(s) and ${gameCount ?? 0} game(s) reference them. Delete or reassign those first.` };
  }
  const { error } = await supabase.from("opponents").delete().eq("id", id);
  return { error: error?.message ?? null };
}

export async function updateOpponentLogo(id: string, logo_url: string | null) {
  const { error } = await supabase.from("opponents").update({ logo_url }).eq("id", id);
  if (error) throw error;
}

// Uploads a team logo to its own bucket — opponent logos are a shared
// team asset any coach/admin can set or replace, unlike player avatars
// which are scoped to each player's own account.
export async function uploadOpponentLogo(opponentId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "png";
  const path = `${opponentId}.${ext}`;
  const { error: upErr } = await supabase.storage.from("opponent-logos").upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from("opponent-logos").getPublicUrl(path);
  await updateOpponentLogo(opponentId, data.publicUrl);
  return data.publicUrl;
}

// Every game against this opponent, newest first, each with its team
// (roster_id), whether it uses a scout sheet, and its scout sheet if one
// exists. The opponent page splits these by team, so a JV game no longer
// takes one of varsity's "last 5" spots.
export interface OpponentGame {
  id: string; game_date: string | null; final_score_us: number | null; final_score_them: number | null;
  status: string | null; roster_id: string | null; uses_scout_sheet: boolean;
  scout_sheet: { id: string; status: string } | null;
}
export async function getOpponentGames(opponentId: string): Promise<OpponentGame[]> {
  const { data, error } = await supabase
    .from("games")
    .select("id, game_date, final_score_us, final_score_them, status, roster_id, uses_scout_sheet, scout_sheets(id, status)")
    .eq("opponent_id", opponentId)
    .order("game_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((g: any) => ({
    ...g,
    uses_scout_sheet: g.uses_scout_sheet ?? true,
    scout_sheet: Array.isArray(g.scout_sheets) ? (g.scout_sheets[0] ?? null) : (g.scout_sheets ?? null),
  }));
}

/** Kept for older callers: the last few games regardless of team. */
export async function getOpponentLastGames(opponentId: string, limit = 5) {
  return (await getOpponentGames(opponentId)).slice(0, limit);
}

export async function getScoutSheetsForOpponent(opponentId: string) {
  const { data, error } = await supabase
    .from("scout_sheets")
    .select("id, game_id, status, created_at, games(game_date, roster_id)")
    .eq("opponent_id", opponentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Teams (for labelling sheets) ─────────────────────────────
export interface TeamTag { id: string; name: string; color: string }
const TEAM_FALLBACK_COLORS = ["#2550d4", "#d97706", "#059669", "#9333ea", "#dc2626", "#0891b2"];
/** The program's teams in their usual order, each with a colour (its own, or a fallback). */
export async function getTeamTags(): Promise<TeamTag[]> {
  const { data } = await supabase.from("rosters").select("id, name, color, status").order("sort_order", { ascending: true });
  return ((data ?? []) as any[])
    .filter(r => r.status == null || r.status === "active")
    .map((r, i) => ({ id: r.id, name: r.name, color: r.color || TEAM_FALLBACK_COLORS[i % TEAM_FALLBACK_COLORS.length] }));
}

export async function getScoutSheetPrintContext(gameId: string, opponentId: string): Promise<{ gameDate: string | null; opponentName: string; rosterId: string | null }> {
  const [{ data: game }, { data: opponent }] = await Promise.all([
    supabase.from("games").select("game_date, roster_id").eq("id", gameId).maybeSingle(),
    supabase.from("opponents").select("name").eq("id", opponentId).maybeSingle(),
  ]);
  return { gameDate: game?.game_date ?? null, opponentName: opponent?.name ?? "Opponent", rosterId: (game as any)?.roster_id ?? null };
}

// ── Scout sheet shell ────────────────────────────────────────
export interface ScoutSheet {
  id: string;
  game_id: string;
  opponent_id: string;
  team_record: string | null;
  tempo: string | null;
  keys_to_game: string[];
  team_offensive_strengths: string[];
  status: "draft" | "published";
  print_selected_player_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export async function getScoutSheetByGame(gameId: string): Promise<ScoutSheet | null> {
  const { data, error } = await supabase.from("scout_sheets").select("*").eq("game_id", gameId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getScoutSheet(id: string): Promise<ScoutSheet | null> {
  const { data, error } = await supabase.from("scout_sheets").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createScoutSheet(gameId: string, opponentId: string): Promise<ScoutSheet> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("scout_sheets")
    .insert({ game_id: gameId, opponent_id: opponentId, created_by: user.id })
    .select().single();
  if (error) throw error;
  return data;
}

// Clones every section of a previous scout sheet into a brand-new one
// tied to a new game — the "duplicate from previous" workflow. Copies
// roster, offense sets, specials, and defense; leaves keys_to_game
// blank since those are almost always game-specific.
export async function duplicateScoutSheet(sourceSheetId: string, newGameId: string): Promise<ScoutSheet> {
  const source = await getScoutSheet(sourceSheetId);
  if (!source) throw new Error("Source scout sheet not found");
  const newSheet = await createScoutSheet(newGameId, source.opponent_id);
  await copyScoutSheetInto(sourceSheetId, newSheet.id);
  return (await getScoutSheet(newSheet.id)) ?? newSheet;
}

/**
 * Copies a previous sheet's content into an EXISTING sheet: record,
 * tempo, team strengths, roster, sets, specials and defense. Keys to the
 * game stay as they are, since those are almost always game-specific.
 *
 * Used by the "copy from last time" banner on a sheet that was just made,
 * and by duplicateScoutSheet. The old duplicate ignored every insert
 * error, so a failed copy could silently leave half a sheet; this checks
 * each one.
 */
export async function copyScoutSheetInto(sourceSheetId: string, targetSheetId: string): Promise<void> {
  const source = await getScoutSheet(sourceSheetId);
  if (!source) throw new Error("The sheet to copy from wasn't found.");

  await updateScoutSheet(targetSheetId, {
    team_record: source.team_record,
    tempo: source.tempo,
    team_offensive_strengths: source.team_offensive_strengths,
  });

  const [players, sets, specials, defense] = await Promise.all([
    getScoutPlayers(sourceSheetId),
    getOffenseSets(sourceSheetId),
    getSpecials(sourceSheetId),
    getDefenseSections(sourceSheetId),
  ]);

  if (players.length) {
    const { error } = await supabase.from("scout_players").insert(players.map(({ id, scout_sheet_id, created_at, ...rest }) => ({
      ...rest, scout_sheet_id: targetSheetId,
    })));
    if (error) throw error;
  }
  if (sets.length) {
    const { error } = await supabase.from("scout_offense_sets").insert(sets.map(({ id, scout_sheet_id, created_at, ...rest }) => ({
      ...rest, scout_sheet_id: targetSheetId,
    })));
    if (error) throw error;
  }
  if (specials.length) {
    const { error } = await supabase.from("scout_specials").insert(specials.map(({ id, scout_sheet_id, created_at, ...rest }) => ({
      ...rest, scout_sheet_id: targetSheetId,
    })));
    if (error) throw error;
  }
  if (defense.length) {
    // One row per slot per sheet, so an upsert -- a fresh sheet can
    // already have a slot saved if the coach clicked into Defense first.
    const { error } = await supabase.from("scout_defense").upsert(
      defense.map(({ id, scout_sheet_id, created_at, updated_at, ...rest }) => ({ ...rest, scout_sheet_id: targetSheetId })),
      { onConflict: "scout_sheet_id,slot" });
    if (error) throw error;
  }
}

/** True when a sheet has no roster, sets, specials or defense yet. */
export async function isScoutSheetEmpty(sheetId: string): Promise<boolean> {
  const counts = await Promise.all(["scout_players", "scout_offense_sets", "scout_specials", "scout_defense"].map(t =>
    supabase.from(t).select("id", { count: "exact", head: true }).eq("scout_sheet_id", sheetId)));
  return counts.every((c: { count: number | null }) => (c.count ?? 0) === 0);
}

/**
 * Scout sheet switched off for a game: removes its sheet if nothing was
 * ever written on it (no players, sets, specials, defense, keys, record,
 * tempo or quiz). A sheet with work on it is kept -- delete that one from
 * the opponent page if you really mean to. Returns true if one was removed.
 */
export async function removeEmptyScoutSheetForGame(gameId: string): Promise<boolean> {
  const sheet = await getScoutSheetByGame(gameId);
  if (!sheet) return false;
  const blank = !sheet.team_record && !sheet.tempo
    && !(sheet.keys_to_game ?? []).some(k => (k ?? "").trim())
    && !(sheet.team_offensive_strengths ?? []).some(k => (k ?? "").trim());
  if (!blank || !(await isScoutSheetEmpty(sheet.id))) return false;
  const { count } = await supabase.from("quizzes").select("id", { count: "exact", head: true }).eq("scout_sheet_id", sheet.id);
  if ((count ?? 0) > 0) return false;
  await deleteScoutSheet(sheet.id);
  return true;
}

/**
 * The most recent OTHER sheet for this opponent that has something on
 * it -- what the "copy from last time" banner offers.
 */
export async function getPreviousSheetForOpponent(opponentId: string, excludeSheetId: string, rosterId?: string | null): Promise<{ id: string; game_date: string | null } | null> {
  const { data, error } = await supabase
    .from("scout_sheets")
    .select("id, games(game_date, roster_id)")
    .eq("opponent_id", opponentId)
    .neq("id", excludeSheetId);
  if (error) throw error;
  const list = ((data ?? []) as any[])
    .map(r => {
      const g = Array.isArray(r.games) ? r.games[0] : r.games;
      return { id: r.id as string, game_date: (g?.game_date ?? null) as string | null, roster_id: (g?.roster_id ?? null) as string | null };
    })
    // Only the same team's sheets (or ones with no team): JV's scout of
    // Franklin's JV is no use on varsity's sheet -- different players.
    .filter(s => !rosterId || !s.roster_id || s.roster_id === rosterId)
    .sort((a, b) => (b.game_date ?? "").localeCompare(a.game_date ?? ""));
  for (const s of list) {
    if (!(await isScoutSheetEmpty(s.id))) return { id: s.id, game_date: s.game_date };
  }
  return null;
}

/**
 * Changes which team a game is against, from the schedule.
 *
 * The game (and its scout sheet, if it has one) is linked to the opponent
 * with that name, or a new one if there isn't one -- the old opponent is
 * never renamed, since a placeholder like "TBA" may sit on two games and
 * only one of them has been decided. A placeholder left with no games, no
 * sheets and no logo is tidied away.
 */
export async function setGameOpponent(gameId: string, name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Type the opponent's name.");
  const { data: game } = await supabase.from("games").select("opponent_id").eq("id", gameId).maybeSingle();
  const oldId: string | null = (game as any)?.opponent_id ?? null;
  const match = (await getOpponents()).find(o => opponentKey(o.name) === opponentKey(clean));
  const opp = match ?? await createOpponent(clean);
  const { error } = await supabase.from("games").update({ opponent: opp.name, opponent_id: opp.id }).eq("id", gameId);
  if (error) throw error;
  await supabase.from("scout_sheets").update({ opponent_id: opp.id }).eq("game_id", gameId);
  if (oldId && oldId !== opp.id) {
    const { data: old } = await supabase.from("opponents").select("logo_url").eq("id", oldId).maybeSingle();
    if (old && !(old as any).logo_url) await deleteOpponent(oldId);   // refuses if still in use
  }
}

/** Names compared ignoring capitals, spaces and punctuation. */
function opponentKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The scout sheet for a game, creating it if there isn't one yet -- so
 * tapping Scout sheet on a game opens something editable straight away.
 *
 * A game whose opponent was typed rather than picked has no opponent
 * record, and a sheet needs one. It's matched to an existing opponent by
 * name (ignoring capitals, spaces and punctuation) or created, and the
 * game is linked to it, so the opponent page and its last-5 results see
 * the game from then on. A different spelling ("Foxboro" vs
 * "Foxborough") still makes a second opponent; rename to merge.
 *
 * Coaches only (players can't create sheets).
 */
export async function ensureScoutSheetForGame(gameId: string): Promise<{ sheet: ScoutSheet; opponentId: string; created: boolean }> {
  const existing = await getScoutSheetByGame(gameId);
  if (existing) return { sheet: existing, opponentId: existing.opponent_id, created: false };

  const { data: game, error: gErr } = await supabase
    .from("games").select("id, opponent, opponent_id").eq("id", gameId).single();
  if (gErr || !game) throw new Error("That game wasn't found.");

  let opponentId: string | null = (game as any).opponent_id ?? null;
  if (!opponentId) {
    const name = String((game as any).opponent ?? "").trim();
    if (!name) throw new Error("This game has no opponent name. Add one to the game first.");
    const match = (await getOpponents()).find(o => opponentKey(o.name) === opponentKey(name));
    const opp = match ?? await createOpponent(name);
    opponentId = opp.id;
    const { error: linkErr } = await supabase.from("games").update({ opponent_id: opponentId }).eq("id", gameId);
    if (linkErr) throw linkErr;
  }

  try {
    const sheet = await createScoutSheet(gameId, opponentId);
    return { sheet, opponentId, created: true };
  } catch (e) {
    // One sheet per game: if two taps raced, the other one won -- use it.
    const raced = await getScoutSheetByGame(gameId);
    if (raced) return { sheet: raced, opponentId: raced.opponent_id, created: false };
    throw e;
  }
}

export async function updateScoutSheet(id: string, patch: Partial<Pick<ScoutSheet,
  "team_record" | "tempo" | "keys_to_game" | "team_offensive_strengths" | "status" | "print_selected_player_ids">>) {
  const { error } = await supabase.from("scout_sheets")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteScoutSheet(id: string) {
  const { error } = await supabase.from("scout_sheets").delete().eq("id", id);
  if (error) throw error;
}

// ── Roster (scout_players) ───────────────────────────────────
export const SCOUT_MARKERS = ["star", "dart", "turtle"] as const;
export type ScoutMarker = typeof SCOUT_MARKERS[number];

export interface ScoutPlayer {
  id: string;
  scout_sheet_id: string;
  name: string;
  number: string | null;
  position: string | null;
  height: string | null;
  grade: string | null;
  dominant_hand: "R" | "L" | null;
  is_starter: boolean;
  markers: ScoutMarker[];
  assigned_to_profile_id: string | null;
  offensive_strengths: string[];
  plan_to_guard: string[];
  defensive_strengths: string[];
  plan_to_attack: string[];
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export async function getScoutPlayers(scoutSheetId: string): Promise<ScoutPlayer[]> {
  const { data, error } = await supabase
    .from("scout_players")
    .select("*")
    .eq("scout_sheet_id", scoutSheetId)
    .order("is_starter", { ascending: false })
    .order("number", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createScoutPlayer(scoutSheetId: string, name: string): Promise<ScoutPlayer> {
  const { data, error } = await supabase
    .from("scout_players")
    .insert({ scout_sheet_id: scoutSheetId, name: name.trim() })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateScoutPlayer(id: string, patch: Partial<Omit<ScoutPlayer, "id" | "scout_sheet_id" | "created_at">>) {
  const { error } = await supabase.from("scout_players").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteScoutPlayer(id: string) {
  const { error } = await supabase.from("scout_players").delete().eq("id", id);
  if (error) throw error;
}

// ── Offense: favorite sets/calls ─────────────────────────────
export interface ScoutOffenseSet {
  id: string;
  scout_sheet_id: string;
  call_name: string;
  description: string | null;
  plan_to_defend: string | null;
  video_url: string | null;
  play_id: string | null;
  sort_order: number;
  created_at: string;
}

export async function getOffenseSets(scoutSheetId: string): Promise<ScoutOffenseSet[]> {
  const { data, error } = await supabase.from("scout_offense_sets").select("*")
    .eq("scout_sheet_id", scoutSheetId).order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function createOffenseSet(scoutSheetId: string, callName: string): Promise<ScoutOffenseSet> {
  const { data, error } = await supabase.from("scout_offense_sets")
    .insert({ scout_sheet_id: scoutSheetId, call_name: callName.trim() })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateOffenseSet(id: string, patch: Partial<Omit<ScoutOffenseSet, "id" | "scout_sheet_id" | "created_at">>) {
  const { error } = await supabase.from("scout_offense_sets").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteOffenseSet(id: string) {
  const { error } = await supabase.from("scout_offense_sets").delete().eq("id", id);
  if (error) throw error;
}

// ── Specials: BLOB / SLOB ─────────────────────────────────────
export interface ScoutSpecial {
  id: string;
  scout_sheet_id: string;
  kind: "blob" | "slob";
  call_name: string;
  description: string | null;
  plan_to_defend: string | null;
  video_url: string | null;
  play_id: string | null;
  sort_order: number;
  created_at: string;
}

export async function getSpecials(scoutSheetId: string): Promise<ScoutSpecial[]> {
  const { data, error } = await supabase.from("scout_specials").select("*")
    .eq("scout_sheet_id", scoutSheetId).order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function createSpecial(scoutSheetId: string, kind: "blob" | "slob", callName: string): Promise<ScoutSpecial> {
  const { data, error } = await supabase.from("scout_specials")
    .insert({ scout_sheet_id: scoutSheetId, kind, call_name: callName.trim() })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateSpecial(id: string, patch: Partial<Omit<ScoutSpecial, "id" | "scout_sheet_id" | "created_at">>) {
  const { error } = await supabase.from("scout_specials").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteSpecial(id: string) {
  const { error } = await supabase.from("scout_specials").delete().eq("id", id);
  if (error) throw error;
}

// ── Defense: primary / secondary / press / blob_slob_d ────────
// `data` shapes, by slot:
//   primary / secondary: { base: "man"|"zone"|null,
//     man?: { court: "full"|"half"|null,
//             structure: string[], structurePlan: string[],
//             offBall: string[], offBallPlan: string[],
//             ballScreen: string[], ballScreenPlan: string[] },
//     zone?: { type: string[], structure: string[], plan: string[] } }
//   press: { chips: string[], plan: string[] }
//   blob_slob_d: { chips: string[], plan: string[] }
export type DefenseSlot = "primary" | "secondary" | "press" | "blob_slob_d";

export interface ScoutDefenseSection {
  id: string;
  scout_sheet_id: string;
  slot: DefenseSlot;
  data: any;
  created_at: string;
  updated_at: string;
}

export async function getDefenseSections(scoutSheetId: string): Promise<ScoutDefenseSection[]> {
  const { data, error } = await supabase.from("scout_defense").select("*").eq("scout_sheet_id", scoutSheetId);
  if (error) throw error;
  return data ?? [];
}

export async function upsertDefenseSection(scoutSheetId: string, slot: DefenseSlot, data: any) {
  const { error } = await supabase.from("scout_defense")
    .upsert(
      { scout_sheet_id: scoutSheetId, slot, data, updated_at: new Date().toISOString() },
      { onConflict: "scout_sheet_id,slot" }
    );
  if (error) throw error;
}

// ── Re-importable export (hidden data embedded in a PDF) ────────
export const SCOUT_SHEET_EXPORT_SCHEMA_VERSION = 1;

export async function scoutSheetToExportPayload(sheetId: string) {
  const sheet = await getScoutSheet(sheetId);
  if (!sheet) throw new Error("Scout sheet not found");
  const [opponent, players, offenseSets, specials, defenseSections, gameDateResult] = await Promise.all([
    getOpponent(sheet.opponent_id),
    getScoutPlayers(sheetId),
    getOffenseSets(sheetId),
    getSpecials(sheetId),
    getDefenseSections(sheetId),
    supabase.from("games").select("game_date").eq("id", sheet.game_id).maybeSingle(),
  ]);
  return {
    opponentName: opponent?.name ?? "Opponent",
    gameDate: gameDateResult.data?.game_date ?? null,
    team_record: sheet.team_record,
    tempo: sheet.tempo,
    keys_to_game: sheet.keys_to_game,
    team_offensive_strengths: sheet.team_offensive_strengths,
    players: players.map(({ id, scout_sheet_id, created_at, ...rest }) => rest),
    offenseSets: offenseSets.map(({ id, scout_sheet_id, created_at, play_id, ...rest }) => rest),
    specials: specials.map(({ id, scout_sheet_id, created_at, play_id, ...rest }) => rest),
    defenseSections: defenseSections.map(({ id, scout_sheet_id, created_at, updated_at, ...rest }) => rest),
  };
}

export async function importScoutSheetFromExportPayload(payload: Awaited<ReturnType<typeof scoutSheetToExportPayload>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  // Relink to an existing opponent by exact name; create fresh if none matches.
  const existingOpponents = await getOpponents();
  let opponentId = existingOpponents.find(o => o.name === payload.opponentName)?.id;
  if (!opponentId) {
    const created = await createOpponent(payload.opponentName);
    opponentId = created.id;
  }

  // Games aren't a reusable entity the way opponents/rosters are — a
  // fresh one is created every time, dated using the exported game date.
  const { game, error: gameErr } = await createGame({
    opponent: payload.opponentName,
    opponent_id: opponentId,
    game_date: payload.gameDate ?? new Date().toISOString().split("T")[0],
  });
  if (gameErr || !game) throw new Error(gameErr ?? "Couldn't create the game.");

  const sheet = await createScoutSheet(game.id, opponentId);
  await updateScoutSheet(sheet.id, {
    team_record: payload.team_record,
    tempo: payload.tempo,
    keys_to_game: payload.keys_to_game,
    team_offensive_strengths: payload.team_offensive_strengths,
  });

  if (payload.players.length) {
    await supabase.from("scout_players").insert(payload.players.map((p: any) => ({ ...p, scout_sheet_id: sheet.id, assigned_to_profile_id: null })));
  }
  if (payload.offenseSets.length) {
    await supabase.from("scout_offense_sets").insert(payload.offenseSets.map((s: any) => ({ ...s, scout_sheet_id: sheet.id, play_id: null })));
  }
  if (payload.specials.length) {
    await supabase.from("scout_specials").insert(payload.specials.map((s: any) => ({ ...s, scout_sheet_id: sheet.id, play_id: null })));
  }
  if (payload.defenseSections.length) {
    await supabase.from("scout_defense").insert(payload.defenseSections.map((d: any) => ({ ...d, scout_sheet_id: sheet.id })));
  }

  return sheet;
}
