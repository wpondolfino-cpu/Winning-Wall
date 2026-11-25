// src/lib/headCoachInvite.ts
// The head-coach invite link (?invite=TOKEN, migration 220 + edge function
// invite-coach). Opening the link only shows a welcome page; nothing is
// used up until the person sets a password (or, with an account of their
// own, signs in) and accepts.
import { supabase } from "./supabase";

export interface InviteLookup {
  status: "open" | "used" | "revoked" | "expired" | "missing";
  program_name?: string | null;
  email?: string;
  name?: string | null;
  expires_at?: string;
  invited_by?: string | null;
  /** none: no account yet. unclaimed: made for them, never claimed. existing: their own account. */
  account?: "none" | "unclaimed" | "existing";
  program?: {
    name: string; school: string | null; logo_url: string | null;
    primary_color: string | null; secondary_color: string | null; accent_color: string | null;
  };
}

export function readInviteToken(): string | null {
  try {
    const t = new URLSearchParams(window.location.search).get("invite");
    return t && /^[A-Za-z0-9_-]{30,80}$/.test(t) ? t : null;
  } catch { return null; }
}

/** Take ?invite= off the address (keeps anything else). */
export function clearInviteParam(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState(window.history.state, document.title, url.pathname + url.search + url.hash);
  } catch { /* leave it */ }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("invite-coach", { body });
  if (error) {
    let detail = error.message;
    try { const b = await (error as any).context?.json?.(); if (b?.error) detail = b.error; } catch { /* keep */ }
    throw new Error(detail);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export function lookupInvite(token: string): Promise<InviteLookup> {
  return call<InviteLookup>({ action: "lookup", token });
}

/** New or unclaimed account: name + password. Own account: must be signed in as it. */
export function acceptInvite(token: string, name?: string, password?: string): Promise<{ ok: true; email: string }> {
  return call({ action: "accept", token, name, password });
}
