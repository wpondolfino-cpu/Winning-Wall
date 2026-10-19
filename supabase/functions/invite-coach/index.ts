// supabase/functions/invite-coach/index.ts
// Platform admin only: make someone head coach of a program by email.
//
//   * Already has an account  -> made head coach right away (nothing sent).
//   * No account yet          -> an invite is created. Supabase emails it
//     if it can; if it can't (its built-in email allows only a few sends
//     an hour), the invite link comes back for you to copy and text them.
//     Either way they land as head coach and set their own password on
//     their first visit.
//
// Body: { program_id: string, email: string, name?: string, link_only?: boolean }
// Returns: { status: "promoted" | "invited", emailed?: boolean, link?: string, name?: string }
//
// Deploy: supabase functions deploy invite-coach
// (or Supabase -> Edge Functions -> Deploy a new function -> invite-coach, paste this).

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

const APP_URL = "https://attleborowinningwall.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());

    // ── Platform admin only ─────────────────────────────────
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!caller) return reply({ error: "Sign in first." }, 401);
    const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", caller.id).maybeSingle();
    if (!pa) return reply({ error: "Only the platform admin can invite head coaches." }, 403);

    const body = await req.json();
    const programId = String(body.program_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
    if (!programId) return reply({ error: "Missing program." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "That doesn't look like an email address." }, 400);

    const { data: program } = await admin.from("programs").select("id, name, organization_id").eq("id", programId).maybeSingle();
    if (!program) return reply({ error: "That program doesn't exist." }, 404);

    async function makeHeadCoach(userId: string, displayName: string | null, how: string) {
      // Someone still pending becomes a coach first; then head coach of this program.
      await admin.from("profiles").update({ role: "coach" }).eq("id", userId).in("role", ["pending_coach", "pending_player"]);
      await admin.from("program_members").upsert(
        { program_id: programId, user_id: userId, role: "head_coach", status: "active" },
        { onConflict: "program_id,user_id" },
      );
      await admin.from("profiles").update({ active_program_id: programId }).eq("id", userId).is("active_program_id", null);
      await admin.from("platform_log").insert({
        actor_id: caller!.id, action: how, org_id: program!.organization_id, program_id: programId,
        detail: `${displayName ?? email} (${email})`,
      });
    }

    // ── Already has an account? ─────────────────────────────
    const { data: existing } = await admin.from("profile_emails").select("id").eq("email", email).maybeSingle();
    if (existing?.id) {
      const { data: prof } = await admin.from("profiles").select("name").eq("id", existing.id).maybeSingle();
      await makeHeadCoach(existing.id, prof?.name ?? null, "Added head coach");
      return reply({ status: "promoted", name: prof?.name ?? email });
    }

    // ── New person: invite ──────────────────────────────────
    const meta = { name: name || email.split("@")[0], must_change_password: true };
    let userId: string | null = null;
    let emailed = false;
    let link: string | undefined;

    if (!body.link_only) {
      const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { data: meta, redirectTo: APP_URL });
      if (!invErr && inv?.user) { userId = inv.user.id; emailed = true; }
    }
    if (!userId) {
      // Couldn't email (or asked for a link): make the invite and hand back its link.
      const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
        type: "invite", email, options: { data: meta, redirectTo: APP_URL },
      });
      if (genErr || !gen?.user) throw genErr ?? new Error("Couldn't create the invite.");
      userId = gen.user.id;
      link = gen.properties?.action_link;
    }

    await makeHeadCoach(userId!, meta.name, emailed ? "Invited head coach (email sent)" : "Invited head coach (link)");
    return reply({ status: "invited", emailed, link, name: meta.name });
  } catch (e: any) {
    return reply({ error: e?.message ?? "Invite failed" }, 500);
  }
});
