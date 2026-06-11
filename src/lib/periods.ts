// src/lib/periods.ts
// Biweekly period helpers — anchor loaded from database,
// cached in memory so it doesn't re-fetch on every call.

import { supabase } from "./supabase";

// In-memory cache — populated on app startup by loadPeriodAnchor()
let _anchorCache: Date | null = null;

// Call once in App.tsx useEffect on mount
export async function loadPeriodAnchor(): Promise<Date> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "period_anchor")
    .single();
  const anchor = data?.value ? new Date(data.value) : new Date("2025-05-03");
  _anchorCache = anchor;
  return anchor;
}

// Save anchor to database — called by AdminSettings
export async function savePeriodAnchor(date: Date): Promise<void> {
  const value = date.toISOString().split("T")[0];
  await supabase.from("app_settings").upsert(
    { key: "period_anchor", value, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  _anchorCache = date;
}

// Synchronous getter — uses cache
export function getPeriodAnchor(): Date {
  return _anchorCache ?? new Date("2025-05-03");
}

// Legacy setter — now also writes to DB
export function setPeriodAnchor(date: Date) {
  _anchorCache = date;
  savePeriodAnchor(date).catch(console.error);
}

export function currentPeriodStart(): Date {
  const EPOCH        = getPeriodAnchor();
  const now          = new Date();
  const msSinceEpoch = now.getTime() - EPOCH.getTime();
  const periodMs     = 14 * 24 * 60 * 60 * 1000;
  if (msSinceEpoch < 0) return EPOCH;
  const periodsSince = Math.floor(msSinceEpoch / periodMs);
  return new Date(EPOCH.getTime() + periodsSince * periodMs);
}

export function currentPeriodEnd(): Date {
  const start = currentPeriodStart();
  return new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
}

export function getPeriodNumber(): number {
  const EPOCH        = getPeriodAnchor();
  const now          = new Date();
  const msSinceEpoch = now.getTime() - EPOCH.getTime();
  const periodMs     = 14 * 24 * 60 * 60 * 1000;
  return Math.floor(msSinceEpoch / periodMs) + 1;
}
