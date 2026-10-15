// src/lib/viewAs.ts
// "View as" a test account, and back.
//
// Entering: the view-as server function checks you're allowed and hands
// back a one-time sign-in token for the test account. Before swapping
// sessions we keep YOUR refresh token on this device, so Return can put
// you back without a password. Only test accounts can ever be entered.

import { supabase } from "./supabase";

export interface TestAccount {
  user_id: string;
  role: "player" | "coach" | "head_coach";
  name: string;
}

interface Marker {
  returnRefreshToken: string;
  testUserId: string;
  testName: string;
  programName: string;
}

const KEY = "ww_view_as";

function readMarker(): Marker | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function clearMarker() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** The active view-as session, if the signed-in account is the test account we entered. */
export function currentViewAs(userId: string | undefined): Marker | null {
  const m = readMarker();
  return m && userId && m.testUserId === userId ? m : null;
}

export async function listTestAccounts(programId: string): Promise<TestAccount[]> {
  const { data, error } = await supabase.functions.invoke("view-as", { body: { action: "list", program_id: programId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.accounts ?? [];
}

export async function enterViewAs(account: TestAccount, programName: string): Promise<void> {
  const { data: s } = await supabase.auth.getSession();
  const refresh = s.session?.refresh_token;
  if (!refresh) throw new Error("Sign in again first.");

  const { data, error } = await supabase.functions.invoke("view-as", { body: { action: "enter", user_id: account.user_id } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  try {
    const marker: Marker = {
      returnRefreshToken: refresh, testUserId: account.user_id, testName: account.name, programName,
    };
    localStorage.setItem(KEY, JSON.stringify(marker));
  } catch { throw new Error("This browser blocked storage, so Return wouldn't work. View as is unavailable here."); }

  const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" });
  if (vErr) { clearMarker(); throw vErr; }
  window.location.href = window.location.pathname;   // fresh load as the test account
}

export async function returnFromViewAs(): Promise<void> {
  const m = readMarker();
  clearMarker();
  if (m) {
    const { error } = await supabase.auth.refreshSession({ refresh_token: m.returnRefreshToken });
    if (!error) { window.location.href = window.location.pathname; return; }
  }
  // Couldn't restore (e.g. the saved login expired): sign out to the login screen.
  await supabase.auth.signOut();
  window.location.href = window.location.pathname;
}
