// src/components/quizzes/ReviewDeck.tsx
// A player's personal review deck: every question they've missed, across
// every quiz, until they get it right. Practice only -- nothing here
// changes a quiz score.

import { useCallback, useEffect, useState } from "react";
import { DeckQuestion, DeckAnswer, getReviewDeckNext, answerReviewDeck } from "../../lib/quizzes";
import { optionStyle, primaryBtn, secondaryBtn } from "./quizStyles";
import { QuizPlayVisual, QuizPlayReveal } from "./QuizPlayVisual";

interface Props {
  onClose: () => void;
}

export default function ReviewDeck({ onClose }: Props) {
  const [q, setQ] = useState<DeckQuestion | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<DeckAnswer | null>(null);
  const [cleared, setCleared] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [ready, setReady] = useState(true);

  const load = useCallback(async (exclude?: string | null) => {
    setPicked(null); setResult(null); setInputError(null); setError(null);
    try {
      const next = await getReviewDeckNext(exclude);
      setReady(!next.visual?.hide_after && !(next.visual?.lead_frames?.length));
      setQ(next);
    }
    catch (e: any) { setError(e?.message ?? "Couldn't load your review deck."); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function check() {
    if (!q || q.done) return;
    if (!picked) { setInputError("Pick an answer first."); return; }
    setBusy(true);
    try {
      const r = await answerReviewDeck(q.question_id, picked);
      setResult(r);
      if (r.correct) setCleared(c => c + 1);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't check that answer.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return (
    <div>
      <div className="error-msg">{error}</div>
      <button type="button" onClick={onClose} style={secondaryBtn}>Back</button>
    </div>
  );
  if (!q) return <div style={{ padding: 12, color: "var(--muted)", fontSize: 13 }}>Loading…</div>;

  if (q.done) return (
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <div style={{ fontSize: 34 }}>✅</div>
      <div style={{ fontSize: 16, fontWeight: 700, margin: "8px 0 4px" }}>Review deck clear</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        {cleared ? `You cleared ${cleared} question${cleared === 1 ? "" : "s"}. ` : ""}Missed quiz questions show up here.
      </div>
      <button type="button" onClick={onClose} style={secondaryBtn}>Done</button>
    </div>
  );

  const stateOf = (id: string): "idle" | "picked" | "right" | "wrong" => {
    if (result) {
      if (id === result.correct_option_id) return "right";
      if (id === picked) return "wrong";
      return "idle";
    }
    return id === picked ? "picked" : "idle";
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Review deck · {q.quiz_title}</span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{result ? result.remaining : q.remaining} left</span>
      </div>

      {q.visual && !result?.reveal && <QuizPlayVisual visual={q.visual} onReady={() => setReady(true)} />}
      {result?.reveal && <QuizPlayReveal reveal={result.reveal} />}
      <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4, marginBottom: 14 }}>{q.prompt}</div>
      {ready && q.options.map(o => (
        <button key={o.id} type="button" disabled={!!result || busy}
          onClick={() => { setPicked(o.id); setInputError(null); }} style={optionStyle(stateOf(o.id))}>
          {o.label}
        </button>
      ))}
      {inputError && <div style={{ fontSize: 13, color: "#ff7b7b", margin: "2px 0 8px" }}>{inputError}</div>}

      {result ? (
        <>
          <div style={{
            borderRadius: 10, padding: "10px 12px", margin: "6px 0 12px", fontSize: 13,
            background: result.correct ? "rgba(40,180,80,0.15)" : "rgba(220,50,50,0.15)",
            color: result.correct ? "#5de098" : "#ff7b7b",
          }}>
            <strong>{result.correct ? "Got it — cleared from your deck." : "Not yet — it stays in your deck."}</strong>
            {result.explanation ? ` ${result.explanation}` : ""}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => load(q.question_id)} style={{ ...primaryBtn, flex: 1, padding: "11px 16px" }}>Next</button>
            <button type="button" onClick={onClose} style={secondaryBtn}>Done</button>
          </div>
        </>
      ) : ready && (
        <button type="button" onClick={check} disabled={busy} style={{ ...primaryBtn, width: "100%", padding: "11px 16px", marginTop: 4 }}>
          {busy ? "Checking…" : "Check"}
        </button>
      )}
    </div>
  );
}
