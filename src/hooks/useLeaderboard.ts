// src/hooks/useLeaderboard.ts
//
// Subscribes to Supabase Realtime on the `scores` table.
// Any INSERT or UPDATE fires a leaderboard refresh — giving
// every connected client a live-updating leaderboard with
// no polling.
//
import { useEffect, useState, useCallback } from "react";
import { supabase, getLeaderboard, LeaderboardEntry } from "../lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";

export function useLeaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getLeaderboard();
      setLeaderboard(data);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("Leaderboard fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load
    refresh();

    // ── WebSocket subscription ───────────────────────────────
    // Supabase Realtime broadcasts a message whenever any row
    // in `scores` is inserted or updated. We re-fetch the
    // aggregated leaderboard view on every such event.
    let channel: RealtimeChannel;

    channel = supabase
      .channel("leaderboard-sync")                        // named channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scores" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "scores" },
        () => refresh()
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("[Realtime] Leaderboard channel connected ✓");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { leaderboard, loading, lastUpdated, refresh };
}
