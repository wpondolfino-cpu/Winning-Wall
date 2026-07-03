// supabase/functions/send-push/index.ts
// Shared push-sending function — called by other Edge Functions (cron jobs)
// or directly from the client (supabase.functions.invoke) right after an
// action happens (announcement posted, challenge sent, etc).
//
// Deploy: supabase functions deploy send-push
//
// Required env vars (Project Settings → Edge Functions → Secrets):
//   ONE_SIGNAL_APP_ID   — same App ID used in index.html
//   ONE_SIGNAL_API_KEY  — your OneSignal REST API key. Must be a "rich"
//                         key (starts with os_v2_app_...) from
//                         Dashboard → Settings → Keys & IDs. Legacy keys
//                         stopped working in 2026.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ONE_SIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID")!;
const ONE_SIGNAL_API_KEY = Deno.env.get("ONE_SIGNAL_API_KEY")!;

interface SendPushBody {
  title: string;
  message: string;
  url?: string;
  /** Send to these player_id tag values specifically. */
  playerIds?: string[];
  /** Send to every subscribed player. */
  allPlayers?: boolean;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  let body: SendPushBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { title, message, url, playerIds, allPlayers } = body;

  if (!title || !message) {
    return new Response(JSON.stringify({ error: "title and message are required" }), { status: 400 });
  }
  if (!allPlayers && (!playerIds || playerIds.length === 0)) {
    return new Response(JSON.stringify({ error: "Provide playerIds or set allPlayers: true" }), { status: 400 });
  }

  const payload: Record<string, unknown> = {
    app_id: ONE_SIGNAL_APP_ID,
    target_channel: "push",
    headings: { en: title },
    contents: { en: message },
    url: url ?? "https://attleborowinningwall.vercel.app",
  };

  if (allPlayers) {
    payload.included_segments = ["Subscribed Users"];
  } else if (playerIds && playerIds.length === 1) {
    payload.filters = [{ field: "tag", key: "player_id", relation: "=", value: playerIds[0] }];
  } else if (playerIds) {
    // OR together a filter for each player_id
    payload.filters = playerIds.flatMap((id, i) => {
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

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "OneSignal error", detail: result }), { status: 502 });
    }

    return new Response(JSON.stringify({ sent: true, result }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Request failed", detail: String(e) }), { status: 500 });
  }
});
