// supabase/functions/view-as/index.ts
//
// "View as" test accounts.
//
//   { action: "list",  program_id }  -> creates the program's missing test
//        accounts, then returns the ones the caller may enter.
//   { action: "enter", user_id }     -> a one-time sign-in token for that
//        test account (the app exchanges it for a session).
//
// Who may do what:
//   * platform admin -> every test account in any program
//                       (Test Player, Test Assistant Coach, Test Head Coach)
//   * head coach     -> their own program's Test Player only
//   * anyone else    -> refused
// Only accounts marked is_test can ever be entered. Real players can't.
//
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> name it
// "view-as" -> paste this file. Leave "Verify JWT" ON.

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

type TestRole = "player" | "coach" | "head_coach";
const PROFILE_ROLE: Record<TestRole, string> = { player: "test_player", coach: "coach", head_coach: "admin" };
const NAME: Record<TestRole, string> = { player: "Test Player", coach: "Test Assistant Coach", head_coach: "Test Head Coach" };

function randomPassword(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Who is calling? ──────────────────────────────────────
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!caller) return reply({ error: "Sign in first." }, 401);

    const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", caller.id).maybeSingle();
    const isPlatformAdmin = !!pa;

    async function isHeadCoach(programId: string): Promise<boolean> {
      const { data } = await admin.from("program_members").select("role")
        .eq("program_id", programId).eq("user_id", caller!.id).eq("status", "active").maybeSingle();
      return data?.role === "head_coach";
    }

    const body = await req.json();

    // ── list: make sure the accounts exist, return what caller may enter ──
    if (body.action === "list") {
      const programId: string = body.program_id;
      if (!programId) return reply({ error: "Missing program_id" }, 400);
      if (!isPlatformAdmin && !(await isHeadCoach(programId))) {
        return reply({ error: "Only head coaches can use View as." }, 403);
      }

      const wanted: TestRole[] = isPlatformAdmin ? ["player", "coach", "head_coach"] : ["player"];

      const { data: existing } = await admin.from("program_members")
        .select("user_id, role").eq("program_id", programId).eq("is_test", true);
      const have = new Set((existing ?? []).map((m: any) => m.role));

      for (const role of wanted) {
        if (have.has(role)) continue;
        await createTestAccount(admin, programId, role);
      }

      const { data: rows } = await admin.from("program_members")
        .select("user_id, role, profiles(name)").eq("program_id", programId).eq("is_test", true);
      const order: TestRole[] = ["player", "coach", "head_coach"];
      const accounts = (rows ?? [])
        .filter((r: any) => wanted.includes(r.role))
        .sort((a: any, b: any) => order.indexOf(a.role) - order.indexOf(b.role))
        .map((r: any) => ({ user_id: r.user_id, role: r.role, name: r.profiles?.name ?? NAME[r.role as TestRole] }));
      return reply({ accounts });
    }

    // ── enter: one-time sign-in for a test account ──────────
    if (body.action === "enter") {
      const userId: string = body.user_id;
      if (!userId) return reply({ error: "Missing user_id" }, 400);

      const { data: m } = await admin.from("program_members")
        .select("program_id, role, is_test").eq("user_id", userId).eq("is_test", true).maybeSingle();
      if (!m) return reply({ error: "That isn't a test account." }, 403);

      const allowed = isPlatformAdmin || (m.role === "player" && await isHeadCoach(m.program_id));
      if (!allowed) return reply({ error: "You can't view as that account." }, 403);

      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
      if (uErr || !u?.user?.email) return reply({ error: "Test account not found." }, 404);

      // Returns the link's token without sending any email.
      const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
      if (lErr || !link?.properties?.hashed_token) throw lErr ?? new Error("Couldn't start the session.");
      return reply({ token_hash: link.properties.hashed_token });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (e: any) {
    return reply({ error: e?.message ?? "View as failed" }, 500);
  }
});

async function createTestAccount(admin: any, programId: string, role: TestRole) {
  const email = `wwtest.${role.replace("_", "")}.${programId.slice(0, 8)}@example.com`;

  // Create the login (no email is sent). If an earlier attempt got this
  // far already, reuse that login.
  let userId: string | null = null;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: randomPassword(), email_confirm: true, user_metadata: { name: NAME[role] },
  });
  if (created?.user) userId = created.user.id;
  else {
    const { data: found } = await admin.from("profile_emails").select("id").eq("email", email).maybeSingle();
    if (!found) throw error ?? new Error("Couldn't create the test account.");
    userId = found.id;
  }

  // A test player starts on the program's biggest team so Schedule,
  // practices and playbooks show something. Coaches can move it later.
  let homeRoster: string | null = null;
  if (role === "player") {
    const { data: rosters } = await admin.from("rosters").select("id").eq("program_id", programId);
    let best = 0;
    for (const r of rosters ?? []) {
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
        .eq("home_roster_id", r.id).eq("role", "player");
      if ((count ?? 0) > best) { best = count ?? 0; homeRoster = r.id; }
    }
  }

  await admin.from("profiles").update({
    name: NAME[role], active_program_id: programId, must_change_password: false,
    avatar_prompt_seen: true, home_roster_id: homeRoster,
  }).eq("id", userId);

  await admin.from("program_members").upsert(
    { program_id: programId, user_id: userId, role, status: "active", is_test: true },
    { onConflict: "program_id,user_id" },
  );

  // Last: the role. (The membership sync keeps is_test as set above.)
  await admin.from("profiles").update({ role: PROFILE_ROLE[role] }).eq("id", userId);
}
