// src/components/quizzes/QuizResults.tsx
// The coach's results for one published quiz version: who's done it,
// how the team did per question, and re-teach flags with an "Add to next
// practice" action.

import { useEffect, useState, useCallback } from "react";
import {
  QuizBundle, QuizResults as Results, getQuizResults, addToNextPractice, formatSeconds, PLAY_QTYPE_LABEL, PlayQType,
} from "../../lib/quizzes";
import { formatDateOnly } from "../../lib/schedule";
import QuizAttemptReview from "./QuizAttemptReview";
import { card, pill, sectionTitle, smallBtn, secondaryBtn } from "./quizStyles";

interface Props {
  bundle: QuizBundle;
}

export default function QuizResults({ bundle }: Props) {
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});   // flag key -> practice date
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
  const showTime = bundle.quiz.show_time_to_coaches;

  const load = useCallback(async () => {
    setError(null);
    try { setResults(await getQuizResults(bundle)); }
    catch (e: any) { setError(e?.message ?? "Couldn't load results."); }
  }, [bundle]);

  useEffect(() => { load(); }, [load]);

  async function addFlag(key: string, labelText: string, missed: number, answered: number, questionId: string | null) {
    setBusyKey(key);
    setError(null);
    try {
      const text = `Re-teach (${bundle.quiz.title}): ${labelText} — ${missed} of ${answered} missed`;
      const date = await addToNextPractice(bundle.quiz.game_id, text, questionId, bundle.quiz.roster_ids);
      setAdded(a => ({ ...a, [key]: date }));
    } catch (e: any) {
      setError(e?.message ?? "Couldn't add it to a practice.");
    } finally {
      setBusyKey(null);
    }
  }

  if (reviewAttemptId) {
    return <QuizAttemptReview attemptId={reviewAttemptId} onClose={() => setReviewAttemptId(null)} />;
  }
  if (!results) {
    return <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>{error ?? "Loading results…"}</div>;
  }

  const metrics: [string, string][] = [
    ["Submitted", `${results.submittedCount} of ${results.rosterCount}`],
    ["Average score", results.averagePct == null ? "—" : `${results.averagePct}%`],
  ];
  if (showTime) metrics.push(["Average time", formatSeconds(results.averageSeconds)]);

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 6 }}>
        {metrics.map(([k, v]) => (
          <div key={k} style={{ background: "var(--surface2)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{k}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
        Team numbers use each player's first finished attempt.
        <button type="button" onClick={load} style={{ ...smallBtn, marginLeft: 8 }}>↻ Refresh</button>
      </div>

      {/* ── Re-teach ── */}
      <div style={sectionTitle}>Re-teach</div>
      {results.flags.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Nothing flagged. A question is flagged when at least half the players who answered it missed it,
          once enough of them have finished.
        </div>
      ) : results.flags.map(f => (
        <div key={f.key} style={{ ...card, display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
          borderColor: "rgba(220,50,50,0.35)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
            <div style={{ fontSize: 12, color: "#ff7b7b" }}>{f.missed} of {f.answered} missed — cover it in pregame or at the next practice</div>
          </div>
          {added[f.key] ? (
            <span style={pill("good")}>Added to {formatDateOnly(added[f.key], { weekday: "short", month: "short", day: "numeric" })}</span>
          ) : (
            <button type="button" disabled={busyKey === f.key} onClick={() => addFlag(f.key, f.label, f.missed, f.answered, f.questionId)}
              style={secondaryBtn}>
              {busyKey === f.key ? "Adding…" : "Add to next practice"}
            </button>
          )}
        </div>
      ))}

      {/* ── By question type (play quizzes) ── */}
      {(() => {
        const typeOf = new Map(bundle.questions.map(q => [q.id, q.qtype]));
        const totals = new Map<PlayQType, { answered: number; correct: number }>();
        for (const r of results.questions) {
          const t = typeOf.get(r.questionId);
          if (!t) continue;
          const cur = totals.get(t) ?? { answered: 0, correct: 0 };
          totals.set(t, { answered: cur.answered + r.answered, correct: cur.correct + r.correct });
        }
        if (totals.size === 0) return null;
        return (
          <>
            <div style={sectionTitle}>By question type</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {[...totals.entries()].map(([t, v]) => {
                const pct = v.answered ? Math.round((v.correct / v.answered) * 100) : null;
                const color = pct == null ? "var(--muted)" : pct >= 80 ? "#5de098" : pct >= 60 ? "var(--gold)" : "#ff7b7b";
                return (
                  <div key={t} style={{ background: "var(--surface2)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{PLAY_QTYPE_LABEL[t]}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color }}>{pct == null ? "—" : `${pct}%`}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{v.answered} answer{v.answered === 1 ? "" : "s"}</div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* ── Per question ── */}
      <div style={sectionTitle}>Question breakdown</div>
      {results.questions.map(q => {
        const pct = q.answered ? Math.round((q.correct / q.answered) * 100) : null;
        const color = pct == null ? "var(--muted)" : pct >= 80 ? "#5de098" : pct >= 60 ? "var(--gold)" : "#ff7b7b";
        return (
          <div key={q.questionId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>{q.prompt}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {q.assigned ? `Assigned · ${q.sentTo} player${q.sentTo === 1 ? "" : "s"}` : "Everyone"} · {q.answered} answered
              </div>
            </div>
            <div style={{ width: 90, height: 6, borderRadius: 3, background: "var(--surface)", overflow: "hidden", flexShrink: 0 }}>
              <div style={{ width: `${pct ?? 0}%`, height: "100%", background: color }} />
            </div>
            <div style={{ width: 40, textAlign: "right", fontSize: 13, color, flexShrink: 0 }}>{pct == null ? "—" : `${pct}%`}</div>
          </div>
        );
      })}

      {/* ── Players ── */}
      <div style={sectionTitle}>Players</div>
      {results.players.map(p => {
        const done = p.attempts.filter(a => a.submittedAt);
        const latest = done[done.length - 1];
        const kind = p.status === "submitted" ? "good" : p.status === "in_progress" ? "warn" : "bad";
        const text = p.status === "submitted" ? "Submitted" : p.status === "in_progress" ? "In progress" : "Not started";
        return (
          <div key={p.playerId} style={{ borderTop: "1px solid var(--border)" }}>
            <div onClick={() => setOpenPlayer(openPlayer === p.playerId ? null : p.playerId)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: done.length ? "pointer" : "default" }}>
              <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
              <span style={pill(kind)}>{text}</span>
              <span style={{ width: 48, textAlign: "right", fontSize: 13 }}>{latest ? `${latest.correct ?? 0}/${latest.total}` : "—"}</span>
              {showTime && <span style={{ width: 44, textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{formatSeconds(latest?.seconds)}</span>}
            </div>
            {openPlayer === p.playerId && done.length > 0 && (
              <div style={{ padding: "0 0 10px 10px" }}>
                {p.attempts.map(a => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, padding: "3px 0", color: "var(--muted)" }}>
                    <span style={{ flex: 1 }}>Attempt {a.attemptNo}{a.submittedAt ? "" : " (in progress)"}</span>
                    {a.submittedAt && <span>{a.correct ?? 0}/{a.total}</span>}
                    {showTime && a.submittedAt && <span>{formatSeconds(a.seconds)}</span>}
                    {a.submittedAt && <button type="button" onClick={() => setReviewAttemptId(a.id)} style={smallBtn}>Answers</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
