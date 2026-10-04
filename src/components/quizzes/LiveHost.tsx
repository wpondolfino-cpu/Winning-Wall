// src/components/quizzes/LiveHost.tsx
// The coach's projector screen for a live team-meeting quiz. Fills the
// whole window so it can go straight on the team-room TV.
//
// The coach controls the pace: Start → (question) → Reveal → Next, with
// the top-5 board every few questions or whenever the coach asks. The
// reveal shows how many picked each answer (never who), the right answer,
// the coaching note, the step, and for tap questions every player's tap.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LiveHostState, getHostState, advanceLive, useLiveChannel, LIVE_COLORS,
} from "../../lib/liveQuiz";
import { QuizPlayVisual, QuizPlayReveal } from "./QuizPlayVisual";

interface Props {
  sessionId: string;
  onClose: () => void;
}

const BOARD_EVERY = 4;   // show the board after every 4th question

const shell: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2000, background: "#0b0f1a", color: "#f2f4f8",
  overflowY: "auto", padding: "20px clamp(16px, 4vw, 48px)",
};
const bigBtn = (primary = true): React.CSSProperties => ({
  background: primary ? "#2550D4" : "#1a2340", color: "#fff", border: primary ? "none" : "1px solid #343c52",
  borderRadius: 10, padding: "10px 22px", fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
});

export default function LiveHost({ sessionId, onClose }: Props) {
  const [st, setSt] = useState<LiveHostState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getHostState(sessionId);
      setSt(next);
      setClock(next.remaining);
    } catch (e: any) { setError(e?.message ?? "Couldn't load the live quiz."); }
  }, [sessionId]);

  // Phones ping "answered" so the count updates; the poll is a backstop.
  const send = useLiveChannel(sessionId, () => { load(); });
  useEffect(() => { load(); }, [load]);

  // The question's court, kept stable while the state refreshes (every
  // answer and every poll) so the lead-up doesn't restart mid-question.
  const qVisual = useMemo(() => st?.question?.visual ?? null,
    [st?.question?.question_id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Local countdown between server refreshes.
  useEffect(() => {
    if (st?.status !== "question" || clock == null || clock <= 0) return;
    const t = window.setTimeout(() => setClock(c => (c == null ? c : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [clock, st?.status]);

  async function act(action: "start" | "reveal" | "scoreboard" | "next" | "end") {
    setBusy(true); setError(null);
    try {
      await advanceLive(sessionId, action);
      send("state");
      await load();
    } catch (e: any) { setError(e?.message ?? "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function exit() {
    if (st && st.status !== "ended" && !window.confirm("End the live quiz for everyone?")) return;
    if (st && st.status !== "ended") await act("end");
    onClose();
  }

  if (!st) {
    return <div style={shell}>{error ? <div className="error-msg">{error}</div> : "Loading…"}
      <div><button onClick={onClose} style={{ ...bigBtn(false), marginTop: 16 }}>Close</button></div></div>;
  }

  const q = st.question;
  const isTap = q?.qtype === "tap_place";
  const answeredAll = st.participants.length > 0 && st.answered >= st.participants.length;
  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 12, letterSpacing: 2, color: "#9aa3b8" }}>LIVE QUIZ</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{st.quiz_title}</div>
      </div>
      {st.status !== "lobby" && st.status !== "ended" && (
        <div style={{ fontSize: 14, color: "#9aa3b8" }}>Question {st.index + 1} of {st.total}</div>
      )}
      <button onClick={exit} style={bigBtn(false)}>{st.status === "ended" ? "Close" : "End live quiz"}</button>
    </div>
  );

  return (
    <div style={shell}>
      {header}
      {error && <div className="error-msg">{error}</div>}

      {/* ── Lobby ── */}
      {st.status === "lobby" && (
        <div style={{ textAlign: "center", paddingTop: 30 }}>
          <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Open Winning Wall to join</div>
          <div style={{ color: "#9aa3b8", marginBottom: 22 }}>Your team got a notification. Anyone already in the app sees a "Live now" banner.</div>
          <div style={{ fontSize: 15, color: "#9aa3b8", marginBottom: 10 }}>In the room: {st.participants.length}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 900, margin: "0 auto 26px" }}>
            {st.participants.map((n, i) => (
              <span key={i} style={{ background: "#1a2340", borderRadius: 16, padding: "6px 14px", fontSize: 15 }}>{n}</span>
            ))}
          </div>
          <button onClick={() => act("start")} disabled={busy || st.participants.length === 0} style={{ ...bigBtn(), fontSize: 20, padding: "14px 34px" }}>
            Start ▶
          </button>
          {st.participants.length === 0 && <div style={{ color: "#9aa3b8", marginTop: 10, fontSize: 13 }}>Waiting for someone to join…</div>}
        </div>
      )}

      {/* ── Question ── */}
      {st.status === "question" && q && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: (clock ?? 0) <= 5 ? "#ff7b7b" : "#F0C040" }}>
              0:{String(Math.max(0, clock ?? 0)).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 18 }}>{st.answered} of {st.participants.length} answered</span>
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            {qVisual && (
              <div style={{ flex: "1 1 420px", minWidth: 300 }}>
                <QuizPlayVisual key={q.question_id} visual={qVisual} />
              </div>
            )}
            <div style={{ flex: "1 1 380px" }}>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.3, marginBottom: 18 }}>{q.prompt}</div>
              {isTap ? (
                <div style={{ fontSize: 18, color: "#9aa3b8" }}>Tap the spot on your phone.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {q.options.map((o, i) => (
                    <div key={o.id} style={{ background: LIVE_COLORS[i % LIVE_COLORS.length], borderRadius: 12, padding: "18px 16px", fontSize: 20, fontWeight: 600 }}>
                      {o.label}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                <button onClick={() => act("reveal")} disabled={busy} style={bigBtn()}>
                  {answeredAll || (clock ?? 1) <= 0 ? "Reveal ▶" : "Reveal now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reveal ── */}
      {st.status === "reveal" && q && st.key && (
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 14 }}>{q.prompt}</div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            {st.key.reveal && (
              <div style={{ flex: "1 1 420px", minWidth: 300 }}>
                <QuizPlayReveal reveal={st.key.reveal}
                  dots={isTap ? st.taps : null}
                  target={st.key.correct_point ? { point: st.key.correct_point, radius: st.key.radius } : null} />
              </div>
            )}
            <div style={{ flex: "1 1 380px" }}>
              {isTap ? (
                <div>
                  <div style={{ fontSize: 44, fontWeight: 800, color: "#5de098" }}>{st.correct_count ?? 0} of {st.answered}</div>
                  <div style={{ fontSize: 18, marginBottom: 6 }}>tapped inside the circle</div>
                  <div style={{ color: "#9aa3b8", fontSize: 14 }}>Each dot is one player's tap: green inside, red outside.</div>
                </div>
              ) : (
                q.options.map((o, i) => {
                  const n = st.counts[o.id] ?? 0;
                  const right = o.id === st.key!.correct_option_id;
                  const pct = st.answered ? (n / st.answered) * 100 : 0;
                  return (
                    <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0" }}>
                      <span style={{ width: 190, fontSize: 18, fontWeight: right ? 700 : 400, color: right ? "#5de098" : "#f2f4f8" }}>
                        {right ? "✓ " : ""}{o.label}
                      </span>
                      <div style={{ flex: 1, background: "#1a2340", borderRadius: 6, height: 26 }}>
                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 6, background: right ? "#28b450" : LIVE_COLORS[i % LIVE_COLORS.length], opacity: right ? 1 : 0.55 }} />
                      </div>
                      <span style={{ width: 30, textAlign: "right", fontSize: 18 }}>{n}</span>
                    </div>
                  );
                })
              )}
              {st.key.explanation && (
                <div style={{ background: "#1a2340", borderRadius: 10, padding: "12px 14px", fontSize: 16, marginTop: 14, lineHeight: 1.45 }}>
                  {st.key.explanation}
                </div>
              )}
              <div style={{ color: "#9aa3b8", fontSize: 12, marginTop: 8 }}>Names stay off this screen — just how many picked each answer.</div>
              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                {(st.index + 1) % BOARD_EVERY === 0 || st.index + 1 === st.total
                  ? <button onClick={() => act("scoreboard")} disabled={busy} style={bigBtn()}>Scoreboard ▶</button>
                  : <button onClick={() => act("next")} disabled={busy} style={bigBtn()}>Next question ▶</button>}
                {(st.index + 1) % BOARD_EVERY !== 0 && st.index + 1 !== st.total && (
                  <button onClick={() => act("scoreboard")} disabled={busy} style={bigBtn(false)}>Show scoreboard</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Scoreboard / end ── */}
      {(st.status === "scoreboard" || st.status === "ended") && (
        <div style={{ maxWidth: 720, margin: "10px auto 0" }}>
          <div style={{ textAlign: "center", fontSize: 26, fontWeight: 700, marginBottom: 14 }}>
            {st.status === "ended" ? "Final standings" : `After question ${st.index + 1}`}
          </div>
          {(st.board ?? []).map((r, i) => (
            <div key={r.player_id} style={{ display: "flex", alignItems: "center", gap: 14, background: "#1a2340", borderRadius: 12, padding: "12px 16px", marginBottom: 8 }}>
              <span style={{ width: 30, fontSize: 24, fontWeight: 800, color: i === 0 ? "#F0C040" : "#9aa3b8" }}>{r.rank}</span>
              <span style={{ flex: 1, fontSize: 20 }}>{r.name}</span>
              <span style={{ fontSize: 16, color: "#5de098" }}>{r.correct} right</span>
            </div>
          ))}
          {(st.board ?? []).length === 0 && <div style={{ textAlign: "center", color: "#9aa3b8" }}>No answers yet.</div>}
          <div style={{ textAlign: "center", color: "#9aa3b8", fontSize: 12, margin: "10px 0 20px" }}>
            Top 5 only. Most right first; quicker right answers break ties.
          </div>
          <div style={{ textAlign: "center" }}>
            {st.status === "scoreboard" && (
              <button onClick={() => act(st.index + 1 >= st.total ? "end" : "next")} disabled={busy} style={bigBtn()}>
                {st.index + 1 >= st.total ? "Finish" : "Next question ▶"}
              </button>
            )}
            {st.status === "ended" && <button onClick={onClose} style={bigBtn()}>Done</button>}
          </div>
        </div>
      )}
    </div>
  );
}
