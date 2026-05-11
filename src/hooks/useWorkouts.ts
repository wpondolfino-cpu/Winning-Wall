// src/hooks/useWorkouts.ts
import { useEffect, useState, useCallback } from "react";
import { supabase, getWorkouts, Workout } from "../lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";

export function useWorkouts() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getWorkouts();
      setWorkouts(data);
    } catch (e) {
      console.error("Workouts fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    // When a coach posts a new workout, all connected clients
    // receive it instantly without a page refresh.
    let channel: RealtimeChannel;
    channel = supabase
      .channel("workouts-sync")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "workouts" },
        () => refresh()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  return { workouts, loading, refresh };
}
