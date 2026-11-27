// src/lib/family.ts
// Parent portal, phase 1 (SQL 222 + edge function family-invite).
//
// Parents are never members of a program, so none of the team's tables are
// open to them. Everything a parent sees comes through the parent_*
// functions, which check that they're an approved parent of that child.
import { supabase } from "./supabase";

// ── Types ─────────────────────────────────────────────────────

export interface ParentChild {
  player_id: string;
  name: string;
  status: "pending" | "active";
  program_id: string;
  program_name: string;
  team_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
}

export type FamilyItemKind = "practice" | "game" | "event";

export interface FamilyScheduleItem {
  kind: FamilyItemKind;
  id: string;
  item_date: string;          // yyyy-mm-dd
  start_time: string | null;  // HH:MM:SS
  end_time: string | null;
  title: string;
  location: string | null;
  bus_time: string | null;
  home_away: string | null;
  note: string | null;
  /** Set when a parent reported this one. */
  absence_reason: string | null;
  /** Changed in the last week: "moved" or "place". */
  changed: "moved" | "place" | null;
  old_date: string | null;
  old_time: string | null;
}

export interface FamilyCancellation {
  kind: FamilyItemKind;
  item_id: string;
  label: string;
  old_date: string;
  old_time: string | null;
  changed_at: string;
}

export interface FamilyAnnouncement {
  id: string;
  message: string;
  coach_name: string | null;
  is_pinned: boolean;
  created_at: string;
  read: boolean;
}

export interface StaffFamily {
  link_id: string;
  status: "pending" | "active";
  relation: string | null;
  created_at: string;
  approved_at: string | null;
  parent_id: string;
  parent_name: string | null;
  parent_email: string | null;
  player_id: string;
  player_name: string | null;
  roster_id: string | null;
  team_name: string | null;
}

export interface StaffAbsence {
  id: string;
  player_id: string;
  player_name: string | null;
  roster_id: string | null;
  parent_name: string | null;
  item_kind: FamilyItemKind;
  item_id: string;
  item_date: string;
  item_label: string | null;
  reason: string;
  note: string | null;
  created_at: string;
  seen_at: string | null;
}

export const ABSENCE_REASONS = ["Illness", "Appointment", "Family", "School", "Other"] as const;

export type Audience = "players" | "parents" | "both";

// ── Helpers ───────────────────────────────────────────────────

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as any, args as any);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Fire-and-forget push; the thing it's about already happened. */
function push(body: Record<string, unknown>) {
  supabase.functions.invoke("send-push", { body }).catch(() => {});
}

export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return "";
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${ap}`;
}

export function formatDay(d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString(undefined, opts);
}

export function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export function mapsUrl(place: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
}

/** An .ics file for one item, so a parent can add it to their calendar. */
export function icsFor(item: FamilyScheduleItem, childName: string): string {
  const [y, mo, d] = item.item_date.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Winning Wall//Family//EN", "BEGIN:VEVENT",
    `UID:${item.id}@winningwall`, `DTSTAMP:${stamp}`];
  const start = item.kind === "game" && item.home_away === "away" && item.bus_time ? item.bus_time : item.start_time;
  if (start) {
    const [h, m] = start.split(":").map(Number);
    const local = (yy: number, mm: number, dd: number, hh: number, mi: number) => `${yy}${pad(mm)}${pad(dd)}T${pad(hh)}${pad(mi)}00`;
    lines.push(`DTSTART:${local(y, mo, d, h, m)}`);
    let endH = h + (item.kind === "game" ? 2 : 2), endM = m;
    if (item.end_time) { const [eh, em] = item.end_time.split(":").map(Number); endH = eh; endM = em; }
    lines.push(`DTEND:${local(y, mo, d, Math.min(endH, 23), endM)}`);
  } else {
    const next = new Date(y, mo - 1, d + 1);
    lines.push(`DTSTART;VALUE=DATE:${y}${pad(mo)}${pad(d)}`, `DTEND;VALUE=DATE:${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`);
  }
  lines.push(`SUMMARY:${esc(`${childName}: ${item.title}`)}`);
  if (item.location) lines.push(`LOCATION:${esc(item.location)}`);
  const desc = [item.kind === "game" && item.bus_time ? `Bus ${formatTime(item.bus_time)}` : "", item.note ?? ""].filter(Boolean).join(" · ");
  if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(item: FamilyScheduleItem, childName: string) {
  const blob = new Blob([icsFor(item, childName)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${item.title.replace(/[^\w ]+/g, "").trim() || "event"}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Invite links (?family=TOKEN) ──────────────────────────────

export function familyLink(token: string): string {
  return `${window.location.origin}/?family=${token}`;
}

export function readFamilyToken(): string | null {
  try {
    const t = new URLSearchParams(window.location.search).get("family");
    return t && /^[A-Za-z0-9_-]{30,80}$/.test(t) ? t : null;
  } catch { return null; }
}

export function clearFamilyParam(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("family");
    window.history.replaceState(window.history.state, document.title, url.pathname + url.search + url.hash);
  } catch { /* leave it */ }
}

/** The player (or their coach) gets the family link. Reuses a fresh one. */
export async function createFamilyInvite(playerId: string): Promise<string> {
  const token = await rpc<string>("create_family_invite", { p_player: playerId });
  return familyLink(token);
}

export interface FamilyInviteLookup {
  status: "open" | "expired" | "revoked" | "missing";
  program_name?: string | null;
  child?: string;
  team?: string | null;
  program?: { name: string; school: string | null; logo_url: string | null; primary_color: string | null; accent_color: string | null };
  caller_role?: string | null;
}

async function inviteCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("family-invite", { body });
  if (error) {
    let detail = error.message;
    try { const b = await (error as any).context?.json?.(); if (b?.error) detail = b.error; } catch { /* keep */ }
    throw new Error(detail);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export function lookupFamilyInvite(token: string): Promise<FamilyInviteLookup> {
  return inviteCall({ action: "lookup", token });
}

/** New parent: name, email, password. Signed-in parent: just the token. */
export async function acceptFamilyInvite(token: string, account?: { name: string; email: string; password: string }):
  Promise<{ ok: true; link_id: string | null; status: string; child: string }> {
  const r = await inviteCall<{ ok: true; link_id: string | null; status: string; child: string }>({ action: "accept", token, ...(account ?? {}) });
  return r;
}

/** After signing in (a new account signs in right after accepting): tell the coaches. */
export function notifyFamilyRequest(linkId: string | null) {
  if (linkId) push({ familyRequest: { linkId } });
}

// ── Parent side ───────────────────────────────────────────────

export async function getParentChildren(): Promise<ParentChild[]> {
  return (await rpc<ParentChild[]>("parent_children")) ?? [];
}

export async function getParentSchedule(playerId: string, days = 42): Promise<FamilyScheduleItem[]> {
  return (await rpc<FamilyScheduleItem[]>("parent_schedule", { p_player: playerId, p_days: days })) ?? [];
}

export async function getParentCancellations(playerId: string): Promise<FamilyCancellation[]> {
  return (await rpc<FamilyCancellation[]>("parent_cancellations", { p_player: playerId })) ?? [];
}

export async function getParentAnnouncements(playerId: string): Promise<FamilyAnnouncement[]> {
  return (await rpc<FamilyAnnouncement[]>("parent_announcements", { p_player: playerId })) ?? [];
}

export async function markAnnouncementsRead(ids: string[]): Promise<void> {
  if (ids.length) await rpc("parent_mark_read", { p_ids: ids });
}

export async function reportAbsence(playerId: string, items: { kind: FamilyItemKind; id: string }[], reason: string, note: string): Promise<string[]> {
  const ids = (await rpc<string[]>("report_absence", { p_player: playerId, p_items: items, p_reason: reason, p_note: note.trim() || null })) ?? [];
  if (ids.length) push({ absenceReported: { absenceIds: ids } });
  return ids;
}

export async function cancelAbsence(playerId: string, itemId: string): Promise<void> {
  await rpc("cancel_absence", { p_player: playerId, p_item: itemId });
}

// ── Coach side ────────────────────────────────────────────────

export async function getStaffFamilies(): Promise<StaffFamily[]> {
  return (await rpc<StaffFamily[]>("staff_families")) ?? [];
}

export async function getStaffAbsences(daysBack = 7): Promise<StaffAbsence[]> {
  return (await rpc<StaffAbsence[]>("staff_absences", { p_days_back: daysBack })) ?? [];
}

export async function decideFamilyLink(linkId: string, approve: boolean): Promise<void> {
  await rpc("decide_family_link", { p_link: linkId, p_approve: approve });
}

export async function removeFamilyLink(linkId: string): Promise<void> {
  const { error } = await supabase.from("family_links").delete().eq("id", linkId);
  if (error) throw new Error(error.message);
}

export async function markAbsencesSeen(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("parent_absences").update({ seen_at: new Date().toISOString() }).in("id", ids).is("seen_at", null);
  if (error) throw new Error(error.message);
}

export async function announcementParentStats(ids: string[]): Promise<Record<string, { seen: number; total: number }>> {
  if (!ids.length) return {};
  const rows = (await rpc<{ announcement_id: string; seen: number; total: number }[]>("announcement_parent_stats", { p_ids: ids })) ?? [];
  return Object.fromEntries(rows.map(r => [r.announcement_id, { seen: r.seen, total: r.total }]));
}

export function notifyParentAnnouncement(announcementId: string): Promise<{ recipients: number | null; error: string | null }> {
  return supabase.functions.invoke("send-push", { body: { parentAnnouncement: { announcementId } } })
    .then(({ data, error }) => ({ recipients: (data as any)?.result?.recipients ?? null, error: error ? error.message : null }))
    .catch((e: any) => ({ recipients: null, error: e?.message ?? String(e) }));
}
