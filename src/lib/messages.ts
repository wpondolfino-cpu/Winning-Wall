// src/lib/messages.ts
// Messages between a program's head coaches and the platform admin
// (migration 191). One conversation per program.

import { supabase } from "./supabase";

export interface ThreadMessage { id: number; from_platform: boolean; sender_name: string; body: string; created_at: string; mine: boolean; }
export interface InboxRow { program_id: string; program: string; org: string; last_body: string; last_at: string; last_from_platform: boolean; unread: number; }

/** Reads a conversation and marks it read for you. */
export async function loadThread(programId: string): Promise<ThreadMessage[]> {
  const { data, error } = await supabase.rpc("message_thread", { p_program: programId });
  if (error) throw error;
  return (data ?? []) as ThreadMessage[];
}

export async function loadInbox(): Promise<InboxRow[]> {
  const { data, error } = await supabase.rpc("message_inbox");
  if (error) throw error;
  return (data ?? []) as InboxRow[];
}

export async function unreadMessages(): Promise<number> {
  const { data } = await supabase.rpc("message_unread");
  return (data as number | null) ?? 0;
}

/** Sends, then pushes it to the other side (head coaches, or the platform
 *  admin). The message is saved even if the push doesn't go out. */
export async function sendMessage(programId: string, body: string, opts: { fromPlatform: boolean; programName: string }): Promise<void> {
  const { error } = await supabase.rpc("message_send", { p_program: programId, p_body: body });
  if (error) throw error;
  try {
    const { data: ids } = await supabase.rpc("message_recipients", { p_program: programId });
    const playerIds = ((ids ?? []) as any[]).map(r => (typeof r === "string" ? r : r.message_recipients ?? r.id)).filter(Boolean);
    if (playerIds.length) {
      await supabase.functions.invoke("send-push", {
        body: {
          title: opts.fromPlatform ? "💬 Message from Winning Wall" : `💬 ${opts.programName}`,
          message: body.length > 140 ? body.slice(0, 137) + "…" : body,
          playerIds,
          url: opts.fromPlatform ? "/?tab=settings" : "/?tab=platform-messages",
        },
      });
    }
  } catch { /* the message itself is saved */ }
}
