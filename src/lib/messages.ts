// src/lib/messages.ts
// Email-style messages between a program's head coaches and the platform
// admin (migration 192). Conversations have a subject; deleting one only
// removes it from your inbox; deleting a message (yours only) removes it
// for both sides.

import { supabase } from "./supabase";

export interface Conversation {
  id: number; program_id: string; program: string; org: string; subject: string;
  last_body: string | null; last_at: string; last_from_platform: boolean | null; messages: number; unread: number;
}
export interface ConvMessage { id: number; from_platform: boolean; sender_name: string; body: string; created_at: string; mine: boolean; }

export async function loadInbox(): Promise<Conversation[]> {
  const { data, error } = await supabase.rpc("conv_inbox");
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

/** A conversation's messages; opening it marks it read for you. */
export async function loadConversation(id: number): Promise<ConvMessage[]> {
  const { data, error } = await supabase.rpc("conv_messages", { p_conv: id });
  if (error) throw error;
  return (data ?? []) as ConvMessage[];
}

export async function unreadMessages(): Promise<number> {
  const { data } = await supabase.rpc("message_unread");
  return (data as number | null) ?? 0;
}

async function push(convId: number, fromPlatform: boolean, title: string, body: string) {
  try {
    const { data: ids } = await supabase.rpc("conv_recipients", { p_conv: convId });
    const playerIds = ((ids ?? []) as any[]).map(r => (typeof r === "string" ? r : r.conv_recipients ?? r.id)).filter(Boolean);
    if (!playerIds.length) return;
    await supabase.functions.invoke("send-push", {
      body: {
        title, message: body.length > 140 ? body.slice(0, 137) + "…" : body, playerIds,
        url: fromPlatform ? "/?tab=announcements" : "/?tab=platform-messages",
      },
    });
  } catch { /* the message itself is saved */ }
}

export async function startConversation(programId: string, subject: string, body: string, opts: { fromPlatform: boolean; programName: string }): Promise<number> {
  const { data, error } = await supabase.rpc("conv_start", { p_program: programId, p_subject: subject, p_body: body });
  if (error) throw error;
  const id = data as number;
  await push(id, opts.fromPlatform, opts.fromPlatform ? `💬 Admin: ${subject}` : `💬 ${opts.programName}: ${subject}`, body);
  return id;
}

export async function reply(conv: Conversation, body: string, fromPlatform: boolean): Promise<void> {
  const { error } = await supabase.rpc("conv_reply", { p_conv: conv.id, p_body: body });
  if (error) throw error;
  await push(conv.id, fromPlatform, fromPlatform ? `💬 Admin: ${conv.subject}` : `💬 ${conv.program}: ${conv.subject}`, body);
}

export async function deleteConversation(id: number): Promise<void> {
  const { error } = await supabase.rpc("conv_delete", { p_conv: id });
  if (error) throw error;
}

export async function deleteMessage(id: number): Promise<void> {
  const { error } = await supabase.rpc("message_delete", { p_message: id });
  if (error) throw error;
}
