// src/components/HeadToHead.tsx
import { useState, useEffect, useCallback } from "react";
import { supabase, Score, Workout, submitScore, awardChallengeWinBonus, awardXp, XP_CHALLENGE_SENT, XP_CHALLENGE_DONE, getActiveTeamCompetition, getTeams, TeamCompetition, Team } from "../lib/supabase";
import { useLeaderboard } from "../hooks/useLeaderboard";

interface Props {
  currentUserId: string;
  currentUserName: string;
  workouts: Workout[];
  myScores: Score[];
  onScoreLogged?: () => void;
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

// ── Rival stat helpers ────────────────────────────────────────
function getRivalStats(challenges: Challenge[], myId: string) {
  const opponents: Record<string, { name: string; challenged: number; won: number; lost: number }> = {};

  for (const c of challenges) {
    const isChallenger = c.challenger_id === myId;
    const rivalId   = isChallenger ? c.opponent_id   : c.challenger_id;
    const rivalName = isChallenger ? c.opponent_name : c.challenger_name;

    if (!opponents[rivalId]) opponents[rivalId] = { name: rivalName, challenged: 0, won: 0, lost: 0 };
    opponents[rivalId].challenged++;

    if (c.status === "completed") {
      if (c.winner_id === myId)     opponents[rivalId].won++;
      else if (c.winner_id && c.winner_id !== myId) opponents[rivalId].lost++;
    }
  }

  return Object.entries(opponents).map(([id, s]) => ({ id, ...s }));
}

export default function HeadToHead({ currentUserId, currentUserName, workouts, myScores, onScoreLogged }: Props) {
  // Team competition state
  const [teamComp, setTeamComp]         = useState<TeamCompetition | null>(null);
  const [teams, setTeams]               = useState<Team[]>([]);
  const [teamProfiles, setTeamProfiles] = useState<any[]>([]);
  const [myTeam, setMyTeam]             = useState<Team | null>(null);
  const [newTeamNotif, setNewTeamNotif] = useState(false);
  const [teamRecord, setTeamRecord]     = useState<{wins:number;losses:number}>({wins:0,losses:0});
  const { leaderboard } = useLeaderboard();
  const [challenges, setChallenges]           = useState<Challenge[]>([]);
  const [showNew, setShowNew]                 = useState(false);
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [selectedWorkout, setSelectedWorkout]   = useState("");
  const [loading, setLoading]                 = useState(true);
  const [sending, setSending]                 = useState(false);
  const [rematching, setRematching]           = useState<string | null>(null);
  const [needsScore, setNeedsScore]           = useState(false);  // challenger has no 24h score
  const [challengeScore, setChallengeScore]   = useState("");     // score input for challenger
  const [responding, setResponding]           = useState<string | null>(null);
  const [myResponse, setMyResponse]           = useState("");
  const [toast, setToast]                     = useState("");
  const [activeTab, setActiveTab]             = useState<"h2h" | "stats" | "teams">("h2h");

  const activeWorkouts = workouts.filter(w => w.is_active !== false && w.scoring_type === "competitive");
  const opponents = leaderboard.filter(e => e.id !== currentUserId);

  const expireChallenges = useCallback(async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    // Find expired pending challenges where current user is challenger
    const { data: expired } = await supabase
      .from("challenges")
      .select("*")
      .eq("challenger_id", currentUserId)
      .eq("status", "pending")
      .lt("created_at", fiveDaysAgo);

    if (expired && expired.length > 0) {
      for (const c of expired) {
        // Mark as completed, challenger wins by default (+1 pt)
        await supabase.from("challenges").update({
          status: "completed",
          winner_id: currentUserId,
          opponent_score: -1, // sentinel = expired
        }).eq("id", c.id);
        // Award 1 point to challenger
        await awardChallengeWinBonus(currentUserId).catch(console.warn);
      }
    }
  }, [currentUserId]);

  const loadChallenges = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("challenges")
      .select("*")
      .or(`challenger_id.eq.${currentUserId},opponent_id.eq.${currentUserId}`)
      .order("created_at", { ascending: false });
    setChallenges(data ?? []);
    setLoading(false);

    // Mark pending challenges to me as seen
    const unseen = (data ?? []).filter(
      (c: Challenge) => c.opponent_id === currentUserId && c.status === "pending" && !c.opponent_seen
    );
    if (unseen.length > 0) {
      await supabase
        .from("challenges")
        .update({ opponent_seen: true })
        .in("id", unseen.map((c: Challenge) => c.id));
    }
  }, [currentUserId]);

  useEffect(() => { expireChallenges().then(() => loadChallenges()); }, [loadChallenges, expireChallenges]);
  useEffect(() => { loadTeamData(); loadTeamRecord(); }, [currentUserId]);

  async function loadTeamRecord() {
    // Find all past completed competitions (has a winning_team_id)
    const { data: comps } = await supabase.from("team_competitions")
      .select("id,winning_team_id")
      .not("winning_team_id","is",null);
    if (!comps || comps.length === 0) return;

    // For each completed competition, find what team the player was on
    const compIds = comps.map((c: any) => c.id);
    const { data: myTeams } = await supabase.from("teams")
      .select("id,competition_id")
      .in("competition_id", compIds);
    if (!myTeams) return;

    // Check which teams the player belongs to by checking profiles history
    // We use current team_id but also need past — simplest: check team membership
    const { data: profs } = await supabase.from("profiles")
      .select("team_id")
      .eq("id", currentUserId);
    const myTeamIds = new Set((profs ?? []).map((p: any) => p.team_id).filter(Boolean));

    // Also check current teamProfiles for historical assignments
    // For past comps, the player's team_id would have been set to a team in that comp
    // Cross reference: my team in each comp
    let wins = 0, losses = 0;
    for (const comp of comps) {
      const teamsInComp = (myTeams ?? []).filter((t: any) => t.competition_id === comp.id);
      const myTeamInComp = teamsInComp.find((t: any) => myTeamIds.has(t.id));
      if (!myTeamInComp) continue;
      if (myTeamInComp.id === comp.winning_team_id) wins++;
      else losses++;
    }
    setTeamRecord({ wins, losses });
  }

  async function loadTeamData() {
    const comp = await getActiveTeamCompetition();
    setTeamComp(comp);
    if (!comp) return;
    const t = await getTeams(comp.id);
    setTeams(t);
    // Load profiles with team assignments
    const { data: profs } = await supabase.from("profiles")
      .select("id,name,avatar_url,grade_category,team_id")
      .eq("role","player")
      .not("team_id","is",null);
    setTeamProfiles(profs ?? []);
    // Find my team
    const me = (profs ?? []).find((p: any) => p.id === currentUserId);
    if (me?.team_id) {
      const mine = t.find(tm => tm.id === me.team_id) ?? null;
      setMyTeam(mine);
      // Show notification if teams were created recently (last 24h)
      const createdAt = (comp as any).created_at;
      if (createdAt) {
        const age = Date.now() - new Date(createdAt).getTime();
        if (age < 86400000) setNewTeamNotif(true);
      }
    }
  }

  // Count of unseen challenges (for the red dot in App.tsx via prop)
  const unseenCount = challenges.filter(
    c => c.opponent_id === currentUserId && c.status === "pending" && !c.opponent_seen
  ).length;

  async function sendChallenge() {
    if (!selectedOpponent || !selectedWorkout) return;
    setSending(true);

    try {
      const workout  = workouts.find(w => w.id === selectedWorkout);
      const opponent = leaderboard.find(e => e.id === selectedOpponent);

      // Check for best score in last 24 hours
      const since24h = new Date(Date.now() - 86400000).toISOString();
      const { data: recentAttempts } = await supabase
        .from("score_attempts")
        .select("*")
        .eq("player_id", currentUserId)
        .eq("workout_id", selectedWorkout)
        .gte("attempted_at", since24h);

      // If no recent attempts, need to prompt for a score
      if (!recentAttempts || recentAttempts.length === 0) {
        setNeedsScore(true);
        setSending(false);
        return;
      }

      // Use best score from last 24 hours
      const best24h = recentAttempts.reduce((best: any, s: any) => {
        const score = s.self_points > 0 ? s.self_points : (s.made + s.reps);
        const bestScore = best ? (best.self_points > 0 ? best.self_points : (best.made + best.reps)) : 0;
        return score > bestScore ? s : best;
      }, null);
      const challengerScore = best24h ? (best24h.self_points > 0 ? best24h.self_points : (best24h.made + best24h.reps)) : 0;

      await createChallenge(selectedOpponent, opponent?.name ?? "Unknown", selectedWorkout, workout?.title ?? "Unknown", challengerScore);
    } finally {
      setSending(false);
    }
  }

  async function sendChallengeWithScore() {
    if (!selectedOpponent || !selectedWorkout) return;
    const score = parseInt(challengeScore) || 0;
    if (score <= 0) { showToast("Please enter a valid score."); return; }
    setSending(true);
    try {
      const workout  = workouts.find(w => w.id === selectedWorkout);
      const opponent = leaderboard.find(e => e.id === selectedOpponent);

      // Submit the score to their workout history first
      await submitScore({
        player_id:   currentUserId,
        workout_id:  selectedWorkout,
        made:        score,
        attempts:    0, sprint_secs: 0, reps: 0, self_points: 0,
      }).catch(console.warn);

      await createChallenge(selectedOpponent, opponent?.name ?? "Unknown", selectedWorkout, workout?.title ?? "Unknown", score);
      setNeedsScore(false);
      setChallengeScore("");
      onScoreLogged?.();
    } finally {
      setSending(false);
    }
  }

  async function createChallenge(opponentId: string, opponentName: string, workoutId: string, workoutTitle: string, challengerScore: number) {
    const { error } = await supabase.from("challenges").insert({
      challenger_id:    currentUserId,
      challenger_name:  currentUserName,
      opponent_id:      opponentId,
      opponent_name:    opponentName,
      workout_id:       workoutId,
      workout_title:    workoutTitle,
      challenger_score: challengerScore,
      opponent_score:   null,
      status:           "pending",
      opponent_seen:    false,
      winner_id:        null,
    });
    if (!error) {
      setShowNew(false);
      setSelectedOpponent(""); setSelectedWorkout("");
      showToast("Challenge sent! ⚔️");
      awardXp(currentUserId, XP_CHALLENGE_SENT, "challenge_sent").catch(console.error);
      loadChallenges();
    }
  }

  async function sendRematch(c: Challenge) {
    setRematching(c.id);
    try {
      const rivalId   = c.challenger_id === currentUserId ? c.opponent_id   : c.challenger_id;
      const rivalName = c.challenger_id === currentUserId ? c.opponent_name : c.challenger_name;

      // Check 24h score for rematch too
      const since24h = new Date(Date.now() - 86400000).toISOString();
      const { data: recentAttempts } = await supabase
        .from("score_attempts")
        .select("*")
        .eq("player_id", currentUserId)
        .eq("workout_id", c.workout_id)
        .gte("attempted_at", since24h);

      let rematchScore = 0;
      if (recentAttempts && recentAttempts.length > 0) {
        const best = recentAttempts.reduce((b: any, s: any) => {
          const score = s.self_points > 0 ? s.self_points : (s.made + s.reps);
          const bScore = b ? (b.self_points > 0 ? b.self_points : (b.made + b.reps)) : 0;
          return score > bScore ? s : b;
        }, null);
        rematchScore = best ? (best.self_points > 0 ? best.self_points : (best.made + best.reps)) : 0;
      }

      if (rematchScore === 0) {
        showToast("Log this drill in the last 24 hours before rematching! 🏀");
        return;
      }

      const { error } = await supabase.from("challenges").insert({
        challenger_id:    currentUserId,
        challenger_name:  currentUserName,
        opponent_id:      rivalId,
        opponent_name:    rivalName,
        workout_id:       c.workout_id,
        workout_title:    c.workout_title,
        challenger_score: rematchScore,
        opponent_score:   null,
        status:           "pending",
        opponent_seen:    false,
        winner_id:        null,
      });

      if (!error) {
        showToast(`Rematch sent to ${rivalName}! 🔄`);
        loadChallenges();
      }
    } finally {
      setRematching(null);
    }
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

    // Determine winner
    const winnerId =
      finalScore > challenge.challenger_score ? currentUserId :
      challenge.challenger_score > finalScore ? challenge.challenger_id :
      null; // tie

    await supabase.from("challenges").update({
      opponent_score: finalScore,
      status:         "completed",
      winner_id:      winnerId,
    }).eq("id", challenge.id);

    // Award +1 point to the winner and XP for completion
    if (winnerId) {
      await awardChallengeWinBonus(winnerId).catch(console.error);
    }
    awardXp(currentUserId, XP_CHALLENGE_DONE, "challenge_completed").catch(console.error);

    // ── Sync to workout scores ──────────────────────────────────
    // If this score is a personal best on the workout, update it
    const workout = workouts.find(w => w.id === challenge.workout_id);
    if (workout && score > 0) {
      try {
        await submitScore({
          player_id:    currentUserId,
          workout_id:   challenge.workout_id,
          made:         score,
          attempts:     0,
          sprint_secs:  0,
          reps:         0,
          self_points:  0,
        });
        onScoreLogged?.();
      } catch (e) {
        console.warn("Could not sync challenge score to workout:", e);
      }
    }

    setResponding(null);
    setMyResponse("");
    showToast(winnerId === currentUserId ? "🏆 You won! Score synced to your workout!" : "Response submitted! 🏀 Score synced to workout.");
    loadChallenges();
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const pending   = challenges.filter(c => c.status === "pending");
  const completed = challenges.filter(c => c.status === "completed");
  const myPending    = pending.filter(c => c.opponent_id   === currentUserId);
  const theirPending = pending.filter(c => c.challenger_id === currentUserId);

  // ── All-time stats ────────────────────────────────────────────
  const completedChallenges = challenges.filter(c => c.status === "completed");
  const totalWins   = completedChallenges.filter(c => c.winner_id === currentUserId).length;
  const totalLosses = completedChallenges.filter(c => c.winner_id && c.winner_id !== currentUserId).length;
  const totalTies   = completedChallenges.filter(c => c.status === "completed" && !c.winner_id).length;

  const rivalStats  = getRivalStats(challenges, currentUserId);
  const mostChallenged = [...rivalStats].sort((a, b) => b.challenged - a.challenged)[0];
  const mostBeaten     = [...rivalStats].sort((a, b) => b.won - a.won)[0];
  const mostLostTo     = [...rivalStats].sort((a, b) => b.lost - a.lost)[0];

  // ── Card component ────────────────────────────────────────────
  function ChallengeCard({ c }: { c: Challenge }) {
    const isChallenger = c.challenger_id === currentUserId;
    const myScore   = isChallenger ? c.challenger_score : (c.opponent_score ?? null);
    const theirScore = isChallenger ? (c.opponent_score ?? null) : c.challenger_score;
    const theirName  = isChallenger ? c.opponent_name : c.challenger_name;
    const iWon   = c.status === "completed" && c.winner_id === currentUserId;
    const theyWon = c.status === "completed" && c.winner_id && c.winner_id !== currentUserId;
    const tied   = c.status === "completed" && !c.winner_id;

    return (
      <div style={{
        background: "var(--surface2)",
        border: `1px solid ${iWon ? "rgba(240,192,64,0.4)" : theyWon ? "rgba(255,107,107,0.3)" : "var(--border)"}`,
        borderRadius: 12, padding: "14px 16px", marginBottom: 10,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
              {isChallenger ? `You vs ${theirName}` : `${theirName} challenged you`}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>📋 {c.workout_title}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              {new Date(c.created_at).toLocaleDateString()}
            </div>
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: c.status === "completed" ? "rgba(40,180,80,0.15)" : c.status === "declined" ? "rgba(255,107,107,0.15)" : "rgba(240,192,64,0.15)",
            color: c.status === "completed" ? "#5de098" : c.status === "declined" ? "#ff7b7b" : "var(--gold)",
          }}>
            {c.status === "completed" ? "Done" : c.status === "declined" ? "Declined" : "Pending"}
          </div>
        </div>

        {/* Score comparison — hidden until both have submitted (prevents gaming) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <div style={{ textAlign: "center", padding: "10px", background: "var(--surface)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>YOU</div>
            {c.status === "completed" ? (
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: iWon ? "var(--gold)" : "var(--text)" }}>
                {myScore ?? "—"}
              </div>
            ) : myScore !== null ? (
              <div style={{ fontSize: 13, color: "#5de098", fontWeight: 600 }}>🔒 Logged</div>
            ) : (
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--muted)" }}>—</div>
            )}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--muted)" }}>VS</div>
          <div style={{ textAlign: "center", padding: "10px", background: "var(--surface)", borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{theirName.split(" ")[0].toUpperCase()}</div>
            {c.status === "completed" ? (
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: theyWon ? "var(--gold)" : "var(--text)" }}>
                {theirScore ?? "—"}
              </div>
            ) : theirScore === -1 ? (
              <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>Forfeited</div>
            ) : theirScore !== null ? (
              <div style={{ fontSize: 13, color: "#5de098", fontWeight: 600 }}>🔒 Logged</div>
            ) : (
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--muted)" }}>—</div>
            )}
          </div>
        </div>
        {/* Waiting message while pending */}
        {c.status === "pending" && (myScore !== null || theirScore !== null) && (
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginBottom: 8, padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
            🔒 Scores hidden until both players submit
          </div>
        )}

        {/* Result + Rematch */}
        {c.status === "completed" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: iWon ? "var(--gold)" : theyWon ? "#ff7b7b" : "var(--muted)" }}>
  {c.opponent_score === -1 ? "🏆 Won (opponent forfeited)" : iWon ? "🏆 You Won!" : theyWon ? "💪 Keep grinding!" : "🤝 Tied!"}
            </div>
            <button
              onClick={() => sendRematch(c)}
              disabled={rematching === c.id}
              style={{
                background: "rgba(147,180,255,0.12)",
                border: "1px solid rgba(147,180,255,0.3)",
                color: "#93b4ff",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {rematching === c.id ? "Sending…" : "🔄 Rematch"}
            </button>
          </div>
        )}

        {/* Respond */}
        {c.status === "pending" && c.opponent_id === currentUserId && (
          responding === c.id ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                Enter your score for <strong style={{ color: "var(--text)" }}>{c.workout_title}</strong>:
              </div>
              <div style={{ fontSize: 11, color: "#93b4ff", marginBottom: 8 }}>
                💡 If this beats your personal best it'll update your workout score automatically!
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number" value={myResponse} onChange={e => setMyResponse(e.target.value)}
                  placeholder="Your score" min="0"
                  style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none" }}
                />
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

  // ── Stat tile ─────────────────────────────────────────────────
  function StatTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
    return (
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: color ?? "var(--text)", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      </div>
    );
  }

  return (
    <div className="panel active">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="section-title">Challenges</div>
          <div className="section-sub">Head-to-Head · Team Competition</div>
        </div>

      </div>

      {/* Tab switcher */}
      {/* Team notification banner */}
      {newTeamNotif && myTeam && (
        <div style={{ background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--gold)", fontWeight: 600 }}>
            🏆 Teams are live! You're on <span style={{ fontWeight: 700 }}>{myTeam.name}</span>
          </div>
          <button onClick={() => setNewTeamNotif(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "var(--surface2)", borderRadius: 10, padding: 4 }}>
        <button onClick={() => setActiveTab("h2h")} style={{
          flex: 1, background: activeTab === "h2h" ? "var(--royal)" : "transparent",
          color: activeTab === "h2h" ? "#fff" : "var(--muted)",
          border: "none", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 600,
          fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s",
        }}>⚔️ Head to Head{myPending.length > 0 ? ` (${myPending.length})` : ""}</button>
        <button onClick={() => setActiveTab("teams")} style={{
          flex: 1, background: activeTab === "teams" ? "var(--royal)" : "transparent",
          color: activeTab === "teams" ? "#fff" : "var(--muted)",
          border: "none", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 600,
          fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s",
        }}>🏆 Teams</button>
        <button onClick={() => setActiveTab("stats")} style={{
          flex: 1, background: activeTab === "stats" ? "var(--royal)" : "transparent",
          color: activeTab === "stats" ? "#fff" : "var(--muted)",
          border: "none", borderRadius: 8, padding: "8px 0", fontSize: 13, fontWeight: 600,
          fontFamily: "inherit", cursor: "pointer", transition: "all 0.15s",
        }}>📊 My Stats</button>
      </div>

      {/* ── HEAD TO HEAD TAB ── */}
      {activeTab === "h2h" && (
        <>
          {/* New Challenge button inside tab */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
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
                <button onClick={sendChallenge}
                  disabled={sending || !selectedOpponent || !selectedWorkout || !myScores.find(s => s.workout_id === selectedWorkout)}
                  className="btn-primary">
                  {sending ? "Sending…" : "⚔️ Send Challenge"}
                </button>
              </div>
            </div>
          )}

          {/* Waiting for me */}
          {myPending.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1, marginBottom: 10 }}>
                ⚔️ Waiting For You ({myPending.length})
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
        </>
      )}

      {/* ── TEAMS TAB ── */}
      {activeTab === "teams" && (
        <div>
          {!teamComp || !teamComp.is_active ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>👀</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", letterSpacing: 1, marginBottom: 10 }}>
                Keep an eye out for the next team competition!
              </div>
              <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7 }}>
                The coaching staff will announce when the next team challenge begins.
              </div>
            </div>
          ) : (
            <div>
              {/* My team highlight */}
              {myTeam && (
                <div style={{ background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Your team</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: myTeam.color }} />
                    <div style={{ fontWeight: 700, fontSize: 18, color: "var(--gold)" }}>{myTeam.name}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {teamComp.start_date} – {teamComp.end_date} · Winning team earns +{teamComp.bonus_points} pts each
                  </div>
                </div>
              )}
              {/* Team standings */}
              {(() => {
                const teamPoints: Record<string, number> = {};
                teams.forEach(t => { teamPoints[t.id] = 0; });
                const sortedTeams = [...teams].sort((a, b) => (teamPoints[b.id] ?? 0) - (teamPoints[a.id] ?? 0));
                const use2col = sortedTeams.length === 2 || sortedTeams.length === 4;
                const medals = ["🥇","🥈","🥉","4th"];

                const renderCard = (team: Team, rank: number) => {
                  const members = teamProfiles.filter((p: any) => p.team_id === team.id);
                  const pts = teamPoints[team.id] ?? 0;
                  const isFirst = rank === 0;
                  const isMyTeam = myTeam?.id === team.id;
                  return (
                    <div key={team.id} style={{ background: isFirst ? "rgba(240,192,64,0.05)" : "var(--surface2)", border: `${isFirst || isMyTeam ? "1.5px" : "1px"} solid ${isFirst ? "var(--gold)" : isMyTeam ? team.color : "var(--border)"}`, borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <div style={{ width: 9, height: 9, borderRadius: "50%", background: team.color }} />
                            <span style={{ fontWeight: 700, fontSize: 13, color: isFirst ? "var(--gold)" : "var(--text)" }}>{team.name}</span>
                            <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 20, background: "var(--surface)", color: "var(--muted)" }}>{medals[rank] ?? `${rank+1}th`}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: isFirst ? "var(--gold)" : "#93b4ff", lineHeight: 1 }}>{pts}</span>
                            <span style={{ fontSize: 10, color: "var(--muted)" }}>pts</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                        {members.map((p: any) => {
                          const initials = p.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase();
                          const isMe = p.id === currentUserId;
                          return (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderRadius: 6, background: isMe ? "rgba(26,63,168,0.15)" : "transparent" }}>
                              <div style={{ width: 20, height: 20, borderRadius: "50%", overflow: "hidden", border: `1.5px solid ${isMe ? team.color : "var(--border)"}`, background: "rgba(26,63,168,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                {p.avatar_url ? <img src={p.avatar_url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 7, fontWeight: 700, color: team.color }}>{initials}</span>}
                              </div>
                              <span style={{ flex: 1, fontSize: 11, color: "var(--text)", fontWeight: isMe ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name.split(" ")[0]}{isMe && <span style={{ color: "#93b4ff", marginLeft: 4 }}>(you)</span>}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                };

                return use2col ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{sortedTeams.map((t, r) => renderCard(t, r))}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{sortedTeams.map((t, r) => renderCard(t, r))}</div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── STATS TAB ── */}
      {activeTab === "stats" && (
        <div>
          {/* W/L/T Record */}
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--muted)", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>
            All-Time Record
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
            <StatTile label="Wins"   value={totalWins}   color="var(--gold)" />
            <StatTile label="Losses" value={totalLosses} color="#ff7b7b" />
            <StatTile label="Ties"   value={totalTies}   color="var(--muted)" />
          </div>
          <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Team Competition Record</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ textAlign: "center", background: "var(--surface)", borderRadius: 8, padding: "10px" }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: "var(--gold)", lineHeight: 1 }}>{teamRecord.wins}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Wins</div>
                </div>
                <div style={{ textAlign: "center", background: "var(--surface)", borderRadius: 8, padding: "10px" }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: "#ff7b7b", lineHeight: 1 }}>{teamRecord.losses}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Losses</div>
                </div>
              </div>
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                {teamRecord.wins + teamRecord.losses > 0 ? `${teamRecord.wins + teamRecord.losses} team competition${teamRecord.wins + teamRecord.losses !== 1 ? "s" : ""} played` : "No team competitions completed yet"}
              </div>
            </div>

          {/* Win rate */}
          {completedChallenges.length > 0 && (
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 24, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Win Rate</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 42, color: totalWins / completedChallenges.length >= 0.5 ? "var(--gold)" : "#93b4ff" }}>
                {Math.round((totalWins / completedChallenges.length) * 100)}%
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{completedChallenges.length} completed challenge{completedChallenges.length !== 1 ? "s" : ""}</div>
            </div>
          )}

          {/* Rivals breakdown */}
          {rivalStats.length > 0 && (
            <>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--muted)", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>
                Rival Breakdown
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
                {mostChallenged && (
                  <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Most Challenged</div>
                      <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 2 }}>{mostChallenged.name}</div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#93b4ff" }}>{mostChallenged.challenged}x</div>
                  </div>
                )}
                {mostBeaten && mostBeaten.won > 0 && (
                  <div style={{ background: "var(--surface2)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Beaten Most</div>
                      <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 2 }}>{mostBeaten.name}</div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)" }}>{mostBeaten.won}W</div>
                  </div>
                )}
                {mostLostTo && mostLostTo.lost > 0 && (
                  <div style={{ background: "var(--surface2)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Lost To Most</div>
                      <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 2 }}>{mostLostTo.name}</div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#ff7b7b" }}>{mostLostTo.lost}L</div>
                  </div>
                )}
              </div>

              {/* Full roster table */}
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--muted)", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>
                vs. Every Player
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 40px 40px 40px", padding: "8px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <div>Player</div><div style={{ textAlign: "center" }}>Total</div><div style={{ textAlign: "center", color: "var(--gold)" }}>W</div><div style={{ textAlign: "center", color: "#ff7b7b" }}>L</div><div style={{ textAlign: "center", color: "var(--muted)" }}>T</div>
                </div>
                {[...rivalStats].sort((a, b) => b.won - a.won).map((r, i) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 40px 40px 40px 40px", padding: "10px 14px", borderBottom: i < rivalStats.length - 1 ? "1px solid var(--border)" : "none", fontSize: 13 }}>
                    <div style={{ color: "var(--text)", fontWeight: 500 }}>{r.name}</div>
                    <div style={{ textAlign: "center", color: "var(--muted)" }}>{r.challenged}</div>
                    <div style={{ textAlign: "center", color: "var(--gold)", fontWeight: 700 }}>{r.won}</div>
                    <div style={{ textAlign: "center", color: "#ff7b7b", fontWeight: 700 }}>{r.lost}</div>
                    <div style={{ textAlign: "center", color: "var(--muted)" }}>{r.challenged - r.won - r.lost}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {challenges.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>
              Complete some challenges to see your stats! ⚔️
            </div>
          )}
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// Export the unseen count calculator so App.tsx can use it
export function getUnseenChallengeCount(challenges: { opponent_id: string; status: string; opponent_seen: boolean }[], userId: string): number {
  return challenges.filter(c => c.opponent_id === userId && c.status === "pending" && !c.opponent_seen).length;
}
