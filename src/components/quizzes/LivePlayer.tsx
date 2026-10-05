// src/components/quizzes/LivePlayer.tsx
// A player's phone during a live team-meeting quiz, and the "Live now"
// banner that gets them there.
//
// The phone is mostly answer buttons -- the question and court are on the
// projector, so eyes go up, not down. Tap questions show the court here,
// since that's where the tap happens. Answers are graded and locked on
// the server; the phone only learns right/wrong when the coach reveals.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LivePlayerState, getLiveState, joinLive, answerLive, getMyLiveSessions, useLiveChannel, LIVE_COLORS,
} from "../../lib/liveQuiz";
import type { TapPoint } from "../../lib/quizzes";
import { QuizPlayVisual, actionFromLabel, TapAction } from "./QuizPlayVisual";

const shell: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 2000, background: "var(--bg, #0b0f1a)", color: "var(--text)",
  overflowY: "auto", padding: "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
};

export function LivePlayer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [st, setSt] = useState<LivePlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tap, setTap] = useState<TapPoint | null>(null);
  const [clock, setClock] = useState<number | null>(null);
  const lastQ = useRef<string | null>(null);
  const [part1Action, setPart1Action] = useState<TapAction | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getLiveState(sessionId);
      setSt(next);
      setClock(next.remaining);
      // A new question clears the last tap.
      const qid = next.question?.question_id ?? null;
      if (qid !== lastQ.current) { lastQ.current = qid; setTap(null); }
    } catch (e: any) { setError(e?.message ?? "Lost the live quiz."); }
  }, [sessionId]);

  useEffect(() => {
    joinLive(sessionId).then(() => { setJoined(true); return load(); })
      .catch(e => setError(e?.message ?? "Couldn't join."));
  }, [sessionId, load]);

  const send = useLiveChannel(joined ? sessionId : null, () => { load(); }, 3000);

  // The phone's tap court: the paused moment, without the lead-up (that
  // plays on the projector). Kept stable so the court doesn't reset.
  const tapVisual = useMemo(
    () => (st?.question?.visual ? { ...st.question.visual, lead_frames: [] } : null),
    [st?.question?.question_id],   // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (st?.status !== "question" || st.answered || clock == null || clock <= 0) return;
    const t = window.setTimeout(() => setClock(c => (c == null ? c : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [clock, st?.status, st?.answered]);

  async function answer(optionId: string | null) {
    if (!st?.question || st.answered || busy) return;
    if (st.question.qtype === "tap_place" && !tap) { setError("Tap the court first."); return; }
    setBusy(true); setError(null);
    if (st.question.visual?.part?.n === 1 && optionId) {
      setPart1Action(actionFromLabel(st.question.options.find(o => o.id === optionId)?.label));
    }
    try {
      await answerLive(sessionId, st.question.question_id, optionId, st.question.qtype === "tap_place" ? tap : null);
      send("answered");
      await load();
    } catch (e: any) { setError(e?.message ?? "Couldn't send that answer."); await load(); }
    finally { setBusy(false); }
  }

  const top = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontSize: 13, color: "var(--muted)" }}>
      <span>🔴 Live · {st?.quiz_title ?? ""}</span>
      <span>
        {st?.status === "question" && !st.answered && clock != null && <strong style={{ color: clock <= 5 ? "#ff7b7b" : "var(--text)", marginRight: 8 }}>0:{String(Math.max(0, clock)).padStart(2, "0")}</strong>}
        {st && st.index >= 0 && st.status !== "ended" ? `Q${st.index + 1} of ${st.total}` : ""}
      </span>
    </div>
  );
  const center = (children: React.ReactNode) => (
    <div style={{ textAlign: "center", padding: "50px 10px" }}>{children}</div>
  );

  let body: React.ReactNode = center(<div style={{ color: "var(--muted)" }}>Joining…</div>);
  if (st) {
    const q = st.question;
    if (st.status === "lobby") {
      body = center(<><div style={{ fontSize: 22, fontWeight: 700 }}>You're in!</div>
        <div style={{ color: "var(--muted)", marginTop: 8 }}>Look up — the coach will start soon.</div></>);
    } else if (st.status === "question" && q && st.answered) {
      body = center(<><div style={{ fontSize: 20, fontWeight: 700 }}>Locked in ✓</div>
        <div style={{ color: "var(--muted)", marginTop: 8 }}>Waiting for the coach to reveal…</div></>);
    } else if (st.status === "question" && q) {
      body = q.qtype === "tap_place" && tapVisual ? (
        <div>
          <div style={{ fontSize: 15, marginBottom: 8 }}>{q.prompt}</div>
          <QuizPlayVisual key={q.question_id} visual={tapVisual} tap={tap}
            onTap={busy ? null : (p: TapPoint) => { setTap(p); setError(null); }}
            tapNum={tapVisual.frames[0]?.players.find(pl => pl.quizFocus)?.num ?? null}
            tapAction={tapVisual.part?.n === 2 ? part1Action : undefined} />
          <button onClick={() => answer(null)} disabled={busy || !tap}
            style={{ width: "100%", padding: "14px", fontSize: 16, fontWeight: 700, border: "none", borderRadius: 12, background: tap ? "#2550D4" : "var(--surface2)", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
            {busy ? "Sending…" : tap ? "Lock in" : "Tap the court"}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>Look up at the screen, then pick:</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {q.options.map((o, i) => (
              <button key={o.id} onClick={() => answer(o.id)} disabled={busy}
                style={{ minHeight: 96, background: LIVE_COLORS[i % LIVE_COLORS.length], color: "#fff", border: "none", borderRadius: 14,
                  fontSize: 17, fontWeight: 700, padding: "12px 10px", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      );
    } else if (st.status === "reveal") {
      body = center(st.my_correct == null
        ? <><div style={{ fontSize: 20, fontWeight: 700 }}>No answer this time</div><div style={{ color: "var(--muted)", marginTop: 8 }}>Check the screen.</div></>
        : st.my_correct
          ? <><div style={{ fontSize: 46 }}>✅</div><div style={{ fontSize: 22, fontWeight: 700, color: "#5de098" }}>Right!</div></>
          : <><div style={{ fontSize: 46 }}>❌</div><div style={{ fontSize: 22, fontWeight: 700, color: "#ff7b7b" }}>Not this time</div><div style={{ color: "var(--muted)", marginTop: 8 }}>Check the screen for why.</div></>);
    } else if (st.status === "scoreboard" || st.status === "ended") {
      const r = st.my_rank;
      body = center(<>
        <div style={{ fontSize: 14, color: "var(--muted)" }}>{st.status === "ended" ? "Final" : "So far"}</div>
        {r ? <><div style={{ fontSize: 40, fontWeight: 800, color: "var(--gold)" }}>#{r.rank}</div>
          <div style={{ fontSize: 16 }}>{r.correct} right</div></> : <div>No answers yet</div>}
        {st.status === "ended" && <button onClick={onClose} style={{ marginTop: 24, padding: "10px 24px", borderRadius: 10, border: "none", background: "#2550D4", color: "#fff", fontSize: 15, fontWeight: 700 }}>Done</button>}
      </>);
    }
  }

  return (
    <div style={shell}>
      {top}
      {error && <div className="error-msg">{error}</div>}
      {body}
      {st?.status !== "ended" && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontFamily: "inherit" }}>
            Leave
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "🔴 Live now — Join" at the top of the app while a live quiz for this
 * player's team is running. Checks when the app opens or comes back to
 * the front, and every minute -- a plain request, no live connection.
 */
export function LiveBanner() {
  const [live, setLive] = useState<{ id: string; quiz_title: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const check = useCallback(() => {
    getMyLiveSessions().then(list => setLive(list[0] ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    check();
    const onFocus = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onFocus);
    const t = window.setInterval(check, 60000);
    return () => { document.removeEventListener("visibilitychange", onFocus); window.clearInterval(t); };
  }, [check]);

  if (open) return <LivePlayer sessionId={open} onClose={() => { setOpen(null); check(); }} />;
  if (!live || dismissed === live.id) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(220,50,50,0.14)", border: "1px solid rgba(220,50,50,0.45)",
      borderRadius: 12, padding: "10px 14px", margin: "0 0 14px" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#ff7b7b" }}>🔴 LIVE NOW</span>
      <span style={{ flex: 1, fontSize: 14 }}>{live.quiz_title}</span>
      <button onClick={() => setOpen(live.id)}
        style={{ background: "#2550D4", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        Join
      </button>
      <button onClick={() => setDismissed(live.id)} aria-label="Hide"
        style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 16, cursor: "pointer" }}>✕</button>
    </div>
  );
}
