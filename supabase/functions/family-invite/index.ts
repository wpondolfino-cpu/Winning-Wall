// supabase/functions/family-invite/index.ts
// Parent portal (SQL 222): family invite links (?family=TOKEN).
//
// A player (or their coach) makes a link for their family. Opening it only
// shows a welcome page. A parent then either:
//   * makes a parent account (name, email, password), or
//   * signs in to the parent account they already have (a second child)
// and is linked to that player as WAITING. A coach approves them in
// Announcements → Families before they see anything.
//
// Parent accounts are never members of a program, so none of the team's
// data is open to them; they only reach what the parent functions in SQL
// 222 hand back for their own approved child.
//
//   { action: "lookup", token }                        what the page shows
//   { action: "accept", token, name, email, password } new parent account
//   { action: "accept", token }                        signed in as a parent
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via Editor,
// name it family-invite, paste this, Deploy. Then turn OFF
// "Verify JWT with legacy secret" (this function checks sign-in itself).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const cleanName = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "your player";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const token = String(body.token ?? "");

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let caller: { id: string; email?: string } | null = null;
    if (jwt && jwt.split(".").length === 3) {
      const { data } = await admin.auth.getUser(jwt);
      caller = data?.user ?? null;
    }

    // The invite, and whether it's still good.
    if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return reply({ status: "missing" });
    const { data: inv } = await admin.from("family_invites").select("*").eq("token", token).maybeSingle();
    if (!inv) return reply({ status: "missing" });
    const { data: member } = await admin.from("program_members").select("status")
      .eq("program_id", inv.program_id).eq("user_id", inv.player_id).eq("role", "player").maybeSingle();
    const status = inv.revoked_at ? "revoked"
      : new Date(inv.expires_at).getTime() <= Date.now() ? "expired"
      : member?.status !== "active" ? "revoked" : "open";

    const [{ data: kid }, { data: prog }] = await Promise.all([
      admin.from("profiles").select("name, home_roster_id").eq("id", inv.player_id).maybeSingle(),
      admin.from("programs").select("name, primary_color, accent_color, logo_url, organization_id").eq("id", inv.program_id).maybeSingle(),
    ]);

    if (action === "lookup") {
      if (status !== "open") return reply({ status, program_name: prog?.name ?? null });
      const [{ data: team }, { data: org }] = await Promise.all([
        kid?.home_roster_id ? admin.from("rosters").select("name").eq("id", kid.home_roster_id).maybeSingle() : Promise.resolve({ data: null }),
        prog?.organization_id ? admin.from("organizations").select("name, logo_url, primary_color, accent_color").eq("id", prog.organization_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      let callerRole: string | null = null;
      if (caller) {
        const { data: me } = await admin.from("profiles").select("role").eq("id", caller.id).maybeSingle();
        callerRole = me?.role ?? null;
      }
      return reply({
        status,
        child: firstName(kid?.name),
        team: (team as any)?.name ?? null,
        program: {
          name: prog?.name ?? "the team",
          school: (org as any)?.name ?? null,
          logo_url: prog?.logo_url ?? (org as any)?.logo_url ?? null,
          primary_color: prog?.primary_color ?? (org as any)?.primary_color ?? null,
          accent_color: prog?.accent_color ?? (org as any)?.accent_color ?? null,
        },
        caller_role: callerRole,
      });
    }

    if (action !== "accept") return reply({ error: "Unknown action." }, 400);
    if (status !== "open") return reply({ error: "This invite link isn't active anymore. Ask for a new one.", status }, 410);

    let parentId: string;
    if (caller) {
      // Signed in: only a parent account can follow a player.
      const { data: me } = await admin.from("profiles").select("role").eq("id", caller.id).maybeSingle();
      if (me?.role !== "parent") {
        return reply({ error: "This link is for a parent account. Sign out, then make a parent account or sign in to yours." }, 403);
      }
      parentId = caller.id;
    } else {
      const name = cleanName(body.name);
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!name) return reply({ error: "Type your name." }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "That doesn't look like an email address." }, 400);
      if (password.length < 8) return reply({ error: "Password must be at least 8 characters." }, 400);
      if (password.length > 72) return reply({ error: "That password is too long (72 characters max)." }, 400);
      const { data: existing } = await admin.from("profile_emails").select("id").eq("email", email).maybeSingle();
      if (existing) return reply({ error: "That email already has an account. Choose \"I already have a parent account\" and sign in.", status: "exists" }, 409);
      const { data: made, error: makeErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      });
      if (makeErr || !made?.user) {
        const m = makeErr?.message ?? "";
        if (/already|registered|exists/i.test(m)) return reply({ error: "That email already has an account. Choose \"I already have a parent account\" and sign in.", status: "exists" }, 409);
        throw makeErr ?? new Error("Couldn't make the account.");
      }
      parentId = made.user.id;
      // A parent: no program, no team data. Only the parent functions.
      const { error: roleErr } = await admin.from("profiles")
        .update({ role: "parent", active_program_id: null, name }).eq("id", parentId);
      if (roleErr) throw roleErr;
      await admin.from("program_members").delete().eq("user_id", parentId);
    }

    if (parentId === inv.player_id) return reply({ error: "That's the player's own account." }, 400);
    const { data: link, error: linkErr } = await admin.from("family_links")
      .upsert({ program_id: inv.program_id, parent_id: parentId, player_id: inv.player_id }, { onConflict: "parent_id,player_id", ignoreDuplicates: true })
      .select("id, status, created_at").maybeSingle();
    if (linkErr) throw linkErr;
    const { data: row } = link ? { data: link } : await admin.from("family_links").select("id, status, created_at")
      .eq("parent_id", parentId).eq("player_id", inv.player_id).maybeSingle();
    return reply({ ok: true, link_id: (row as any)?.id ?? null, status: (row as any)?.status ?? "pending", child: firstName(kid?.name) });
  } catch (e: any) {
    return reply({ error: e?.message ?? "Something went wrong." }, 500);
  }
});
