// src/components/challenges/H2HOversight.tsx
// Read-only oversight view for coaches/admins — shows every H2H challenge
// happening app-wide, not just ones the logged-in account participated in
// (unlike the player-facing H2HTab, which is scoped to "my" challenges).

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

interface Challenge {
  id: string;
  challenger_id: string; challenger_name: string;
  opponent_id: string;   opponent_name: string;
  workout_title: string;
  challenger_score: number;
  opponent_score: number | null;
  status: "pending" | "completed" | "declined";
  winner_id: string | null;
  created_at: string;
}

export default function H2HOversight() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("challenges").select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setChallenges(data ?? []);
    setLoading(false);
  }

  const pending   = challenges.filter(c => c.status === "pending").length;
  const completed = challenges.filter(c => c.status === "completed").length;
  const declined  = challenges.filter(c => c.status === "declined").length;

  const statusStyle = (status: Challenge["status"]) => ({
    background: status === "completed" ? "rgba(40,180,80,0.15)" : status === "declined" ? "rgba(255,107,107,0.15)" : "rgba(240,192,64,0.15)",
    color:      status === "completed" ? "#5de098" : status === "declined" ? "#ff7b7b" : "var(--gold)",
  });

  if (loading) return <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 18 }}>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px", textAlign: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)" }}>{pending}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Pending</div>
        </div>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px", textAlign: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#5de098" }}>{completed}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Completed</div>
        </div>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px", textAlign: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "#ff7b7b" }}>{declined}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Declined</div>
        </div>
      </div>

      {challenges.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚔️</div>
          No challenges yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {challenges.map(c => (
            <div key={c.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                  {c.challenger_name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>vs</span> {c.opponent_name}
                </div>
                <span style={{ ...statusStyle(c.status), fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>
                  {c.status === "completed" ? "Done" : c.status === "declined" ? "Declined" : "Pending"}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: c.status === "completed" ? 4 : 0 }}>{c.workout_title}</div>
              {c.status === "completed" && (
                <div style={{ fontSize: 12, color: "var(--text)" }}>
                  {c.challenger_name}: <strong>{c.challenger_score}</strong> · {c.opponent_name}: <strong>{c.opponent_score}</strong>
                  {c.winner_id && <span style={{ marginLeft: 8, color: "var(--gold)" }}>🏆 {c.winner_id === c.challenger_id ? c.challenger_name : c.opponent_name} won</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
