// src/lib/quizzes.ts
// Player quizzes built from a scout sheet.
//
// Coaches read and write quiz content directly (RLS: is_staff). Players
// never touch the tables: every player action is a database function
// (supabase/migrations/161_quizzes.sql) that grades on the server, so
// nothing the phone sends can change a score, and the answer key only
// reaches the phone after the answer it belongs to is locked.

import { supabase } from "./supabase";
import { Play, PlayFrame, PlayAction, getPlaybookPlays, stepName } from "./plays";
import {
  getScoutSheet, getScoutPlayers, getDefenseSections, getScoutSheetPrintContext,
  ensureScoutSheetForGame, ScoutPlayer,
} from "./scoutSheets";
import {
  OFF_STRENGTH_STARTERS, PLAN_TO_GUARD_STARTERS, PLAN_TO_ATTACK_STARTERS, TEAM_OFF_STRENGTH_STARTERS,
  PRESS_OPTS, PRESS_PLAN_OPTS, BLOB_SLOB_D_OPTS, BLOB_SLOB_D_PLAN_OPTS,
  STRUCTURE_OPTS, STRUCTURE_PLAN_OPTS, OFF_BALL_OPTS, OFF_BALL_PLAN_OPTS,
  BALL_SCREEN_OPTS, BALL_SCREEN_PLAN_OPTS, ZONE_TYPE_OPTS, ZONE_STRUCTURE_OPTS, ZONE_PLAN_OPTS,
} from "./scoutOptions";

// ── Types ─────────────────────────────────────────────────────

export type QuizStatus = "draft" | "published" | "archived";
export type FeedbackMode = "end" | "immediate";
export type QuestionSource = "sheet" | "ai" | "coach";

export interface Quiz {
  id: string;
  scout_sheet_id: string | null;
  game_id: string | null;
  title: string;
  version: number;
  status: QuizStatus;
  feedback_mode: FeedbackMode;
  allow_retakes: boolean;
  time_limit_seconds: number | null;
  show_time_to_coaches: boolean;
  roster_ids: string[];            // the teams "everyone" means (162)
  due_at: string | null;           // standalone quizzes; scout quizzes use tip-off
  playbook_id: string | null;      // play quizzes (163)
  source_play_ids: string[];
  play_settings: PlayQuizSettings | Record<string, never>;
  replaces_quiz_id: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type QuizSettings = Pick<Quiz, "feedback_mode" | "allow_retakes" | "time_limit_seconds" | "show_time_to_coaches"
  | "title" | "roster_ids" | "due_at">;

export type QuizKind = "scout" | "plays" | "standalone";
export const quizKind = (q: Pick<Quiz, "scout_sheet_id"> & Partial<Pick<Quiz, "playbook_id" | "source_play_ids">>): QuizKind =>
  q.scout_sheet_id ? "scout"
  : (q.playbook_id || (q.source_play_ids?.length ?? 0) > 0) ? "plays"
  : "standalone";

// ── Play quiz types (163) ─────────────────────────────────────

export type PlayQType = "what_next" | "who_ball" | "name_play";
export const PLAY_QTYPE_LABEL: Record<PlayQType, string> = {
  what_next: "What happens next",
  who_ball: "Who gets the ball",
  name_play: "Name that play",
};

/** What a play quiz was built with, so Regenerate repeats it. */
export interface PlayQuizSettings {
  types: Partial<Record<PlayQType, number>>;   // type -> questions per play (0/absent = off)
  maxQuestions: number;
}

/**
 * The court shown WITH a question. Never contains the step that answers
 * it: "what happens next" shows positions only; "name that play" shows
 * the opening steps with no title.
 */
export interface QuizVisual {
  court_template: string;
  frames: PlayFrame[];
  /** Animate these frames, then hide the court before answers appear. */
  hide_after?: boolean;
  /**
   * The steps BEFORE the one asked about, in order, with their arrows --
   * played as a lead-up so the player knows where they are in the play.
   * Never includes the step being asked about.
   */
  lead_frames?: PlayFrame[];
  caption?: string | null;
  /** Shown as a header above the court: which play and which step. */
  heading?: QuizHeading | null;
}

/** The play and step a question is about, shown big above the court. */
export interface QuizHeading {
  play: string;
  stepNumber: number;          // 1-based
  stepName: string | null;     // the coach's name for the step, if any
  ballHolder: number | null;   // jersey number of whoever has the ball
}

/** The answering step, sent only once the answer is locked. */
export interface QuizReveal {
  court_template: string;
  frame: PlayFrame;
  caption?: string | null;
  heading?: QuizHeading | null;
}

export interface QuizOption { id: string; label: string; sort_order: number; }

/** A question as the coach sees it: with its key and who it goes to. */
export interface QuizQuestion {
  id: string;
  quiz_id: string;
  sort_order: number;
  prompt: string;
  source: QuestionSource;
  family: string | null;
  options: QuizOption[];
  correct_option_id: string | null;
  explanation: string | null;
  assignee_ids: string[];          // empty = everyone on the game's roster
  qtype: PlayQType | null;
  visual: QuizVisual | null;
  reveal: QuizReveal | null;
}

/** A question before it's saved: options by text, correct one by index. */
export interface QuestionDraft {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  source: QuestionSource;
  family: string | null;
  assigneeIds: string[];
  qtype?: PlayQType | null;
  visual?: QuizVisual | null;
  reveal?: QuizReveal | null;
}

export interface QuizBundle { quiz: Quiz; questions: QuizQuestion[]; }

// ── Small helpers ─────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim().toLowerCase();
    if (!x.trim() || seen.has(k)) continue;
    seen.add(k);
    out.push(x.trim());
  }
  return out;
}

/** "#23 Carter", "#23", or the name -- how a scout player is referred to. */
export function scoutPlayerLabel(p: Pick<ScoutPlayer, "number" | "name">): string {
  const last = (p.name ?? "").trim().split(/\s+/).slice(-1)[0] ?? "";
  if (p.number) return last ? `#${p.number} ${last}` : `#${p.number}`;
  return p.name || "their player";
}

/**
 * A multiple-choice question from a chip list: one chip that IS on the
 * sheet is the right answer; the wrong answers come from the same starter
 * list, minus anything that's also on the sheet (so a wrong answer is
 * never secretly right). Returns null if there aren't enough wrong
 * answers to make it a real question.
 */
function chipQuestion(args: {
  prompt: string;
  onSheet: string[];
  pool: string[];
  family: string;
  assigneeIds?: string[];
  explanationPrefix?: string;
}): QuestionDraft | null {
  const onSheet = uniq(args.onSheet);
  if (!onSheet.length) return null;
  const onSheetKeys = new Set(onSheet.map(s => s.toLowerCase()));
  const wrong = shuffle(uniq(args.pool).filter(x => !onSheetKeys.has(x.toLowerCase()))).slice(0, 3);
  if (wrong.length < 1) return null;
  const correct = shuffle(onSheet)[0];
  const prefix = args.explanationPrefix ?? "On the scout sheet";
  return {
    prompt: args.prompt,
    options: [correct, ...wrong],
    correctIndex: 0,
    explanation: `${prefix}: ${onSheet.join(" · ")}.`,
    source: "sheet",
    family: args.family,
    assigneeIds: args.assigneeIds ?? [],
  };
}

// ── Generating from the scout sheet ──────────────────────────

/**
 * Every question the sheet's structured fields can produce on their own.
 * Free-text fields (set descriptions, plans to defend, notes, keys to the
 * game) aren't used here -- that's what the AI draft is for.
 */
export async function buildQuestionsFromSheet(scoutSheetId: string): Promise<QuestionDraft[]> {
  const [sheet, players, defense] = await Promise.all([
    getScoutSheet(scoutSheetId), getScoutPlayers(scoutSheetId), getDefenseSections(scoutSheetId),
  ]);
  if (!sheet) throw new Error("Scout sheet not found");
  const out: QuestionDraft[] = [];
  const push = (q: QuestionDraft | null) => { if (q) out.push(q); };

  // ── Matchups: each goes to the player assigned to guard him ──
  for (const p of players) {
    const who = scoutPlayerLabel(p);
    const assignees = p.assigned_to_profile_id ? [p.assigned_to_profile_id] : [];
    const yours = assignees.length > 0;

    if (p.dominant_hand && (yours || p.is_starter)) {
      const right = p.dominant_hand === "R";
      out.push({
        prompt: yours ? `You're guarding ${who}. What's his strong hand?` : `What's ${who}'s strong hand?`,
        options: right ? ["Right", "Left"] : ["Left", "Right"],
        correctIndex: 0,
        explanation: `${who} is ${right ? "right" : "left"}-handed.${p.plan_to_guard.length ? ` Plan: ${p.plan_to_guard.join(" · ")}.` : ""}`,
        source: "sheet",
        family: yours ? "matchup_hand" : "personnel_hand",
        assigneeIds: assignees,
      });
    }
    if (!yours) continue;   // the rest only make sense for his defender
    push(chipQuestion({
      prompt: `What's our plan to guard ${who}?`,
      onSheet: p.plan_to_guard, pool: PLAN_TO_GUARD_STARTERS,
      family: "matchup_plan", assigneeIds: assignees, explanationPrefix: `Plan to guard ${who}`,
    }));
    push(chipQuestion({
      prompt: `What does ${who} do best?`,
      onSheet: p.offensive_strengths, pool: OFF_STRENGTH_STARTERS,
      family: "matchup_strength", assigneeIds: assignees, explanationPrefix: `${who}'s strengths`,
    }));
    push(chipQuestion({
      prompt: `How do we attack ${who} when he's guarding us?`,
      onSheet: p.plan_to_attack, pool: PLAN_TO_ATTACK_STARTERS,
      family: "matchup_attack", assigneeIds: assignees, explanationPrefix: `Plan to attack ${who}`,
    }));
  }

  // ── Personnel, for everyone: "which of these is a shooter?" ──
  // One question per strength that 1-2 players have and at least two
  // don't, capped at three so the quiz isn't all personnel.
  const labelled = players.filter(p => p.number || p.name);
  let personnelCount = 0;
  for (const chip of ["Shooter", "Driver", "Post up", "Rebounder", "Playmaker"]) {
    if (personnelCount >= 3) break;
    const has = labelled.filter(p => p.offensive_strengths.some(s => s.toLowerCase() === chip.toLowerCase()));
    const lacks = labelled.filter(p => !has.includes(p));
    if (has.length < 1 || has.length > 2 || lacks.length < 2) continue;
    const right = shuffle(has)[0];
    const wrong = shuffle(lacks).slice(0, 3);
    out.push({
      prompt: `Which of their players is a ${chip.toLowerCase()}?`,
      options: [scoutPlayerLabel(right), ...wrong.map(scoutPlayerLabel)],
      correctIndex: 0,
      explanation: `${has.map(scoutPlayerLabel).join(" and ")} — ${chip.toLowerCase()}.`,
      source: "sheet",
      family: `personnel_${chip.toLowerCase().replace(/\s+/g, "_")}`,
      assigneeIds: [],
    });
    personnelCount++;
  }

  // ── Team offense ──
  push(chipQuestion({
    prompt: "Which of these is a strength of their offense?",
    onSheet: sheet.team_offensive_strengths ?? [], pool: TEAM_OFF_STRENGTH_STARTERS,
    family: "team_offense", explanationPrefix: "Their offense",
  }));

  // ── Defense ──
  const bySlot: Record<string, any> = {};
  defense.forEach(d => { bySlot[d.slot] = d.data; });

  const defenseQuestions = (data: any, label: "main" | "secondary") => {
    if (!data?.base) return;
    const their = label === "main" ? "their" : "their secondary";
    out.push({
      prompt: label === "main" ? "What's their main defense?" : "What's their secondary defense?",
      options: data.base === "man" ? ["Man", "Zone"] : ["Zone", "Man"],
      correctIndex: 0,
      explanation: `${label === "main" ? "Main" : "Secondary"} defense: ${data.base}.`,
      source: "sheet", family: `defense_${label}_base`, assigneeIds: [],
    });
    if (data.base === "man" && data.man) {
      const m = data.man;
      if (label === "main" && m.court) {
        out.push({
          prompt: "Do they pick up full court or half court?",
          options: m.court === "full" ? ["Full court", "Half court"] : ["Half court", "Full court"],
          correctIndex: 0, explanation: `They pick up ${m.court} court.`,
          source: "sheet", family: "defense_court", assigneeIds: [],
        });
      }
      push(chipQuestion({ prompt: `How does ${their} man defense guard ball screens?`, onSheet: m.ballScreen ?? [], pool: BALL_SCREEN_OPTS, family: `defense_${label}_ball_screen`, explanationPrefix: "Ball screens" }));
      push(chipQuestion({ prompt: "What's our plan against their ball-screen coverage?", onSheet: m.ballScreenPlan ?? [], pool: BALL_SCREEN_PLAN_OPTS, family: `defense_${label}_ball_screen_plan`, explanationPrefix: "Our plan" }));
      push(chipQuestion({ prompt: `How does ${their} man defense guard off-ball screens?`, onSheet: m.offBall ?? [], pool: OFF_BALL_OPTS, family: `defense_${label}_off_ball`, explanationPrefix: "Off-ball screens" }));
      push(chipQuestion({ prompt: "What's our plan against their off-ball screen defense?", onSheet: m.offBallPlan ?? [], pool: OFF_BALL_PLAN_OPTS, family: `defense_${label}_off_ball_plan`, explanationPrefix: "Our plan" }));
      push(chipQuestion({ prompt: `Which describes ${their} man defense?`, onSheet: m.structure ?? [], pool: STRUCTURE_OPTS, family: `defense_${label}_structure`, explanationPrefix: "Their man defense" }));
      push(chipQuestion({ prompt: "What's our plan against their man defense?", onSheet: m.structurePlan ?? [], pool: STRUCTURE_PLAN_OPTS, family: `defense_${label}_structure_plan`, explanationPrefix: "Our plan" }));
    }
    if (data.base === "zone" && data.zone) {
      const z = data.zone;
      push(chipQuestion({ prompt: `What zone ${label === "main" ? "do they play" : "do they switch to"}?`, onSheet: z.type ?? [], pool: ZONE_TYPE_OPTS, family: `defense_${label}_zone_type`, explanationPrefix: "Their zone" }));
      push(chipQuestion({ prompt: "Which describes their zone?", onSheet: z.structure ?? [], pool: ZONE_STRUCTURE_OPTS, family: `defense_${label}_zone_structure`, explanationPrefix: "Their zone" }));
      push(chipQuestion({ prompt: "What's our plan against their zone?", onSheet: z.plan ?? [], pool: ZONE_PLAN_OPTS, family: `defense_${label}_zone_plan`, explanationPrefix: "Our plan" }));
    }
  };
  defenseQuestions(bySlot.primary, "main");
  defenseQuestions(bySlot.secondary, "secondary");

  push(chipQuestion({ prompt: "What press do they run?", onSheet: bySlot.press?.chips ?? [], pool: PRESS_OPTS, family: "press", explanationPrefix: "Their press" }));
  push(chipQuestion({ prompt: "What's our press break against them?", onSheet: bySlot.press?.plan ?? [], pool: PRESS_PLAN_OPTS, family: "press_plan", explanationPrefix: "Our press break" }));
  push(chipQuestion({ prompt: "How do they defend our out-of-bounds plays?", onSheet: bySlot.blob_slob_d?.chips ?? [], pool: BLOB_SLOB_D_OPTS, family: "oob_defense", explanationPrefix: "Their inbounds defense" }));
  push(chipQuestion({ prompt: "What's our plan against their inbounds defense?", onSheet: bySlot.blob_slob_d?.plan ?? [], pool: BLOB_SLOB_D_PLAN_OPTS, family: "oob_defense_plan", explanationPrefix: "Our plan" }));

  return out;
}

/** AI drafts from the sheet's free-text fields (edge function quiz-draft). */
export async function draftQuestionsWithAi(scoutSheetId: string, count = 6): Promise<QuestionDraft[]> {
  const { data, error } = await supabase.functions.invoke("quiz-draft", { body: { scoutSheetId, count } });
  if (error) {
    // functions.invoke hides the body on a non-2xx; dig the message out.
    let msg = error.message;
    try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch { /* keep msg */ }
    throw new Error(msg || "Couldn't draft questions.");
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  const list = ((data as any)?.questions ?? []) as any[];
  return list
    .filter(q => typeof q?.prompt === "string" && Array.isArray(q.options) && q.options.length >= 2)
    .map(q => ({
      prompt: String(q.prompt),
      options: q.options.map((o: any) => String(o)).slice(0, 5),
      correctIndex: Math.max(0, Math.min(Number(q.correct) || 0, q.options.length - 1)),
      explanation: q.explanation ? String(q.explanation) : null,
      source: "ai" as const,
      family: null,
      assigneeIds: [],
    }));
}

// ── Reading (coach) ──────────────────────────────────────────

export async function getQuizzesForSheet(scoutSheetId: string): Promise<Quiz[]> {
  const { data, error } = await supabase.from("quizzes").select("*")
    .eq("scout_sheet_id", scoutSheetId).order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Quiz[];
}

export async function getQuizBundle(quizId: string): Promise<QuizBundle> {
  const { data: quiz, error } = await supabase.from("quizzes").select("*").eq("id", quizId).single();
  if (error) throw error;
  const { data: qs, error: qErr } = await supabase.from("quiz_questions").select("*")
    .eq("quiz_id", quizId).order("sort_order").order("created_at");
  if (qErr) throw qErr;
  const ids = (qs ?? []).map((q: any) => q.id);
  const [opts, keys, assignees] = ids.length
    ? await Promise.all([
        supabase.from("quiz_question_options").select("*").in("question_id", ids).order("sort_order"),
        supabase.from("quiz_answer_keys").select("*").in("question_id", ids),
        supabase.from("quiz_question_assignees").select("*").in("question_id", ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }] as any[];
  const optsBy = new Map<string, QuizOption[]>();
  for (const o of (opts.data ?? []) as any[]) {
    const list = optsBy.get(o.question_id) ?? [];
    list.push({ id: o.id, label: o.label, sort_order: o.sort_order });
    optsBy.set(o.question_id, list);
  }
  const keyBy = new Map<string, any>(((keys.data ?? []) as any[]).map(k => [k.question_id, k]));
  const assignBy = new Map<string, string[]>();
  for (const a of (assignees.data ?? []) as any[]) {
    const list = assignBy.get(a.question_id) ?? [];
    list.push(a.player_id);
    assignBy.set(a.question_id, list);
  }
  return {
    quiz: quiz as Quiz,
    questions: ((qs ?? []) as any[]).map(q => ({
      id: q.id, quiz_id: q.quiz_id, sort_order: q.sort_order, prompt: q.prompt,
      source: q.source, family: q.family,
      options: optsBy.get(q.id) ?? [],
      correct_option_id: keyBy.get(q.id)?.correct_option_id ?? null,
      explanation: keyBy.get(q.id)?.explanation ?? null,
      assignee_ids: assignBy.get(q.id) ?? [],
      qtype: q.qtype ?? null,
      visual: q.visual ?? null,
      reveal: q.reveal ?? null,
    })),
  };
}

// ── Writing (coach, drafts) ──────────────────────────────────

/**
 * Saves several new questions to a draft in a handful of round trips
 * (one insert per table) rather than four per question.
 */
export async function addQuestions(quizId: string, drafts: QuestionDraft[], startOrder: number): Promise<void> {
  const clean = drafts
    .map(d => ({ ...d, prompt: d.prompt.trim(), options: d.options.map(o => o.trim()) }))
    .filter(d => d.prompt && d.options.filter(Boolean).length >= 2);
  if (!clean.length) return;

  const { data: qRows, error: qErr } = await supabase.from("quiz_questions")
    .insert(clean.map((d, i) => ({
      quiz_id: quizId, sort_order: startOrder + i, prompt: d.prompt, source: d.source, family: d.family,
      qtype: d.qtype ?? null, visual: d.visual ?? null, reveal: d.reveal ?? null,
    })))
    .select("id, sort_order");
  if (qErr) throw qErr;
  const qIdByOrder = new Map<number, string>(((qRows ?? []) as any[]).map(r => [r.sort_order, r.id]));

  const optionRows: { question_id: string; label: string; sort_order: number }[] = [];
  clean.forEach((d, i) => {
    const qid = qIdByOrder.get(startOrder + i)!;
    d.options.forEach((label, j) => { if (label) optionRows.push({ question_id: qid, label, sort_order: j }); });
  });
  const { data: oRows, error: oErr } = await supabase.from("quiz_question_options").insert(optionRows).select("id, question_id, sort_order");
  if (oErr) throw oErr;
  const optId = (qid: string, order: number) =>
    ((oRows ?? []) as any[]).find(o => o.question_id === qid && o.sort_order === order)?.id as string | undefined;

  const keyRows = clean.map((d, i) => {
    const qid = qIdByOrder.get(startOrder + i)!;
    // correctIndex counts every option the coach typed; blanks were
    // skipped above, so find the option at that original position.
    return { question_id: qid, correct_option_id: optId(qid, d.correctIndex), explanation: d.explanation?.trim() || null };
  }).filter(k => k.correct_option_id);
  if (keyRows.length) {
    const { error: kErr } = await supabase.from("quiz_answer_keys").insert(keyRows);
    if (kErr) throw kErr;
  }

  const assignRows = clean.flatMap((d, i) =>
    d.assigneeIds.map(pid => ({ question_id: qIdByOrder.get(startOrder + i)!, player_id: pid })));
  if (assignRows.length) {
    const { error: aErr } = await supabase.from("quiz_question_assignees").insert(assignRows);
    if (aErr) throw aErr;
  }
}

/**
 * The draft for this sheet: generates one if there isn't one.
 *
 * Regenerating (a published version exists) builds the sheet questions
 * fresh from the sheet as it is NOW, and carries over every question the
 * coach wrote or kept from the AI -- regenerating to pick up a matchup
 * change shouldn't throw away hand-written work. The live version stays
 * live until this draft is published.
 */
export async function createDraftForSheet(scoutSheetId: string): Promise<string> {
  const existing = await getQuizzesForSheet(scoutSheetId);
  const draft = existing.find(q => q.status === "draft");
  if (draft) return draft.id;

  const sheet = await getScoutSheet(scoutSheetId);
  if (!sheet) throw new Error("Scout sheet not found");
  const ctx = await getScoutSheetPrintContext(sheet.game_id, sheet.opponent_id);
  const previous = existing.find(q => q.status === "published") ?? existing[0] ?? null;
  const { data: { user } } = await supabase.auth.getUser();
  // A scout quiz goes to the game's team.
  const { data: game } = await supabase.from("games").select("roster_id").eq("id", sheet.game_id).maybeSingle();
  const gameRoster = (game as any)?.roster_id as string | null | undefined;

  const { data: created, error } = await supabase.from("quizzes").insert({
    scout_sheet_id: scoutSheetId,
    game_id: sheet.game_id,
    title: `${ctx.opponentName} scout`,
    version: (existing[0]?.version ?? 0) + 1,
    feedback_mode: previous?.feedback_mode ?? "end",
    allow_retakes: previous?.allow_retakes ?? false,
    time_limit_seconds: previous?.time_limit_seconds ?? null,
    show_time_to_coaches: previous?.show_time_to_coaches ?? false,
    roster_ids: gameRoster ? [gameRoster] : (previous?.roster_ids ?? []),
    created_by: user?.id ?? null,
  }).select().single();
  if (error) throw error;
  const quizId = (created as any).id as string;

  try {
    const fromSheet = await buildQuestionsFromSheet(scoutSheetId);
    let carried: QuestionDraft[] = [];
    if (previous) {
      const prev = await getQuizBundle(previous.id);
      carried = prev.questions.filter(q => q.source !== "sheet").map(q => ({
        prompt: q.prompt,
        options: q.options.map(o => o.label),
        correctIndex: Math.max(0, q.options.findIndex(o => o.id === q.correct_option_id)),
        explanation: q.explanation,
        source: q.source,
        family: q.family,
        assigneeIds: q.assignee_ids,
      }));
    }
    await addQuestions(quizId, [...fromSheet, ...carried], 0);
  } catch (e) {
    // Don't leave a half-built draft behind.
    await supabase.from("quizzes").delete().eq("id", quizId);
    throw e;
  }
  return quizId;
}

// ── Play quizzes (163) ───────────────────────────────────────

const ACTION_WORD: Record<string, string> = {
  move: "Cut", screen: "Set a screen", pass: "Pass", dribble: "Dribble", shot: "Shoot", lob: "Throw a lob",
};
const ACTION_SENTENCE: Record<string, string> = {
  move: "cuts", screen: "sets a screen", pass: "passes", dribble: "dribbles", shot: "shoots", lob: "throws a lob",
};

/** A frame stripped to what a question may show: positions only. The
 *  player the question is about is marked so the court draws them gold. */
function positionsOnly(f: PlayFrame, focusId?: string): PlayFrame {
  return {
    players: f.players.map(p => ({ ...p, profile_id: null, handoff: false, quizFocus: !!focusId && p.id === focusId })),
    defenders: f.defenders.map(d => ({ ...d })),
    ball: f.ball ? { ...f.ball } : null,
    ballHolderId: f.ballHolderId ?? null,
    actions: [],
    // Court text and drawings can describe the very move being asked
    // about, so they stay out of the question.
  };
}

/** A full step for the reveal, without links to real players. */
function cleanStep(f: PlayFrame, focusId?: string): PlayFrame {
  return { ...f, players: f.players.map(p => ({ ...p, profile_id: null, quizFocus: !!focusId && p.id === focusId })), note: undefined };
}

function playCaption(play: Play, i: number): string {
  const f = play.data.frames[i];
  // The ball is drawn over whoever has it, which can hide their number.
  const holder = f?.ballHolderId ? f.players.find(p => p.id === f.ballHolderId) : undefined;
  return `${play.title} · ${stepName(f, i)}${i === 0 ? " · Start of the play" : ""}${holder ? ` · the ${holder.num} has the ball` : ""}`;
}

function playHeading(play: Play, i: number): QuizHeading {
  const f = play.data.frames[i];
  const holder = f?.ballHolderId ? f.players.find(p => p.id === f.ballHolderId) : undefined;
  return {
    play: play.title,
    stepNumber: i + 1,
    stepName: f?.label?.trim() || null,
    ballHolder: holder ? holder.num : null,
  };
}

/** The steps before step i, for the lead-up. */
function leadUp(play: Play, i: number, focusId?: string): PlayFrame[] {
  return play.data.frames.slice(0, i).map(f => cleanStep(f, focusId));
}

function pickN<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, Math.max(0, n));
}

/**
 * Builds play questions from plays as drawn. Every answer comes from the
 * drawing itself, so it's right by construction. Steps' coaching notes,
 * when written, become the explanation.
 */
export function buildPlayQuestions(plays: Play[], settings: PlayQuizSettings): QuestionDraft[] {
  const per = settings.types;
  const out: QuestionDraft[] = [];
  const titled = plays.filter(p => p.title?.trim());

  for (const play of plays) {
    const frames = play.data?.frames ?? [];
    const template = play.court_template;

    // ── What happens next: one player's first action on a step ──
    if (per.what_next) {
      const pool: { i: number; num: number; id: string; action: PlayAction; many: boolean }[] = [];
      frames.forEach((f, i) => {
        for (const p of f.players) {
          if (!p.id) continue;
          const mine = f.actions
            .filter(a => a.sourcePlayerId === p.id)
            .sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
          if (mine.length && ACTION_WORD[mine[0].type]) pool.push({ i, num: p.num, id: p.id, action: mine[0], many: mine.length > 1 });
        }
      });
      for (const c of pickN(pool, per.what_next)) {
        const right = ACTION_WORD[c.action.type];
        const wrong = pickN(Object.values(ACTION_WORD).filter(w => w !== right), 3);
        const note = frames[c.i].note?.trim();
        out.push({
          prompt: `What does the ${c.num} do${c.many ? " first" : ""} on this step?`,
          options: [right, ...wrong], correctIndex: 0,
          explanation: `The ${c.num} ${ACTION_SENTENCE[c.action.type]}.${note ? ` Coach's note: ${note}` : ""}`,
          source: "sheet", family: null, assigneeIds: [], qtype: "what_next",
          visual: { court_template: template, frames: [positionsOnly(frames[c.i], c.id)], lead_frames: leadUp(play, c.i, c.id), caption: playCaption(play, c.i), heading: playHeading(play, c.i) },
          reveal: { court_template: template, frame: cleanStep(frames[c.i], c.id), caption: playCaption(play, c.i), heading: playHeading(play, c.i) },
        });
      }
    }

    // ── Who gets the ball: a pass with a known receiver ──
    if (per.who_ball) {
      const pool: { i: number; from: number; fromId: string; to: number; others: number[] }[] = [];
      frames.forEach((f, i) => {
        for (const a of f.actions) {
          if ((a.type !== "pass" && a.type !== "lob") || !a.sourcePlayerId || !a.targetPlayerId) continue;
          const from = f.players.find(p => p.id === a.sourcePlayerId);
          const to = f.players.find(p => p.id === a.targetPlayerId);
          if (!from || !to) continue;
          const others = f.players.filter(p => p.id !== from.id && p.id !== to.id).map(p => p.num);
          if (others.length >= 1) pool.push({ i, from: from.num, fromId: from.id!, to: to.num, others });
        }
      });
      for (const c of pickN(pool, per.who_ball)) {
        const note = frames[c.i].note?.trim();
        out.push({
          prompt: `Who does the ${c.from} pass to on this step?`,
          options: [`The ${c.to}`, ...pickN(c.others, 3).map(n => `The ${n}`)], correctIndex: 0,
          explanation: `The ${c.from} passes to the ${c.to}.${note ? ` Coach's note: ${note}` : ""}`,
          source: "sheet", family: null, assigneeIds: [], qtype: "who_ball",
          visual: { court_template: template, frames: [positionsOnly(frames[c.i], c.fromId)], lead_frames: leadUp(play, c.i, c.fromId), caption: playCaption(play, c.i), heading: playHeading(play, c.i) },
          reveal: { court_template: template, frame: cleanStep(frames[c.i], c.fromId), caption: playCaption(play, c.i), heading: playHeading(play, c.i) },
        });
      }
    }

    // ── Name that play: watch the opening, court hides, pick the title ──
    if (per.name_play && frames.some(f => f.actions.length) && titled.length >= 3) {
      const others = titled.filter(p => p.id !== play.id && p.title.trim().toLowerCase() !== play.title.trim().toLowerCase());
      const wrong = pickN([...new Set(others.map(p => p.title.trim()))], 3);
      if (wrong.length >= 2) {
        const opening = frames.slice(0, Math.min(2, frames.length)).map(f => ({
          ...cleanStep(f), label: undefined, texts: [], drawings: [],
        }));
        for (let k = 0; k < Math.min(per.name_play, 1); k++) {
          out.push({
            prompt: "Which play was that?",
            options: [play.title.trim(), ...wrong], correctIndex: 0,
            explanation: `That's ${play.title.trim()}.`,
            source: "sheet", family: null, assigneeIds: [], qtype: "name_play",
            visual: { court_template: template, frames: opening, hide_after: true, caption: null },
            reveal: null,
          });
        }
      }
    }
  }

  // Cap the total, keeping a mix of types rather than cutting one off.
  const max = Math.max(1, settings.maxQuestions || out.length);
  if (out.length <= max) return out;
  const byType = new Map<string, QuestionDraft[]>();
  shuffle(out).forEach(q => { const k = q.qtype ?? ""; byType.set(k, [...(byType.get(k) ?? []), q]); });
  const kept: QuestionDraft[] = [];
  while (kept.length < max) {
    let added = false;
    for (const list of byType.values()) {
      if (kept.length >= max) break;
      const q = list.shift();
      if (q) { kept.push(q); added = true; }
    }
    if (!added) break;
  }
  return kept;
}

/** The plays a play quiz builds from: its playbook's, or the hand-picked ones. */
async function loadSourcePlays(playbookId: string | null, playIds: string[]): Promise<{ plays: Play[]; skipped: number }> {
  if (playbookId) {
    const rows = await getPlaybookPlays(playbookId);
    // A coach can only read plays they own or that were shared with them;
    // the rest come back empty and are skipped.
    const plays = rows.filter(r => r && (r as any).id && (r as any).data) as Play[];
    return { plays, skipped: rows.length - plays.length };
  }
  if (!playIds.length) return { plays: [], skipped: 0 };
  const { data, error } = await supabase.from("plays").select("*").in("id", playIds);
  if (error) throw error;
  const plays = (data ?? []) as Play[];
  return { plays, skipped: playIds.length - plays.length };
}

export interface PlayQuizInput {
  title: string;
  playbookId: string | null;
  playIds: string[];
  rosterIds: string[];
  dueAt: string | null;
  settings: PlayQuizSettings;
}

/** Creates a play quiz draft and fills it. Returns its id and how many questions it got. */
export async function createPlayQuiz(input: PlayQuizInput): Promise<{ id: string; count: number; skipped: number }> {
  if (!input.title.trim()) throw new Error("Give the quiz a title.");
  if (!input.rosterIds.length) throw new Error("Pick at least one team.");
  if (!input.playbookId && !input.playIds.length) throw new Error("Pick a playbook or some plays.");
  if (!Object.values(input.settings.types).some(n => (n ?? 0) > 0)) throw new Error("Pick at least one question type.");

  const { plays, skipped } = await loadSourcePlays(input.playbookId, input.playIds);
  const drafts = buildPlayQuestions(plays, input.settings);
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("quizzes").insert({
    title: input.title.trim(),
    roster_ids: input.rosterIds,
    due_at: input.dueAt,
    playbook_id: input.playbookId,
    source_play_ids: input.playbookId ? plays.map(p => p.id) : input.playIds,
    play_settings: input.settings,
    created_by: user?.id ?? null,
  }).select("id").single();
  if (error) throw error;
  const id = (data as any).id as string;
  try {
    await addQuestions(id, drafts, 0);
  } catch (e) {
    await supabase.from("quizzes").delete().eq("id", id);
    throw e;
  }
  return { id, count: drafts.length, skipped };
}

/**
 * Rebuilds a play quiz from its plays as they are now, with the same
 * types and counts. A draft is rebuilt in place; a published quiz gets a
 * new draft version that replaces it when published (it stays live until
 * then). Questions the coach wrote by hand carry over either way.
 * Returns the id of the draft to open.
 */
export async function regeneratePlayQuiz(quizId: string): Promise<string> {
  const quiz = await getQuiz(quizId);
  if (!quiz) throw new Error("Quiz not found.");
  const settings = quiz.play_settings as PlayQuizSettings;
  if (!settings?.types) throw new Error("This quiz wasn't built from plays.");
  const bundle = await getQuizBundle(quizId);
  const handWritten: QuestionDraft[] = bundle.questions.filter(q => !q.qtype && q.source !== "sheet").map(q => ({
    prompt: q.prompt,
    options: q.options.map(o => o.label),
    correctIndex: Math.max(0, q.options.findIndex(o => o.id === q.correct_option_id)),
    explanation: q.explanation, source: q.source, family: q.family, assigneeIds: q.assignee_ids,
  }));
  const { plays } = await loadSourcePlays(quiz.playbook_id, quiz.source_play_ids);
  const drafts = [...buildPlayQuestions(plays, settings), ...handWritten];

  if (quiz.status === "draft") {
    const { error } = await supabase.from("quiz_questions").delete().eq("quiz_id", quizId);
    if (error) throw error;
    await addQuestions(quizId, drafts, 0);
    return quizId;
  }

  // An existing draft of the next version is reused rather than doubled.
  const { data: existing } = await supabase.from("quizzes").select("id").eq("replaces_quiz_id", quizId).eq("status", "draft").maybeSingle();
  if ((existing as any)?.id) return (existing as any).id as string;

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("quizzes").insert({
    title: quiz.title, roster_ids: quiz.roster_ids, due_at: quiz.due_at,
    playbook_id: quiz.playbook_id, source_play_ids: quiz.playbook_id ? plays.map(p => p.id) : quiz.source_play_ids,
    play_settings: settings, version: quiz.version + 1, replaces_quiz_id: quiz.id,
    feedback_mode: quiz.feedback_mode, allow_retakes: quiz.allow_retakes,
    time_limit_seconds: quiz.time_limit_seconds, show_time_to_coaches: quiz.show_time_to_coaches,
    created_by: user?.id ?? null,
  }).select("id").single();
  if (error) throw error;
  const id = (data as any).id as string;
  try { await addQuestions(id, drafts, 0); }
  catch (e) { await supabase.from("quizzes").delete().eq("id", id); throw e; }
  return id;
}

/** A game a scout quiz can be made for (the Quizzes page's game picker). */
export interface QuizGameOption {
  id: string;
  game_date: string;
  tip_time: string | null;
  opponent: string | null;
  roster_id: string | null;
}

/** Games from two weeks ago onward, soonest first. */
export async function getGamesForScoutQuiz(): Promise<QuizGameOption[]> {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { data, error } = await supabase.from("games")
    .select("id, game_date, tip_time, opponent, roster_id")
    .gte("game_date", from)
    .order("game_date").order("tip_time");
  if (error) throw error;
  return (data ?? []) as QuizGameOption[];
}

/**
 * A game's scout quiz, from the Quizzes page. Makes the game's scout
 * sheet if it doesn't have one (same as the Schedule's Scout sheet
 * button), then builds the quiz from it -- unless the sheet already has a
 * quiz, in which case that one is returned rather than a second version.
 * Returns the scout sheet id; the editor opens on the sheet's quiz.
 */
export async function createScoutQuizForGame(gameId: string): Promise<string> {
  const { sheet } = await ensureScoutSheetForGame(gameId);
  const existing = await getQuizzesForSheet(sheet.id);
  if (!existing.length) await createDraftForSheet(sheet.id);
  return sheet.id;
}

/** A quiz that isn't tied to a scout sheet (terms, rules, later plays). */
export async function createStandaloneQuiz(title: string, rosterIds: string[], dueAt: string | null): Promise<string> {
  if (!title.trim()) throw new Error("Give the quiz a title.");
  if (!rosterIds.length) throw new Error("Pick at least one team.");
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("quizzes").insert({
    title: title.trim(), roster_ids: rosterIds, due_at: dueAt, created_by: user?.id ?? null,
  }).select("id").single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function getQuiz(quizId: string): Promise<Quiz | null> {
  const { data, error } = await supabase.from("quizzes").select("*").eq("id", quizId).maybeSingle();
  if (error) throw error;
  return (data as Quiz) ?? null;
}

/** A row on the coach's Quizzes page. */
export interface QuizListItem {
  quiz: Quiz;
  kind: QuizKind;
  gameDate: string | null;
  tipTime: string | null;
  submitted: number;   // players with a finished attempt
}

/**
 * Every quiz version a coach can see, newest first, with its game and how
 * many players have finished it. Archived versions are left out except
 * when they're the only version of a scout quiz.
 */
export async function getAllQuizzes(): Promise<QuizListItem[]> {
  const { data, error } = await supabase.from("quizzes").select("*, games(game_date, tip_time)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  // An archived version is hidden when a newer one exists (same scout
  // sheet, or a play quiz version that replaced it). Drafts that replace a
  // live play quiz are opened from that quiz rather than listed twice.
  const visible = rows.filter(r => {
    if (r.replaces_quiz_id && r.status === "draft" && rows.some(o => o.id === r.replaces_quiz_id && o.status === "published")) return false;
    if (r.status !== "archived") return true;
    const newerSheet = rows.some(o => o.id !== r.id && o.scout_sheet_id && o.scout_sheet_id === r.scout_sheet_id && o.status !== "archived");
    const replacedBy = rows.some(o => o.replaces_quiz_id === r.id);
    return !newerSheet && !replacedBy;
  });
  const ids = visible.map(r => r.id);
  const { data: attempts } = ids.length
    ? await supabase.from("quiz_attempts").select("quiz_id, player_id").in("quiz_id", ids).not("submitted_at", "is", null)
    : { data: [] as any[] };
  const doneBy = new Map<string, Set<string>>();
  for (const a of (attempts ?? []) as any[]) {
    const set = doneBy.get(a.quiz_id) ?? new Set<string>();
    set.add(a.player_id);
    doneBy.set(a.quiz_id, set);
  }
  return visible.map(r => {
    const g = Array.isArray(r.games) ? r.games[0] : r.games;
    const { games: _g, ...quiz } = r;
    return {
      quiz: quiz as Quiz,
      kind: quizKind(quiz),
      gameDate: g?.game_date ?? null,
      tipTime: g?.tip_time ?? null,
      submitted: doneBy.get(r.id)?.size ?? 0,
    };
  });
}

/** How many re-teach flags a published quiz has right now. */
export async function getReteachCount(quizId: string): Promise<number> {
  const bundle = await getQuizBundle(quizId);
  const results = await getQuizResults(bundle);
  return results.flags.length;
}

/** Replaces a draft question in full (prompt, answers, key, assignees). */
export async function saveDraftQuestion(question: QuizQuestion, d: QuestionDraft): Promise<void> {
  const options = d.options.map(o => o.trim());
  if (!d.prompt.trim()) throw new Error("The question can't be blank.");
  if (options.filter(Boolean).length < 2) throw new Error("Give it at least two answers.");
  if (!options[d.correctIndex]) throw new Error("Mark which answer is correct.");

  const { error: qErr } = await supabase.from("quiz_questions").update({ prompt: d.prompt.trim() }).eq("id", question.id);
  if (qErr) throw qErr;
  // Options are replaced outright; the key goes with them (cascade).
  const { error: dErr } = await supabase.from("quiz_question_options").delete().eq("question_id", question.id);
  if (dErr) throw dErr;
  const rows = options.map((label, j) => ({ question_id: question.id, label, sort_order: j })).filter(r => r.label);
  const { data: oRows, error: oErr } = await supabase.from("quiz_question_options").insert(rows).select("id, sort_order");
  if (oErr) throw oErr;
  const correctId = ((oRows ?? []) as any[]).find(o => o.sort_order === d.correctIndex)?.id;
  const { error: kErr } = await supabase.from("quiz_answer_keys")
    .upsert({ question_id: question.id, correct_option_id: correctId, explanation: d.explanation?.trim() || null });
  if (kErr) throw kErr;

  await supabase.from("quiz_question_assignees").delete().eq("question_id", question.id);
  if (d.assigneeIds.length) {
    const { error: aErr } = await supabase.from("quiz_question_assignees")
      .insert(d.assigneeIds.map(pid => ({ question_id: question.id, player_id: pid })));
    if (aErr) throw aErr;
  }
}

/**
 * Wording fixes on a PUBLISHED quiz: the question text, the answer labels,
 * and the explanation. The database refuses anything else.
 */
export async function saveWording(question: QuizQuestion, prompt: string, labels: Record<string, string>, explanation: string | null): Promise<void> {
  if (!prompt.trim()) throw new Error("The question can't be blank.");
  if (prompt.trim() !== question.prompt) {
    const { error } = await supabase.from("quiz_questions").update({ prompt: prompt.trim() }).eq("id", question.id);
    if (error) throw error;
  }
  for (const o of question.options) {
    const next = (labels[o.id] ?? o.label).trim();
    if (next && next !== o.label) {
      const { error } = await supabase.from("quiz_question_options").update({ label: next }).eq("id", o.id);
      if (error) throw error;
    }
  }
  if ((explanation ?? "").trim() !== (question.explanation ?? "")) {
    const { error } = await supabase.from("quiz_answer_keys")
      .update({ explanation: explanation?.trim() || null }).eq("question_id", question.id);
    if (error) throw error;
  }
}

export async function deleteQuestion(questionId: string) {
  const { error } = await supabase.from("quiz_questions").delete().eq("id", questionId);
  if (error) throw error;
}

/** Swaps a draft question with its neighbour. */
export async function moveQuestion(questions: QuizQuestion[], index: number, dir: -1 | 1) {
  const j = index + dir;
  if (j < 0 || j >= questions.length) return;
  // Renumber everything so equal sort_orders can't make a swap a no-op.
  const order = questions.map(q => q.id);
  [order[index], order[j]] = [order[j], order[index]];
  await Promise.all(order.map((id, i) => supabase.from("quiz_questions").update({ sort_order: i }).eq("id", id)));
}

export async function updateQuizSettings(quizId: string, patch: Partial<QuizSettings>) {
  const { error } = await supabase.from("quizzes").update(patch).eq("id", quizId);
  if (error) throw error;
}

export async function publishQuiz(quizId: string) {
  const { error } = await supabase.rpc("publish_quiz", { p_quiz: quizId });
  if (error) throw new Error(error.message);
}

export async function deleteQuiz(quizId: string) {
  const { error } = await supabase.from("quizzes").delete().eq("id", quizId);
  if (error) throw error;
}

// ── Results (coach) ──────────────────────────────────────────

export interface PlayerResult {
  playerId: string;
  name: string;
  status: "submitted" | "in_progress" | "not_started";
  questionCount: number;
  attempts: { id: string; attemptNo: number; correct: number | null; total: number; seconds: number | null; submittedAt: string | null }[];
}

export interface QuestionResult {
  questionId: string;
  prompt: string;
  family: string | null;
  sentTo: number;        // players this question went to
  answered: number;      // ...who've finished a first attempt including it
  correct: number;
  assigned: boolean;
}

/** A re-teach flag: one question, or a whole matchup family. */
export interface ReteachFlag {
  key: string;
  label: string;
  missed: number;
  answered: number;
  questionId: string | null;   // null for a family
}

export interface QuizResults {
  players: PlayerResult[];
  questions: QuestionResult[];
  flags: ReteachFlag[];
  submittedCount: number;
  rosterCount: number;
  averagePct: number | null;
  averageSeconds: number | null;
}

const FAMILY_LABELS: Record<string, string> = {
  matchup_hand: "Your matchup's strong hand",
  matchup_plan: "Plan to guard your matchup",
  matchup_strength: "What your matchup does best",
  matchup_attack: "How to attack your matchup",
};

/**
 * Whether a miss rate is worth an alert. Needs enough answers to mean
 * something: 5 for a big group, half the group for a small one, and never
 * for a question that went to fewer than 3 players.
 */
export function shouldFlag(sentTo: number, answered: number, missed: number): boolean {
  if (sentTo < 3 || answered === 0) return false;
  const needed = sentTo >= 10 ? 5 : Math.ceil(sentTo / 2);
  return answered >= needed && missed / answered >= 0.5;
}

/**
 * Everything the results screen shows. Team numbers use each player's
 * FIRST finished attempt -- a retake after seeing the key would make a
 * question look learned when it wasn't the first time.
 */
export async function getQuizResults(bundle: QuizBundle): Promise<QuizResults> {
  const quizId = bundle.quiz.id;
  const [rosterRes, attemptsRes] = await Promise.all([
    supabase.rpc("quiz_roster", { p_quiz: quizId }),
    supabase.from("quiz_attempts").select("*").eq("quiz_id", quizId).order("attempt_no"),
  ]);
  if (rosterRes.error) throw rosterRes.error;
  if (attemptsRes.error) throw attemptsRes.error;
  const rosterIds = new Set<string>(((rosterRes.data ?? []) as any[]).map(r => (typeof r === "string" ? r : r.quiz_roster ?? r.id)));
  const attempts = (attemptsRes.data ?? []) as any[];

  // Who each question went to.
  const sentToBy = new Map<string, Set<string>>();
  const everyoneIds = new Set<string>(rosterIds);
  for (const q of bundle.questions) {
    sentToBy.set(q.id, q.assignee_ids.length ? new Set(q.assignee_ids) : new Set(everyoneIds));
  }
  const involved = new Set<string>(everyoneIds);
  bundle.questions.forEach(q => q.assignee_ids.forEach(id => involved.add(id)));
  attempts.forEach(a => involved.add(a.player_id));

  const ids = [...involved];
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, name").in("id", ids)
    : { data: [] as any[] };
  const nameBy = new Map<string, string>(((profiles ?? []) as any[]).map(p => [p.id, p.name]));

  const attemptIds = attempts.map(a => a.id);
  const { data: answers } = attemptIds.length
    ? await supabase.from("quiz_answers").select("*").in("attempt_id", attemptIds)
    : { data: [] as any[] };
  const answersBy = new Map<string, any[]>();
  for (const x of (answers ?? []) as any[]) {
    const list = answersBy.get(x.attempt_id) ?? [];
    list.push(x);
    answersBy.set(x.attempt_id, list);
  }

  const secondsOf = (a: any): number | null => {
    const list = answersBy.get(a.id) ?? [];
    if (!a.submitted_at || !list.length) return null;
    const first = Math.min(...list.map(x => new Date(x.served_at).getTime()));
    return Math.max(0, Math.round((new Date(a.submitted_at).getTime() - first) / 1000));
  };

  // Players
  const players: PlayerResult[] = ids
    .filter(pid => bundle.questions.some(q => sentToBy.get(q.id)!.has(pid)) || attempts.some(a => a.player_id === pid))
    .map(pid => {
      const mine = attempts.filter(a => a.player_id === pid);
      const anyDone = mine.some(a => a.submitted_at);
      const open = mine.some(a => !a.submitted_at);
      return {
        playerId: pid,
        name: nameBy.get(pid) ?? "Player",
        status: anyDone ? "submitted" : open ? "in_progress" : "not_started",
        questionCount: bundle.questions.filter(q => sentToBy.get(q.id)!.has(pid)).length,
        attempts: mine.map(a => ({
          id: a.id, attemptNo: a.attempt_no, correct: a.correct_count, total: a.total_count,
          seconds: secondsOf(a), submittedAt: a.submitted_at,
        })),
      } as PlayerResult;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // First finished attempt per player
  const firstDone = new Map<string, any>();
  for (const a of attempts) {
    if (!a.submitted_at) continue;
    const cur = firstDone.get(a.player_id);
    if (!cur || a.attempt_no < cur.attempt_no) firstDone.set(a.player_id, a);
  }

  const questions: QuestionResult[] = bundle.questions.map(q => {
    let answered = 0, correct = 0;
    for (const a of firstDone.values()) {
      const x = (answersBy.get(a.id) ?? []).find(r => r.question_id === q.id && r.answered_at);
      if (!x) continue;
      answered++;
      if (x.is_correct) correct++;
    }
    return {
      questionId: q.id, prompt: q.prompt, family: q.family,
      sentTo: sentToBy.get(q.id)!.size, answered, correct,
      assigned: q.assignee_ids.length > 0,
    };
  });

  // Re-teach flags: matchup families judged together, everything else
  // on its own.
  const flags: ReteachFlag[] = [];
  const families = new Map<string, QuestionResult[]>();
  for (const r of questions) {
    if (r.family && r.family.startsWith("matchup_") && r.assigned) {
      const list = families.get(r.family) ?? [];
      list.push(r);
      families.set(r.family, list);
      continue;
    }
    if (shouldFlag(r.sentTo, r.answered, r.answered - r.correct)) {
      flags.push({ key: r.questionId, label: r.prompt, missed: r.answered - r.correct, answered: r.answered, questionId: r.questionId });
    }
  }
  for (const [family, list] of families) {
    const sentTo = list.reduce((n, r) => n + r.sentTo, 0);
    const answered = list.reduce((n, r) => n + r.answered, 0);
    const missed = list.reduce((n, r) => n + (r.answered - r.correct), 0);
    if (shouldFlag(sentTo, answered, missed)) {
      flags.push({ key: family, label: FAMILY_LABELS[family] ?? family, missed, answered, questionId: null });
    }
  }

  const done = [...firstDone.values()];
  const pcts = done.filter(a => a.total_count > 0).map(a => (a.correct_count ?? 0) / a.total_count);
  const secs = done.map(secondsOf).filter((s): s is number => s != null);
  return {
    players, questions, flags,
    submittedCount: done.length,
    rosterCount: players.length,
    averagePct: pcts.length ? Math.round((pcts.reduce((s, x) => s + x, 0) / pcts.length) * 100) : null,
    averageSeconds: secs.length ? Math.round(secs.reduce((s, x) => s + x, 0) / secs.length) : null,
  };
}

export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// ── Re-teach → next practice ─────────────────────────────────

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Adds a "to cover" item to the next practice for this quiz's team(s):
 * the game's roster for a scout quiz, the quiz's own teams otherwise.
 * Prefers a practice BEFORE tip-off; if there isn't one, the next one
 * after. Returns that practice's date.
 */
export async function addToNextPractice(gameId: string | null, text: string, questionId: string | null, quizRosterIds: string[] = []): Promise<string> {
  let rosterId: string | null = null, gameDate: string | null = null, tipTime: string | null = null;
  if (gameId) {
    const { data: g } = await supabase.from("games").select("roster_id, game_date, tip_time").eq("id", gameId).maybeSingle();
    rosterId = (g as any)?.roster_id ?? null;
    gameDate = (g as any)?.game_date ?? null;
    tipTime = (g as any)?.tip_time ?? null;
  }
  const { data: practices, error } = await supabase.from("practices")
    .select("id, practice_date, start_time, roster_ids")
    .eq("is_template", false).eq("is_tryout", false)
    .gte("practice_date", localToday())
    .order("practice_date").order("start_time");
  if (error) throw error;
  const teamIds = rosterId ? [rosterId] : quizRosterIds;
  const forTeam = ((practices ?? []) as any[]).filter(p =>
    !teamIds.length || !(p.roster_ids ?? []).length || (p.roster_ids ?? []).some((r: string) => teamIds.includes(r)));
  if (!forTeam.length) throw new Error("No upcoming practice for this team. Create one first, then add it.");

  const beforeTip = (p: any) => {
    if (!gameDate) return true;
    if (p.practice_date < gameDate) return true;
    if (p.practice_date > gameDate) return false;
    return !!tipTime && !!p.start_time && p.start_time < tipTime;
  };
  const target = forTeam.find(beforeTip) ?? forTeam[0];

  const { data: { user } } = await supabase.auth.getUser();
  const { error: insErr } = await supabase.from("practice_cover_items").insert({
    practice_id: target.id, quiz_question_id: questionId, text, added_by: user?.id ?? null,
  });
  if (insErr) throw insErr;
  return target.practice_date as string;
}

export interface CoverItem { id: string; practice_id: string; text: string; done: boolean; created_at: string; }

export async function getCoverItems(practiceId: string): Promise<CoverItem[]> {
  const { data, error } = await supabase.from("practice_cover_items").select("id, practice_id, text, done, created_at")
    .eq("practice_id", practiceId).order("created_at");
  if (error) throw error;
  return (data ?? []) as CoverItem[];
}

export async function setCoverItemDone(id: string, done: boolean) {
  const { error } = await supabase.from("practice_cover_items").update({ done }).eq("id", id);
  if (error) throw error;
}

export async function deleteCoverItem(id: string) {
  const { error } = await supabase.from("practice_cover_items").delete().eq("id", id);
  if (error) throw error;
}

// ── Player side (all server functions) ───────────────────────

export interface MyQuiz {
  quiz_id: string;
  title: string;
  kind: QuizKind;
  due_at: string | null;
  playbook_id: string | null;
  scout_sheet_id: string | null;
  game_id: string | null;
  game_date: string | null;
  tip_time: string | null;
  opponent: string | null;
  feedback_mode: FeedbackMode;
  allow_retakes: boolean;
  time_limit_seconds: number | null;
  question_count: number;
  attempts: { id: string; attempt_no: number; submitted_at: string | null; correct_count: number | null; total_count: number }[];
}

export interface ServedOption { id: string; label: string; }

export interface ServedQuestion {
  done: boolean;
  question_id: string;
  prompt: string;
  qtype: PlayQType | null;
  visual: QuizVisual | null;
  options: ServedOption[];
  index: number;
  total: number;
  feedback_mode: FeedbackMode;
  time_limit: number | null;
  remaining: number | null;
}

export interface AnswerResult {
  recorded: boolean;
  finished: boolean;
  timed_out: boolean;
  correct?: boolean;
  correct_option_id?: string;
  explanation?: string | null;
  reveal?: QuizReveal | null;
}

export interface ReviewQuestion {
  question_id: string;
  prompt: string;
  qtype: PlayQType | null;
  visual: QuizVisual | null;
  reveal: QuizReveal | null;
  options: ServedOption[];
  chosen_option_id: string | null;
  correct_option_id: string | null;
  explanation: string | null;
  is_correct: boolean;
  timed_out: boolean;
}

export interface AttemptReview {
  quiz_id: string;
  title: string;
  attempt_no: number;
  correct_count: number;
  total_count: number;
  questions: ReviewQuestion[];
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

export const getMyQuizzes = () => rpc<MyQuiz[]>("my_quizzes").then(r => r ?? []);
export const startQuizAttempt = (quizId: string) => rpc<string>("start_quiz_attempt", { p_quiz: quizId });
export const getNextQuestion = (attemptId: string) => rpc<ServedQuestion>("quiz_next_question", { p_attempt: attemptId });
export const submitQuizAnswer = (attemptId: string, questionId: string, optionId: string | null) =>
  rpc<AnswerResult>("quiz_submit_answer", { p_attempt: attemptId, p_question: questionId, p_option: optionId });
export const getAttemptReview = (attemptId: string) => rpc<AttemptReview>("quiz_attempt_review", { p_attempt: attemptId });

export interface DeckQuestion {
  done: boolean;
  question_id: string;
  prompt: string;
  qtype: PlayQType | null;
  visual: QuizVisual | null;
  options: ServedOption[];
  quiz_title: string;
  remaining: number;
}
export interface DeckAnswer { correct: boolean; correct_option_id: string; explanation: string | null; reveal?: QuizReveal | null; remaining: number; }

export const getReviewDeckCount = () => rpc<number>("review_deck_count").then(n => n ?? 0);
export const getReviewDeckNext = (excludeId?: string | null) => rpc<DeckQuestion>("review_deck_next", { p_exclude: excludeId ?? null });
export const answerReviewDeck = (questionId: string, optionId: string) =>
  rpc<DeckAnswer>("review_deck_answer", { p_question: questionId, p_option: optionId });
