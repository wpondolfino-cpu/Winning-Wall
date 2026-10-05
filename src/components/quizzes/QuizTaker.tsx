// src/components/quizzes/QuizTaker.tsx
// A player taking a quiz. One question at a time, served by the server:
// the phone never has the answer key ahead of time, never sends a score,
// and a refresh returns the same question with the same clock.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  ServedQuestion, AnswerResult, startQuizAttempt, getNextQuestion, submitQuizAnswer, submitQuizTap, TapPoint,
} from "../../lib/quizzes";
import QuizAttemptReview from "./QuizAttemptReview";
import { QuizPlayVisual, QuizPlayReveal, actionFromLabel, TapAction } from "./QuizPlayVisual";
import { optionStyle, primaryBtn, secondaryBtn } from "./quizStyles";

interface Props {
  quizId: string;
  title: string;
  onClose: () => void;
}

export default function QuizTaker({ quizId, title, onClose }: Props) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [question, setQuestion] = useState<ServedQuestion | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // "Where do you go": where they've tapped (they can tap again to move it).
  const [tapPoint, setTapPoint] = useState<TapPoint | null>(null);
  const [feedback, setFeedback] = useState<AnswerResult | null>(null);
  const [finished, setFinished] = useState<{ correct: number; total: number } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const submittedFor = useRef<string | null>(null);   // stops a double submit (tap + timer)
  const tapRef = useRef<TapPoint | null>(null);       // the tap at the moment of submitting
  const lockRef = useRef<HTMLButtonElement | null>(null);
  // Two-part questions: what the player picked in part 1 (cut / screen /
  // dribble) is how their part-2 tap draws -- their own picture, never the
  // right answer.
  const [part1Action, setPart1Action] = useState<TapAction | null>(null);

  // On a phone the answers can fill the screen; once one is picked (or the
  // court tapped), bring Lock in into view so it's never hiding below.
  useEffect(() => {
    if (picked || tapPoint) lockRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked, tapPoint]);
  // A "name that play" question shows its answers only after the court
  // has played and hidden. Everything else is ready at once.
  const [ready, setReady] = useState(true);

  const showFinish = useCallback(async (id: string) => {
    const { data } = await supabase.from("quiz_attempts").select("correct_count, total_count").eq("id", id).maybeSingle();
    setQuestion(null);
    setFinished({ correct: (data as any)?.correct_count ?? 0, total: (data as any)?.total_count ?? 0 });
  }, []);

  const loadNext = useCallback(async (id: string) => {
    setPicked(null);
    setTapPoint(null);
    tapRef.current = null;
    setFeedback(null);
    setInputError(null);
    const q = await getNextQuestion(id);
    if (q.done) { await showFinish(id); return; }
    submittedFor.current = null;
    setReady(!q.visual?.hide_after && !(q.visual?.lead_frames?.length));
    setQuestion(q);
    setRemaining(q.remaining);
  }, [showFinish]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await startQuizAttempt(quizId);
        if (cancelled) return;
        setAttemptId(id);
        await loadNext(id);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Couldn't start the quiz.");
      }
    })();
    return () => { cancelled = true; };
  }, [quizId, loadNext]);

  const submit = useCallback(async (optionId: string | null) => {
    if (!attemptId || !question || feedback) return;
    if (submittedFor.current === question.question_id) return;
    submittedFor.current = question.question_id;
    setBusy(true);
    setError(null);
    try {
      if (question.visual?.part?.n === 1 && optionId) {
        setPart1Action(actionFromLabel(question.options.find(o => o.id === optionId)?.label));
      }
      const res = question.qtype === "tap_place"
        ? await submitQuizTap(attemptId, question.question_id, tapRef.current)
        : await submitQuizAnswer(attemptId, question.question_id, optionId);
      if (question.feedback_mode === "immediate") {
        setFeedback(res);
      } else if (res.finished) {
        await showFinish(attemptId);
      } else {
        await loadNext(attemptId);
      }
    } catch (e: any) {
      submittedFor.current = null;
      setError((e?.message ?? "Couldn't save that answer.") + " Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [attemptId, question, feedback, loadNext, showFinish]);

  // Time limit: the server is the judge (it stamped when the question was
  // served); this countdown just shows it and sends "no answer" at zero.
  useEffect(() => {
    // The clock runs once the answers are on screen.
    if (remaining == null || feedback || !question || !ready) return;
    if (remaining <= 0) { submit(picked); return; }
    const t = window.setTimeout(() => setRemaining(r => (r == null ? r : r - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [remaining, feedback, question, submit, picked, ready]);

  function check() {
    if (question?.qtype === "tap_place") {
      if (!tapPoint) { setInputError("Tap the court first."); return; }
      submit(null);
      return;
    }
    if (!picked) { setInputError("Pick an answer first."); return; }
    submit(picked);
  }

  async function next() {
    if (!attemptId) return;
    if (feedback?.finished) { await showFinish(attemptId); return; }
    setBusy(true);
    try { await loadNext(attemptId); }
    catch (e: any) { setError(e?.message ?? "Couldn't load the next question."); }
    finally { setBusy(false); }
  }

  if (reviewing && attemptId) {
    return <QuizAttemptReview attemptId={attemptId} onClose={() => setReviewing(false)} />;
  }

  if (finished) {
    const pct = finished.total ? Math.round((finished.correct / finished.total) * 100) : 0;
    return (
      <div style={{ textAlign: "center", padding: "12px 0" }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{title}</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, color: "var(--gold)", lineHeight: 1.1, margin: "10px 0" }}>
          {finished.correct} / {finished.total}
        </div>
        <div style={{ fontSize: 14, marginBottom: 16 }}>{pct}% correct</div>
        {finished.correct < finished.total && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>
            Missed questions were added to your review deck.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" onClick={() => setReviewing(true)} style={primaryBtn}>See answers</button>
          <button type="button" onClick={onClose} style={secondaryBtn}>Done</button>
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div>
        {error ? <div className="error-msg">{error}</div> : <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
        {error && <button type="button" onClick={onClose} style={secondaryBtn}>Back</button>}
      </div>
    );
  }

  const stateOf = (id: string): "idle" | "picked" | "right" | "wrong" => {
    if (feedback && feedback.correct_option_id) {
      if (id === feedback.correct_option_id) return "right";
      if (id === picked) return "wrong";
      return "idle";
    }
    return id === picked ? "picked" : "idle";
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{title}</span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {remaining != null && !feedback && (
            <span style={{ marginRight: 10, color: remaining <= 5 ? "#ff7b7b" : "var(--text)", fontWeight: 600 }}>⏱ {Math.max(0, remaining)}s</span>
          )}
          {question.index} of {question.total}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--surface2)", overflow: "hidden", marginBottom: 16 }}>
        <div style={{ width: `${Math.round((question.index / question.total) * 100)}%`, height: "100%", background: "var(--royal-light)" }} />
      </div>

      {error && <div className="error-msg">{error}</div>}

      {question.visual && (!feedback?.reveal) && (
        <QuizPlayVisual visual={question.visual} onReady={() => setReady(true)}
          {...(question.qtype === "tap_place" ? {
            tap: tapPoint,
            onTap: busy ? null : (p: TapPoint) => { setTapPoint(p); tapRef.current = p; setInputError(null); },
            tapNum: question.visual.frames[0]?.players.find(pl => pl.quizFocus)?.num ?? null,
            tapAction: question.visual.part?.n === 2 ? part1Action : undefined,
          } : {})} />
      )}
      {feedback?.reveal && (
        <QuizPlayReveal reveal={feedback.reveal}
          tap={question.qtype === "tap_place" ? tapPoint : null}
          target={feedback.correct_point ? { point: feedback.correct_point, radius: feedback.radius ?? 50 } : null}
          tapNum={question.visual?.frames[0]?.players.find(pl => pl.quizFocus)?.num ?? null}
          tapAction={question.visual?.part?.n === 2 ? part1Action : question.visual?.tap_action ?? null} />
      )}

      <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, marginBottom: 14 }}>{question.prompt}</div>

      {ready && question.options.map(o => (
        <button key={o.id} type="button" disabled={!!feedback || busy}
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
            <strong>{feedback.correct ? "Correct." : feedback.timed_out ? "Time's up." : "Not quite."}</strong>
            {feedback.explanation ? ` ${feedback.explanation}` : ""}
          </div>
          <button type="button" onClick={next} disabled={busy} style={{ ...primaryBtn, width: "100%", padding: "11px 16px" }}>
            {feedback.finished ? "See my score" : "Next question"}
          </button>
        </>
      ) : ready && (
        <button ref={lockRef} type="button" onClick={check} disabled={busy} style={{ ...primaryBtn, width: "100%", padding: "11px 16px", marginTop: 4, scrollMarginBottom: 16 }}>
          {busy ? "Saving…" : question.index === question.total ? "Submit answer" : "Lock in answer"}
        </button>
      )}
    </div>
  );
}
