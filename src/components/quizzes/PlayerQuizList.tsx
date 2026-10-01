// src/components/quizzes/PlayerQuizList.tsx
// A player's quizzes. Shown at the top of the Scout tab (every quiz plus
// the review deck) and inside a scout sheet's Quiz tab (just that
// sheet's quiz). Taking, reviewing and the deck open in place.

import { useCallback, useEffect, useState } from "react";
import { MyQuiz, getMyQuizzes, getReviewDeckCount } from "../../lib/quizzes";
import { formatDateOnly } from "../../lib/schedule";
import QuizTaker from "./QuizTaker";
import QuizAttemptReview from "./QuizAttemptReview";
import ReviewDeck from "./ReviewDeck";
import { card, pill, primaryBtn, secondaryBtn, sectionTitle } from "./quizStyles";

interface Props {
  /** Only this sheet's quiz (inside a scout sheet). Omit for the full list + deck. */
  scoutSheetId?: string;
}

function tipLabel(q: MyQuiz): string | null {
  if (!q.game_date) return null;
  const day = formatDateOnly(q.game_date, { weekday: "short", month: "short", day: "numeric" });
  if (!q.tip_time) return `Before the game · ${day}`;
  const [h, m] = q.tip_time.split(":").map(Number);
  return `Before tip-off · ${day} ${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export default function PlayerQuizList({ scoutSheetId }: Props) {
  const [quizzes, setQuizzes] = useState<MyQuiz[] | null>(null);
  const [deckCount, setDeckCount] = useState(0);
  const [taking, setTaking] = useState<MyQuiz | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, n] = await Promise.all([getMyQuizzes(), scoutSheetId ? Promise.resolve(0) : getReviewDeckCount()]);
      setQuizzes(scoutSheetId ? list.filter(q => q.scout_sheet_id === scoutSheetId) : list);
      setDeckCount(n);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load your quizzes.");
    }
  }, [scoutSheetId]);

  useEffect(() => { load(); }, [load]);

  const close = () => { setTaking(null); setReviewId(null); setDeckOpen(false); load(); };

  if (taking) return <QuizTaker quizId={taking.quiz_id} title={taking.title} onClose={close} />;
  if (reviewId) return <QuizAttemptReview attemptId={reviewId} onClose={close} />;
  if (deckOpen) return <ReviewDeck onClose={close} />;

  if (error) return <div className="error-msg">{error}</div>;
  if (!quizzes) return null;
  // On the Scout tab, stay out of the way when there's nothing to show.
  if (!scoutSheetId && quizzes.length === 0 && deckCount === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {!scoutSheetId && <div style={{ ...sectionTitle, marginTop: 0 }}>Quizzes</div>}

      {!scoutSheetId && deckCount > 0 && (
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Review deck</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{deckCount} missed question{deckCount === 1 ? "" : "s"} to get right</div>
          </div>
          <button type="button" onClick={() => setDeckOpen(true)} style={primaryBtn}>Practice</button>
        </div>
      )}

      {scoutSheetId && quizzes.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "8px 0" }}>No quiz for this scout yet.</div>
      )}

      {quizzes.map(q => {
        const done = q.attempts.filter(a => a.submitted_at);
        const open = q.attempts.find(a => !a.submitted_at);
        const latest = done[done.length - 1];
        const due = tipLabel(q);
        return (
          <div key={q.quiz_id} style={{ ...card, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{q.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {q.question_count} question{q.question_count === 1 ? "" : "s"}
                  {q.time_limit_seconds ? ` · ${q.time_limit_seconds}s each` : ""}
                  {due ? ` · ${due}` : ""}
                </div>
              </div>
              {latest
                ? <span style={pill("good")}>{latest.correct_count ?? 0}/{latest.total_count}</span>
                : open ? <span style={pill("warn")}>In progress</span>
                : <span style={pill("info")}>New</span>}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {open && <button type="button" onClick={() => setTaking(q)} style={primaryBtn}>Resume</button>}
              {!open && !latest && <button type="button" onClick={() => setTaking(q)} style={primaryBtn}>Start quiz</button>}
              {latest && <button type="button" onClick={() => setReviewId(latest.id)} style={secondaryBtn}>See answers</button>}
              {!open && latest && q.allow_retakes && <button type="button" onClick={() => setTaking(q)} style={secondaryBtn}>Retake</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
