// src/lib/records.ts
// Hall of Fame records — best scores and all-time stats

import { supabase } from "./supabase";

export async function getCurrentSeason(): Promise<string> {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export async function getRecords() {
  const { data } = await supabase
    .from("records").select("*")
    .order("record_type").order("value", { ascending: false });
  return data ?? [];
}

export async function getBestScoreRecords() {
  const { data } = await supabase
    .from("records").select("*")
    .eq("record_type", "best_score").order("workout_title");
  return data ?? [];
}
