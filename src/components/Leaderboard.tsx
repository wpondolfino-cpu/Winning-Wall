// src/components/Leaderboard.tsx
import { useState, useEffect } from "react";
import { useLeaderboard } from "../hooks/useLeaderboard";
import { supabase, LeaderboardEntry, GRADE_CATEGORIES, GradeCategory, Workout, Score } from "../lib/supabase";

interface Props {
  currentUserId?: string;
}

const ALL = "All Players";
type Tab = typeof ALL | GradeCategory;

const SHORT: Record<string, string> = {
  "Elementary (3rd-4th Grade)": "Elem",
  "5th & 6th Grade": "5th/6th",
  "7th & 8th Grade": "7th/8th",
  "Underclassman (9th-10th Grade)": "JV",
  "Upperclassman (11th-12th Grade)": "Varsity",
  "Alumni": "Alumni",
  "All Players": "All",
};

type LeaderboardView = "overall" | string; // string = workout id

export default function Leaderboard({ currentUserId }: Props) {
  const { leaderboard, loading, lastUpdated } = useLeaderboard();
  const [activeTab, setActiveTab]   = useState<Tab>(ALL);
  const [view, setView]             = useState<LeaderboardView>("overall");
  const [workouts, setWorkouts]     = useState<Workout[]>([]);
  const [allScores, setAllScores]   = useState<Score[]>([]);
  const [profiles, setProfiles]     = useState<{id:string;name:string;grade_category?:string}[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [{ data: ws }, { data: sc }, { data: pr }] = await Promise.all([
      supabase.from("workouts").select("*").eq("is_active", true).order("created_at", { ascending: false }),
      supabase.from("scores").select("*"),
      supabase.from("profiles").select("id,name,grade_category").eq("role", "player"),
    ]);
    setWorkouts(ws ?? []);
    setAllScores(sc ?? []);
    setProfiles(pr ?? []);
  }

  if (loading) return <div className="loading">Loading leaderboard…</div>;

  const tabs: Tab[] = [ALL, ...GRADE_CATEGORIES];

  // Filter leaderboard to grade tab
  const filtered = activeTab === ALL
    ? leaderboard
    : leaderboard.filter(e => e.grade_category === activeTab);

  const ranked = filtered.map((e, i) => ({ ...e, rank: i + 1 }));
  const me = leaderboard.find(e => e.id === currentUserId);
  const myRankInTab = ranked.find(e => e.id === currentUserId);

  const shotPct = (e: LeaderboardEntry) =>
    e.total_attempts > 0 ? Math.round((e.total_made / e.total_attempts) * 100) + "%" : "—";
  const rankClass = (r: number) => r === 1 ? "gold" : r === 2 ? "silver" : r === 3 ? "bronze" : "";

  // ── Per-workout leaderboard data ──
  function getWorkoutBoard(workoutId: string) {
    // Get all scores for this workout
    const wScores = allScores.filter(s => s.workout_id === workoutId);
    // Filter by grade if needed
    const gradeFiltered = activeTab === ALL
      ? wScores
      : wScores.filter(s => {
          const p = profiles.find(pr => pr.id === s.player_id);
          return p?.grade_category === activeTab;
        });

    // Build rows with player names
    const rows = gradeFiltered.map(s => {
      const p = profiles.find(pr => pr.id === s.player_id);
      const rawScore = s.self_points > 0 ? s.self_points : (s.made + s.reps);
      const displayScore = s.sprint_secs > 0 && s.made === 0 && s.reps === 0
        ? `${s.sprint_secs}s` : rawScore.toString();
      return {
        playerId: s.player_id,
        name: p?.name ?? "Unknown",
        rawScore: s.sprint_secs > 0 && s.made === 0 ? -s.sprint_secs : rawScore, // lower time = better
        displayScore,
        points: s.points ?? 0,
      };
    }).sort((a, b) => b.rawScore - a.rawScore);

    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  const selectedWorkout = workouts.find(w => w.id === view);

  return (
    <div className="panel active">
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div className="section-title">Leaderboard</div>
          <div className="section-sub">
            {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Syncing…"}
          </div>
        </div>
        <span className="live-badge"><span className="live-dot" /> LIVE</span>
      </div>

      {/* ── Grade category tabs ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, background: "var(--surface2)", padding: 6, borderRadius: 12, border: "1px solid var(--border)" }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 600,
            background: activeTab === tab ? "var(--royal)" : "transparent",
            color: activeTab === tab ? "#fff" : "var(--muted)", transition: "all .2s", whiteSpace: "nowrap",
          }}>{SHORT[tab] ?? tab}</button>
        ))}
      </div>

      {/* ── View selector: Overall + per-workout ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        <button onClick={() => setView("overall")} style={{
          padding: "6px 14px", borderRadius: 8, border: `1px solid ${view === "overall" ? "var(--royal-light)" : "var(--border)"}`,
          cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          background: view === "overall" ? "rgba(26,63,168,0.2)" : "var(--surface2)",
          color: view === "overall" ? "#93b4ff" : "var(--muted)",
        }}>🏆 Overall</button>
        {workouts.map(w => (
          <button key={w.id} onClick={() => setView(w.id)} style={{
            padding: "6px 14px", borderRadius: 8, border: `1px solid ${view === w.id ? "var(--royal-light)" : "var(--border)"}`,
            cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
            background: view === w.id ? "rgba(26,63,168,0.2)" : "var(--surface2)",
            color: view === w.id ? "#93b4ff" : "var(--muted)", whiteSpace: "nowrap",
          }}>{w.emoji} {w.title}</button>
        ))}
      </div>

      {/* ── My stats strip (players only) ── */}
      {currentUserId && me && view === "overall" && (
        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">Overall Rank</div><div className="stat-value gold">#{me.rank}</div></div>
          <div className="stat-card"><div className="stat-label">{activeTab === ALL ? "Total Points" : `${SHORT[activeTab]} Rank`}</div>
            <div className="stat-value blue">{activeTab === ALL ? me.total_points : myRankInTab ? `#${myRankInTab.rank}` : "—"}</div>
          </div>
          <div className="stat-card"><div className="stat-label">Workouts Done</div><div className="stat-value">{me.workouts_completed}</div></div>
        </div>
      )}

      {/* ── Grade category label ── */}
      {activeTab !== ALL && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(26,63,168,0.15)", borderRadius: 8, fontSize: 13, color: "#93b4ff", fontWeight: 600, border: "1px solid rgba(26,63,168,0.25)" }}>
          📋 {activeTab} — {view === "overall" ? `${ranked.length} players` : `${getWorkoutBoard(view).length} scores`}
        </div>
      )}

      {/* ══ OVERALL LEADERBOARD ══ */}
      {view === "overall" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="lb-header-row">
            <div>RNK</div><div>PLAYER</div>
            <div style={{ textAlign: "center" }}>SHOT%</div>
            <div style={{ textAlign: "center" }}>SPRINT</div>
            <div style={{ textAlign: "center" }}>DONE</div>
            <div style={{ textAlign: "center" }}>PTS</div>
          </div>
          {ranked.map(entry => (
            <div key={entry.id} className={`lb-row ${entry.id === currentUserId ? "me" : ""}`}>
              <div className={`lb-rank ${rankClass(entry.rank)}`}>{entry.rank}</div>
              <div>
                <div className="lb-name" style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  {entry.is_period_champion && <span title="Biweekly Champion!">👑</span>}
                  {entry.name}
                  {entry.id === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff" }}>(you)</span>}
                  {entry.current_streak && entry.current_streak >= 2 && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "rgba(255,100,0,0.2)", color: "#ff8c42", border: "1px solid rgba(255,100,0,0.3)" }}>🔥 {entry.current_streak}d</span>
                  )}
                </div>
                <div className="lb-pos">
                  {entry.jersey ? `#${entry.jersey}` : ""}{entry.position ? ` · ${entry.position}` : ""}
                  {entry.grade_category && activeTab === ALL && <span style={{ marginLeft: 4, color: "var(--muted)" }}>· {SHORT[entry.grade_category] ?? entry.grade_category}</span>}
                </div>
              </div>
              <div className="lb-cell">{shotPct(entry)}</div>
              <div className="lb-cell">{entry.best_sprint > 0 ? `${entry.best_sprint}s` : "—"}</div>
              <div className="lb-cell">{entry.workouts_completed}</div>
              <div className="lb-cell highlight">{entry.total_points}</div>
            </div>
          ))}
          {ranked.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No players in this category yet. 🏀</div>
          )}
        </div>
      )}

      {/* ══ PER-WORKOUT LEADERBOARD ══ */}
      {view !== "overall" && selectedWorkout && (() => {
        const board = getWorkoutBoard(view);
        return (
          <div>
            {/* Workout info card */}
            <div className="card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ fontSize: 36 }}>{selectedWorkout.emoji}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>{selectedWorkout.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{selectedWorkout.category} · {selectedWorkout.scoring_type === "competitive" ? "Ranked" : selectedWorkout.scoring_type === "flat" ? `${selectedWorkout.flat_points} pts flat` : "Self-reported"}</div>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)" }}>{board.length}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>scores logged</div>
              </div>
            </div>

            {/* Score table */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 100px 80px", padding: "8px 16px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)" }}>
                <div>RNK</div><div>PLAYER</div><div style={{ textAlign: "center" }}>SCORE</div><div style={{ textAlign: "center" }}>PTS</div>
              </div>
              {board.map(row => (
                <div key={row.playerId} style={{
                  display: "grid", gridTemplateColumns: "44px 1fr 100px 80px",
                  padding: "11px 16px", alignItems: "center",
                  borderBottom: "1px solid rgba(176,184,200,0.05)",
                  background: row.playerId === currentUserId ? "rgba(26,63,168,0.15)" : undefined,
                  border: row.playerId === currentUserId ? "1px solid rgba(26,63,168,0.3)" : undefined,
                  borderRadius: row.playerId === currentUserId ? 8 : undefined,
                }}>
                  <div className={`lb-rank ${rankClass(row.rank)}`}>{row.rank}</div>
                  <div>
                    <div className="lb-name">
                      {row.name}
                      {row.playerId === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff", marginLeft: 6 }}>(you)</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "center", fontWeight: 600, color: "var(--silver-light)", fontSize: 14 }}>{row.displayScore}</div>
                  <div style={{ textAlign: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>{row.points}</div>
                </div>
              ))}
              {board.length === 0 && (
                <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                  No scores logged for this drill yet. Be the first! 🏀
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
