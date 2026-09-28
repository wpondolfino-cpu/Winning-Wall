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
//   * { title, message, allPlayers: true }
//       Coaches and admins only.
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
  /** Send to every subscribed player. Coaches and admins only. */
  allPlayers?: boolean;
  /** A fixed notification to coaches, allowed while logged out. */
  notifyStaff?: "reset_request" | "new_signup";
  name?: string;
  role?: string;
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
  let allPlayers = false;

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
    const { data: staff } = await admin.from("profiles").select("id").in("role", ["coach", "admin"]);
    playerIds = (staff ?? []).map((s: any) => s.id);
    if (!playerIds.length) return reply({ sent: false, reason: "no coaches" });
  } else {
    // ── Everything else: signed-in users only ─────────────────
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!user) return reply({ error: "Sign in to send notifications." }, 401);

    if (!body.title || !body.message) return reply({ error: "title and message are required" }, 400);
    title = String(body.title).slice(0, 120);
    message = String(body.message).slice(0, 500);

    if (body.allPlayers) {
      const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
      if (me?.role !== "coach" && me?.role !== "admin") {
        return reply({ error: "Only coaches can notify every player." }, 403);
      }
      allPlayers = true;
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

  if (allPlayers) {
    payload.included_segments = ["Subscribed Users"];
  } else if (playerIds!.length === 1) {
    payload.filters = [{ field: "tag", key: "player_id", relation: "=", value: playerIds![0] }];
  } else {
    // OR together a filter for each player_id
    payload.filters = playerIds!.flatMap((id, i) => {
      const f = [{ field: "tag", key: "player_id", relation: "=", value: id }];
      return i === 0 ? f : [{ operator: "OR" }, ...f];
    });
  }

  try {
    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Key ${ONE_SIGNAL_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) return reply({ error: "OneSignal error", detail: result }, 502);
    return reply({ sent: true, result });
  } catch (e) {
    return reply({ error: "Request failed", detail: String(e) }, 500);
  }
});
