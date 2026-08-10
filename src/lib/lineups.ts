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

export type ShiftSide = "us" | "opponent";

/** "Team 1" and "Team 2" in a practice. Games only ever use the us side. */
export const SIDE_LABEL: Record<ShiftSide, string> = { us: "Team 1", opponent: "Team 2" };

export interface Shift {
  id: string;
  game_id: string;
  quarter: number;
  start_sequence: number;
  player_ids: string[];
  start_clock_seconds: number | null;
  source: "post_game" | "live";
  /** Which squad this five belongs to. Always "us" for a real game. */
  side: ShiftSide;
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
 * Who's available for this game: the roster's own players, plus anyone
 * called up for this specific game (flagged, so the bench shows them
 * differently).
 *
 * A game with no roster_id falls back to every player rather than an empty
 * bench. Passing no gameId skips call-ups -- useful where the list is only
 * needed to turn ids into names.
 */
export async function listGamePlayers(rosterId: string | null, gameId?: string): Promise<LineupPlayer[]> {
  const calledUp = gameId ? await listCallUpIds(gameId) : new Set<string>();

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
    .filter((p) => !rosterId || p.home_roster_id === rosterId || calledUp.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name ?? "",
      jersey: p.jersey ?? null,
      called_up: !!rosterId && p.home_roster_id !== rosterId && calledUp.has(p.id),
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

/** Player ids called up for this specific game. */
export async function listCallUpIds(gameId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from("game_call_ups").select("player_id").eq("game_id", gameId);
  if (error) throw new Error(`Couldn't load call-ups: ${error.message}`);
  return new Set(((data ?? []) as any[]).map((r) => r.player_id as string));
}

/**
 * Players eligible to be called up: anyone with the player role who isn't
 * already on this roster. Returns their own roster's name so the picker can
 * say where they're coming from.
 */
export async function listCallUpCandidates(rosterId: string | null): Promise<(LineupPlayer & { fromRoster: string })[]> {
  const [{ data, error }, { data: rosters }] = await Promise.all([
    supabase.from("profiles").select("id, name, jersey, home_roster_id").eq("role", "player"),
    supabase.from("rosters").select("id, name"),
  ]);
  if (error) throw new Error(`Couldn't load players: ${error.message}`);
  const rosterName = new Map(((rosters ?? []) as any[]).map((r) => [r.id, r.name as string]));
  return ((data ?? []) as any[])
    .filter((p) => p.home_roster_id !== rosterId)
    .map((p) => ({
      id: p.id,
      name: p.name ?? "",
      jersey: p.jersey ?? null,
      called_up: true,
      fromRoster: rosterName.get(p.home_roster_id) ?? "no roster",
    }))
    .sort((a, b) => a.fromRoster.localeCompare(b.fromRoster) || (a.jersey ?? 999) - (b.jersey ?? 999) || a.name.localeCompare(b.name));
}

export async function addCallUp(gameId: string, playerId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("game_call_ups").insert({ game_id: gameId, player_id: playerId, created_by: userId });
  return { error: error?.message ?? null };
}

export async function removeCallUp(gameId: string, playerId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("game_call_ups").delete().eq("game_id", gameId).eq("player_id", playerId);
  return { error: error?.message ?? null };
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
  side: ShiftSide = "us",
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
      side,
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

  const target = allShifts.find((s) => s.id === shiftId);
  if (!target) return { error: "Shift not found.", shifts: allShifts };
  // Only this side cascades. Fixing who was on for Team 1 tells you nothing
  // about who was on for Team 2.
  const ordered = allShifts
    .filter((s) => (s.side ?? "us") === (target.side ?? "us"))
    .sort((a, b) => a.start_sequence - b.start_sequence);
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

/** The shift covering a given possession on one side -- the latest one starting at or before it. */
export function shiftForSequence(shifts: Shift[], sequence: number, side: ShiftSide = "us"): Shift | null {
  let found: Shift | null = null;
  for (const s of shifts) {
    if ((s.side ?? "us") !== side) continue;
    if (s.start_sequence <= sequence) {
      if (!found || s.start_sequence > found.start_sequence) found = s;
    }
  }
  return found;
}

/**
 * Possession id -> the shift on each end of it.
 *
 * One rule covers games and practices both: offence goes to the latest
 * shift on the side that has the ball, defence to the latest shift on the
 * other side. In a game only "us" shifts exist, so our own possessions find
 * no defensive shift and theirs find no offensive one -- which is precisely
 * the old single-shift behaviour, just expressed once.
 */
export function assignPossessionSides(
  possessions: Possession[],
  shifts: Shift[],
): Map<string, { off: string | null; def: string | null }> {
  const sorted = [...shifts].sort((a, b) => a.start_sequence - b.start_sequence);
  const out = new Map<string, { off: string | null; def: string | null }>();
  for (const p of possessions) {
    const ballSide: ShiftSide = p.team === "us" ? "us" : "opponent";
    const otherSide: ShiftSide = ballSide === "us" ? "opponent" : "us";
    out.set(p.id, {
      off: shiftForSequence(sorted, p.sequence, ballSide)?.id ?? null,
      def: shiftForSequence(sorted, p.sequence, otherSide)?.id ?? null,
    });
  }
  return out;
}

/** Possession id -> shift id for the "us" side only. Kept for the entry screen, which paints one side at a time. */
export function assignPossessions(possessions: Possession[], shifts: Shift[], side: ShiftSide = "us"): Map<string, string> {
  const sorted = [...shifts].sort((a, b) => a.start_sequence - b.start_sequence);
  const out = new Map<string, string>();
  for (const p of possessions) {
    const s = shiftForSequence(sorted, p.sequence, side);
    if (s) out.set(p.id, s.id);
  }
  return out;
}

/** A stable key for a set of five, so the same five in a different order groups together. */
export function lineupKey(playerIds: string[]): string {
  return [...playerIds].sort().join("|");
}

// ── Invariants ───────────────────────────────────────────────────

/**
 * Arithmetic checks that either pass or scream. With no type checker in
 * the loop and shift entry being manual, these catch both entry mistakes
 * and aggregation bugs -- a shift with six players, a shift covering zero
 * possessions, possessions with no shift at all.
 */
export function validateShifts(possessions: Possession[], shifts: Shift[], sides: ShiftSide[] = ["us"]): string[] {
  const problems: string[] = [];
  const multi = sides.length > 1;
  const tag = (side: ShiftSide) => (multi ? `${SIDE_LABEL[side]}: ` : "");

  for (const side of sides) {
    const sorted = shifts.filter((s) => (s.side ?? "us") === side).sort((a, b) => a.start_sequence - b.start_sequence);

    sorted.forEach((s) => {
      if (s.player_ids.length !== 5) {
        problems.push(`${tag(side)}a shift starting at #${s.start_sequence} has ${s.player_ids.length} players, not 5.`);
      }
      if (new Set(s.player_ids).size !== s.player_ids.length) {
        problems.push(`${tag(side)}a shift starting at #${s.start_sequence} lists the same player twice.`);
      }
    });

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start_sequence === sorted[i - 1].start_sequence) {
        problems.push(`${tag(side)}two shifts both start at #${sorted[i].start_sequence}.`);
      }
    }

    const assigned = assignPossessions(possessions, shifts, side);
    const unassigned = possessions.filter((p) => !assigned.has(p.id));
    if (unassigned.length) {
      const first = unassigned.reduce((m, p) => (p.sequence < m ? p.sequence : m), Infinity);
      problems.push(`${tag(side)}${unassigned.length} possession${unassigned.length === 1 ? "" : "s"} before the first shift (from #${first}).`);
    }

    const covered = new Set(assigned.values());
    sorted.forEach((s) => {
      if (!covered.has(s.id) && possessions.length) {
        problems.push(`${tag(side)}the shift starting at #${s.start_sequence} covers no possessions.`);
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
        problems.push(`${tag(side)}the shift starting at #${s?.start_sequence} spans more than one period — add a shift at the period change.`);
      }
    });
  }

  // Intrasquad only: nobody can be on both squads at once.
  if (multi) {
    const usShifts = shifts.filter((s) => (s.side ?? "us") === "us");
    possessions.forEach((p) => {
      const a = shiftForSequence(usShifts, p.sequence, "us");
      const b = shiftForSequence(shifts, p.sequence, "opponent");
      if (!a || !b) return;
      const both = a.player_ids.filter((id) => b.player_ids.includes(id));
      if (both.length) {
        problems.push(`At #${p.sequence}, ${both.length} player${both.length === 1 ? " is" : "s are"} listed on both squads at once.`);
      }
    });
  }

  return [...new Set(problems)];
}
