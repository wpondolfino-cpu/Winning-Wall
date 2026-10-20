// supabase/functions/view-as/index.ts
//
// "View as" test accounts.
//
//   { action: "list",  program_id }  -> creates the program's missing test
//        accounts, then returns the ones the caller may enter.
//   { action: "enter", user_id }     -> a one-time sign-in token for that
//        test account (the app exchanges it for a session).
//   { action: "sandbox_build", rebuild? } -> platform admin only: makes
//        the sandbox's 36 players, 3 coaches and Varsity/JV/Freshman
//        rosters (migration 198). rebuild = delete them all and start over.
//
// The sandbox: "list" there returns its made-up people (building them the
// first time), and the platform admin can enter any of them. They're
// ordinary accounts that exist only in the sandbox, so they count in its
// leaderboards and attendance; the sandbox is walled off from real
// programs like any other program.
//
// Who may do what:
//   * platform admin -> every test account in any program
//                       (Test Player, Test Assistant Coach, Test Head Coach)
//   * head coach     -> their own program's Test Player only
//   * anyone else    -> refused
// Only accounts marked is_test, or the sandbox's made-up people, can ever
// be entered. Real players can't.
//
// Deploy: Supabase -> Edge Functions -> Deploy a new function -> name it
// "view-as" -> paste this file. Leave "Verify JWT" ON.

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
      serverKey(),
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

      const sandboxId = await sandboxProgramId(admin);
      if (sandboxId && programId === sandboxId) {
        if (!isPlatformAdmin) return reply({ error: "Only the platform admin can use the sandbox." }, 403);
        await buildSandbox(admin, sandboxId, false);
        return reply({ accounts: await sandboxPeople(admin, sandboxId) });
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

    // ── sandbox_build: make (or remake) the sandbox people ───
    if (body.action === "sandbox_build") {
      if (!isPlatformAdmin) return reply({ error: "Platform admin only." }, 403);
      const sandboxId = await sandboxProgramId(admin);
      if (!sandboxId) return reply({ error: "There's no sandbox yet. Run migration 198 first." }, 400);
      const made = await buildSandbox(admin, sandboxId, body.rebuild === true);
      return reply({ ok: true, created: made, accounts: await sandboxPeople(admin, sandboxId) });
    }

    // ── enter: one-time sign-in for a test account ──────────
    if (body.action === "enter") {
      const userId: string = body.user_id;
      if (!userId) return reply({ error: "Missing user_id" }, 400);

      const { data: memberships } = await admin.from("program_members")
        .select("program_id, role, is_test").eq("user_id", userId);
      const m = (memberships ?? []).find((x: any) => x.is_test);

      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
      if (uErr || !u?.user?.email) return reply({ error: "Account not found." }, 404);

      let allowed = false;
      if (m) {
        allowed = isPlatformAdmin || (m.role === "player" && await isHeadCoach(m.program_id));
      } else if (isPlatformAdmin) {
        // A sandbox person: in the sandbox and nowhere else, with one of
        // the made-up addresses this function creates.
        const sandboxId = await sandboxProgramId(admin);
        allowed = !!sandboxId && (memberships ?? []).length === 1
          && memberships![0].program_id === sandboxId
          && isSandboxEmail(u.user.email, sandboxId);
      }
      if (!allowed) return reply({ error: "You can't view as that account." }, 403);

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


// ── Sandbox (migration 198) ─────────────────────────────────────

async function sandboxProgramId(admin: any): Promise<string | null> {
  const { data } = await admin.rpc("sandbox_program_id");
  return (data as string | null) ?? null;
}

function sandboxEmail(key: string, sandboxId: string): string {
  return `wwsandbox.${key}.${sandboxId.slice(0, 8)}@example.com`;
}
function isSandboxEmail(email: string, sandboxId: string): boolean {
  return /^wwsandbox\.[a-z0-9]+\./.test(email) && email.endsWith(`.${sandboxId.slice(0, 8)}@example.com`);
}

// School year that ends next June: from August on, it's next year.
function academicYear(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}
function gradYearFor(grade: number): number { return academicYear() + (12 - grade); }
function gradeCategory(grade: number): string {
  return grade >= 11 ? "Upperclassman (11th-12th Grade)" : "Underclassman (9th-10th Grade)";
}

const SANDBOX_ROSTERS = [
  { key: "Varsity",  color: "#1a3fa8", coach: "Dana Reyes",  grades: [12, 12, 12, 12, 12, 12, 11, 11, 11, 11, 11, 10] },
  { key: "JV",       color: "#1D9E75", coach: "Chris Okafor", grades: [11, 11, 10, 10, 10, 10, 10, 10, 9, 9, 9, 9] },
  { key: "Freshman", color: "#EF9F27", coach: "Sam Patel",   grades: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9] },
];
const SANDBOX_PLAYERS = [
  "Marcus Hale", "Tyler Brooks", "Jordan Price", "Devin Carter", "Isaiah Moore", "Caleb Turner",
  "Andre Collins", "Nate Sullivan", "Ryan Foster", "Jalen Woods", "Cole Bennett", "Mason Reed",
  "Owen Castillo", "Liam Doyle", "Xavier Grant", "Ethan Shaw", "Miles Parker", "Aiden Flynn",
  "Gavin Hayes", "Lucas Rivera", "Noah Kim", "Brady Walsh", "Trey Morgan", "Elijah Ross",
  "Eli Warren", "Jayden Cruz", "Connor Byrne", "Dylan Ortiz", "Logan Pierce", "Carter Nash",
  "Julian Vega", "Hunter Lane", "Micah Stone", "Evan Brooks-Hill", "Zach Monroe", "Kai Fisher",
];
const JERSEYS = [2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21];
const SANDBOX_COACHES: { key: string; name: string; role: "head_coach" | "coach" }[] = [
  { key: "c1", name: "Dana Reyes", role: "head_coach" },
  { key: "c2", name: "Chris Okafor", role: "coach" },
  { key: "c3", name: "Sam Patel", role: "coach" },
];

/** Everyone in the sandbox except the platform admin, coaches first. */
async function sandboxPeople(admin: any, sandboxId: string) {
  const { data: rows } = await admin.from("program_members")
    .select("user_id, role, profiles(name, graduation_year, home_roster_id)")
    .eq("program_id", sandboxId).eq("status", "active");
  const { data: pa } = await admin.from("platform_admins").select("user_id");
  const admins = new Set((pa ?? []).map((r: any) => r.user_id));
  const order: Record<string, number> = { head_coach: 0, coach: 1, player: 2 };
  return (rows ?? [])
    .filter((r: any) => !admins.has(r.user_id))
    .map((r: any) => ({ user_id: r.user_id, role: r.role, name: r.profiles?.name ?? "Sandbox person" }))
    .sort((a: any, b: any) => (order[a.role] - order[b.role]) || a.name.localeCompare(b.name));
}

/** Makes whatever's missing. rebuild: delete the sandbox people and rosters first. */
async function buildSandbox(admin: any, sandboxId: string, rebuild: boolean): Promise<number> {
  if (rebuild) {
    const { data: members } = await admin.from("program_members").select("user_id").eq("program_id", sandboxId);
    for (const m of members ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      const email = u?.user?.email ?? "";
      if (!isSandboxEmail(email, sandboxId)) continue;          // never anyone real
      const { data: others } = await admin.from("program_members").select("program_id")
        .eq("user_id", m.user_id).neq("program_id", sandboxId);
      if ((others ?? []).length > 0) continue;
      const { error } = await admin.auth.admin.deleteUser(m.user_id);
      if (error) throw new Error(`Couldn't remove ${email}: ${error.message}. Reset the sandbox first, then rebuild.`);
    }
    await admin.from("rosters").delete().eq("program_id", sandboxId);
  }

  // Rosters.
  const rosterIds: Record<string, string> = {};
  const { data: existing } = await admin.from("rosters").select("id, name").eq("program_id", sandboxId);
  for (const r of existing ?? []) rosterIds[r.name] = r.id;
  for (let i = 0; i < SANDBOX_ROSTERS.length; i++) {
    const r = SANDBOX_ROSTERS[i];
    if (rosterIds[r.key]) continue;
    const { data, error } = await admin.from("rosters").insert({
      program_id: sandboxId, name: r.key, color: r.color, roster_type: "seasonal", status: "active",
      default_coach_name: r.coach, sort_order: i,
    }).select("id").single();
    if (error) throw new Error(`Couldn't make the ${r.key} roster: ${error.message}`);
    rosterIds[r.key] = data.id;
  }

  // Who already exists, by their made-up address.
  const { data: members } = await admin.from("program_members").select("user_id").eq("program_id", sandboxId);
  const ids = (members ?? []).map((m: any) => m.user_id);
  const have = new Set<string>();
  if (ids.length) {
    const { data: emails } = await admin.from("profile_emails").select("email").in("id", ids);
    for (const e of emails ?? []) have.add(e.email);
  }

  const jobs: (() => Promise<void>)[] = [];
  // Coaches first, so the head coach is in place (and the starter pack
  // lands) before the players arrive.
  for (const c of SANDBOX_COACHES) {
    const email = sandboxEmail(c.key, sandboxId);
    if (have.has(email)) continue;
    jobs.push(() => makeSandboxPerson(admin, sandboxId, email, c.name, c.role, {}));
  }
  const coachJobs = jobs.splice(0);
  for (const j of coachJobs) await j();

  let n = 0;
  SANDBOX_ROSTERS.forEach((r, ri) => {
    r.grades.forEach((grade, gi) => {
      n++;
      const key = `p${String(n).padStart(2, "0")}`;
      const email = sandboxEmail(key, sandboxId);
      if (have.has(email)) return;
      const name = SANDBOX_PLAYERS[ri * 12 + gi];
      jobs.push(() => makeSandboxPerson(admin, sandboxId, email, name, "player", {
        home_roster_id: rosterIds[r.key], graduation_year: gradYearFor(grade),
        grade_category: gradeCategory(grade), jersey: JERSEYS[gi],
      }));
    });
  });
  // A few at a time keeps it quick without hammering the auth server.
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map(j => j()));
  return coachJobs.length + jobs.length;
}

async function makeSandboxPerson(
  admin: any, sandboxId: string, email: string, name: string,
  role: "player" | "coach" | "head_coach", extra: Record<string, unknown>,
) {
  let userId: string | null = null;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: randomPassword(), email_confirm: true, user_metadata: { name },
  });
  if (created?.user) userId = created.user.id;
  else {
    const { data: found } = await admin.from("profile_emails").select("id").eq("email", email).maybeSingle();
    if (!found) throw error ?? new Error(`Couldn't create ${name}.`);
    userId = found.id;
  }

  await admin.from("profiles").update({
    name, active_program_id: sandboxId, must_change_password: false, avatar_prompt_seen: true,
    home_roster_id: null, ...extra,
  }).eq("id", userId);

  const { error: mErr } = await admin.from("program_members").upsert(
    { program_id: sandboxId, user_id: userId, role, status: "active", is_test: false },
    { onConflict: "program_id,user_id" },
  );
  if (mErr) throw new Error(`Couldn't add ${name} to the sandbox: ${mErr.message}`);

  // Last: the role (same order as the test accounts).
  const profileRole = role === "head_coach" ? "admin" : role === "coach" ? "coach" : "player";
  await admin.from("profiles").update({ role: profileRole }).eq("id", userId);
}
