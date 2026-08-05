// src/lib/scoutSheets.ts
// Types + CRUD for the Scout Sheet feature: opponents, scout_sheets,
// scout_players, scout_offense_sets, scout_specials, scout_defense.
// Mirrors the style of plays.ts / workouts.ts — thin wrappers around
// supabase-js, no business logic beyond what the DB/RLS already enforces.

import { supabase } from "./supabase";

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

// Last 5 games against this opponent, each paired with its scout sheet
// id (if one exists) so the profile view can link straight into it.
export async function getOpponentLastGames(opponentId: string, limit = 5) {
  const { data, error } = await supabase
    .from("games")
    .select("id, game_date, final_score_us, final_score_them, status, scout_sheets(id, status)")
    .eq("opponent_id", opponentId)
    .order("game_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((g: any) => ({
    ...g,
    scout_sheet: Array.isArray(g.scout_sheets) ? (g.scout_sheets[0] ?? null) : (g.scout_sheets ?? null),
  }));
}

export async function getScoutSheetsForOpponent(opponentId: string) {
  const { data, error } = await supabase
    .from("scout_sheets")
    .select("id, game_id, status, created_at, games(game_date)")
    .eq("opponent_id", opponentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getScoutSheetPrintContext(gameId: string, opponentId: string): Promise<{ gameDate: string | null; opponentName: string }> {
  const [{ data: game }, { data: opponent }] = await Promise.all([
    supabase.from("games").select("game_date").eq("id", gameId).maybeSingle(),
    supabase.from("opponents").select("name").eq("id", opponentId).maybeSingle(),
  ]);
  return { gameDate: game?.game_date ?? null, opponentName: opponent?.name ?? "Opponent" };
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: created, error: createErr } = await supabase
    .from("scout_sheets")
    .insert({
      game_id: newGameId,
      opponent_id: source.opponent_id,
      team_record: source.team_record,
      tempo: source.tempo,
      team_offensive_strengths: source.team_offensive_strengths,
      created_by: user.id,
    })
    .select().single();
  if (createErr) throw createErr;
  const newSheet: ScoutSheet = created;

  const [players, sets, specials, defense] = await Promise.all([
    getScoutPlayers(sourceSheetId),
    getOffenseSets(sourceSheetId),
    getSpecials(sourceSheetId),
    getDefenseSections(sourceSheetId),
  ]);

  if (players.length) {
    await supabase.from("scout_players").insert(players.map(({ id, scout_sheet_id, created_at, ...rest }) => ({
      ...rest, scout_sheet_id: newSheet.id,
    })));
  }
  if (sets.length) {
    await supabase.from("scout_offense_sets").insert(sets.map(({ id, scout_sheet_id, created_at, ...rest }) => ({
      ...rest, scout_sheet_id: newSheet.id,
    })));
  }
  if (specials.length) {
    await supabase.from("scout_specials").insert(specials.map(({ id, scout_sheet_id, created_at, ...rest }) => ({
      ...rest, scout_sheet_id: newSheet.id,
    })));
  }
  if (defense.length) {
    await supabase.from("scout_defense").insert(defense.map(({ id, scout_sheet_id, created_at, updated_at, ...rest }) => ({
      ...rest, scout_sheet_id: newSheet.id,
    })));
  }

  return newSheet;
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
  const { data: game, error: gameErr } = await supabase.from("games").insert({
    opponent: payload.opponentName,
    opponent_id: opponentId,
    game_date: payload.gameDate ?? new Date().toISOString().split("T")[0],
    season: new Date(payload.gameDate ?? Date.now()).getFullYear().toString(),
    home_away: "home",
    status: "draft",
    created_by: user.id,
  }).select().single();
  if (gameErr) throw gameErr;

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
