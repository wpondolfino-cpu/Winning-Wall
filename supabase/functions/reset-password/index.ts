// supabase/functions/reset-password/index.ts
//
// Resets one account's password to a fresh temporary one and returns it,
// so the coach can pass it on. The player sets their own at next login.
//
// Who can call it (same rule as the reset_user_password database
// function, migration 150):
//   * an admin -> any account
//   * a coach  -> players only (player / inactive / pending_player)
//   * anyone else -> refused
//
// The previous version checked nothing, so anyone holding the app's public
// key could reset any account -- including the admin's -- to the shared
// password printed on the login page.
//
// Body: { player_id: string, request_id?: string }
// Returns: { success: true, temp_password: string }
//
// Deploy: supabase functions deploy reset-password
// (or paste into Supabase -> Edge Functions -> reset-password -> Code).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Readable aloud to a player: Word-Word-1234. 40 x 40 x 9000 combinations,
// only valid until they log in and set their own.
const WORDS = [
  "Maple", "Tiger", "River", "Eagle", "Cedar", "Falcon", "Harbor", "Summit", "Comet", "Canyon",
  "Meadow", "Rocket", "Timber", "Orbit", "Glacier", "Thunder", "Willow", "Anchor", "Bison", "Coral",
  "Delta", "Ember", "Forest", "Granite", "Hawk", "Island", "Jaguar", "Lantern", "Marble", "Nova",
  "Otter", "Pepper", "Quartz", "Raven", "Saddle", "Tundra", "Violet", "Walnut", "Yarrow", "Zephyr",
];
function tempPassword(): string {
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  const a = WORDS[r[0] % WORDS.length];
  let b = WORDS[r[1] % WORDS.length];
  if (b === a) b = WORDS[(r[1] + 1) % WORDS.length];
  const n = 1000 + (r[2] % 9000);
  return `${a}-${b}-${n}`;
}

const PLAYER_ROLES = ["player", "inactive", "pending_player"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { player_id, request_id } = await req.json();
    if (!player_id) return reply({ error: "Missing player_id" }, 400);

    const admin = createClient(
      Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Who is calling? ────────────────────────────────────────
    // The app's public key is also a valid token, so a token existing
    // proves nothing; it has to belong to a signed-in user.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!caller) return reply({ error: "Sign in as a coach to reset passwords." }, 401);

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", caller.id).single();
    const callerRole = callerProfile?.role;
    if (callerRole !== "coach" && callerRole !== "admin") {
      return reply({ error: "Only coaches can reset passwords." }, 403);
    }

    const { data: target } = await admin.from("profiles").select("role").eq("id", player_id).single();
    if (!target) return reply({ error: "That account doesn't exist." }, 404);
    if (callerRole !== "admin" && !PLAYER_ROLES.includes(target.role)) {
      return reply({ error: "Only an admin can reset a coach's password." }, 403);
    }

    // ── Reset ──────────────────────────────────────────────────
    const temp = tempPassword();
    const { error: resetError } = await admin.auth.admin.updateUserById(player_id, { password: temp });
    if (resetError) throw resetError;

    // Prompted to set their own at next login.
    await admin.from("profiles").update({ must_change_password: true }).eq("id", player_id);

    if (request_id) {
      await admin.from("password_reset_requests").update({ status: "done" }).eq("id", request_id);
    }

    return reply({ success: true, temp_password: temp });
  } catch (e: any) {
    return reply({ error: e?.message ?? "Reset failed" }, 500);
  }
});
