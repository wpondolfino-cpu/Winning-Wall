// src/components/quizzes/QuizPreview.tsx
// A coach taking their own quiz the way a player would -- drafts included
// -- with NOTHING saved: no attempt, no results, no review-deck entries.
//
// It grades on this device from the quiz's answer key (which coaches can
// already see), so it tests the quiz itself -- questions, wording, courts,
// timing, who gets what -- but not the server grading path players use.
// To check that, take the published quiz with a test player account.
//
// Mirrors QuizTaker: coach order, shuffled answers, the quiz's feedback
// setting and time limit (the clock starts once the answers are on
// screen), "name that play" hiding the court before the answers appear.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { QuizBundle, QuizQuestion } from "../../lib/quizzes";
import { RosterPlayer } from "../../lib/plays";
import { inputStyle } from "../../lib/inputStyle";
import { QuizPlayVisual, QuizPlayReveal } from "./QuizPlayVisual";
import { optionStyle, primaryBtn, secondaryBtn, card, label } from "./quizStyles";

interface Props {
  bundle: QuizBundle;
  roster: RosterPlayer[];
  onClose: () => void;
}

interface Answer { questionId: string; chosen: string | null; correct: boolean; timedOut: boolean; }

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuizPreview({ bundle, roster, onClose }: Props) {
  const { quiz } = bundle;
  const [quizRoster, setQuizRoster] = useState<Set<string> | null>(null);
  const [as, setAs] = useState<string>("everyone");         // "everyone" or a player id
  const [started, setStarted] = useState(false);
  const [order, setOrder] = useState<QuizQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [feedback, setFeedback] = useState<Answer | null>(null);
  const [finished, setFinished] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [ready, setReady] = useState(true);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  // Bumped each run so the court restarts its lead-up even when "Preview
  // again" shows the very same question object.
  const [run, setRun] = useState(0);

  // Who "everyone" is for this quiz right now -- same function the results use.
  useEffect(() => {
    supabase.rpc("quiz_roster", { p_quiz: quiz.id }).then(({ data }: { data: unknown }) => {
      const ids = ((data ?? []) as any[]).map(r => (typeof r === "string" ? r : r.quiz_roster ?? r.id));
      setQuizRoster(new Set(ids));
    });
  }, [quiz.id]);

  // Everyone who'd get at least one question: the quiz's roster plus
  // anyone a question is assigned to.
  const people = useMemo(() => {
    const ids = new Set<string>(quizRoster ?? []);
    bundle.questions.forEach(q => q.assignee_ids.forEach(id => ids.add(id)));
    return [...ids]
      .map(id => ({ id, name: roster.find(r => r.id === id)?.name ?? "Player" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [quizRoster, bundle.questions, roster]);

  const questionsFor = (who: string): QuizQuestion[] => bundle.questions.filter(q =>
    who === "everyone"
      ? q.assignee_ids.length === 0
      : q.assignee_ids.includes(who) || (q.assignee_ids.length === 0 && !!quizRoster?.has(who)));

  // Answer order shuffled once per question per run, like the server does.
  const [optionOrder, setOptionOrder] = useState<Record<string, string[]>>({});

  function start() {
    const qs = questionsFor(as).filter(q => q.options.length >= 2);
    if (!qs.length) { setInputError("No questions go to that choice."); return; }
    setOrder(qs);
    setOptionOrder(Object.fromEntries(qs.map(q => [q.id, shuffle(q.options.map(o => o.id))])));
    setAnswers([]); setIdx(0); setPicked(null); setFeedback(null); setFinished(false); setReviewing(false);
    setInputError(null);
    setRun(r => r + 1);
    setStarted(true);
    beginQuestion(qs[0]);
  }

  function beginQuestion(q: QuizQuestion) {
    setPicked(null); setFeedback(null); setInputError(null);
    setReady(!q.visual?.hide_after && !(q.visual?.lead_frames?.length));
    setRemaining(quiz.time_limit_seconds ?? null);
  }

  const q = order[idx];

  function lock(choice: string | null, timedOut: boolean) {
    if (!q || feedback) return;
    const a: Answer = { questionId: q.id, chosen: choice, correct: !timedOut && !!choice && choice === q.correct_option_id, timedOut };
    const next = [...answers, a];
    setAnswers(next);
    if (quiz.feedback_mode === "immediate") { setFeedback(a); return; }
    advance(next);
  }

  function advance(list: Answer[] = answers) {
    if (idx + 1 >= order.length) { setFinished(true); return; }
    setIdx(idx + 1);
    beginQuestion(order[idx + 1]);
    void list;
  }

  // Time limit, started once the answers are showing.
  useEffect(() => {
    if (!started || finished || remaining == null || feedback || !ready || !q) return;
    if (remaining <= 0) { lock(picked, !picked); return; }
    const t = window.setTimeout(() => setRemaining(r => (r == null ? r : r - 1)), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, feedback, ready, started, finished, idx]);

  const banner = (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, marginBottom: 12, borderColor: "rgba(240,192,64,0.4)", padding: "8px 12px" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>PREVIEW</span>
      <span style={{ flex: 1, fontSize: 12, color: "var(--muted)" }}>Nothing is saved — no attempt, no results, no review deck.</span>
      <button type="button" onClick={onClose} style={{ ...secondaryBtn, padding: "5px 10px", fontSize: 12 }}>Exit preview</button>
    </div>
  );

  // ── Setup ──
  if (!started) {
    const count = questionsFor(as).length;
    return (
      <div>
        {banner}
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{quiz.title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            {quiz.feedback_mode === "immediate" ? "Answers after each question" : "Answers at the end"}
            {quiz.time_limit_seconds ? ` · ${quiz.time_limit_seconds}s per question` : " · No time limit"}
            {quiz.status === "draft" ? " · Draft — players can't see it yet" : ""}
          </div>
          <div style={label}>Preview as</div>
          <select value={as} onChange={e => { setAs(e.target.value); setInputError(null); }}
            style={{ ...inputStyle, width: "100%", marginBottom: 6 }}>
            <option value="everyone">Everyone's questions (nothing assigned)</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            {quizRoster === null ? "Checking who gets this quiz…" : `${count} question${count === 1 ? "" : "s"}${as === "everyone" ? "" : " for this player"}`}
            {as !== "everyone" && quizRoster && !quizRoster.has(as) ? " — not on this quiz's teams, so only questions assigned to them" : ""}
          </div>
          {inputError && <div className="error-msg">{inputError}</div>}
          <button type="button" onClick={start} disabled={quizRoster === null} style={primaryBtn}>▶ Start preview</button>
        </div>
      </div>
    );
  }

  // ── Review (after finishing) ──
  if (finished && reviewing) {
    return (
      <div>
        {banner}
        {order.map((qq, i) => {
          const a = answers.find(x => x.questionId === qq.id);
          const opts = (optionOrder[qq.id] ?? []).map(id => qq.options.find(o => o.id === id)!).filter(Boolean);
          return (
            <div key={qq.id} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, color: a?.correct ? "#5de098" : "#ff7b7b", marginBottom: 4 }}>
                {i + 1}. {a?.correct ? "Correct" : a?.timedOut ? "Time ran out" : "Missed"}
              </div>
              {qq.reveal && <QuizPlayReveal reveal={qq.reveal} />}
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{qq.prompt}</div>
              {opts.map(o => (
                <div key={o.id} style={{ ...optionStyle(o.id === qq.correct_option_id ? "right" : o.id === a?.chosen ? "wrong" : "idle"), cursor: "default" }}>
                  {o.label}{o.id === a?.chosen && <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.8 }}>(your answer)</span>}
                </div>
              ))}
              {qq.explanation && <div style={{ fontSize: 13, color: "var(--muted)" }}>{qq.explanation}</div>}
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => setStarted(false)} style={primaryBtn}>Preview again</button>
          <button type="button" onClick={onClose} style={secondaryBtn}>Done</button>
        </div>
      </div>
    );
  }

  // ── Score ──
  if (finished) {
    const right = answers.filter(a => a.correct).length;
    return (
      <div>
        {banner}
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{quiz.title}</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: "var(--gold)", lineHeight: 1.1, margin: "10px 0" }}>
            {right} / {answers.length}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Not saved. A player would see their score and missed questions here.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button type="button" onClick={() => setReviewing(true)} style={primaryBtn}>See answers</button>
            <button type="button" onClick={() => setStarted(false)} style={secondaryBtn}>Preview again</button>
          </div>
        </div>
      </div>
    );
  }

  // ── A question ──
  if (!q) return null;
  const opts = (optionOrder[q.id] ?? []).map(id => q.options.find(o => o.id === id)!).filter(Boolean);
  const stateOf = (id: string): "idle" | "picked" | "right" | "wrong" => {
    if (feedback) {
      if (id === q.correct_option_id) return "right";
      if (id === feedback.chosen) return "wrong";
      return "idle";
    }
    return id === picked ? "picked" : "idle";
  };

  return (
    <div>
      {banner}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{quiz.title}</span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {remaining != null && !feedback && ready && (
            <span style={{ marginRight: 10, color: remaining <= 5 ? "#ff7b7b" : "var(--text)", fontWeight: 600 }}>⏱ {Math.max(0, remaining)}s</span>
          )}
          {idx + 1} of {order.length}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--surface2)", overflow: "hidden", marginBottom: 16 }}>
        <div style={{ width: `${Math.round(((idx + 1) / order.length) * 100)}%`, height: "100%", background: "var(--royal-light)" }} />
      </div>

      {q.visual && !(feedback && q.reveal) && <QuizPlayVisual key={`${q.id}-${run}`} visual={q.visual} onReady={() => setReady(true)} />}
      {feedback && q.reveal && <QuizPlayReveal reveal={q.reveal} />}

      <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, marginBottom: 14 }}>{q.prompt}</div>

      {ready && opts.map(o => (
        <button key={o.id} type="button" disabled={!!feedback}
          onClick={() => { setPicked(o.id); setInputError(null); }} style={optionStyle(stateOf(o.id))}>
          {o.label}
        </button>
      ))}
      {inputError && <div style={{ fontSize: 13, color: "#ff7b7b", margin: "2px 0 8px" }}>{inputError}</div>}

      {feedback ? (
        <>
          <div style={{
            borderRadius: 10, padding: "10px 12px", margin: "6px 0 12px", fontSize: 13,
            background: feedback.correct ? "rgba(40,180,80,0.15)" : "rgba(220,50,50,0.15)",
            color: feedback.correct ? "#5de098" : "#ff7b7b",
          }}>
            <strong>{feedback.correct ? "Correct." : feedback.timedOut ? "Time's up." : "Not quite."}</strong>
            {q.explanation ? ` ${q.explanation}` : ""}
          </div>
          <button type="button" onClick={() => advance()} style={{ ...primaryBtn, width: "100%", padding: "11px 16px" }}>
            {idx + 1 >= order.length ? "See the score" : "Next question"}
          </button>
        </>
      ) : ready && (
        <button type="button"
          onClick={() => { if (!picked) { setInputError("Pick an answer first."); return; } lock(picked, false); }}
          style={{ ...primaryBtn, width: "100%", padding: "11px 16px", marginTop: 4 }}>
          {idx + 1 === order.length ? "Submit answer" : "Lock in answer"}
        </button>
      )}
    </div>
  );
}
