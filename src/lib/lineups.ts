 // src/lib/lineups.ts
// Lineup tracker data layer. Kept out of gameStats.ts on purpose -- that
// file is already 1000+ lines and this is a separate concern that only
// consumes possessions, never produces them.
//
// The core idea: shifts are stored, lineups are derived. A shift is one
// continuous stretch with the same five on the floor, recorded by where it
// STARTS. A possession belongs to the latest shift whose start_sequence is
// at or before its own, so nothing ever has to be written back onto the
// possessions table and the live tracker is untouched.

import { supabase } from "./supabase";
import type { Possession } from "./gameStats";

export interface Shift {
  id: string;
  game_id: string;
  quarter: number;
  start_sequence: number;
  player_ids: string[];
  start_clock_seconds: number | null;
  source: "post_game" | "live";
  created_at: string;
}

export type FoulLevel = "2nd" | "3rd" | "4th" | "5th";
export const FOUL_LEVELS: FoulLevel[] = ["2nd", "3rd", "4th", "5th"];

export interface LineupEvent {
  id: string;
  game_id: string;
  quarter: number;
  sequence: number;
  player_id: string;
  event_type: "foul_trouble";
  detail: FoulLevel | null;
  created_at: string;
}

export interface LineupPlayer {
  id: string;
  name: string;
  jersey: number | null;
  /** True when they belong to another roster and were called up to this one. */
  called_up: boolean;
}

// ── Reads ────────────────────────────────────────────────────────

export async function listShifts(gameId: string): Promise<Shift[]> {
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("game_id", gameId)
    .order("start_sequence", { ascending: true });
  // A missing table or an RLS block would otherwise read as "no shifts yet".
  if (error) throw new Error(`Couldn't load shifts: ${error.message}`);
  return (data ?? []) as Shift[];
}

export async function listLineupEvents(gameId: string): Promise<LineupEvent[]> {
  const { data, error } = await supabase
    .from("lineup_events")
    .select("*")
    .eq("game_id", gameId)
    .order("sequence", { ascending: true });
  if (error) throw new Error(`Couldn't load foul trouble events: ${error.message}`);
  return (data ?? []) as LineupEvent[];
}

/**
 * Who's available for this game. A game's roster_id decides the base list;
 * anyone called up to that roster from elsewhere is appended and flagged,
 * so a JV kid who played six varsity minutes is still tappable.
 *
 * A game with no roster_id (created before migration 102) falls back to
 * every player, which is the old behaviour rather than an empty bench.
 */
export async function listGamePlayers(rosterId: string | null): Promise<LineupPlayer[]> {
  // NOTE: call-ups live on practice_attendance_overrides, not profiles --
  // that column is per-practice, so there's nothing on the player record to
  // read here. Game-level call-ups need their own field; until then a
  // called-up player is picked from "All players".
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, jersey, home_roster_id")
    .eq("role", "player")
    .order("jersey", { ascending: true, nullsFirst: false });

  // Surfacing this matters: a bad column name makes PostgREST reject the
  // whole request, and swallowing that into an empty array looks exactly
  // like "nobody is on this roster".
  if (error) throw new Error(`Couldn't load players: ${error.message}`);

  const rows = (data ?? []) as any[];
  const mapped: LineupPlayer[] = rows
    .filter((p) => !rosterId || p.home_roster_id === rosterId)
    .map((p) => ({
      id: p.id,
      name: p.name ?? "",
      jersey: p.jersey ?? null,
      called_up: false,
    }));

  // Roster players first, call-ups after, each by jersey then name.
  return mapped.sort((a, b) => {
    if (a.called_up !== b.called_up) return a.called_up ? 1 : -1;
    if (a.jersey != null && b.jersey != null) return a.jersey - b.jersey;
    if (a.jersey != null) return -1;
    if (b.jersey != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The five that started the most recent game with any shifts entered, so a
 * new game's first shift can be prefilled. Restricted to the same roster --
 * last season's varsity starters are no help for a JV game.
 */
export async function lastStartingFive(rosterId: string | null, excludeGameId: string): Promise<string[] | null> {
  let q = supabase.from("games").select("id, game_date").order("game_date", { ascending: false }).limit(25);
  if (rosterId) q = q.eq("roster_id", rosterId);
  const { data: games } = await q;
  const ids = (games ?? []).map((g: any) => g.id).filter((id: string) => id !== excludeGameId);
  if (!ids.length) return null;

  const { data: shifts } = await supabase
    .from("shifts")
    .select("game_id, player_ids, start_sequence")
    .in("game_id", ids)
    .order("start_sequence", { ascending: true });
  if (!shifts?.length) return null;

  // Walk games newest-first and take the first one that has a shift.
  for (const id of ids) {
    const first = (shifts as any[]).find((s) => s.game_id === id);
    if (first) return first.player_ids as string[];
  }
  return null;
}

// ── Writes ───────────────────────────────────────────────────────

export async function createShift(
  gameId: string,
  quarter: number,
  startSequence: number,
  playerIds: string[],
  userId: string,
  startClockSeconds?: number | null,
): Promise<{ error: string | null; shift: Shift | null }> {
  if (playerIds.length !== 5) return { error: "A shift needs exactly five players.", shift: null };
  const { data, error } = await supabase
    .from("shifts")
    .insert({
      game_id: gameId,
      quarter,
      start_sequence: startSequence,
      player_ids: playerIds,
      start_clock_seconds: startClockSeconds ?? null,
      created_by: userId,
    })
    .select()
    .single();
  return { error: error?.message ?? null, shift: (data as Shift) ?? null };
}

/**
 * Changes who's on the floor for an existing shift.
 *
 * Cascade is deliberate. The editor works in swap terms even though the
 * database stores absolute fives, so correcting "10 in for 32" to "10 in
 * for 21" has to follow through every later shift -- otherwise you'd fix
 * one shift and leave the rest of the game built on the wrong five. The
 * cascade stops at the first later shift that already mentions either
 * player, since that shift set them deliberately.
 */
export async function updateShiftFive(
  shiftId: string,
  playerIds: string[],
  allShifts: Shift[],
): Promise<{ error: string | null; shifts: Shift[] }> {
  if (playerIds.length !== 5) return { error: "A shift needs exactly five players.", shifts: allShifts };

  const ordered = [...allShifts].sort((a, b) => a.start_sequence - b.start_sequence);
  const idx = ordered.findIndex((s) => s.id === shiftId);
  if (idx < 0) return { error: "Shift not found.", shifts: allShifts };

  const before = ordered[idx].player_ids;
  const removed = before.filter((p) => !playerIds.includes(p));
  const added = playerIds.filter((p) => !before.includes(p));

  const updates: { id: string; player_ids: string[] }[] = [{ id: shiftId, player_ids: playerIds }];

  for (let i = idx + 1; i < ordered.length; i++) {
    const five = ordered[i].player_ids;
    // A later shift that already decided about either player wins.
    const touched = [...removed, ...added].some((p) => {
      const prev = ordered[i - 1].player_ids;
      return five.includes(p) !== prev.includes(p);
    });
    if (touched) break;
    let next = five;
    removed.forEach((p) => { next = next.filter((x) => x !== p); });
    added.forEach((p) => { if (!next.includes(p)) next = [...next, p]; });
    if (next.length !== 5) break;
    if (next.join(",") === five.join(",")) continue;
    updates.push({ id: ordered[i].id, player_ids: next });
  }

  for (const u of updates) {
    const { error } = await supabase.from("shifts").update({ player_ids: u.player_ids }).eq("id", u.id);
    if (error) return { error: error.message, shifts: allShifts };
  }

  const byId = new Map(updates.map((u) => [u.id, u.player_ids]));
  return {
    error: null,
    shifts: allShifts.map((s) => (byId.has(s.id) ? { ...s, player_ids: byId.get(s.id)! } : s)),
  };
}

/**
 * Assigns (or reassigns) which roster a game's players come from. Games
 * created before migration 102 have no roster, so they offer every player
 * until this is set.
 */
export async function setGameRoster(gameId: string, rosterId: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase.from("games").update({ roster_id: rosterId }).eq("id", gameId);
  return { error: error?.message ?? null };
}

export async function deleteShift(shiftId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("shifts").delete().eq("id", shiftId);
  return { error: error?.message ?? null };
}

export async function addFoulTrouble(
  gameId: string,
  quarter: number,
  sequence: number,
  playerId: string,
  detail: FoulLevel,
  userId: string,
): Promise<{ error: string | null; event: LineupEvent | null }> {
  const { data, error } = await supabase
    .from("lineup_events")
    .insert({ game_id: gameId, quarter, sequence, player_id: playerId, event_type: "foul_trouble", detail, created_by: userId })
    .select()
    .single();
  return { error: error?.message ?? null, event: (data as LineupEvent) ?? null };
}

export async function deleteLineupEvent(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("lineup_events").delete().eq("id", id);
  return { error: error?.message ?? null };
}

// ── Deriving lineups from shifts ─────────────────────────────────

/** The shift covering a given possession -- the latest one starting at or before it. */
export function shiftForSequence(shifts: Shift[], sequence: number): Shift | null {
  let found: Shift | null = null;
  for (const s of shifts) {
    if (s.start_sequence <= sequence) {
      if (!found || s.start_sequence > found.start_sequence) found = s;
    }
  }
  return found;
}

/** Possession id -> shift id, for everything a shift covers. */
export function assignPossessions(possessions: Possession[], shifts: Shift[]): Map<string, string> {
  const sorted = [...shifts].sort((a, b) => a.start_sequence - b.start_sequence);
  const out = new Map<string, string>();
  for (const p of possessions) {
    const s = shiftForSequence(sorted, p.sequence);
    if (s) out.set(p.id, s.id);
  }
  return out;
}

/** A stable key for a set of five, so the same five in a different order groups together. */
export function lineupKey(playerIds: string[]): string {
  return [...playerIds].sort().join("|");
}

export interface LineupRow {
  key: string;
  playerIds: string[];
  /** Our offensive possessions with this five on the floor. */
  offPossessions: number;
  /** Their offensive possessions -- our defensive ones. */
  defPossessions: number;
  pointsFor: number;
  pointsAgainst: number;
  offPPP: number | null;
  defPPP: number | null;
  /** Points per 100 possessions, offence minus defence. */
  netRating: number | null;
  plusMinus: number;
  shiftCount: number;
}

/**
 * Phase 1 report: exact five-man lineups only, and raw values only -- no
 * shrinkage, no combos, no sample gates. Those arrive in Phase 2, once
 * there's real data to calibrate against.
 */
export function computeLineupRows(possessions: Possession[], shifts: Shift[]): LineupRow[] {
  const assigned = assignPossessions(possessions, shifts);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const rows = new Map<string, LineupRow>();

  const shiftsSeen = new Map<string, Set<string>>();

  for (const p of possessions) {
    const shiftId = assigned.get(p.id);
    if (!shiftId) continue;
    const shift = shiftById.get(shiftId);
    if (!shift) continue;
    const key = lineupKey(shift.player_ids);

    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        playerIds: [...shift.player_ids],
        offPossessions: 0, defPossessions: 0,
        pointsFor: 0, pointsAgainst: 0,
        offPPP: null, defPPP: null, netRating: null,
        plusMinus: 0, shiftCount: 0,
      };
      rows.set(key, row);
      shiftsSeen.set(key, new Set());
    }
    shiftsSeen.get(key)!.add(shiftId);

    if (p.team === "us") {
      row.offPossessions++;
      row.pointsFor += p.points ?? 0;
    } else {
      row.defPossessions++;
      row.pointsAgainst += p.points ?? 0;
    }
  }

  const out: LineupRow[] = [];
  rows.forEach((row, key) => {
    row.shiftCount = shiftsSeen.get(key)?.size ?? 0;
    row.offPPP = row.offPossessions ? round2(row.pointsFor / row.offPossessions) : null;
    row.defPPP = row.defPossessions ? round2(row.pointsAgainst / row.defPossessions) : null;
    row.netRating =
      row.offPPP != null && row.defPPP != null ? Math.round((row.offPPP - row.defPPP) * 100) : null;
    row.plusMinus = row.pointsFor - row.pointsAgainst;
    out.push(row);
  });

  return out.sort((a, b) => b.offPossessions + b.defPossessions - (a.offPossessions + a.defPossessions));
}

// ── Invariants ───────────────────────────────────────────────────

/**
 * Arithmetic checks that either pass or scream. With no type checker in
 * the loop and shift entry being manual, these catch both entry mistakes
 * and aggregation bugs -- a shift with six players, a shift covering zero
 * possessions, possessions with no shift at all.
 */
export function validateShifts(possessions: Possession[], shifts: Shift[]): string[] {
  const problems: string[] = [];
  const sorted = [...shifts].sort((a, b) => a.start_sequence - b.start_sequence);

  sorted.forEach((s) => {
    if (s.player_ids.length !== 5) {
      problems.push(`A shift starting at #${s.start_sequence} has ${s.player_ids.length} players, not 5.`);
    }
    if (new Set(s.player_ids).size !== s.player_ids.length) {
      problems.push(`A shift starting at #${s.start_sequence} lists the same player twice.`);
    }
  });

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_sequence === sorted[i - 1].start_sequence) {
      problems.push(`Two shifts both start at #${sorted[i].start_sequence}.`);
    }
  }

  const assigned = assignPossessions(possessions, shifts);
  const unassigned = possessions.filter((p) => !assigned.has(p.id));
  if (unassigned.length) {
    const first = unassigned.reduce((m, p) => (p.sequence < m ? p.sequence : m), Infinity);
    problems.push(`${unassigned.length} possession${unassigned.length === 1 ? "" : "s"} before the first shift (from #${first}).`);
  }

  const covered = new Set(assigned.values());
  sorted.forEach((s) => {
    if (!covered.has(s.id) && possessions.length) {
      problems.push(`The shift starting at #${s.start_sequence} covers no possessions.`);
    }
  });

  // A shift is supposed to sit inside one period. If the possessions it
  // covers span two, a period boundary was missed.
  const byShift = new Map<string, Set<number>>();
  possessions.forEach((p) => {
    const id = assigned.get(p.id);
    if (!id) return;
    if (!byShift.has(id)) byShift.set(id, new Set());
    byShift.get(id)!.add(p.quarter);
  });
  byShift.forEach((quarters, id) => {
    if (quarters.size > 1) {
      const s = sorted.find((x) => x.id === id);
      problems.push(`The shift starting at #${s?.start_sequence} spans more than one period — add a shift at the period change.`);
    }
  });

  return problems;
}

function round2(n: number) { return Math.round(n * 100) / 100; }
