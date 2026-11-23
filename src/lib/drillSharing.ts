// src/lib/drillSharing.ts
// Sending team drills to other teams (SQL 218).
//
//   * Teams at the same school: picked from a list; their coaches see it in
//     their Drill Library with Add to library / No thanks.
//   * A coach at another school: a share code (DRL-7K4Q, good for 14 days)
//     they type into their Drill Library, or a link that fills it in.
//
// Adding makes the other team their own copy, with the diagram and linked
// play. Until 218 is run, the lists come back empty.

import { supabase } from "./supabase";

export interface SendTarget { id: string; name: string; }
export interface InboxDrill { id: string; title: string; category: string | null; from: string; sent_at: string; }
export interface ShareCode { code: string; expires_at: string; }
export type CodeLookup = { ok: true; title: string; category: string | null; from: string } | { ok: false; why: string };

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message ?? fallback);
}

/** The other teams at your school. */
export async function getSendTargets(): Promise<SendTarget[]> {
  const { data, error } = await supabase.rpc("drill_send_targets");
  if (error) { console.warn("drill_send_targets:", error.message); return []; }
  return (data ?? []) as SendTarget[];
}

export async function sendDrill(drillId: string, programIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("drill_send", { p_drill: drillId, p_programs: programIds });
  if (error) fail(error, "Couldn't send it.");
  return (data ?? 0) as number;
}

/** A drill's share code, making one if it doesn't have a live one. */
export async function getShareCode(drillId: string): Promise<ShareCode> {
  const { data, error } = await supabase.rpc("drill_share_code", { p_drill: drillId });
  if (error) fail(error, "Couldn't make a code.");
  return data as ShareCode;
}

/** The live code, if there is one — doesn't make one. */
export async function getShareStatus(drillId: string): Promise<ShareCode | null> {
  const { data, error } = await supabase.rpc("drill_share_status", { p_drill: drillId });
  if (error) return null;
  return (data ?? null) as ShareCode | null;
}

export async function revokeShareCode(drillId: string): Promise<void> {
  const { error } = await supabase.rpc("drill_share_revoke", { p_drill: drillId });
  if (error) fail(error, "Couldn't turn the code off.");
}

/** The link to send with a code: opens the Drill Library with the code filled in. */
export function shareLink(code: string): string {
  return `${window.location.origin}/?tab=practicelibrary&drillcode=${encodeURIComponent(code)}`;
}

/** Drills other teams at your school have sent, not yet answered. */
export async function getDrillInbox(): Promise<InboxDrill[]> {
  const { data, error } = await supabase.rpc("drill_inbox");
  if (error) { console.warn("drill_inbox:", error.message); return []; }
  return (data ?? []) as InboxDrill[];
}

export async function pickSentDrill(sendId: string, add: boolean): Promise<void> {
  const { error } = await supabase.rpc("drill_pick", { p_send: sendId, p_add: add });
  if (error) fail(error, "Couldn't do that.");
}

export async function lookupDrillCode(code: string): Promise<CodeLookup> {
  const { data, error } = await supabase.rpc("drill_code_lookup", { p_code: code });
  if (error) return { ok: false, why: error.message };
  return data as CodeLookup;
}

export async function addDrillFromCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("drill_code_add", { p_code: code });
  if (error) fail(error, "Couldn't add it.");
  return (data as { title: string }).title;
}

/** A code typed any which way ("drl 7k4q", "7K4Q") made tidy. */
export function tidyCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = s.startsWith("DRL") ? s.slice(3) : s;
  return body ? `DRL-${body}` : "";
}
