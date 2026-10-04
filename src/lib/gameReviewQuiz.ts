// src/lib/gameReviewQuiz.ts
// Game-review quizzes: questions from a game's end-of-game report.
//
// TEAM STATS ONLY. Nothing here reads individual or lineup stats, so a
// review is safe to run in live mode in front of the whole team.
//
// Five kinds, all about what the numbers MEAN rather than trivia:
//   1. Goal check      -- "Did we hit our goal for turnovers?"
//   2. Biggest gap     -- "Where did they beat us most?"
//   3. What worked     -- "Which of our sets scored best?" (sets, motion,
//                         zone, BLOB, SLOB; only calls run 2+ times)
//   4. Runs            -- "When did they go on their 10-0 run?"
//   5. Number ranges   -- only for count stats you set goals for
//
// Built once and saved (snapshot); Rebuild from game picks up corrections.

import { supabase } from "./supabase";
import {
  Possession, PlayCall, StatGoal, computeTeamStats, computePlayCallEffectiveness,
  computeExtraPossessions, computePointsOffLiveTurnovers, computeSecondChancePoints,
  countedPossessions, gameFormat, periodLabel,
} from "./gameStats";
import { addQuestions, QuestionDraft } from "./quizzes";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const draft = (prompt: string, options: string[], explanation: string, family: string): QuestionDraft => ({
  prompt, options, correctIndex: 0, explanation, source: "sheet", family, assigneeIds: [],
});

interface GameData {
  game: any;
  possessions: Possession[];
  goals: StatGoal[];
  playCalls: PlayCall[];
}

async function loadGame(gameId: string): Promise<GameData> {
  const [{ data: game, error: gErr }, { data: poss }, { data: goals }, { data: calls }] = await Promise.all([
    supabase.from("games").select("*").eq("id", gameId).single(),
    supabase.from("possessions").select("*").eq("game_id", gameId).order("sequence", { ascending: true }),
    supabase.from("stat_goals").select("*"),
    supabase.from("play_calls").select("*"),
  ]);
  if (gErr || !game) throw new Error("That game wasn't found.");
  return { game, possessions: (poss ?? []) as Possession[], goals: (goals ?? []) as StatGoal[], playCalls: (calls ?? []) as PlayCall[] };
}

/** Every question the game's numbers support. */
export function buildReviewQuestions({ game, possessions, goals, playCalls }: GameData): QuestionDraft[] {
  const out: QuestionDraft[] = [];
  const opp = (game.opponent as string) || "They";
  const counted = countedPossessions(possessions);
  if (!counted.length) return out;
  const fmt = gameFormat(game);

  // ── 1. Goal checks (and 5. ranges) from our stats with goals ──
  const ours = computeTeamStats(possessions, "us", goals)
    .filter(r => r.goal != null && !(r.sampleMin != null && (r.sampleN ?? 0) < r.sampleMin));
  const goalOf = (key: string) => goals.find(g => g.stat_key === key && g.team === "us");
  const shown = (r: { value: number; display?: string; raw?: string }) =>
    `${r.display ?? r.value}${r.raw ? ` (${r.raw})` : ""}`;
  const checks = ours.map(r => {
    const g = goalOf(r.key);
    const higher = (g?.direction ?? "higher_better") === "higher_better";
    const met = higher ? r.value >= (r.goal as number) : r.value <= (r.goal as number);
    return { r, higher, met };
  });
  // Mostly misses (that's the lesson), with one hit for balance.
  const misses = shuffle(checks.filter(c => !c.met));
  const hits = shuffle(checks.filter(c => c.met));
  for (const c of [...misses.slice(0, 3), ...hits.slice(0, 1)]) {
    const goalText = `${c.higher ? "at least" : "no more than"} ${c.r.goal}`;
    out.push(draft(
      `Did we hit our goal for ${c.r.label.toLowerCase()}? (Goal: ${goalText})`,
      c.met ? ["Yes", "No"] : ["No", "Yes"],
      `We had ${shown(c.r)} — goal was ${goalText}.`,
      `review_goal:${c.r.key}`,
    ));
  }

  // ── 5. Ranges, for whole-number stats with goals (counts, not rates) ──
  for (const c of shuffle(checks.filter(c => Number.isInteger(c.r.value) && !c.r.raw && c.r.value >= 0)).slice(0, 2)) {
    const v = c.r.value;
    const width = Math.max(2, Math.round(Math.max(Math.abs(c.r.goal as number), v, 4) * 0.25));
    const slot = Math.floor(Math.random() * 4);                 // which of 4 bins holds the answer
    let start = Math.max(0, Math.floor(v / width) * width - slot * width);
    const bins = [0, 1, 2, 3].map(k => [start + k * width, start + (k + 1) * width - 1] as [number, number]);
    const label = (b: [number, number], last: boolean) => (last ? `${b[0]}+` : `${b[0]}–${b[1]}`);
    const labels = bins.map((b, k) => label(b, k === 3));
    const rightK = bins.findIndex((b, k) => v >= b[0] && (k === 3 || v <= b[1]));
    if (rightK < 0) continue;
    out.push(draft(
      `About how many ${c.r.label.toLowerCase()} did we have?`,
      [labels[rightK], ...labels.filter((_, k) => k !== rightK)],
      `We had ${v} — goal was ${c.higher ? "at least" : "no more than"} ${c.r.goal}.`,
      `review_range:${c.r.key}`,
    ));
  }

  // ── 2. Biggest gap: where the game was won or lost ──
  const pot = computePointsOffLiveTurnovers(possessions);
  const scp = computeSecondChancePoints(possessions);
  const xp = computeExtraPossessions(possessions);
  const areas = [
    { name: "Points off turnovers", us: pot.us, them: pot.opponent },
    { name: "Second-chance points", us: scp.us, them: scp.opponent },
    { name: "Extra possessions", us: xp.us, them: xp.opponent },
  ];
  const gaps = areas.map(a => ({ ...a, gap: a.them - a.us }));
  const worst = [...gaps].sort((a, b) => b.gap - a.gap)[0];
  const best = [...gaps].sort((a, b) => a.gap - b.gap)[0];
  const detail = gaps.map(a => `${a.name}: us ${a.us}, ${opp} ${a.them}`).join(" · ");
  if (gaps.length >= 3 && worst.gap > 0 && gaps.filter(a => a.gap === worst.gap).length === 1) {
    out.push(draft(`Where did ${opp} beat us by the most?`,
      [worst.name, ...gaps.filter(a => a !== worst).map(a => a.name)], detail, "review_gap"));
  } else if (gaps.length >= 3 && best.gap < 0 && gaps.filter(a => a.gap === best.gap).length === 1) {
    out.push(draft(`Where did we beat ${opp} by the most?`,
      [best.name, ...gaps.filter(a => a !== best).map(a => a.name)], detail, "review_gap"));
  }

  // ── 3. What worked: best points per play among calls run 2+ times ──
  const categories: { cat: string; noun: string }[] = [
    { cat: "set", noun: "sets" }, { cat: "motion", noun: "motion actions" }, { cat: "zone", noun: "zone offense calls" },
    { cat: "blob", noun: "BLOBs" }, { cat: "slob", noun: "SLOBs" },
  ];
  for (const { cat, noun } of categories) {
    const rows = computePlayCallEffectiveness(possessions, playCalls.filter(p => p.category === cat))
      .filter(r => r.calls >= 2);
    if (rows.length < 3) continue;
    const sorted = [...rows].sort((a, b) => b.ppp - a.ppp);
    if (sorted[0].ppp === sorted[1].ppp) continue;          // a tie isn't a fair question
    const top = sorted[0];
    const others = shuffle(sorted.slice(1)).slice(0, 3);
    out.push(draft(
      `Which of our ${noun} scored best against ${opp}? (run 2+ times)`,
      [top.name, ...others.map(r => r.name)],
      `${top.name}: ${top.ppp} points per play (${top.scored} of ${top.calls} scored). ` +
        others.map(r => `${r.name}: ${r.ppp}`).join(", ") + ".",
      `review_calls:${cat}`,
    ));
  }

  // ── 4. Runs: the biggest unanswered run each way, 8+ points ──
  // Every scoring trip counts toward a run, free-throw-only trips included.
  const ordered = [...possessions].sort((a, b) => a.sequence - b.sequence);
  type Run = { team: string; points: number; startPeriod: number };
  let bestRun: Record<string, Run | null> = { us: null, opponent: null };
  let cur: Run | null = null;
  for (const p of ordered) {
    if (!p.points) continue;
    if (cur && cur.team === p.team) cur.points += p.points;
    else cur = { team: p.team, points: p.points, startPeriod: p.quarter };
    const b = bestRun[cur.team];
    if (!b || cur.points > b.points) bestRun[cur.team] = { ...cur };
  }
  const periods = [...new Set(ordered.map(p => p.quarter))].sort((a, b) => a - b);
  for (const team of ["opponent", "us"] as const) {
    const r = bestRun[team];
    if (!r || r.points < 8 || periods.length < 3) continue;
    const right = periodLabel(fmt, r.startPeriod);
    const wrong = shuffle(periods.filter(q => q !== r.startPeriod)).slice(0, 3).map(q => periodLabel(fmt, q));
    out.push(draft(
      team === "opponent" ? `When did ${opp} go on their ${r.points}–0 run?` : `When did we go on our ${r.points}–0 run?`,
      [right, ...wrong],
      `${team === "opponent" ? opp : "We"} scored ${r.points} straight starting in ${right}.`,
      `review_run:${team}`,
    ));
  }

  return out;
}

/** Creates a review quiz draft for a game. Returns its id and question count. */
export async function createReviewQuiz(gameId: string): Promise<{ id: string; count: number }> {
  const data = await loadGame(gameId);
  if (!countedPossessions(data.possessions).length) {
    throw new Error("This game has no tracked possessions, so there's nothing to build a review from.");
  }
  const drafts = buildReviewQuestions(data);
  const g = data.game;
  const date = g.game_date ? new Date(`${g.game_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const { data: { user } } = await supabase.auth.getUser();
  const { data: row, error } = await supabase.from("quizzes").insert({
    title: `Game review: ${g.opponent || "game"}${date ? ` (${date})` : ""}`,
    game_id: gameId,
    review_game_id: gameId,
    roster_ids: g.roster_id ? [g.roster_id] : [],
    created_by: user?.id ?? null,
  }).select("id").single();
  if (error) throw error;
  const id = (row as any).id as string;
  try { await addQuestions(id, drafts, 0); }
  catch (e) { await supabase.from("quizzes").delete().eq("id", id); throw e; }
  return { id, count: drafts.length };
}

/** Rebuilds a review DRAFT from the game as it is now. Hand-written questions stay. */
export async function rebuildReviewDraft(quizId: string): Promise<number> {
  const { data: quiz } = await supabase.from("quizzes").select("id, status, review_game_id").eq("id", quizId).single();
  if (!quiz || (quiz as any).status !== "draft" || !(quiz as any).review_game_id) throw new Error("Only a review draft can be rebuilt.");
  const { error } = await supabase.from("quiz_questions").delete().eq("quiz_id", quizId).eq("source", "sheet");
  if (error) throw error;
  const fresh = buildReviewQuestions(await loadGame((quiz as any).review_game_id));
  const { data: kept } = await supabase.from("quiz_questions").select("id").eq("quiz_id", quizId).order("sort_order");
  await Promise.all(((kept ?? []) as any[]).map((r, i) => supabase.from("quiz_questions").update({ sort_order: fresh.length + i }).eq("id", r.id)));
  await addQuestions(quizId, fresh, 0);
  return fresh.length;
}

/** Recent games with tracked possessions, newest first, for the picker. */
export async function getGamesForReview(): Promise<{ id: string; game_date: string; opponent: string | null; roster_id: string | null }[]> {
  const { data, error } = await supabase.from("games").select("id, game_date, opponent, roster_id, track_stats")
    .lte("game_date", new Date().toISOString().slice(0, 10))
    .order("game_date", { ascending: false }).limit(40);
  if (error) throw error;
  return ((data ?? []) as any[]).filter(g => g.track_stats !== false);
}
