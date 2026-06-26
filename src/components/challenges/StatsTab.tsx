// src/components/StatsTab.tsx
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

interface Props { currentUserId: string; }

interface Challenge {
  id: string; challenger_id: string; challenger_name: string;
  opponent_id: string; opponent_name: string; workout_id: string;
  status: "pending" | "completed" | "declined"; winner_id: string | null; created_at: string;
}

function getRivalStats(challenges: Challenge[], myId: string) {
  const opponents: Record<string, { name: string; challenged: number; won: number; lost: number }> = {};
  for (const c of challenges) {
    const isChallenger = c.challenger_id === myId;
    const rivalId   = isChallenger ? c.opponent_id   : c.challenger_id;
    const rivalName = isChallenger ? c.opponent_name : c.challenger_name;
    if (!opponents[rivalId]) opponents[rivalId] = { name: rivalName, challenged: 0, won: 0, lost: 0 };
    opponents[rivalId].challenged++;
    if (c.status === "completed") {
      if (c.winner_id === myId) opponents[rivalId].won++;
      else if (c.winner_id && c.winner_id !== myId) opponents[rivalId].lost++;
    }
  }
  return Object.entries(opponents).map(([id, s]) => ({ id, ...s }));
}

function StatTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, color: color ?? "var(--text)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

export default function StatsTab({ currentUserId }: Props) {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [teamRecord, setTeamRecord] = useState<{wins:number;losses:number}>({wins:0,losses:0});

  useEffect(() => {
    loadChallenges();
    loadTeamRecord();
  }, [currentUserId]);

  async function loadChallenges() {
    const { data } = await supabase.from("challenges").select("*")
      .or(`challenger_id.eq.${currentUserId},opponent_id.eq.${currentUserId}`)
      .order("created_at", { ascending: false });
    setChallenges(data ?? []);
  }

  async function loadTeamRecord() {
    const { data: comps } = await supabase.from("team_competitions").select("id,winning_team_id").not("winning_team_id","is",null);
    if (!comps || comps.length === 0) return;
    const compIds = comps.map((c: any) => c.id);
    const { data: myTeams } = await supabase.from("teams").select("id,competition_id").in("competition_id", compIds);
    const { data: profs } = await supabase.from("profiles").select("team_id").eq("id", currentUserId);
    const myTeamIds = new Set((profs ?? []).map((p: any) => p.team_id).filter(Boolean));
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

  const completedChallenges = challenges.filter(c => c.status === "completed");
  const totalWins   = completedChallenges.filter(c => c.winner_id === currentUserId).length;
  const totalLosses = completedChallenges.filter(c => c.winner_id && c.winner_id !== currentUserId).length;
  const totalTies   = completedChallenges.filter(c => c.status === "completed" && !c.winner_id).length;
  const rivalStats  = getRivalStats(challenges, currentUserId);
  const mostChallenged = [...rivalStats].sort((a, b) => b.challenged - a.challenged)[0];
  const mostBeaten     = [...rivalStats].sort((a, b) => b.won - a.won)[0];
  const mostLostTo     = [...rivalStats].sort((a, b) => b.lost - a.lost)[0];

  return (
    <div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--muted)", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>All-Time Record</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        <StatTile label="Wins" value={totalWins} color="var(--gold)" />
        <StatTile label="Losses" value={totalLosses} color="#ff7b7b" />
        <StatTile label="Ties" value={totalTies} color="var(--muted)" />
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
      {completedChallenges.length > 0 && (
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", marginBottom: 24, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Win Rate</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 42, color: totalWins / completedChallenges.length >= 0.5 ? "var(--gold)" : "#93b4ff" }}>
            {Math.round((totalWins / completedChallenges.length) * 100)}%
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{completedChallenges.length} completed challenge{completedChallenges.length !== 1 ? "s" : ""}</div>
        </div>
      )}
      {rivalStats.length > 0 && (
        <>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--muted)", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>Rival Breakdown</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {mostChallenged && <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Most Challenged</div><div style={{ fontWeight: 600, color: "var(--text)", marginTop: 2 }}>{mostChallenged.name}</div></div><div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#93b4ff" }}>{mostChallenged.challenged}x</div></div>}
            {mostBeaten && mostBeaten.won > 0 && <div style={{ background: "var(--surface2)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Beaten Most</div><div style={{ fontWeight: 600, color: "var(--text)", marginTop: 2 }}>{mostBeaten.name}</div></div><div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)" }}>{mostBeaten.won}W</div></div>}
            {mostLostTo && mostLostTo.lost > 0 && <div style={{ background: "var(--surface2)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Lost To Most</div><div style={{ fontWeight: 600, color: "var(--text)", marginTop: 2 }}>{mostLostTo.name}</div></div><div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#ff7b7b" }}>{mostLostTo.lost}L</div></div>}
          </div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--muted)", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>vs. Every Player</div>
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
      {challenges.length === 0 && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "40px 0" }}>Complete some challenges to see your stats! ⚔️</div>}
    </div>
  );
}
