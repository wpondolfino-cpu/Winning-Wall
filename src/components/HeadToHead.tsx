// src/components/HeadToHead.tsx
import { useState, useEffect } from "react";
import { supabase, Score, Workout, LeaderboardEntry } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  currentUserId: string;
  currentUserName: string;
  workouts: Workout[];
  myScores: Score[];
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
  created_at: string;
}

export default function HeadToHead({ currentUserId, currentUserName, workouts, myScores }: Props) {
  const { leaderboard } = useLeaderboard();
  const [challenges, setChallenges]     = useState<Challenge[]>([]);
  const [showNew, setShowNew]           = useState(false);
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [selectedWorkout, setSelectedWorkout]   = useState("");
  const [loading, setLoading]           = useState(true);
  const [sending, setSending]           = useState(false);
  const [responding, setResponding]     = useState<string | null>(null);
  const [myResponse, setMyResponse]     = useState("");
  const [toast, setToast]               = useState("");

  // Only active workouts
  const activeWorkouts = workouts.filter(w => w.is_active !== false && w.scoring_type === "competitive");

  // Other players
  const opponents = leaderboard.filter(e => e.id !== currentUserId);

  useEffect(() => { loadChallenges(); }, []);

  async function loadChallenges() {
    setLoading(true);
    const { data } = await supabase
      .from("challenges")
      .select("*")
      .or(`challenger_id.eq.${currentUserId},opponent_id.eq.${currentUserId}`)
      .order("created_at", { ascending: false });
    setChallenges(data ?? []);
    setLoading(false);
  }

  async function sendChallenge() {
    if (!selectedOpponent || !selectedWorkout) return;
    setSending(true);
    const workout = workouts.find(w => w.id === selectedWorkout);
    const opponent = leaderboard.find(e => e.id === selectedOpponent);
    const myScore = myScores.find(s => s.workout_id === selectedWorkout);

    const { error } = await supabase.from("challenges").insert({
      challenger_id: currentUserId,
      challenger_name: currentUserName,
      opponent_id: selectedOpponent,
      opponent_name: opponent?.name ?? "Unknown",
      workout_id: selectedWorkout,
      workout_title: workout?.title ?? "Unknown",
      challenger_score: myScore ? (myScore.made + myScore.reps) : 0,
      opponent_score: null,
      status: "pending",
    });

    if (!error) {
      setShowNew(false);
      setSelectedOpponent(""); setSelectedWorkout("");
      showToast("Challenge sent! 🏀");
      loadChallenges();
    }
    setSending(false);
  }

  async function respondToChallenge(challenge: Challenge, accept: boolean) {
    if (!accept) {
      await supabase.from("challenges").update({ status: "declined" }).eq("id", challenge.id);
      showToast("Challenge declined.");
      loadChallenges();
      return;
    }
    setResponding(challenge.id);
  }

  async function submitResponse(challenge: Challenge) {
    const score = parseInt(myResponse) || 0;
    const myBest = myScores.find(s => s.workout_id === challenge.workout_id);
    const finalScore = myBest ? Math.max(score, myBest.made + myBest.reps) : score;

    await supabase.from("challenges").update({
      opponent_score: finalScore,
      status: "completed",
    }).eq("id", challenge.id);

    setResponding(null);
    setMyResponse("");
    showToast("Response submitted! 🏀");
    loadChallenges();
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  }

  const pending  = challenges.filter(c => c.status === "pending");
  const completed = challenges.filter(c => c.status === "completed");

  const myPending = pending.filter(c => c.opponent_id === currentUserId);
  const theirPending = pending.filter(c => c.challenger_id === currentUserId);

  function ChallengeCard({ c }: { c: Challenge }) {
    const isChallenger = c.challenger_id === currentUserId;
    const myScore = isChallenger ? c.challenger_score : (c.opponent_score ?? null);
    const theirScore = isChallenger ? (c.opponent_score ?? null) : c.challenger_score;
    const theirName = isChallenger ? c.opponent_name : c.challenger_name;
    const iWon = c.status === "completed" && myScore !== null && theirScore !== null && myScore > theirScore;
    const theyWon = c.status === "completed" && myScore !== null && theirScore !== null && theirScore > myScore;
    const tied = c.status === "completed" && myScore === theirScore;

    return (
      <div style={{
        background: "var(--surface2)", border: `1px solid ${iWon ? "rgba(240,192,64,0.4)" : theyWon ? "rgba(255,107,107,0.3)" : "var(--border)"}`,
        borderRadius: 12, padding: "14px 16px", marginBottom: 10,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
              {isChallenger ? `You vs ${theirName}` : `${theirName} challenged you`}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>📋 {c.workout_title}</div>
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: c.status === "completed" ? "rgba(40,180,80,0.15)" : c.status === "declined" ? "rgba(255,107,107,0.15)" : "rgba(240,192,64,0.15)",
            color: c.status === "completed" ? "#5de098" : c.status === "declined" ? "#ff7b7b" : "var(--gold)",
          }}>
            {c.status === "completed" ? "Done" : c.status === "declined" ? "Declined" : "Pending"}
          </div>
        </div>

        {/* Score comparison */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ textAlign: "center", padding: "10px", background: "var(--surface)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>YOU</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: iWon ? "var(--gold)" : "var(--text)" }}>
              {myScore ?? "—"}
            </div>
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--muted)" }}>VS</div>
          <div style={{ textAlign: "center", padding: "10px", background: "var(--surface)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{theirName.split(" ")[0].toUpperCase()}</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: theyWon ? "var(--gold)" : "var(--text)" }}>
              {theirScore ?? "—"}
            </div>
          </div>
        </div>

        {/* Result */}
        {c.status === "completed" && (
          <div style={{ textAlign: "center", fontSize: 14, fontWeight: 700, color: iWon ? "var(--gold)" : theyWon ? "#ff7b7b" : "var(--muted)" }}>
            {iWon ? "🏆 You Won!" : theyWon ? "💪 Keep grinding!" : "🤝 Tied!"}
          </div>
        )}

        {/* Respond to challenge */}
        {c.status === "pending" && c.opponent_id === currentUserId && (
          responding === c.id ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                Enter your score for {c.workout_title}:
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" value={myResponse} onChange={e => setMyResponse(e.target.value)}
                  placeholder="Your score" min="0"
                  style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
                <button onClick={() => submitResponse(c)} style={{
                  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8,
                  padding: "8px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                }}>Submit</button>
                <button onClick={() => setResponding(null)} style={{
                  background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)",
                  borderRadius: 8, padding: "8px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
                }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => respondToChallenge(c, true)} style={{
                flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8,
                padding: "8px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
              }}>Accept Challenge</button>
              <button onClick={() => respondToChallenge(c, false)} style={{
                background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)",
                borderRadius: 8, padding: "8px 14px", fontSize: 12, fontFamily: "inherit", cursor: "pointer",
              }}>Decline</button>
            </div>
          )
        )}
      </div>
    );
  }

  return (
    <div className="panel active">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div className="section-title">Head-to-Head</div>
          <div className="section-sub">Challenge a teammate on any drill</div>
        </div>
        <button onClick={() => setShowNew(s => !s)} style={{
          background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
          padding: "9px 16px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>{showNew ? "✕ Cancel" : "⚔️ New Challenge"}</button>
      </div>

      {/* New challenge form */}
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
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>Choose Drill</label>
              <select value={selectedWorkout} onChange={e => setSelectedWorkout(e.target.value)}
                style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                <option value="">Select a drill…</option>
                {activeWorkouts.map(w => <option key={w.id} value={w.id}>{w.emoji} {w.title}</option>)}
              </select>
            </div>
            {selectedWorkout && !myScores.find(s => s.workout_id === selectedWorkout) && (
              <div style={{ padding: "8px 12px", background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.25)", borderRadius: 8, fontSize: 12, color: "#ff7b7b" }}>
                ⚠️ You need to log a score for this drill first before challenging someone!
              </div>
            )}
            <button onClick={sendChallenge} disabled={sending || !selectedOpponent || !selectedWorkout || !myScores.find(s => s.workout_id === selectedWorkout)}
              className="btn-primary">
              {sending ? "Sending…" : "⚔️ Send Challenge"}
            </button>
          </div>
        </div>
      )}

      {/* Pending challenges for me */}
      {myPending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 10 }}>
            ⚔️ Challenges Waiting For You ({myPending.length})
          </div>
          {myPending.map(c => <ChallengeCard key={c.id} c={c} />)}
        </div>
      )}

      {/* My sent challenges */}
      {theirPending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#93b4ff", letterSpacing: 1, marginBottom: 10 }}>
            📤 Challenges You Sent ({theirPending.length})
          </div>
          {theirPending.map(c => <ChallengeCard key={c.id} c={c} />)}
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--muted)", letterSpacing: 1, marginBottom: 10 }}>
            📋 Past Challenges
          </div>
          {completed.map(c => <ChallengeCard key={c.id} c={c} />)}
        </div>
      )}

      {challenges.length === 0 && !loading && !showNew && (
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
          No challenges yet. Hit "New Challenge" to call someone out! ⚔️
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
