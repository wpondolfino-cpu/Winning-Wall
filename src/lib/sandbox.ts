// src/lib/sandbox.ts
// The platform admin's sandbox (migration 198): a walled-off program with
// 36 made-up players, 3 made-up coaches and Varsity/JV/Freshman rosters.
// Nothing done in it reaches a real program. The people are made by the
// view-as function (logins can only be created there); the rest is
// database calls that refuse anyone but the platform admin.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface SandboxPerson {
  user_id: string;
  name: string;
  role: "head_coach" | "coach" | "player";
  graduation_year: number | null;
  roster_id: string | null;
  roster: string | null;
}
export interface SandboxRoster { id: string; name: string; color: string | null; }
export interface SandboxOverview {
  program_id: string | null;
  rosters: SandboxRoster[];
  people: SandboxPerson[];
  content: { practices: number; games: number; plays: number; quizzes: number; scores: number };
}

export async function loadSandbox(): Promise<SandboxOverview> {
  const { data, error } = await supabase.rpc("sandbox_overview");
  if (error) throw error;
  return data as SandboxOverview;
}

/** Makes whatever people and rosters are missing. rebuild = delete them all and start over. */
export async function buildSandbox(rebuild = false): Promise<number> {
  const { data, error } = await supabase.functions.invoke("view-as", { body: { action: "sandbox_build", rebuild } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.created ?? 0;
}

/** Wipes everything made in the sandbox; people, rosters and settings stay. */
export async function resetSandbox(): Promise<{ cleared: number; starter_items: number }> {
  const { data, error } = await supabase.rpc("sandbox_reset");
  if (error) throw error;
  return data as { cleared: number; starter_items: number };
}

/** Whether the signed-in account is working in the sandbox right now. */
export function useInSandbox(userId: string | undefined): boolean {
  const [inSandbox, setInSandbox] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let on = true;
    supabase.rpc("in_sandbox").then(({ data }) => { if (on) setInSandbox(data === true); });
    return () => { on = false; };
  }, [userId]);
  return inSandbox;
}
