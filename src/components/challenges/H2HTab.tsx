// src/components/H2HTab.tsx
import { useState, useEffect, useCallback } from "react";
import { supabase, Score, Workout, submitScore, awardChallengeWinBonus, awardXp, XP_CHALLENGE_SENT, XP_CHALLENGE_DONE, getXpPerks } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  currentUserId: string;
  currentUserName: string;
  workouts: Workout[];
  myScores: Score[];
  onScoreLogged?: () => void;
  onPendingCount: (n: number) => void;
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

export default function H2HTab({ currentUserId, currentUserName, workouts, myScores, onScoreLogged, onPendingCount }: Props) {
  const [challenges, setChallenges]           = useState<Challenge[]>([]);
  const [showNew, setShowNew]                 = useState(false);
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [selectedWorkout, setSelectedWorkout]   = useState("");
  const [loading, setLoading]                 = useState(true);
  const [sending, setSending]                 = useState(false);
  const [rematching, setRematching]           = useState<string | null>(null);
  const [needsScore, setNeedsScore]           = useState(false);
  const [challengeScore, setChallengeScore]   = useState("");
  const [responding, setResponding]           = useState<string | null>(null);
  const [myResponse, setMyResponse]           = useState("");
  const [toast, setToast]                     = useState("");
  const [xpPerks, setXpPerks]                 = useState<any[]>([]);
  const { leaderboard } = useLeaderboard();

  const activeWorkouts = workouts.filter(w => w.is_active !== false && w.scoring_type === "competitive");
  const challengesThreshold = xpPerks.length > 0
    ? (xpPerks.find((p: any) => p.perk_key === "challenges_unlocked")?.xp_required ?? 150) : 150;
  const opponents = leaderboard.filter(e => e.id !== currentUserId && (e.total_xp ?? 0) >= challengesThreshold);

  const expireChallenges = useCallback(async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data: expired } = await supabase
      .from("challenges").select("*")
      .eq("challenger_id", currentUserId).eq("status", "pending").lt("created_at", fiveDaysAgo);
    if (expired && expired.length > 0) {
      for (const c of expired) {
        await supabase.from("challenges").update({ status: "completed", winner_id: currentUserId, opponent_score: -1 }).eq("id", c.id);
        await awardChallengeWinBonus(currentUserId).catch(console.warn);
      }
    }
  }, [currentUserId]);

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
      await supabase.from("challenges").update({ opponent_seen: true }).in("id", unseen.map((c: Challenge) => c.id));
    }
  }, [currentUserId, onPendingCount]);

  useEffect(() => {
    expireChallenges().then(() => loadChallenges());
    getXpPerks().then(setXpPerks).catch(console.error);
  }, [loadChallenges, expireChallenges]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 3000); }

  async function sendChallenge() {
    if (!selectedOpponent || !selectedWorkout) return;
    setSending(true);
    try {
      const workout  = workouts.find(w => w.id === selectedWorkout);
      const opponent = leaderboard.find(e => e.id === selectedOpponent);
      const since24h = new Date(Date.now() - 86400000).toISOString();
      const { data: recentAttempts } = await supabase.from("score_attempts").select("*")
        .eq("player_id", currentUserId).eq("workout_id", selectedWorkout).gte("attempted_at", since24h);
      if (!recentAttempts || recentAttempts.length === 0) { setNeedsScore(true); setSending(false); return; }
      const best24h = recentAttempts.reduce((best: any, s: any) => {
        const score = s.self_points > 0 ? s.self_points : (s.made + s.reps);
        const bestScore = best ? (best.self_points > 0 ? best.self_points : (best.made + best.reps)) : 0;
        return score > bestScore ? s : best;
      }, null);
      const challengerScore = best24h ? (best24h.self_points > 0 ? best24h.self_points : (best24h.made + best24h.reps)) : 0;
      await createChallenge(selectedOpponent, opponent?.name ?? "Unknown", selectedWorkout, workout?.title ?? "Unknown", challengerScore);
    } finally { setSending(false); }
  }

  async function sendChallengeWithScore() {
    if (!selectedOpponent || !selectedWorkout) return;
    const score = parseInt(challengeScore) || 0;
    if (score <= 0) { showToast("Please enter a valid score."); return; }
    setSending(true);
    try {
      const workout  = workouts.find(w => w.id === selectedWorkout);
      const opponent = leaderboard.find(e => e.id === selectedOpponent);
      await submitScore({ player_id: currentUserId, workout_id: selectedWorkout, made: score, attempts: 0, sprint_secs: 0, reps: 0, self_points: 0 }).catch(console.warn);
      await createChallenge(selectedOpponent, opponent?.name ?? "Unknown", selectedWorkout, workout?.title ?? "Unknown", score);
      setNeedsScore(false); setChallengeScore(""); onScoreLogged?.();
    } finally { setSending(false); }
  }

  async function createChallenge(opponentId: string, opponentName: string, workoutId: string, workoutTitle: string, challengerScore: number) {
    const { error } = await supabase.from("challenges").insert({
      challenger_id: currentUserId, challenger_name: currentUserName,
      opponent_id: opponentId, opponent_name: opponentName,
      workout_id: workoutId, workout_title: workoutTitle,
      challenger_score: challengerScore, opponent_score: null,
      status: "pending", opponent_seen: false, winner_id: null,
    });
    if (!error) {
      setShowNew(false); setSelectedOpponent(""); setSelectedWorkout("");
      showToast("Challenge sent! ⚔️");
      try { const { data } = await supabase.from("xp_settings").select("xp_required").eq("perk_key","_xp_challenge_sent").single(); await awardXp(currentUserId, data?.xp_required ?? XP_CHALLENGE_SENT, "challenge_sent"); } catch(e) { console.error(e); }
      loadChallenges();
    }
  }

  async function sendRematch(c: Challenge) {
    setRematching(c.id);
    try {
      const rivalId   = c.challenger_id === currentUserId ? c.opponent_id   : c.challenger_id;
      const rivalName = c.challenger_id === currentUserId ? c.opponent_name : c.challenger_name;
      const since24h = new Date(Date.now() - 86400000).toISOString();
      const { data: recentAttempts } = await supabase.from("score_attempts").select("*")
        .eq("player_id", currentUserId).eq("workout_id", c.workout_id).gte("attempted_at", since24h);
      let rematchScore = 0;
      if (recentAttempts && recentAttempts.length > 0) {
        const best = recentAttempts.reduce((b: any, s: any) => {
          const score = s.self_points > 0 ? s.self_points : (s.made + s.reps);
          const bScore = b ? (b.self_points > 0 ? b.self_points : (b.made + b.reps)) : 0;
          return score > bScore ? s : b;
        }, null);
        rematchScore = best ? (best.self_points > 0 ? best.self_points : (best.made + best.reps)) : 0;
      }
      if (rematchScore === 0) { showToast("Log this drill in the last 24 hours before rematching! 🏀"); return; }
      const { error } = await supabase.from("challenges").insert({
        challenger_id: currentUserId, challenger_name: currentUserName,
        opponent_id: rivalId, opponent_name: rivalName,
        workout_id: c.workout_id, workout_title: c.workout_title,
        challenger_score: rematchScore, opponent_score: null,
        status: "pending", opponent_seen: false, winner_id: null,
      });
      if (!error) { showToast(`Rematch sent to ${rivalName}! 🔄`); loadChallenges(); }
    } finally { setRematching(null); }
  }

  async function respondToChallenge(challenge: Challenge, accept: boolean) {
    if (!accept) {
      await supabase.from("challenges").update({ status: "declined" }).eq("id", challenge.id);
      showToast("Challenge declined."); loadChallenges(); return;
    }
    setResponding(challenge.id);
  }

  async function submitResponse(challenge: Challenge) {
    const finalScore = parseInt(myResponse) || 0;
    const winnerId = finalScore > challenge.challenger_score ? currentUserId : challenge.challenger_score > finalScore ? challenge.challenger_id : null;
    await supabase.from("challenges").update({ opponent_score: finalScore, status: "completed", winner_id: winnerId }).eq("id", challenge.id);
    if (winnerId) await awardChallengeWinBonus(winnerId).catch(console.error);
    try { const { data } = await supabase.from("xp_settings").select("xp_required").eq("perk_key","_xp_challenge_done").single(); await awardXp(currentUserId, data?.xp_required ?? XP_CHALLENGE_DONE, "challenge_completed"); } catch(e) { console.error(e); }
    if (finalScore > 0) {
      try { await submitScore({ player_id: currentUserId, workout_id: challenge.workout_id, made: finalScore, attempts: 0, sprint_secs: 0, reps: 0, self_points: 0 }); onScoreLogged?.(); } catch(e) { console.warn(e); }
    }
    setResponding(null); setMyResponse("");
    showToast(winnerId === currentUserId ? "🏆 You won!" : "Response submitted! 🏀");
    loadChallenges();
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
              : myScore !== null ? <div style={{ fontSize: 13, color: "#5de098", fontWeight: 600 }}>🔒 Logged</div>
              : <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--muted)" }}>—</div>}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--muted)" }}>VS</div>
          <div style={{ textAlign: "center", padding: "10px", background: "var(--surface)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{theirName.split(" ")[0].toUpperCase()}</div>
            {c.status === "completed" ? <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: theyWon ? "var(--gold)" : "var(--text)" }}>{theirScore ?? "—"}</div>
              : theirScore === -1 ? <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>Forfeited</div>
              : theirScore !== null ? <div style={{ fontSize: 13, color: "#5de098", fontWeight: 600 }}>🔒 Logged</div>
              : <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--muted)" }}>—</div>}
          </div>
        </div>
        {c.status === "pending" && (myScore !== null || theirScore !== null) && (
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
                <button onClick={() => submitResponse(c)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>Submit</button>
                <button onClick={() => setResponding(null)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Cancel</button>
              </div>
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
              <select value={selectedOpponent} onChange={e => setSelectedOpponent(e.target.value)}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                <option value="">Select a player…</option>
                {opponents.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {opponents.length === 0 && <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", padding: "8px 12px", background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 8 }}>No eligible opponents yet — other players need to reach {challengesThreshold} XP to unlock challenges.</div>}
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Choose Drill</label>
              <select value={selectedWorkout} onChange={e => setSelectedWorkout(e.target.value)}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                <option value="">Select a drill…</option>
                {activeWorkouts.map(w => <option key={w.id} value={w.id}>{w.emoji} {w.title}</option>)}
              </select>
            </div>
            {needsScore ? (
              <div>
                <div style={{ padding: "10px 12px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, fontSize: 12, color: "var(--silver-light)", marginBottom: 10 }}>⚠️ You haven't logged this drill in the last 24 hours. Enter your score to send the challenge:</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input type="number" value={challengeScore} onChange={e => setChallengeScore(e.target.value)} placeholder="Your score" min="0" style={{ flex: 1, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
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
