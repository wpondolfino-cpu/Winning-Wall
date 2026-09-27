// src/lib/periods.ts
//
// The current competition (migration 147), replacing the endless 14-day
// cycle counted from one anchor date.
//
// A competition has its own start, end and name, and there may be none
// running at all -- that's how a pause works. So everything that used to
// be a Date is now Date | null, and every caller has to say what it does
// when nothing is running. That's deliberate: a page that forgot would
// break the first time competitions were paused.
//
// Cached in memory so render code can read it synchronously. Components
// should use useCompetition() so they re-render once it loads; library
// code awaits ensureCompetitionLoaded().

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type CompetitionLength = "day" | "week" | "two_weeks" | "month" | "custom";

export interface Competition {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  length_kind: CompetitionLength;
  repeats: boolean;
  crowned_at: string | null;
  skipped_at: string | null;
  /** Which leaderboard crowns it (migration 148): offseason points, or in-season practice wins. */
  scored_by: CompetitionScoring;
}

export type CompetitionScoring = "points" | "practice_wins";
export const SCORING_LABEL: Record<CompetitionScoring, string> = { points: "Points", practice_wins: "Practice wins" };

interface State { loaded: boolean; current: Competition | null; next: Competition | null; }

let state: State = { loaded: false, current: null, next: null };
let loading: Promise<State> | null = null;
const listeners = new Set<(s: State) => void>();

/**
 * Loads the running competition (starting the next repeat if one is due)
 * and the next scheduled one. Cached; pass force after changing anything.
 */
let watchingAuth = false;

export function loadCurrentCompetition(force = false): Promise<State> {
  // The app loads this on start, before sign-in, when the table can't be
  // read -- so reload once a session exists. Registered here, not at the
  // top of the file: supabase.ts re-exports this module, and touching the
  // client while the two are still loading would crash on startup.
  if (!watchingAuth) {
    watchingAuth = true;
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") loadCurrentCompetition(true);
    });
  }
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const { data: cur, error } = await supabase.rpc("current_competition");
      if (error) throw error;
      const current = ((cur as Competition[] | null) ?? [])[0] ?? null;
      const { data: nx } = await supabase
        .from("competitions").select("*")
        .gt("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true }).limit(1);
      state = { loaded: true, current, next: (nx as Competition[] | null)?.[0] ?? null };
    } catch (e) {
      console.error("Couldn't load the current competition:", e);
      state = { ...state, loaded: true };
      loading = null; // let the next caller retry
    }
    listeners.forEach(l => l(state));
    return state;
  })();
  return loading;
}

/** Kept so App.tsx's startup call keeps working. */
export const loadPeriodAnchor = loadCurrentCompetition;

export async function ensureCompetitionLoaded(): Promise<State> {
  return state.loaded ? state : loadCurrentCompetition();
}

export function getCurrentCompetition(): Competition | null { return state.current; }

/** For components: re-renders when the competition loads or changes. */
export function useCompetition(): State {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    if (!state.loaded) loadCurrentCompetition();
    else setS(state);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}

// ── Old names, now nullable ─────────────────────────────────

/** Start of the running competition, or null when none is running. */
export function currentPeriodStart(): Date | null {
  return state.current ? new Date(state.current.starts_at) : null;
}

/** End of the running competition (the midnight after its last day), or null. */
export function currentPeriodEnd(): Date | null {
  return state.current ? new Date(state.current.ends_at) : null;
}

/**
 * The key perk uses are recorded under: the running competition's start
 * date. Perks reset with each competition, whatever its length, and can't
 * be used while nothing is running. Matches the old period_start dates,
 * so uses from before the switch carry over.
 */
export function currentPerkPeriodKey(): string | null {
  return state.current ? state.current.starts_at.slice(0, 10) : null;
}

// ── Dates, names and lengths ───────────────────────────────

const TZ = "America/New_York";

/** A moment's calendar date in Eastern time, YYYY-MM-DD. Boundaries are midnight Eastern. */
export function easternDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** Midnight Eastern at the start of a YYYY-MM-DD date, as an ISO string. */
export function easternMidnightISO(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // Midnight EST is 05:00 UTC. If that reads as 1am, it's daylight time
  // (midnight = 04:00 UTC). DST changes at 2am, so midnight is safe.
  const est = new Date(Date.UTC(y, m - 1, d, 5));
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(est));
  return new Date(est.getTime() - hour * 3600_000).toISOString();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

/** The last day a competition covers (Eastern), not the midnight it ends on. */
export function lastDay(c: Pick<Competition, "ends_at">): string {
  return easternDate(new Date(new Date(c.ends_at).getTime() - 1000));
}

export function firstDay(c: Pick<Competition, "starts_at">): string {
  return easternDate(new Date(c.starts_at));
}

export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Oct 5 – Oct 18", or "Oct 5" for one day. Same format the server uses. */
export function defaultCompetitionName(first: string, last: string): string {
  return first === last ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`;
}

/** "Sep 21 – Oct 4" for display. */
export function competitionRange(c: Pick<Competition, "starts_at" | "ends_at">): string {
  return defaultCompetitionName(firstDay(c), lastDay(c));
}

/** Whole days left including today; 1 = last day. */
export function daysLeft(c: Pick<Competition, "ends_at">): number {
  const [a, b] = [easternDate(new Date()), easternDate(new Date(c.ends_at))];
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export const LENGTH_LABEL: Record<CompetitionLength, string> = {
  day: "1 day", week: "1 week", two_weeks: "2 weeks", month: "1 month", custom: "Custom",
};

/** Last day for a preset, given its first day. */
export function presetLastDay(first: string, kind: CompetitionLength): string {
  switch (kind) {
    case "day":       return first;
    case "week":      return addDays(first, 6);
    case "two_weeks": return addDays(first, 13);
    case "month":     return addDays(addMonths(first, 1), -1);
    default:          return addDays(first, 13);
  }
}

/** "Fall week 3 · Sep 21 – Oct 4", or just the range when the name already is the range. */
export function competitionLabel(c: Pick<Competition, "name" | "starts_at" | "ends_at">): string {
  const r = competitionRange(c);
  return c.name === r ? r : `${c.name} · ${r}`;
}
