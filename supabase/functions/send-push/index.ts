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
//       Any signed-in user (a challenge notifies its opponent, etc.).
//       Reaches every device signed into those accounts.
//   * { title, message, allPlayers: true }
//       Coaches of the program you're in (or the platform admin). Reaches
//       every active member of THAT program only (migration 186) --
//       before programs, it reached every device in the app.
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
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  /** A fixed notification to coaches, allowed while logged out. */
  notifyStaff?: "reset_request" | "new_signup";
  name?: string;
  role?: string;
  /** new_signup: the team code typed at signup, so only that program's coaches hear about it. */
  joinCode?: string;
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  let body: SendPushBody;
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON body" }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

    if (!body.title || !body.message) return reply({ error: "title and message are required" }, 400);
    title = String(body.title).slice(0, 120);
    message = String(body.message).slice(0, 500);

    const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const isPlatformAdmin = !!pa;

    if (body.allPrograms) {
      if (!isPlatformAdmin) return reply({ error: "Only the platform admin can notify every program." }, 403);
      const { data: progs } = await admin.from("programs").select("id, is_active");
      const ids = (progs ?? []).filter((p: any) => p.is_active !== false).map((p: any) => p.id);
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
