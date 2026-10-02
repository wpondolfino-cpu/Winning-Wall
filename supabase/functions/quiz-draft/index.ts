// supabase/functions/quiz-draft/index.ts
// Drafts quiz questions from a scout sheet's FREE-TEXT fields (set
// descriptions, plans to defend, specials, keys to the game, player
// notes) using the Claude API. The structured fields (hands, coverages,
// matchups) don't need this -- the app builds those itself.
//
// Drafts only. Nothing here touches the quiz tables: the questions go
// back to the coach's review screen, and nothing reaches a player until
// the coach publishes.
//
// Who can call it: signed-in coaches and admins only.
//
// Privacy: the opposing players are minors at another school, so their
// NAMES never leave this function. Each player is replaced by their
// number ("#23"), including anywhere a name was typed into a description
// or note. Players without a number become "an unnumbered player".
//
// Deploy: supabase functions deploy quiz-draft
//
// Required secret (Project Settings → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  — from console.anthropic.com
// Optional:
//   QUIZ_MODEL         — model to use; defaults to claude-sonnet-5-5
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("QUIZ_MODEL") || "claude-sonnet-5-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Plain text from the app's light markup (**bold**, bullets, arrows). */
function plain(s: unknown): string {
  return String(s ?? "").replace(/\*\*/g, "").replace(/\r/g, "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  if (!ANTHROPIC_API_KEY) return reply({ error: "AI drafting isn't set up yet (missing ANTHROPIC_API_KEY)." }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── Caller must be staff ──
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!user) return reply({ error: "Sign in first." }, 401);
  const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "coach" && me?.role !== "admin") return reply({ error: "Coaches only." }, 403);

  let body: { scoutSheetId?: string; count?: number };
  try { body = await req.json(); } catch { return reply({ error: "Invalid JSON body" }, 400); }
  const sheetId = String(body.scoutSheetId ?? "");
  const count = Math.max(1, Math.min(Number(body.count) || 6, 12));
  if (!sheetId) return reply({ error: "scoutSheetId is required" }, 400);

  // ── Load the sheet ──
  const [sheetRes, playersRes, setsRes, specialsRes] = await Promise.all([
    admin.from("scout_sheets").select("id, tempo, keys_to_game").eq("id", sheetId).maybeSingle(),
    admin.from("scout_players").select("name, number, position, notes, offensive_strengths, plan_to_guard").eq("scout_sheet_id", sheetId),
    admin.from("scout_offense_sets").select("call_name, description, plan_to_defend").eq("scout_sheet_id", sheetId).order("sort_order"),
    admin.from("scout_specials").select("kind, call_name, description, plan_to_defend").eq("scout_sheet_id", sheetId).order("sort_order"),
  ]);
  if (!sheetRes.data) return reply({ error: "Scout sheet not found" }, 404);
  const players = (playersRes.data ?? []) as any[];

  // ── Swap names for numbers everywhere ──
  // Full names first, then each part of a name 3+ letters long ("Carter"
  // on its own), as whole words, case-insensitive.
  const swaps: { re: RegExp; to: string }[] = [];
  for (const p of players) {
    const to = p.number ? `#${p.number}` : "an unnumbered player";
    const name = String(p.name ?? "").trim();
    if (!name) continue;
    swaps.push({ re: new RegExp(`\\b${escapeRegex(name)}\\b`, "gi"), to });
    for (const part of name.split(/\s+/)) {
      if (part.length >= 3) swaps.push({ re: new RegExp(`\\b${escapeRegex(part)}\\b`, "gi"), to });
    }
  }
  swaps.sort((a, b) => b.re.source.length - a.re.source.length);
  const scrub = (s: unknown) => swaps.reduce((t, w) => t.replace(w.re, w.to), plain(s));

  const lines: string[] = [];
  const sets = (setsRes.data ?? []) as any[];
  if (sets.length) {
    lines.push("THEIR OFFENSIVE SETS:");
    for (const s of sets) {
      lines.push(`- "${scrub(s.call_name)}"${s.description ? `: ${scrub(s.description)}` : ""}${s.plan_to_defend ? ` | OUR PLAN TO DEFEND: ${scrub(s.plan_to_defend)}` : ""}`);
    }
  }
  const specials = (specialsRes.data ?? []) as any[];
  if (specials.length) {
    lines.push("THEIR OUT-OF-BOUNDS PLAYS:");
    for (const s of specials) {
      lines.push(`- ${String(s.kind).toUpperCase()} "${scrub(s.call_name)}"${s.description ? `: ${scrub(s.description)}` : ""}${s.plan_to_defend ? ` | OUR PLAN TO DEFEND: ${scrub(s.plan_to_defend)}` : ""}`);
    }
  }
  const withNotes = players.filter(p => plain(p.notes));
  if (withNotes.length) {
    lines.push("NOTES ON THEIR PLAYERS:");
    for (const p of withNotes) {
      lines.push(`- ${p.number ? `#${p.number}` : "An unnumbered player"}${p.position ? ` (${p.position})` : ""}: ${scrub(p.notes)}`);
    }
  }
  const keys = ((sheetRes.data as any).keys_to_game ?? []) as string[];
  if (keys.filter(k => plain(k)).length) {
    lines.push("OUR KEYS TO THE GAME:");
    keys.filter(k => plain(k)).forEach(k => lines.push(`- ${scrub(k)}`));
  }
  if (plain((sheetRes.data as any).tempo)) lines.push(`THEIR TEMPO: ${scrub((sheetRes.data as any).tempo)}`);

  if (!lines.length) {
    return reply({ error: "This scout sheet has no written descriptions, plans, notes or keys to draft from yet." }, 400);
  }

  const instructions = `You write quiz questions that help high school basketball players learn a scouting report before a game.

Write ${count} multiple-choice questions using ONLY the scouting material below. Rules:
- Every correct answer must be stated or directly implied by the material. Never invent facts.
- Each question has 3 or 4 short answer options. Wrong answers must be plausible basketball answers but clearly wrong according to the material.
- Prefer what a player must do or recognize in the game (coverages, what a set is trying to get, our plan to defend it) over trivia.
- Refer to opposing players only by number exactly as written (e.g. "#23"). Never use names.
- Keep questions under 25 words and options under 12 words. Plain language a 15-year-old understands.
- "explanation" is one short sentence saying why the answer is right, from the material.
- Cover different parts of the material rather than several questions on one item.

Respond with ONLY a JSON array, no other text, in this shape:
[{"prompt": "...", "options": ["...", "...", "..."], "correct": 0, "explanation": "..."}]
"correct" is the 0-based index of the right option.

SCOUTING MATERIAL:
${lines.join("\n")}`;

  let text = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        messages: [{ role: "user", content: instructions }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Anthropic error", res.status, JSON.stringify(data));
      return reply({ error: "The AI request failed. Try again in a minute." }, 502);
    }
    text = ((data.content ?? []) as any[]).map(b => (b.type === "text" ? b.text : "")).join("\n");
  } catch (e) {
    console.error(e);
    return reply({ error: "Couldn't reach the AI service." }, 502);
  }

  // ── Parse and validate ──
  let parsed: any[] = [];
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return reply({ error: "The AI's answer couldn't be read. Try again." }, 502);
  }
  const questions = (Array.isArray(parsed) ? parsed : [])
    .filter(q => q && typeof q.prompt === "string" && Array.isArray(q.options))
    .map(q => {
      const options = q.options.map((o: unknown) => String(o).trim()).filter(Boolean).slice(0, 5);
      const correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct < options.length ? q.correct : -1;
      return { prompt: String(q.prompt).trim().slice(0, 300), options, correct, explanation: q.explanation ? String(q.explanation).slice(0, 400) : null };
    })
    .filter(q => q.prompt && q.options.length >= 2 && q.correct >= 0)
    .slice(0, count);

  return reply({ questions });
});
