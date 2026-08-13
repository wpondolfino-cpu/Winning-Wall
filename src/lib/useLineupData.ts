// src/lib/useLineupData.ts
// Loads everything a lineup surface needs for a set of games.
//
// Extracted so Reports and Rankings can't drift apart. They read the same
// possessions, the same shifts and the same goals, so a lineup that ranks
// 2nd has to show the same numbers on the report — two copies of this
// loader would have made that a coincidence rather than a guarantee.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { listStatGoals, gameFormat, type GameFormat, type Possession, type StatGoal } from "./gameStats";
import { listGamePlayers, listLineupEvents, type Shift, type LineupPlayer } from "./lineups";
import type { GameSlice } from "./lineupStats";

export interface LineupData {
  slices: GameSlice[];
  goals: StatGoal[];
  players: LineupPlayer[];
  /** Foul-trouble events counted per player, for the individual level. */
  fouls: Map<string, number>;
  loading: boolean;
  error: string | null;
}

export function useLineupData(gameIds: string[]): LineupData {
  const [slices, setSlices] = useState<GameSlice[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [players, setPlayers] = useState<LineupPlayer[]>([]);
  const [fouls, setFouls] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = gameIds.join(",");

  const load = useCallback(async () => {
    setLoading(true);
    if (!gameIds.length) { setSlices([]); setError(null); setLoading(false); return; }
    try {
      const formats = new Map<string, GameFormat>();
      const { data: gameRows, error: gameErr } = await supabase.from("games").select("*").in("id", gameIds);
      if (gameErr) throw new Error(gameErr.message);
      ((gameRows ?? []) as any[]).forEach((g) => formats.set(g.id, gameFormat(g)));

      const [{ data: poss }, { data: shiftRows }, { data: goalRows }] = await Promise.all([
        supabase.from("possessions").select("*").in("game_id", gameIds).order("sequence", { ascending: true }),
        supabase.from("shifts").select("*").in("game_id", gameIds).order("start_sequence", { ascending: true }),
        listStatGoals(),
      ]);

      const allPoss = (poss ?? []) as Possession[];
      const allShifts = (shiftRows ?? []) as Shift[];
      setGoals((goalRows ?? []) as StatGoal[]);
      // Sequence is unique per game, not across games, so each game has to be
      // matched against its own shifts before anything is merged.
      setSlices(gameIds.map((id) => {
        const shifts = allShifts.filter((s) => s.game_id === id);
        return {
          gameId: id,
          possessions: allPoss.filter((p) => p.game_id === id),
          shifts,
          format: formats.get(id) ?? gameFormat(null),
          // Only shifts where a clock reading was actually entered. Sparse by
          // design -- the estimate falls back to even distribution elsewhere.
          anchors: shifts
            .filter((s) => s.start_clock_seconds != null)
            .map((s) => ({ sequence: s.start_sequence, seconds: s.start_clock_seconds! })),
        };
      }));
      setPlayers(await listGamePlayers(null));

      const events = (await Promise.all(gameIds.map((id) => listLineupEvents(id)))).flat();
      const counts = new Map<string, number>();
      events.forEach((e) => counts.set(e.player_id, (counts.get(e.player_id) ?? 0) + 1));
      setFouls(counts);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load lineup data.");
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); }, [load]);

  return { slices, goals, players, fouls, loading, error };
}

/** Jersey and surname, or the full name where no jersey is set. */
export function playerLabeller(players: LineupPlayer[]) {
  const byId = new Map(players.map((p) => [p.id, p]));
  return (id: string) => {
    const p = byId.get(id);
    if (!p) return "?";
    return p.jersey != null ? `${p.jersey} ${p.name.split(" ").slice(-1)[0]}` : (p.name || "?");
  };
}
