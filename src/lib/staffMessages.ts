// src/lib/staffMessages.ts
// Messages between a program's coaches -- head coaches and assistants
// (migration 203). Same inbox style as messages with Winning Wall:
// conversations with a subject, deleting one only removes it from your
// inbox, deleting a message (yours only) removes it for everyone.
// Everything is in the program you're in; players never see any of it.

import { supabase } from "./supabase";

export interface StaffPerson { id: string; name: string; role: "head_coach" | "coach"; }
export interface StaffConversation {
  id: number; subject: string; everyone: boolean; people: string;
  last_body: string | null; last_sender: string | null; last_mine: boolean | null;
  last_at: string; messages: number; unread: number;
}
export interface StaffMessage { id: number; sender_name: string; body: string; created_at: string; mine: boolean; }

export async function loadStaffPeople(): Promise<StaffPerson[]> {
  const { data, error } = await supabase.rpc("staff_people");
  if (error) throw error;
  return (data ?? []) as StaffPerson[];
}

export async function loadStaffInbox(): Promise<StaffConversation[]> {
  const { data, error } = await supabase.rpc("staff_inbox");
  if (error) throw error;
  return (data ?? []) as StaffConversation[];
}

/** A conversation's messages; opening it marks it read for you. */
export async function loadStaffThread(id: number): Promise<StaffMessage[]> {
  const { data, error } = await supabase.rpc("staff_thread", { p_conv: id });
  if (error) throw error;
  return (data ?? []) as StaffMessage[];
}

export async function staffUnread(): Promise<number> {
  const { data, error } = await supabase.rpc("staff_unread");
  if (error) return 0;   // before migration 203, or not a coach
  return (data as number | null) ?? 0;
}

async function push(convId: number, title: string, body: string) {
  try {
    const { data: ids } = await supabase.rpc("staff_recipients", { p_conv: convId });
    const playerIds = ((ids ?? []) as any[]).map(r => (typeof r === "string" ? r : r.staff_recipients ?? r.id)).filter(Boolean);
    if (!playerIds.length) return;
    await supabase.functions.invoke("send-push", {
      body: { title, message: body.length > 140 ? body.slice(0, 137) + "…" : body, playerIds, url: "/?tab=announcements" },
    });
  } catch { /* the message itself is saved */ }
}

/** to = [] for the whole staff. */
export async function startStaffConversation(subject: string, body: string, to: string[], senderName: string): Promise<number> {
  const { data, error } = await supabase.rpc("staff_start", { p_subject: subject, p_body: body, p_to: to.length ? to : null });
  if (error) throw error;
  const id = data as number;
  await push(id, `💬 ${senderName}: ${subject}`, body);
  return id;
}

export async function replyStaff(conv: StaffConversation, body: string, senderName: string): Promise<void> {
  const { error } = await supabase.rpc("staff_reply", { p_conv: conv.id, p_body: body });
  if (error) throw error;
  await push(conv.id, `💬 ${senderName}: ${conv.subject}`, body);
}

export async function hideStaffConversation(id: number): Promise<void> {
  const { error } = await supabase.rpc("staff_hide", { p_conv: id });
  if (error) throw error;
}

export async function deleteStaffMessage(id: number): Promise<void> {
  const { error } = await supabase.rpc("staff_message_delete", { p_message: id });
  if (error) throw error;
}
