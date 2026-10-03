// src/components/quizzes/QuizAttemptReview.tsx
// Every question in a FINISHED attempt with the player's answer, the
// right answer and the explanation. The server only returns this once
// the attempt is submitted. Used by the player after a quiz and by a
// coach from the results screen.

import { useEffect, useState } from "react";
import { AttemptReview, getAttemptReview } from "../../lib/quizzes";
import { optionStyle, secondaryBtn } from "./quizStyles";
import { QuizPlayReveal } from "./QuizPlayVisual";

interface Props {
  attemptId: string;
  onClose: () => void;
}

export default function QuizAttemptReview({ attemptId, onClose }: Props) {
  const [review, setReview] = useState<AttemptReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAttemptReview(attemptId).then(setReview).catch(e => setError(e?.message ?? "Couldn't load the answers."));
  }, [attemptId]);

  if (error) return (
    <div>
      <div className="error-msg">{error}</div>
      <button type="button" onClick={onClose} style={secondaryBtn}>Back</button>
    </div>
  );
  if (!review) return <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>Loading answers…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{review.title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Attempt {review.attempt_no} · {review.correct_count} of {review.total_count} correct
          </div>
        </div>
        <button type="button" onClick={onClose} style={secondaryBtn}>Back</button>
      </div>

      {review.questions.map((q, i) => (
        <div key={q.question_id} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, color: q.is_correct ? "#5de098" : "#ff7b7b", marginBottom: 4 }}>
            {i + 1}. {q.is_correct ? "Correct" : q.timed_out ? "Time ran out" : "Missed"}
          </div>
          {q.reveal && (
            <QuizPlayReveal reveal={q.reveal}
              tap={q.chosen_point}
              target={q.correct_point ? { point: q.correct_point, radius: q.radius ?? 50 } : null}
              tapNum={q.visual?.frames[0]?.players.find(pl => pl.quizFocus)?.num ?? null} />
          )}
          {q.qtype === "tap_place" && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              {q.chosen_point ? "Gold = your tap. " : "No tap. "}Green circle = where the play sends them, and how close counted.
            </div>
          )}
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{q.prompt}</div>
          {q.options.map(o => {
            const state = o.id === q.correct_option_id ? "right" : o.id === q.chosen_option_id ? "wrong" : "idle";
            return (
              <div key={o.id} style={{ ...optionStyle(state), cursor: "default" }}>
                {o.label}
                {o.id === q.chosen_option_id && <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.8 }}>(your answer)</span>}
              </div>
            );
          })}
          {q.explanation && <div style={{ fontSize: 13, color: "var(--muted)" }}>{q.explanation}</div>}
        </div>
      ))}
    </div>
  );
}
