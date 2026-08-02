// src/lib/practiceWins.ts
import { supabase } from "./supabase";

export interface PracticeWin {
  id: string;
  practice_id: string;
  player_id: string;
  drill_name: string | null;
  logged_by: string;
  created_at: string;
}

export async function getPracticeWins(practiceId: string): Promise<PracticeWin[]> {
  const { data, error } = await supabase.from("practice_wins").select("*")
    .eq("practice_id", practiceId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Logs one win per selected player (a multi-winner tap for a
// team-format drill) — all sharing the same drill name and timestamp
// cluster, which is also what a single Undo removes as a group.
export async function logPracticeWin(practiceId: string, playerIds: string[], drillName: string): Promise<PracticeWin[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const rows = playerIds.map(playerId => ({
    practice_id: practiceId,
    player_id: playerId,
    drill_name: drillName.trim() || null,
    logged_by: user.id,
  }));
  const { data, error } = await supabase.from("practice_wins").insert(rows).select();
  if (error) throw error;
  return data ?? [];
}

export async function deletePracticeWins(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("practice_wins").delete().in("id", ids);
  if (error) throw error;
}
