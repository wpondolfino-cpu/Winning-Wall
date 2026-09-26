// supabase/functions/daily-reminders/index.ts
// Daily checks in one cron job (cron.job "daily-reminders", 16:00 UTC --
// noon Eastern in summer, 11am in winter; lunchtime on purpose, so
// players still have the afternoon to get to the gym):
//
//   0. Start the next repeating competition if the last one has ended
//      (migration 147), so it never waits on someone opening the app.
//   1. Streak reminder -- players with an active streak who haven't
//      logged a workout yet today.
//   2. "Days left" -- once per competition, to all players, timed to its
//      length: 2 days left for a week or longer, "ends tomorrow" for
//      2-6 days, "ends tonight" on a one-day competition.
//   3. Crown reminder -- one push a day to coaches while any ended
//      competition is neither crowned nor skipped, escalating with the
//      oldest one's wait.
//
// Each section fails on its own; one breaking never stops the others.
//
// Deploy: supabase functions deploy daily-reminders
// Deploy AFTER migration 147 -- sections 0, 2 and 3 read its tables.
//
// Env vars (same as notify-inactive / send-push):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ONE_SIGNAL_APP_ID, ONE_SIGNAL_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ONE_SIGNAL_APP_ID = Deno.env.get("ONE_SIGNAL_APP_ID")!;
const ONE_SIGNAL_API_KEY = Deno.env.get("ONE_SIGNAL_API_KEY")!;
const APP_URL = "https://attleborowinningwall.vercel.app";
const DAY_MS = 24 * 60 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function sendPush(filters: unknown[], title: string, message: string) {
  const res = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Authorization": `Key ${ONE_SIGNAL_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      app_id: ONE_SIGNAL_APP_ID,
      target_channel: "push",
      filters,
      headings: { en: title },
      contents: { en: message },
      url: APP_URL,
    }),
  });
  const result = await res.json();
  console.log(`Push [${title}]:`, JSON.stringify(result));
  return { sent: res.ok, result };
}

async function sendPushToPlayers(playerIds: string[], title: string, message: string) {
  if (playerIds.length === 0) return { sent: false, reason: "no players" };
  const filters = playerIds.flatMap((id, i) => {
    const f = [{ field: "tag", key: "player_id", relation: "=", value: id }];
    return i === 0 ? f : [{ operator: "OR" }, ...f];
  });
  return sendPush(filters, title, message);
}

function sendPushToAllPlayers(title: string, message: string) {
  return sendPush([{ field: "tag", key: "player_id", relation: "exists" }], title, message);
}

/** A moment's calendar date in Eastern time, as YYYY-MM-DD. Competition boundaries are midnight Eastern. */
function easternDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

/** Whole days between two YYYY-MM-DD dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

serve(async () => {
  const results: Record<string, unknown> = {};

  // ── 0. Start the next repeating competition ───────────────
  try {
    const { data, error } = await supabase.rpc("roll_competitions");
    if (error) throw error;
    results.competitionsStarted = data ?? 0;
  } catch (e) {
    results.competitionsStarted = { error: String(e) };
  }

  // ── 1. Streak reminders ──────────────────────────────────
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data: streaks, error } = await supabase
      .from("streaks")
      .select("player_id, current_streak, last_logged_date")
      .gt("current_streak", 0)
      .neq("last_logged_date", today);

    if (error) throw error;

    const playerIds = (streaks ?? []).map((s) => s.player_id);
    if (playerIds.length > 0) {
      results.streakReminder = await sendPushToPlayers(
        playerIds,
        "🔥 Don't break your streak!",
        "Log a workout today to keep your streak alive."
      );
      results.streakPlayerCount = playerIds.length;
    } else {
      results.streakReminder = { sent: false, reason: "no players with an at-risk streak" };
    }
  } catch (e) {
    results.streakReminder = { error: String(e) };
  }

  // ── 2. Competition ending soon ───────────────────────────
  try {
    const nowIso = new Date().toISOString();
    const { data: running, error } = await supabase
      .from("competitions")
      .select("id, name, starts_at, ends_at, ending_warned_at")
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .limit(1);
    if (error) throw error;

    const c = running?.[0];
    if (!c) {
      results.endingReminder = { sent: false, reason: "no competition running" };
    } else if (c.ending_warned_at) {
      results.endingReminder = { sent: false, reason: "already warned", competition: c.name };
    } else {
      const lengthDays = Math.round((Date.parse(c.ends_at) - Date.parse(c.starts_at)) / DAY_MS);
      // ends_at is the midnight AFTER the last day, so 1 = today is the last day.
      const daysUntilEnd = daysBetween(easternDate(new Date()), easternDate(new Date(c.ends_at)));
      const warnAt = lengthDays >= 2 ? 2 : 1;

      if (daysUntilEnd === warnAt) {
        const [title, message] =
          lengthDays >= 7 ? ["⏰ 2 days left!", `${c.name} ends in 2 days — every point counts!`]
          : lengthDays >= 2 ? ["⏰ Ends tomorrow!", `${c.name} ends tomorrow night — get your work in!`]
          : ["⏰ Last day!", `${c.name} ends tonight — get your work in!`];
        results.endingReminder = await sendPushToAllPlayers(title, message);
        await supabase.from("competitions").update({ ending_warned_at: nowIso }).eq("id", c.id);
      } else {
        results.endingReminder = { sent: false, competition: c.name, daysUntilEnd, warnAt };
      }
    }
  } catch (e) {
    results.endingReminder = { error: String(e) };
  }

  // ── 3. Crown reminder (escalating digest) ────────────────
  try {
    const { data: waiting, error } = await supabase
      .from("competitions")
      .select("id, name, ends_at")
      .lte("ends_at", new Date().toISOString())
      .is("crowned_at", null)
      .is("skipped_at", null)
      .order("ends_at", { ascending: true });
    if (error) throw error;

    if (!waiting || waiting.length === 0) {
      results.crowningReminder = { sent: false, reason: "nothing waiting to be crowned" };
    } else {
      const { data: staff } = await supabase.from("profiles").select("id").in("role", ["coach", "admin"]);
      const staffIds = (staff ?? []).map((s) => s.id);
      const oldest = waiting[0];
      const daysSince = Math.max(0, daysBetween(easternDate(new Date(oldest.ends_at)), easternDate(new Date())));
      const n = waiting.length;
      const what = n === 1 ? oldest.name : `${n} competitions`;

      const title = daysSince === 0 ? "👑 Time to crown champions!"
        : daysSince === 1 ? "⏰ Champions still not crowned"
        : "🚨 Champions overdue!";
      const message = daysSince === 0
        ? `${what} just ended — crown the champions from the Leaderboard tab.`
        : daysSince === 1
        ? `${what} ${n === 1 ? "is" : "are"} waiting — players want to see who won.`
        : `${what} ${n === 1 ? "is" : "are"} waiting to be crowned${n > 1 ? `, the oldest ${daysSince} days overdue` : ` — ${daysSince} days overdue`}.`;

      results.crowningReminder = await sendPushToPlayers(staffIds, title, message);
      results.crowningWaiting = n;
      results.crowningDaysSince = daysSince;
    }
  } catch (e) {
    results.crowningReminder = { error: String(e) };
  }

  return new Response(JSON.stringify(results), { status: 200 });
});
