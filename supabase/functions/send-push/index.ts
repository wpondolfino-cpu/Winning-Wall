// supabase/functions/send-push/index.ts
// Shared push-sending function, called from the app right after an action
// (announcement posted, challenge sent, champions crowned...).
//
// Who can send what (the previous version checked nothing, so anyone
// holding the app's public key could push any message and link to every
// player's phone):
//
//   * { notifyStaff: "reset_request" | "new_signup", name, role? }
//       No sign-in needed -- these come from the login screen. The message
//       is fixed; the server finds the coaches and sends it to them.
//   * { title, message, playerIds }
//       Any signed-in user (a challenge notifies its opponent, etc.), but
//       only people on a team the sender is on: anyone else in the list is
//       dropped, so nobody can push to another school's players or coaches.
//       The platform admin can reach anyone.
//   * { drillSent: { drillId, programIds } }
//       After a coach sends a drill to other teams at their school (SQL
//       218): the server checks the send really happened (this sender, this
//       drill, those teams, the last 10 minutes) and tells those teams'
//       coaches. The wording is fixed.
//   * Parent portal (SQL 222), all fixed text built here:
//     { familyRequest: { linkId } }        a parent just asked to follow a
//                                           player -> that program's coaches
//     { absenceReported: { absenceIds } }   a parent reported an absence
//                                           -> that program's coaches
//     { parentAnnouncement: { announcementId } }  a coach's announcement for
//                                           parents -> approved parents of
//                                           players on its teams
//     { scheduleChanged: { itemId } }       a coach moved or cancelled a
//                                           practice, game or event -> parents
//                                           of players on its teams
//   * Parent portal phase 2 (SQL 223), fixed text too:
//     { signupSuggested: { signupId } }  a family suggested a sign-up -> coaches
//     { signupOpened: { signupId } }     a coach opened or approved one -> the
//                                         team's parents (and the family who
//                                         suggested it)
//     { signupUpdate: { updateId } }     organizer's update -> families signed up
//     { signupReminder: { signupId } }   organizer or coach, at most every 12
//                                         hours: signed-up families get "you're
//                                         signed up", the rest "spots left"
//     { familyMessage: { messageId } }   family message -> the staff, or a
//                                         coach's reply -> that family. The
//                                         text never includes the message.
//     Each is checked against what really happened in the last few minutes
//     (this user made that request / report / announcement / change).
//   * { title, message, allPlayers: true }
//       Coaches of the program you're in (or the platform admin). Reaches
//       every active member of THAT program only (migration 186) --
//       before programs, it reached every device in the app.
//   * { title, message, programIds: [...] }
//       Platform admin only: every active member of the chosen programs.
//   * { title, message, allPrograms: true }
//       Platform admin only: every active member of every program
//       (announcements posted to every program).
//   * url: only links into the app are kept; anything else is replaced
//     with the app's address.
//
// Deploy: supabase functions deploy send-push
//
// Required env vars (Project Settings → Edge Functions → Secrets):
//   ONE_SIGNAL_APP_ID   — same App ID used in index.html
//   ONE_SIGNAL_API_KEY  — your OneSignal REST API key. Must be a "rich"
//                         key (starts with os_v2_app_...) from
//                         Dashboard → Settings → Keys & IDs. Legacy keys
//                         stopped working in 2026.
// SUPABASE_URL and the server key are provided automatically.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// The server key. Prefers the new secret key (Settings > API Keys >
// "Publishable and secret API keys"), falling back to the legacy
// service_role key while that's still switched on.
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys?.default === "string" && keys.default) return keys.default;
  } catch { /* not set */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const ONE_SIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID")!;
const ONE_SIGNAL_API_KEY = Deno.env.get("ONE_SIGNAL_API_KEY")!;
const APP_URL = "https://attleborowinningwall.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface SendPushBody {
  title?: string;
  message?: string;
  url?: string;
  /** Send to these player_id tag values specifically. */
  playerIds?: string[];
  /** Send to every member of the program you're in. Its coaches only. */
  allPlayers?: boolean;
  /** Send to every member of every program. Platform admin only. */
  allPrograms?: boolean;
  /** Send to every member of these programs. Platform admin only. */
  programIds?: string[];
  /** A fixed notification to coaches, allowed while logged out. */
  notifyStaff?: "reset_request" | "new_signup";
  name?: string;
  role?: string;
  /** new_signup: the team code typed at signup, so only that program's coaches hear about it. */
  joinCode?: string;
  /** A drill was just sent to these teams at the sender's school: tell their coaches. */
  drillSent?: { drillId?: string; programIds?: string[] };
  /** Parent portal (SQL 222). */
  familyRequest?: { linkId?: string };
  absenceReported?: { absenceIds?: string[] };
  parentAnnouncement?: { announcementId?: string };
  scheduleChanged?: { itemId?: string };
  signupSuggested?: { signupId?: string };
  signupOpened?: { signupId?: string };
  signupUpdate?: { updateId?: string };
  signupReminder?: { signupId?: string };
  familyMessage?: { messageId?: string };
}

/** "Tue, Dec 2" and "5:30 PM" for notification text. */
function shortDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00Z");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function shortTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** A name typed on the login screen: plain text, short. */
function cleanName(s: unknown): string {
  return String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "Someone";
}

/** Keeps links inside the app. */
function safeUrl(url: unknown): string {
  if (typeof url !== "string" || !url) return APP_URL;
  if (url.startsWith("/")) return APP_URL + url;
  return url.startsWith(APP_URL) ? url : APP_URL;
}

/** One fixed notification to these accounts (used where one request sends
 *  two different messages, like sign-up reminders). */
async function sendOneSignal(ids: string[], title: string, message: string, url: string): Promise<void> {
  for (let i = 0; i < ids.length; i += 2000) {
    await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { "Authorization": `Key ${ONE_SIGNAL_API_KEY}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        app_id: ONE_SIGNAL_APP_ID, target_channel: "push",
        headings: { en: title }, contents: { en: message }, url: safeUrl(url),
        include_aliases: { external_id: ids.slice(i, i + 2000) },
      }),
    }).catch(() => {});
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  let body: SendPushBody;
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON body" }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());

  let title: string;
  let message: string;
  let playerIds: string[] | undefined;

  if (body.notifyStaff) {
    // ── Login-screen notifications: fixed text, coaches only ──
    const name = cleanName(body.name);
    if (body.notifyStaff === "reset_request") {
      title = "🔑 Password reset requested";
      message = `${name} requested a password reset.`;
    } else if (body.notifyStaff === "new_signup") {
      const role = body.role === "coach" ? "coach" : "player";
      title = "🆕 New signup needs approval";
      message = `${name} signed up as a ${role} and is waiting for approval.`;
    } else {
      return reply({ error: "Unknown notification" }, 400);
    }
    // A signup goes to the coaches of the program its team code points to
    // (migration 179) -- never to every coach in the app; one with no valid
    // code goes to the platform admin. Password reset requests still go to
    // every coach until notifications are split by program.
    let staffIds: string[] = [];
    const code = typeof body.joinCode === "string" ? body.joinCode.trim().toUpperCase() : "";
    if (body.notifyStaff === "new_signup" && code) {
      const { data: prog } = await admin.from("programs").select("id").eq("join_code", code).maybeSingle();
      if (prog) {
        const { data: staff } = await admin.from("program_members").select("user_id")
          .eq("program_id", prog.id).eq("status", "active").in("role", ["head_coach", "coach"]).eq("is_test", false);
        staffIds = (staff ?? []).map((s: any) => s.user_id);
      }
    }
    if (body.notifyStaff === "reset_request") {
      const { data: staff } = await admin.from("profiles").select("id").in("role", ["coach", "admin"]);
      staffIds = (staff ?? []).map((s: any) => s.id);
    } else if (!staffIds.length) {
      const { data: pas } = await admin.from("platform_admins").select("user_id");
      staffIds = (pas ?? []).map((s: any) => s.user_id);
    }
    playerIds = staffIds;
    if (!playerIds.length) return reply({ sent: false, reason: "no coaches" });
  } else {
    // ── Everything else: signed-in users only ─────────────────
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!user) return reply({ error: "Sign in to send notifications." }, 401);

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const staffOf = async (programId: string) => {
      const { data } = await admin.from("program_members").select("user_id")
        .eq("program_id", programId).eq("status", "active").in("role", ["head_coach", "coach"]).eq("is_test", false);
      return [...new Set<string>((data ?? []).map((m: any) => m.user_id))];
    };
    const isStaffOf = async (programId: string) => {
      const { data: m } = await admin.from("program_members").select("role").eq("program_id", programId)
        .eq("user_id", user.id).eq("status", "active").maybeSingle();
      if (m?.role === "head_coach" || m?.role === "coach") return true;
      const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
      return !!pa;
    };
    /** Approved parents of players on these teams (no teams = every team). */
    const parentsOf = async (programId: string, rosterIds: string[]) => {
      const { data: links } = await admin.from("family_links").select("parent_id, player_id").eq("program_id", programId).eq("status", "active");
      const rows = (links ?? []) as { parent_id: string; player_id: string }[];
      if (!rosterIds.length) return [...new Set(rows.map((r) => r.parent_id))];
      const { data: kids } = rows.length
        ? await admin.from("profiles").select("id, home_roster_id").in("id", [...new Set(rows.map((r) => r.player_id))])
        : { data: [] };
      const onTeam = new Set(((kids ?? []) as any[]).filter((k) => rosterIds.includes(k.home_roster_id)).map((k) => k.id));
      return [...new Set(rows.filter((r) => onTeam.has(r.player_id)).map((r) => r.parent_id))];
    };

    if (body.familyRequest) {
      const { data: link } = await admin.from("family_links").select("program_id, player_id, created_at")
        .eq("id", String(body.familyRequest.linkId ?? "")).eq("parent_id", user.id).gte("created_at", tenMinAgo).maybeSingle();
      if (!link) return reply({ error: "No matching request." }, 403);
      const [{ data: me }, { data: kid }] = await Promise.all([
        admin.from("profiles").select("name").eq("id", user.id).maybeSingle(),
        admin.from("profiles").select("name").eq("id", link.player_id).maybeSingle(),
      ]);
      playerIds = await staffOf(link.program_id);
      if (!playerIds.length) return reply({ sent: false, reason: "no coaches" });
      title = "👪 Parent waiting for approval";
      message = `${cleanName(me?.name)} asked to follow ${cleanName(kid?.name)}. Approve them in Announcements → Families.`;
      body.url = "/?tab=announcements&sub=families";
    } else if (body.absenceReported) {
      const ids = (body.absenceReported.absenceIds ?? []).filter((x) => typeof x === "string").slice(0, 20);
      const { data: rows } = ids.length
        ? await admin.from("parent_absences").select("program_id, player_id, item_label, item_date, reason")
            .in("id", ids).eq("parent_id", user.id).gte("created_at", tenMinAgo)
        : { data: [] };
      const list = (rows ?? []) as any[];
      if (!list.length) return reply({ error: "No matching report." }, 403);
      const { data: kid } = await admin.from("profiles").select("name").eq("id", list[0].player_id).maybeSingle();
      playerIds = await staffOf(list[0].program_id);
      if (!playerIds.length) return reply({ sent: false, reason: "no coaches" });
      const what = list.map((r) => `${r.item_label ?? "practice"} ${shortDate(r.item_date)}`).join(", ");
      title = "📝 Absence reported";
      message = `${cleanName(kid?.name)} will miss ${what} (${String(list[0].reason).slice(0, 40)}).`;
      body.url = "/?tab=announcements&sub=families";
    } else if (body.parentAnnouncement) {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: a } = await admin.from("announcements").select("program_id, message, audience, roster_ids, is_pinned")
        .eq("id", String(body.parentAnnouncement.announcementId ?? "")).gte("created_at", since).maybeSingle();
      if (!a || !["parents", "both"].includes(a.audience)) return reply({ error: "No matching announcement." }, 403);
      if (!(await isStaffOf(a.program_id))) return reply({ error: "Only coaches can notify parents." }, 403);
      playerIds = await parentsOf(a.program_id, (a.roster_ids ?? []) as string[]);
      if (!playerIds.length) return reply({ sent: false, reason: "no parents linked yet" });
      const { data: prog } = await admin.from("programs").select("name").eq("id", a.program_id).maybeSingle();
      title = `${a.is_pinned ? "📌" : "📢"} ${prog?.name ?? "Your team"}`;
      message = String(a.message).slice(0, 500);
      body.url = "/";
    } else if (body.scheduleChanged) {
      const { data: c } = await admin.from("schedule_changes").select("*")
        .eq("item_id", String(body.scheduleChanged.itemId ?? "")).eq("changed_by", user.id).gte("changed_at", tenMinAgo)
        .order("changed_at", { ascending: false }).limit(1).maybeSingle();
      if (!c || !c.program_id) return reply({ error: "No matching change." }, 403);
      if (!(await isStaffOf(c.program_id))) return reply({ error: "Only coaches can notify parents." }, 403);
      if (c.label === "Tryout") return reply({ sent: false, reason: "tryouts aren't shown to families" });
      playerIds = await parentsOf(c.program_id, (c.roster_ids ?? []) as string[]);
      if (!playerIds.length) return reply({ sent: false, reason: "no parents linked yet" });
      const label = c.label ?? "Practice";
      if (c.change === "cancelled") {
        title = "❌ Schedule change";
        message = `${label} on ${shortDate(c.old_date)}${c.old_time ? ` at ${shortTime(c.old_time)}` : ""} is cancelled.`;
      } else if (c.change === "moved") {
        title = "📅 Schedule change";
        message = `${label} ${shortDate(c.old_date)} is now ${shortDate(c.new_date)}${c.new_time ? ` at ${shortTime(c.new_time)}` : ""}.`;
      } else {
        title = "📍 New location";
        message = `${label} on ${shortDate(c.new_date)} is now at ${String(c.new_place ?? "").slice(0, 80)}.`;
      }
      body.url = "/";
    } else if (body.signupSuggested) {
      const { data: su } = await admin.from("family_signups").select("program_id, title, organizer_player_id")
        .eq("id", String(body.signupSuggested.signupId ?? "")).eq("organizer_id", user.id).eq("status", "pending")
        .gte("created_at", tenMinAgo).maybeSingle();
      if (!su) return reply({ error: "No matching sign-up." }, 403);
      const { data: kid } = await admin.from("profiles").select("name").eq("id", su.organizer_player_id).maybeSingle();
      playerIds = await staffOf(su.program_id);
      if (!playerIds.length) return reply({ sent: false, reason: "no coaches" });
      title = "🙋 Sign-up to approve";
      message = `${cleanName(kid?.name)}'s family suggested "${String(su.title).slice(0, 80)}". Approve it in Announcements → Families.`;
      body.url = "/?tab=announcements&sub=families";
    } else if (body.signupOpened) {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: su } = await admin.from("family_signups")
        .select("program_id, roster_id, title, event_date, organizer_id, organizer_is_parent, approved_at, status")
        .eq("id", String(body.signupOpened.signupId ?? "")).eq("status", "open").gte("approved_at", since).maybeSingle();
      if (!su) return reply({ error: "No matching sign-up." }, 403);
      if (!(await isStaffOf(su.program_id))) return reply({ error: "Only coaches can do that." }, 403);
      playerIds = (await parentsOf(su.program_id, su.roster_id ? [su.roster_id] : [])).filter((id) => id !== user.id);
      if (su.organizer_is_parent && su.organizer_id && !playerIds.includes(su.organizer_id)) playerIds.push(su.organizer_id);
      if (!playerIds.length) return reply({ sent: false, reason: "no parents linked yet" });
      title = "🙋 New sign-up";
      message = `${String(su.title).slice(0, 80)}${su.event_date ? ` (${shortDate(su.event_date)})` : ""}. Tap to see the spots.`;
      body.url = "/?ptab=signups";
    } else if (body.signupUpdate) {
      const { data: u } = await admin.from("family_signup_updates").select("signup_id, message")
        .eq("id", String(body.signupUpdate.updateId ?? "")).eq("author_id", user.id).gte("created_at", tenMinAgo).maybeSingle();
      if (!u) return reply({ error: "No matching update." }, 403);
      const [{ data: su }, { data: claims }] = await Promise.all([
        admin.from("family_signups").select("title, organizer_id").eq("id", u.signup_id).maybeSingle(),
        admin.from("family_signup_claims").select("parent_id").eq("signup_id", u.signup_id),
      ]);
      playerIds = [...new Set<string>([...((claims ?? []) as any[]).map((c) => c.parent_id), ...(su?.organizer_id ? [su.organizer_id] : [])])]
        .filter((id) => id !== user.id);
      if (!playerIds.length) return reply({ sent: false, reason: "nobody signed up yet" });
      title = `📣 ${String(su?.title ?? "Sign-up").slice(0, 60)}`;
      message = String(u.message).slice(0, 300);
      body.url = "/?ptab=signups";
    } else if (body.signupReminder) {
      const sid = String(body.signupReminder.signupId ?? "");
      const { data: su } = await admin.from("family_signups")
        .select("id, program_id, roster_id, title, event_date, event_time, deadline, status, organizer_id, last_reminded_at")
        .eq("id", sid).maybeSingle();
      if (!su || !["open", "closed"].includes(su.status)) return reply({ error: "No matching sign-up." }, 403);
      if (su.organizer_id !== user.id && !(await isStaffOf(su.program_id))) return reply({ error: "Only the organizer or a coach can send reminders." }, 403);
      if (su.last_reminded_at && Date.now() - new Date(su.last_reminded_at).getTime() < 12 * 3600 * 1000) {
        return reply({ sent: false, reason: "A reminder already went out in the last 12 hours." });
      }
      const [{ data: claims }, { data: spots }] = await Promise.all([
        admin.from("family_signup_claims").select("parent_id, spot_id, qty").eq("signup_id", su.id),
        admin.from("family_signup_spots").select("id, quantity").eq("signup_id", su.id),
      ]);
      const cl = (claims ?? []) as any[];
      const signed = [...new Set<string>(cl.map((c) => c.parent_id))].filter((id) => id !== user.id);
      const left = ((spots ?? []) as any[]).reduce((n, sp) => n + Math.max(0, sp.quantity - cl.filter((c) => c.spot_id === sp.id).reduce((a, c) => a + c.qty, 0)), 0);
      const today = new Date().toISOString().slice(0, 10);
      const stillOpen = su.status === "open" && today <= String(su.deadline ?? su.event_date ?? today) && left > 0;
      const others = stillOpen
        ? (await parentsOf(su.program_id, su.roster_id ? [su.roster_id] : [])).filter((id) => id !== user.id && !signed.includes(id))
        : [];
      if (!signed.length && !others.length) return reply({ sent: false, reason: "nobody to remind" });
      await admin.from("family_signups").update({ last_reminded_at: new Date().toISOString() }).eq("id", su.id);
      const when = su.event_date ? ` ${shortDate(su.event_date)}${su.event_time ? ` at ${shortTime(su.event_time)}` : ""}` : "";
      const name = String(su.title).slice(0, 80);
      let sentTo = 0;
      if (signed.length) {
        await sendOneSignal(signed, "⏰ Reminder", `You're signed up for ${name}${when}.`, "/?ptab=signups");
        sentTo += signed.length;
      }
      if (others.length) {
        await sendOneSignal(others, "🙋 Spots still open", `${name}${when}: ${left} spot${left === 1 ? "" : "s"} left${su.deadline ? `, sign up by ${shortDate(su.deadline)}` : ""}.`, "/?ptab=signups");
        sentTo += others.length;
      }
      return reply({ sent: true, people: sentTo });
    } else if (body.familyMessage) {
      const { data: m } = await admin.from("family_messages").select("thread_id, program_id, author_kind, author_name")
        .eq("id", String(body.familyMessage.messageId ?? "")).eq("author_id", user.id).gte("created_at", tenMinAgo).maybeSingle();
      if (!m) return reply({ error: "No matching message." }, 403);
      const { data: th } = await admin.from("family_threads").select("player_id").eq("id", m.thread_id).maybeSingle();
      const { data: kid } = await admin.from("profiles").select("name").eq("id", th?.player_id ?? "").maybeSingle();
      const first = cleanName(kid?.name).split(/\s+/)[0] || "your player";
      if (m.author_kind === "parent") {
        playerIds = (await staffOf(m.program_id)).filter((id) => id !== user.id);
        title = "💬 Family message";
        message = `New message from ${first}'s family. Open Announcements → Families → Messages.`;
        body.url = "/?tab=announcements&sub=families";
      } else {
        const { data: links } = await admin.from("family_links").select("parent_id")
          .eq("player_id", th?.player_id ?? "").eq("program_id", m.program_id).eq("status", "active");
        playerIds = [...new Set<string>(((links ?? []) as any[]).map((l) => l.parent_id))];
        title = "💬 Message from the coaches";
        message = `${cleanName(m.author_name) || "A coach"} replied about ${first}.`;
        body.url = "/?ptab=messages";
      }
      if (!playerIds.length) return reply({ sent: false, reason: "nobody to notify" });
    } else if (body.drillSent) {
      // ── A drill sent to other teams: fixed text, checked against the send ──
      const drillId = typeof body.drillSent.drillId === "string" ? body.drillSent.drillId : "";
      const wanted = (body.drillSent.programIds ?? []).filter((x) => typeof x === "string").slice(0, 50);
      if (!drillId || !wanted.length) return reply({ error: "drillId and programIds are required" }, 400);
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: sends } = await admin.from("drill_sends").select("to_program, from_program")
        .eq("drill_id", drillId).eq("from_user", user.id).in("to_program", wanted).gte("created_at", since);
      const teams = [...new Set<string>((sends ?? []).map((r: any) => r.to_program))];
      if (!teams.length) return reply({ error: "No matching send." }, 403);
      const [{ data: drill }, { data: from }] = await Promise.all([
        admin.from("practice_drills_library").select("title").eq("id", drillId).maybeSingle(),
        admin.from("programs").select("name").eq("id", (sends as any[])[0].from_program).maybeSingle(),
      ]);
      const { data: staff } = await admin.from("program_members").select("user_id")
        .in("program_id", teams).eq("status", "active").in("role", ["head_coach", "coach"]).eq("is_test", false);
      playerIds = [...new Set<string>((staff ?? []).map((m: any) => m.user_id))].filter((id) => id !== user.id);
      if (!playerIds.length) return reply({ sent: false, reason: "no coaches on those teams yet" });
      title = `📨 New drill from ${from?.name ?? "another team"}`;
      message = `"${drill?.title ?? "A drill"}" was sent to your team. Add it from your Drill Library.`;
      body.url = "/?tab=practicelibrary";
    } else {

    if (!body.title || !body.message) return reply({ error: "title and message are required" }, 400);
    title = String(body.title).slice(0, 120);
    message = String(body.message).slice(0, 500);

    const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const isPlatformAdmin = !!pa;

    if (body.allPrograms || Array.isArray(body.programIds)) {
      if (!isPlatformAdmin) return reply({ error: "Only the platform admin can notify several programs." }, 403);
      const { data: progs } = await admin.from("programs").select("id, is_active");
      const wanted = Array.isArray(body.programIds) ? new Set(body.programIds.filter((x) => typeof x === "string")) : null;
      const ids = (progs ?? []).filter((p: any) => p.is_active !== false && (!wanted || wanted.has(p.id))).map((p: any) => p.id);
      const { data: members } = ids.length
        ? await admin.from("program_members").select("user_id").in("program_id", ids).eq("status", "active")
        : { data: [] };
      playerIds = [...new Set<string>((members ?? []).map((m: any) => m.user_id))];
      if (!playerIds.length) return reply({ sent: false, reason: "nobody in any program yet" });
    } else if (body.allPlayers) {
      // The program the sender is in right now.
      const { data: me } = await admin.from("profiles").select("active_program_id").eq("id", user.id).single();
      const programId = me?.active_program_id as string | null;
      if (!programId) return reply({ error: "Pick a program first." }, 400);
      const { data: mine } = await admin.from("program_members").select("role")
        .eq("program_id", programId).eq("user_id", user.id).eq("status", "active").maybeSingle();
      const isStaff = mine?.role === "head_coach" || mine?.role === "coach";
      if (!isStaff && !isPlatformAdmin) {
        return reply({ error: "Only coaches can notify every player." }, 403);
      }
      const { data: members } = await admin.from("program_members").select("user_id")
        .eq("program_id", programId).eq("status", "active");
      playerIds = [...new Set<string>((members ?? []).map((m: any) => m.user_id))];
      if (!playerIds.length) return reply({ sent: false, reason: "nobody in this program yet" });
    } else {
      playerIds = (body.playerIds ?? []).filter((id) => typeof id === "string").slice(0, 500);
      if (!playerIds.length) return reply({ error: "Provide playerIds or set allPlayers: true" }, 400);
      // Only people on a team the sender is on (players reach teammates and
      // their coaches; coaches reach their own people). Anyone else is dropped.
      if (!isPlatformAdmin) {
        const { data: mine } = await admin.from("program_members").select("program_id")
          .eq("user_id", user.id).eq("status", "active");
        const myTeams = [...new Set<string>((mine ?? []).map((m: any) => m.program_id))];
        const { data: theirs } = myTeams.length
          ? await admin.from("program_members").select("user_id").in("program_id", myTeams).in("user_id", playerIds).eq("status", "active")
          : { data: [] };
        const allowed = new Set<string>((theirs ?? []).map((m: any) => m.user_id));
        playerIds = playerIds.filter((id) => allowed.has(id));
        if (!playerIds.length) return reply({ error: "You can only notify people on your own team." }, 403);
      }
    }
    }
  }

  const payload: Record<string, unknown> = {
    app_id: ONE_SIGNAL_APP_ID,
    target_channel: "push",
    headings: { en: title },
    contents: { en: message },
    url: safeUrl(body.url),
  };

  // Every device signed into these accounts (OneSignal external ID = our
  // user id, set by the app at sign-in; cleared at sign-out). OneSignal
  // takes up to 2,000 ids per notification, so big audiences go in batches.
  const ids = playerIds ?? [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 2000) batches.push(ids.slice(i, i + 2000));

  try {
    let recipients = 0;
    let skipped = 0;
    let created = 0;
    let last: any = null;
    const reasons: string[] = [];
    for (const batch of batches) {
      const res = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Authorization": `Key ${ONE_SIGNAL_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ ...payload, include_aliases: { external_id: batch } }),
      });
      const result = await res.json();
      if (!res.ok) return reply({ error: "OneSignal error", detail: result }, 502);
      last = result;
      // OneSignal answers 200 even when nobody received it. If it created a
      // notification (has an id) it was sent; `errors` may still list
      // accounts it skipped (invalid_aliases = never turned on push). With
      // no id, nobody got it, and `errors` says why -- e.g. "All included
      // players are not subscribed".
      const errs = result?.errors;
      const invalid = errs && typeof errs === "object" && !Array.isArray(errs)
        ? (errs.invalid_aliases?.external_id ?? []) : [];
      if (result?.id) {
        created++;
        skipped += Array.isArray(invalid) ? invalid.length : 0;
        if (typeof result?.recipients === "number") recipients += result.recipients;
      } else {
        const why = Array.isArray(errs) ? errs.join("; ") : errs && typeof errs === "object" ? JSON.stringify(errs) : null;
        reasons.push(why ?? "No notification was created");
      }
    }
    if (created === 0) {
      // Usually: nobody in the audience has turned on notifications yet.
      const plain = reasons.every((r) => r.includes("invalid_aliases") || r.toLowerCase().includes("not subscribed"))
        ? `none of the ${ids.length} account${ids.length === 1 ? "" : "s"} it went to ${ids.length === 1 ? "has" : "have"} notifications turned on yet`
        : reasons.join("; ") || "No notification was created";
      return reply({ sent: false, reason: plain, result: last });
    }
    return reply({ sent: true, skipped, result: { ...last, recipients } });
  } catch (e) {
    return reply({ error: "Request failed", detail: String(e) }, 500);
  }
});
