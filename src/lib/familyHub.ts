// src/lib/familyHub.ts
// Parent portal, phase 2 (SQL 223): checklist, sign-ups, family messages
// and the per-team switches. Phase 1 lives in family.ts.
import { supabase } from "./supabase";

// ── Types ─────────────────────────────────────────────────────

export interface PortalInfo {
  messages_on: boolean;
  suggestions_on: boolean;
  has_messages: boolean;
  unread_messages: number;
  open_signups: number;
  checklist_total: number;
  checklist_received: number;
}

export interface ParentChecklistRow {
  id: string;
  title: string;
  details: string | null;
  due_date: string | null;
  received_on: string | null;
}

export interface ChecklistItem {
  id: string;
  roster_id: string;
  title: string;
  details: string | null;
  due_date: string | null;
  sort_order: number;
  archived_at: string | null;
}

export interface ChecklistMark { item_id: string; player_id: string; received_on: string }

export interface SignupClaim {
  id: string;
  qty: number;
  mine: boolean;
  name: string | null;   // null when names are hidden from you
  child: string | null;
  note: string | null;
}

export interface SignupSpot {
  id: string;
  label: string;
  quantity: number;
  taken: number;
  claims: SignupClaim[];
}

export interface SignupUpdate { id: string; message: string; created_at: string; author: string | null }

export type SignupStatus = "pending" | "open" | "closed" | "declined";

export interface Signup {
  id: string;
  roster_id: string | null;
  team_name: string | null;
  title: string;
  details: string | null;
  event_date: string | null;
  event_time: string | null;
  deadline: string | null;
  created_at: string;
  show_names: boolean;
  allow_undo: boolean;
  status: SignupStatus;
  decline_note: string | null;
  organizer_name: string | null;
  organizer_is_parent: boolean;
  organizer_child: string | null;
  mine: boolean;
  can_manage: boolean;
  open_now: boolean;
  location: string | null;
  has_location: boolean;
  spots: SignupSpot[];
  updates: SignupUpdate[];
}

export interface SignupDraft {
  id?: string;
  player?: string;              // a family suggesting one, through this child
  roster_id?: string | null;    // coaches: null = every team
  title: string;
  details: string;
  event_date: string;           // yyyy-mm-dd or ""
  event_time: string;           // HH:MM or ""
  deadline: string;
  show_names: boolean;
  allow_undo: boolean;
  location: string;
  spots: { id?: string; label: string; quantity: number }[];
}

export interface FamilyMessage {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_kind: "parent" | "staff";
  body: string;
  created_at: string;
  mine: boolean;
}

export interface StaffThread {
  player_id: string;
  player_name: string | null;
  roster_id: string | null;
  team_name: string | null;
  parents: string | null;
  messages_on: boolean;
  last_message_at: string | null;
  last_body: string | null;
  last_kind: "parent" | "staff" | null;
  unread: number;
}

export interface TeamSetting { roster_id: string; name: string; suggestions_on: boolean; messages_on: boolean }

// ── Helpers ───────────────────────────────────────────────────

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as any, args as any);
  if (error) throw new Error(error.message);
  return data as T;
}

function push(body: Record<string, unknown>) {
  supabase.functions.invoke("send-push", { body }).catch(() => {});
}

// ── Parent: tab badges ────────────────────────────────────────

export async function getPortalInfo(playerId: string): Promise<PortalInfo | null> {
  return await rpc<PortalInfo | null>("parent_portal_info", { p_player: playerId });
}

// ── Checklist ─────────────────────────────────────────────────

export async function getParentChecklist(playerId: string): Promise<ParentChecklistRow[]> {
  return (await rpc<ParentChecklistRow[]>("parent_checklist", { p_player: playerId })) ?? [];
}

export async function getChecklist(rosterId: string): Promise<{ items: ChecklistItem[]; marks: ChecklistMark[] }> {
  const { data: items, error } = await supabase.from("family_checklist_items")
    .select("id, roster_id, title, details, due_date, sort_order, archived_at")
    .eq("roster_id", rosterId).is("archived_at", null).order("sort_order").order("created_at");
  if (error) throw new Error(error.message);
  const ids = ((items ?? []) as ChecklistItem[]).map(i => i.id);
  const { data: marks } = ids.length
    ? await supabase.from("family_checklist_marks").select("item_id, player_id, received_on").in("item_id", ids)
    : { data: [] as ChecklistMark[] };
  return { items: (items ?? []) as ChecklistItem[], marks: (marks ?? []) as ChecklistMark[] };
}

export async function saveChecklistItem(item: { id?: string; roster_id: string; title: string; details?: string | null; due_date?: string | null; sort_order?: number }): Promise<void> {
  const row = {
    roster_id: item.roster_id, title: item.title.trim(),
    details: item.details?.trim() || null, due_date: item.due_date || null,
    ...(item.sort_order !== undefined ? { sort_order: item.sort_order } : {}),
  };
  const { error } = item.id
    ? await supabase.from("family_checklist_items").update(row).eq("id", item.id)
    : await supabase.from("family_checklist_items").insert(row);
  if (error) throw new Error(error.message);
}

/** Take an item off the list. Marks stay in the database. */
export async function archiveChecklistItem(id: string): Promise<void> {
  const { error } = await supabase.from("family_checklist_items").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setReceived(itemId: string, playerId: string, received: boolean): Promise<void> {
  const { error } = received
    ? await supabase.from("family_checklist_marks").upsert({ item_id: itemId, player_id: playerId, received_on: localToday() }, { onConflict: "item_id,player_id" })
    : await supabase.from("family_checklist_marks").delete().eq("item_id", itemId).eq("player_id", playerId);
  if (error) throw new Error(error.message);
}

// ── Sign-ups ──────────────────────────────────────────────────

/** A parent through a child, or (no child) a coach's whole program. */
export async function listSignups(playerId: string | null): Promise<Signup[]> {
  return (await rpc<Signup[]>("signup_list", { p_player: playerId })) ?? [];
}

/** Save. A new coach sign-up can tell the families; a family's suggestion
 *  always tells the coaches. */
export async function saveSignup(d: SignupDraft, opts: { notifyFamilies?: boolean } = {}): Promise<{ id: string; status: SignupStatus }> {
  const isNew = !d.id;
  const r = await rpc<{ id: string; status: SignupStatus }>("signup_save", {
    p: {
      id: d.id ?? null, player: d.player ?? null,
      ...(d.roster_id !== undefined ? { roster_id: d.roster_id } : {}),
      title: d.title, details: d.details, event_date: d.event_date, event_time: d.event_time,
      deadline: d.deadline, show_names: d.show_names, allow_undo: d.allow_undo, location: d.location,
      spots: d.spots.filter(s => s.label.trim()).map(s => ({ id: s.id ?? null, label: s.label.trim(), quantity: s.quantity })),
    },
  });
  if (isNew && r.status === "pending") push({ signupSuggested: { signupId: r.id } });
  if (isNew && r.status === "open" && opts.notifyFamilies) push({ signupOpened: { signupId: r.id } });
  return r;
}

export async function decideSignup(id: string, approve: boolean, note?: string): Promise<void> {
  await rpc("signup_decide", { p_id: id, p_approve: approve, p_note: note ?? null });
  if (approve) push({ signupOpened: { signupId: id } });
}

export async function setSignupOpen(id: string, open: boolean): Promise<void> {
  await rpc("signup_set_open", { p_id: id, p_open: open });
}

export async function deleteSignup(id: string): Promise<void> {
  await rpc("signup_delete", { p_id: id });
}

export async function claimSpot(spotId: string, playerId: string, qty: number, note: string): Promise<void> {
  await rpc("signup_claim", { p_spot: spotId, p_player: playerId, p_qty: qty, p_note: note.trim() || null });
}

export async function unclaim(claimId: string): Promise<void> {
  await rpc("signup_unclaim", { p_claim: claimId });
}

export async function postSignupUpdate(id: string, message: string): Promise<void> {
  const uid = await rpc<string>("signup_post_update", { p_id: id, p_message: message });
  if (uid) push({ signupUpdate: { updateId: uid } });
}

/** Returns a short line for the organizer: who it went to, or why not. */
export async function sendSignupReminder(id: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("send-push", { body: { signupReminder: { signupId: id } } });
  if (error) {
    let detail = error.message;
    try { const b = await (error as any).context?.json?.(); if (b?.error) detail = b.error; } catch { /* keep */ }
    return `Not sent: ${detail}`;
  }
  const d = data as any;
  if (d?.sent) return `Reminder sent to ${d.people} famil${d.people === 1 ? "y" : "ies"}.`;
  return `Not sent: ${d?.reason ?? "unknown reason"}.`;
}

// ── Family messages ───────────────────────────────────────────

export async function getThreadMessages(playerId: string): Promise<FamilyMessage[]> {
  return (await rpc<FamilyMessage[]>("family_thread_messages", { p_player: playerId })) ?? [];
}

export async function sendFamilyMessage(playerId: string, body: string): Promise<void> {
  const id = await rpc<string>("family_send_message", { p_player: playerId, p_body: body });
  if (id) push({ familyMessage: { messageId: id } });
}

export async function getStaffThreads(): Promise<StaffThread[]> {
  return (await rpc<StaffThread[]>("staff_family_threads")) ?? [];
}

// ── Per-team switches ─────────────────────────────────────────

export async function getTeamSettings(): Promise<TeamSetting[]> {
  const [{ data: teams, error }, { data: rows }] = await Promise.all([
    supabase.from("rosters").select("id, name, status").order("sort_order", { ascending: true }),
    supabase.from("family_team_settings").select("roster_id, suggestions_on, messages_on"),
  ]);
  if (error) throw new Error(error.message);
  const byId = new Map(((rows ?? []) as any[]).map(r => [r.roster_id, r]));
  return ((teams ?? []) as any[]).filter(t => t.status !== "archived").map(t => ({
    roster_id: t.id, name: t.name,
    suggestions_on: byId.get(t.id)?.suggestions_on ?? true,
    messages_on: byId.get(t.id)?.messages_on ?? false,
  }));
}

export async function saveTeamSetting(s: { roster_id: string; suggestions_on: boolean; messages_on: boolean }): Promise<void> {
  const { error } = await supabase.from("family_team_settings")
    .upsert({ roster_id: s.roster_id, suggestions_on: s.suggestions_on, messages_on: s.messages_on, updated_at: new Date().toISOString() }, { onConflict: "roster_id" });
  if (error) throw new Error(error.message);
}

// ── Little shared bits ────────────────────────────────────────

function localToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Coaches: things waiting in Families (for the tab badge). */
export async function staffFamilyWaiting(): Promise<{ parents: number; signups: number; messages: number }> {
  const [fam, sig, th] = await Promise.all([
    supabase.rpc("staff_families" as any).then(({ data }: any) => ((data ?? []) as any[]).filter(f => f.status === "pending").length, () => 0),
    listSignups(null).then(l => l.filter(s => s.status === "pending").length, () => 0),
    getStaffThreads().then(t => t.reduce((n, x) => n + (x.unread || 0), 0), () => 0),
  ]);
  return { parents: fam, signups: sig, messages: th };
}

export function blankSignup(): SignupDraft {
  return { title: "", details: "", event_date: "", event_time: "", deadline: "", show_names: true, allow_undo: true, location: "", spots: [{ label: "", quantity: 1 }] };
}

export function draftFrom(s: Signup): SignupDraft {
  return {
    id: s.id, roster_id: s.roster_id, title: s.title, details: s.details ?? "",
    event_date: s.event_date ?? "", event_time: (s.event_time ?? "").slice(0, 5), deadline: s.deadline ?? "",
    show_names: s.show_names, allow_undo: s.allow_undo, location: s.location ?? "",
    spots: s.spots.map(sp => ({ id: sp.id, label: sp.label, quantity: sp.quantity })),
  };
}
