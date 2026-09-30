// src/components/H2HTab.tsx
import { useState, useEffect, useCallback } from "react";
import { supabase, Score, Workout, getXpPerks } from "../../lib/supabase";
import { useLeaderboard } from "../../hooks/useLeaderboard";

interface Props {
  currentUserId: string;
  currentUserName: string;
  workouts: Workout[];
  myScores: Score[];
  onScoreLogged?: () => void;
  onPendingCount: (n: number) => void;
  prefillWorkoutId?: string | null;
  onPrefillHandled?: () => void;
}

// Exported so the coach/admin Oversight view can show the exact same
// eligible-drill list players see in their own "choose drill" dropdown
// — one source of truth instead of a second copy that could drift.
/**
 * Who won a challenge.
 *
 * Until now this was a bare `mine > theirs`, which had two bugs. It
 * ignored lower_is_better entirely -- so a "fewest attempts to make 7"
 * challenge awarded the win to whoever shot WORSE -- and it had no
 * tiebreak, so a tie on raw score was simply a tie even when the workout
 * defines how to break one.
 *
 * Tiebreak direction matches the leaderboard exactly (rerank_workout in
 * migration 110): fastest time is always lower-wins, free throws always
 * higher-wins, and a starred spot follows the drill because it's a slice
 * of the drill's own score. A player with no tiebreak value on file
 * loses to one who has it, and never drops below a plain tie.
 */
export function decideChallengeWinner(
  workout: Workout | undefined,
  challengerId: string,
  opponentId: string,
  challengerScore: number,
  opponentScore: number,
  challengerTiebreak: number | null,
  opponentTiebreak: number | null
): string | null {
  const lowerWins = Boolean((workout as any)?.lower_is_better);
  const better = (a: number, b: number) => (lowerWins ? a < b : a > b);
  if (better(challengerScore, opponentScore)) return challengerId;
  if (better(opponentScore, challengerScore)) return opponentId;

  const mode = (workout as any)?.tiebreak_mode as string | null | undefined;
  if (!mode) return null;

  // Having a value beats not having one, whichever way the mode points.
  if (challengerTiebreak != null && opponentTiebreak == null) return challengerId;
  if (opponentTiebreak != null && challengerTiebreak == null) return opponentId;
  if (challengerTiebreak == null || opponentTiebreak == null) return null;

  const tieLowerWins = mode === "fastest_time" ? true : mode === "spot" ? lowerWins : false;
  const tieBetter = (a: number, b: number) => (tieLowerWins ? a < b : a > b);
  if (tieBetter(challengerTiebreak, opponentTiebreak)) return challengerId;
  if (tieBetter(opponentTiebreak, challengerTiebreak)) return opponentId;
  return null;
}

export function getH2HEligibleWorkouts(workouts: Workout[]): Workout[] {
  return workouts.filter(w => w.is_active !== false && (w.scoring_type === "competitive" || w.scoring_type === "multi_spot"));
}

interface Challenge {
  id: string;
  challenger_id: string;
  challenger_name: string;
  opponent_id: string;
  opponent_name: string;
  workout_id: string;
  workout_title: string;
  challenger_score: number;
  opponent_score: number | null;
  status: "pending" | "completed" | "declined";
  opponent_seen: boolean;
  winner_id: string | null;
  created_at: string;
}

export default function H2HTab({ currentUserId, currentUserName, workouts, myScores, onScoreLogged, onPendingCount, prefillWorkoutId, onPrefillHandled }: Props) {
  const [challenges, setChallenges]           = useState<Challenge[]>([]);
  const [showNew, setShowNew]                 = useState(false);
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [selectedWorkout, setSelectedWorkout]   = useState("");
  const [loading, setLoading]                 = useState(true);
  const [sending, setSending]                 = useState(false);
  const [rematching, setRematching]           = useState<string | null>(null);
  const [needsScore, setNeedsScore]           = useState(false);
  // An unused score from the last 24 hours that could be sent as-is, shown
  // before sending so the player can choose to do the drill again instead
  // (migration 160). Each attempt backs only one challenge.
  const [recentScore, setRecentScore] = useState<{ score: number; attempted_at: string } | null>(null);
  const [challengeScore, setChallengeScore]   = useState("");
  const [responding, setResponding]           = useState<string | null>(null);
  const [myResponse, setMyResponse]           = useState("");
  const [responseTiebreak, setResponseTiebreak] = useState("");
  const [challengeTiebreak, setChallengeTiebreak] = useState("");
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [toast, setToast]                     = useState("");
  const [xpPerks, setXpPerks]                 = useState<any[]>([]);
  const { leaderboard } = useLeaderboard();

  const activeWorkouts = getH2HEligibleWorkouts(workouts);
  const challengesThreshold = xpPerks.length > 0
    ? (xpPerks.find((p: any) => p.perk_key === "challenges_unlocked")?.xp_required ?? 150) : 150;
  // Who I can challenge, decided on the server (migration 157): unlocked
  // challenges, been on the app lately, and not waiting to challenge me back.
  const [opponentList, setOpponentList] = useState<{ player_id: string; name: string; available: boolean; reason: string | null }[]>([]);
  const opponents = opponentList.map(o => ({ id: o.player_id, name: o.name, available: o.available, reason: o.reason }));
  const loadOpponents = useCallback(async () => {
    const { data } = await supabase.rpc("challenge_opponents");
    setOpponentList((data ?? []) as any[]);
  }, []);
  const selectedOpponentInfo = opponents.find(o => o.id === selectedOpponent);

  // Expiry (5 days unanswered) runs in the daily job now, for everyone.

  const loadChallenges = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("challenges").select("*")
      .or(`challenger_id.eq.${currentUserId},opponent_id.eq.${currentUserId}`)
      .order("created_at", { ascending: false });
    const all = data ?? [];
    setChallenges(all);
    setLoading(false);
    const unseen = all.filter((c: Challenge) => c.opponent_id === currentUserId && c.status === "pending" && !c.opponent_seen);
    onPendingCount(unseen.length);
    if (unseen.length > 0) {
      await supabase.rpc("mark_challenges_seen");
    }
  }, [currentUserId, onPendingCount]);

  useEffect(() => {
    loadChallenges();
    loadOpponents();
    getXpPerks().then(setXpPerks).catch(console.error);
  }, [loadChallenges, loadOpponents]);

  useEffect(() => {
    if (prefillWorkoutId) {
      setSelectedWorkout(prefillWorkoutId);
      setShowNew(true);
      onPrefillHandled?.();
    }
  }, [prefillWorkoutId, onPrefillHandled]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  /** Server messages ("Waiting for Jordan to challenge you back."), shown as they are. */
  function friendly(e: any): string { return e?.message ?? "Something went wrong."; }

  /** Ask the server for my unused best from the last 24 hours on this drill. */
  async function lookUpRecentScore(workoutId: string) {
    const { data } = await supabase.rpc("my_recent_challenge_score", { p_workout_id: workoutId });
    const row = ((data ?? []) as any[])[0];
    return row ? { score: Number(row.score), attempted_at: row.attempted_at as string } : null;
  }

  // Step 1: show the score that would be sent, or go straight to entering
  // a fresh one if there isn't an unused one.
  async function sendChallenge() {
    if (!selectedOpponent || !selectedWorkout) return;
    setSending(true);
    try {
      const recent = await lookUpRecentScore(selectedWorkout);
      if (recent) { setRecentScore(recent); setNeedsScore(false); }
      else { setRecentScore(null); setNeedsScore(true); }
    } finally { setSending(false); }
  }

  // Step 2a: send the unused recent score as it is.
  async function sendRecentScore() {
    if (!selectedOpponent || !selectedWorkout) return;
    setSending(true);
    try {
      const { error } = await supabase.rpc("send_challenge", { p_opponent: selectedOpponent, p_workout_id: selectedWorkout });
      if (error) {
        if (error.code === "P0002") { setRecentScore(null); setNeedsScore(true); return; }
        showToast(friendly(error)); return;
      }
      setRecentScore(null);
      await afterChallengeSent(selectedOpponent, selectedWorkout);
    } finally { setSending(false); }
  }

  async function sendChallengeWithScore() {
    if (!selectedOpponent || !selectedWorkout) return;
    const score = parseInt(challengeScore) || 0;
    if (score <= 0) { showToast("Please enter a valid score."); return; }
    setSending(true);
    try {
      const workout = workouts.find(w => w.id === selectedWorkout);
      const myTb = (workout as any)?.tiebreak_mode && (workout as any)?.tiebreak_mode !== "spot" && challengeTiebreak.trim() !== "" ? parseFloat(challengeTiebreak) : null;
      // The server logs the score like any drill, then creates the challenge.
      const { error } = await supabase.rpc("send_challenge", {
        p_opponent: selectedOpponent, p_workout_id: selectedWorkout, p_score: score, p_tiebreak: myTb,
      });
      if (error) { showToast(friendly(error)); return; }
      setNeedsScore(false); setRecentScore(null); setChallengeScore(""); setChallengeTiebreak(""); onScoreLogged?.();
      await afterChallengeSent(selectedOpponent, selectedWorkout);
    } finally { setSending(false); }
  }

  async function afterChallengeSent(opponentId: string, workoutId: string) {
    const workoutTitle = workouts.find(w => w.id === workoutId)?.title ?? "a drill";
    setShowNew(false); setSelectedOpponent(""); setSelectedWorkout("");
    showToast("Challenge sent! ⚔️");
    try {
      await supabase.functions.invoke("send-push", {
        body: {
          title: "⚔️ You've been challenged!",
          message: `${currentUserName} challenged you in ${workoutTitle}`,
          playerIds: [opponentId],
        },
      });
    } catch (e) { console.error("Push notification failed to send:", e); }
    loadChallenges();
    loadOpponents();
  }


  // A rematch goes through the same steps as a new challenge: see the
  // score that would be sent, or do the drill again. It never quietly
  // reuses the score the rival has already seen -- that attempt is spent.
  async function sendRematch(c: Challenge) {
    setRematching(c.id);
    try {
      const rivalId = c.challenger_id === currentUserId ? c.opponent_id : c.challenger_id;
      setShowNew(true);
      setSelectedOpponent(rivalId);
      setSelectedWorkout(c.workout_id);
      const recent = await lookUpRecentScore(c.workout_id);
      if (recent) { setRecentScore(recent); setNeedsScore(false); }
      else { setRecentScore(null); setNeedsScore(true); }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally { setRematching(null); }
  }

  async function respondToChallenge(challenge: Challenge, accept: boolean) {
    if (!accept) {
      const { error: declineErr } = await supabase.rpc("decline_challenge", { p_challenge_id: challenge.id });
      if (declineErr) { showToast(friendly(declineErr)); return; }
      showToast("Challenge declined.");
      try {
        await supabase.functions.invoke("send-push", {
          body: {
            title: "Challenge declined",
            message: `${currentUserName} declined your challenge in ${challenge.workout_title}`,
            playerIds: [challenge.challenger_id],
          },
        });
      } catch (e) { console.error("Push notification failed to send:", e); }
      loadChallenges(); return;
    }
    setResponding(challenge.id);
  }

  async function submitResponse(challenge: Challenge) {
    if (submittingResponse) return; // blocks re-entry from double-clicks
    setSubmittingResponse(true);
    try {
      const finalScore = parseInt(myResponse) || 0;
      const respWorkout = workouts.find(w => w.id === challenge.workout_id);
      const myTiebreak = (respWorkout as any)?.tiebreak_mode && responseTiebreak.trim() !== "" ? parseFloat(responseTiebreak) : null;
      // decideChallengeWinner, not `finalScore > challenger_score` -- the
      // old comparison handed a fewest-wins drill to the higher score.
      // The server logs the score, decides the winner (same rules as
      // decideChallengeWinner), pays the +1 once and awards XP to both.
      const { data: res, error: respErr } = await supabase.rpc("respond_challenge", {
        p_challenge_id: challenge.id, p_score: finalScore, p_tiebreak: myTiebreak,
      });
      if (respErr) { showToast(friendly(respErr)); return; }
      const winnerId: string | null = (res as any)?.winner_id ?? null;
      if (finalScore > 0) onScoreLogged?.();
      try {
        const resultMsg = winnerId === challenge.challenger_id
          ? `You beat ${currentUserName} in ${challenge.workout_title}! 🏆`
          : winnerId === currentUserId
          ? `${currentUserName} beat you in ${challenge.workout_title}!`
          : `Your challenge with ${currentUserName} ended in a tie in ${challenge.workout_title}!`;
        await supabase.functions.invoke("send-push", {
          body: {
            title: "🏀 Challenge complete!",
            message: resultMsg,
            playerIds: [challenge.challenger_id],
          },
        });
      } catch (e) { console.error("Push notification failed to send:", e); }
      setResponding(null); setMyResponse(""); setResponseTiebreak("");
      showToast(winnerId === currentUserId ? "🏆 You won!" : "Response submitted! 🏀");
      loadChallenges();
    } finally {
      setSubmittingResponse(false);
    }
  }

  const pending   = challenges.filter(c => c.status === "pending");
  const completed = challenges.filter(c => c.status === "completed");
  const myPending    = pending.filter(c => c.opponent_id === currentUserId);
  const theirPending = pending.filter(c => c.challenger_id === currentUserId);

  function ChallengeCard({ c }: { c: Challenge }) {
    const isChallenger = c.challenger_id === currentUserId;
    const myScore    = isChallenger ? c.challenger_score : (c.opponent_score ?? null);
    const theirScore = isChallenger ? (c.opponent_score ?? null) : c.challenger_score;
    const theirName  = isChallenger ? c.opponent_name : c.challenger_name;
    const iWon   = c.status === "completed" && c.winner_id === currentUserId;
    const theyWon = c.status === "completed" && c.winner_id && c.winner_id !== currentUserId;

    return (
      <div style={{ background: "var(--surface2)", border: `1px solid ${iWon ? "rgba(240,192,64,0.4)" : theyWon ? "rgba(255,107,107,0.3)" : "var(--border)"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{isChallenger ? `You vs ${theirName}` : `${theirName} challenged you`}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>📋 {c.workout_title}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{new Date(c.created_at).toLocaleDateString()}</div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: c.status === "completed" ? "rgba(40,180,80,0.15)" : c.status === "declined" ? "rgba(255,107,107,0.15)" : "rgba(240,192,64,0.15)", color: c.status === "completed" ? "#5de098" : c.status === "declined" ? "#ff7b7b" : "var(--gold)" }}>
            {c.status === "completed" ? "Done" : c.status === "declined" ? "Declined" : "Pending"}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ textAlign: "center", padding: "10px", background: "var(--surface)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>YOU</div>
            {c.status === "completed" ? <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: iWon ? "var(--gold)" : "var(--text)" }}>{myScore ?? "—"}</div>
              : (myScore !== null || isChallenger) ? <div style={{ fontSize: 13, color: "#5de098", fontWeight: 600 }}>🔒 Logged</div>
              : <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--muted)" }}>—</div>}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--muted)" }}>VS</div>
          <div style={{ textAlign: "center", padding: "10px", background: "var(--surface)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{theirName.split(" ")[0].toUpperCase()}</div>
            {c.status === "completed" ? <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: theyWon ? "var(--gold)" : "var(--text)" }}>{theirScore ?? "—"}</div>
              : theirScore === -1 ? <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>Forfeited</div>
              : (theirScore !== null || !isChallenger) ? <div style={{ fontSize: 13, color: "#5de098", fontWeight: 600 }}>🔒 Logged</div>
              : <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--muted)" }}>—</div>}
          </div>
        </div>
        {c.status === "pending" && (
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginBottom: 8, padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>🔒 Scores hidden until both players submit</div>
        )}
        {c.status === "completed" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: iWon ? "var(--gold)" : theyWon ? "#ff7b7b" : "var(--muted)" }}>
              {c.opponent_score === -1 ? "🏆 Won (opponent forfeited)" : iWon ? "🏆 You Won!" : theyWon ? "💪 Keep grinding!" : "🤝 Tied!"}
            </div>
            <button onClick={() => sendRematch(c)} disabled={rematching === c.id}
              style={{ background: "rgba(147,180,255,0.12)", border: "1px solid rgba(147,180,255,0.3)", color: "#93b4ff", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
              {rematching === c.id ? "Sending…" : "🔄 Rematch"}
            </button>
          </div>
        )}
        {c.status === "pending" && c.opponent_id === currentUserId && (
          responding === c.id ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Enter your score for <strong style={{ color: "var(--text)" }}>{c.workout_title}</strong>:</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" value={myResponse} onChange={e => setMyResponse(e.target.value)} placeholder="Your score" min="0"
                  style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
                <button onClick={() => submitResponse(c)} disabled={submittingResponse} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{submittingResponse ? "Submitting…" : "Submit"}</button>
                <button onClick={() => setResponding(null)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
              </div>
              {(() => {
                const rw = workouts.find(w => w.id === c.workout_id);
                const mode = (rw as any)?.tiebreak_mode as string | null | undefined;
                // 'spot' needs no input here -- it's read from the drill's
                // own per-spot scores, which a challenge doesn't collect.
                if (!mode || mode === "spot") return null;
                return (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                      {(rw as any)?.tiebreak_instructions ||
                        (mode === "fastest_time" ? "Tiebreaker — fastest time, in seconds" : "Tiebreaker — free throws made")}
                    </div>
                    <input type="number" value={responseTiebreak} onChange={e => setResponseTiebreak(e.target.value)} placeholder="Tiebreaker (only used if you tie)" min="0"
                      style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => respondToChallenge(c, true)} style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Accept Challenge</button>
              <button onClick={() => respondToChallenge(c, false)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Decline</button>
            </div>
          )
        )}
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button onClick={() => setShowNew(s => !s)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{showNew ? "✕ Cancel" : "⚔️ New Challenge"}</button>
      </div>
      {showNew && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">Send a Challenge</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Choose Opponent</label>
              <select value={selectedOpponent} onChange={e => { setSelectedOpponent(e.target.value); setRecentScore(null); setNeedsScore(false); }}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                <option value="">Select a player…</option>
                {opponents.map(o => (
                  <option key={o.id} value={o.id} disabled={!o.available}>
                    {o.name}{o.available ? "" : o.reason?.startsWith("Waiting") ? " — waiting for them to challenge you back" : " — not active lately"}
                  </option>
                ))}
              </select>
              {opponents.filter(o => o.available).length === 0 && <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", padding: "8px 12px", background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 8 }}>No eligible opponents yet — other players need to reach {challengesThreshold} XP to unlock challenges.</div>}
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Choose Drill</label>
              <select value={selectedWorkout} onChange={e => { setSelectedWorkout(e.target.value); setRecentScore(null); setNeedsScore(false); }}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                <option value="">Select a drill…</option>
                {activeWorkouts.map(w => <option key={w.id} value={w.id}>{w.emoji} {w.title}</option>)}
              </select>
            </div>
            {recentScore && !needsScore ? (
              <div>
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Score that will be sent</div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--text)", lineHeight: 1.1 }}>{recentScore.score}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    Your best unused score from the last 24 hours · logged {(() => {
                      const mins = Math.round((Date.now() - Date.parse(recentScore.attempted_at)) / 60000);
                      return mins < 60 ? `${Math.max(1, mins)}m ago` : `${Math.round(mins / 60)}h ago`;
                    })()}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button onClick={sendRecentScore} disabled={sending} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                    {sending ? "Sending…" : `Send with ${recentScore.score}`}
                  </button>
                  <button onClick={() => { setRecentScore(null); setNeedsScore(true); }} disabled={sending} style={{ background: "var(--royal)", border: "none", color: "#fff", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                    Do it again
                  </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                  "Do it again" logs a new score like any drill and sends that one, even if it's lower.
                </div>
              </div>
            ) : needsScore ? (
              <div>
                <div style={{ padding: "10px 12px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 10 }}>🏀 Do the drill now, then enter your score. It's logged like any workout and sent as your challenge score.</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input type="number" value={challengeScore} onChange={e => setChallengeScore(e.target.value)} placeholder="Your score" min="0" style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
                  {(() => {
                    const cw = workouts.find(w => w.id === selectedWorkout);
                    const m = (cw as any)?.tiebreak_mode as string | null | undefined;
                    if (!m || m === "spot") return null;
                    return (
                      <input type="number" value={challengeTiebreak} onChange={e => setChallengeTiebreak(e.target.value)}
                        placeholder={(cw as any)?.tiebreak_instructions || (m === "fastest_time" ? "Tiebreak time (secs)" : "Tiebreak FTs")} min="0"
                        style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                    );
                  })()}
                  <button onClick={sendChallengeWithScore} disabled={sending} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>{sending ? "Sending…" : "⚔️ Send"}</button>
                  <button onClick={() => { setNeedsScore(false); setChallengeScore(""); }} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "9px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={sendChallenge} disabled={sending || !selectedOpponent || !selectedWorkout} className="btn-primary">{sending ? "Sending…" : "⚔️ Send Challenge"}</button>
            )}
          </div>
        </div>
      )}
      {myPending.length > 0 && <div style={{ marginBottom: 20 }}><div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 10 }}>⚔️ Waiting For You ({myPending.length})</div>{myPending.map(c => <ChallengeCard key={c.id} c={c} />)}</div>}
      {theirPending.length > 0 && <div style={{ marginBottom: 20 }}><div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#93b4ff", letterSpacing: 1, marginBottom: 10 }}>📤 Challenges You Sent ({theirPending.length})</div>{theirPending.map(c => <ChallengeCard key={c.id} c={c} />)}</div>}
      {completed.length > 0 && <div><div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--muted)", letterSpacing: 1, marginBottom: 10 }}>📋 Past Challenges</div>{completed.map(c => <ChallengeCard key={c.id} c={c} />)}</div>}
      {challenges.length === 0 && !loading && !showNew && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>No challenges yet. Hit "New Challenge" to call someone out! ⚔️</div>}
      {toast && <div className="toast show">{toast}</div>}
    </>
  );
}
