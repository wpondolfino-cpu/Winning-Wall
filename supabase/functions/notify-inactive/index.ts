// supabase/functions/notify-inactive/index.ts
// Deploy: supabase functions deploy notify-inactive
// Schedule via Supabase Dashboard → Edge Functions → Cron: "0 9 * * *" (9am daily)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY")!;
const ONE_SIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID")!;
const ONE_SIGNAL_API_KEY = Deno.env.get("ONE_SIGNAL_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async () => {
  // 1. Fetch all players inactive for 14+ days
  const { data: inactive, error } = await supabase
    .from("inactive_players")
    .select("*");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!inactive || inactive.length === 0) {
    return new Response(JSON.stringify({ message: "No inactive players." }), { status: 200 });
  }

  const results = [];

  for (const player of inactive) {
    const daysInactive = Math.round(player.days_inactive ?? 99);
    const message = `Hey ${player.name.split(" ")[0]}! You haven't logged a workout in ${daysInactive} days. The offseason leaderboard is heating up — get in the gym and log your scores on AHS Winning Wall! 🏀`;

    // ── Send Email via SendGrid ──────────────────────────────
    try {
      const emailRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: player.email, name: player.name }] }],
          from: { email: "noreply@ahswinningwall.com", name: "AHS Winning Wall" },
          subject: "🏀 Get back in the gym — your teammates are grinding!",
          content: [{
            type: "text/html",
            value: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#111828;color:#e8eaf2;border-radius:16px;overflow:hidden">
                <div style="background:#1a3fa8;padding:24px;text-align:center">
                  <h1 style="font-size:28px;margin:0;letter-spacing:2px;color:#f0c040">AHS WINNING WALL</h1>
                  <p style="color:#93b4ff;margin:4px 0 0;font-size:13px">OFFSEASON TRAINING PLATFORM</p>
                </div>
                <div style="padding:32px 24px">
                  <h2 style="color:#f5f7fc;margin:0 0 12px">Hey ${player.name.split(" ")[0]}! 👋</h2>
                  <p style="color:#b0b8c8;line-height:1.7">${message}</p>
                  <a href="https://ahswinningwall.com" style="display:inline-block;margin-top:24px;background:#1a3fa8;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600">Log My Scores →</a>
                </div>
                <div style="padding:16px 24px;border-top:1px solid rgba(176,184,200,0.15);font-size:12px;color:#7a85a0;text-align:center">
                  AHS Basketball · Offseason ${new Date().getFullYear()}
                </div>
              </div>
            `,
          }],
        }),
      });
      results.push({ player: player.name, email: emailRes.ok ? "sent" : "failed" });
    } catch (e) {
      results.push({ player: player.name, email: "error", detail: String(e) });
    }

    // ── Send Push via OneSignal ──────────────────────────────
    try {
      const pushRes = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Authorization": `Key ${ONE_SIGNAL_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          app_id: ONE_SIGNAL_APP_ID,
          target_channel: "push",
          filters: [{ field: "tag", key: "player_id", relation: "=", value: player.id }],
          headings: { en: "🏀 Get back in the gym!" },
          contents: { en: message },
          url: "https://attleborowinningwall.vercel.app",
        }),
      });
      results.push({ player: player.name, push: pushRes.ok ? "sent" : "failed" });
    } catch (e) {
      results.push({ player: player.name, push: "error", detail: String(e) });
    }

    // ── Log notification in DB ───────────────────────────────
    await supabase.from("notifications").insert({
      player_id: player.id,
      channel: "email",
      message,
    });
  }

  return new Response(JSON.stringify({ notified: inactive.length, results }), { status: 200 });
});
