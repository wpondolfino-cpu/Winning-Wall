// src/components/Leaderboard.tsx
import { useState, useEffect } from "react";
import { useLeaderboard } from "../hooks/useLeaderboard";
import {
  supabase, LeaderboardEntry, GRADE_CATEGORIES, GradeCategory,
  Workout, Score, currentPeriodStart, currentPeriodEnd,
  getActiveTeamCompetition, getTeams,
} from "../lib/supabase";
import type { TeamCompetition, Team } from "../lib/supabase";

interface Props { currentUserId?: string; }

const ALL = "All Players";
type GradeTab = typeof ALL | GradeCategory;
type TimeMode = "alltime" | "period" | "teams";
type BoardView = "overall" | string; // string = workout id

const SHORT: Record<string, string> = {
  "Underclassman (9th-10th Grade)": "JV",
  "Upperclassman (11th-12th Grade)": "Varsity",
  "Alumni": "Alumni",
  "All Players": "All",
};

interface PeriodEntry {
  player_id: string;
  name: string;
  grade_category?: string;
  period_points: number;
  workouts_logged: number;
  is_period_champion?: boolean;
  current_streak?: number;
  avatar_url?: string;
}

export default function Leaderboard({ currentUserId }: Props) {
  const { leaderboard, loading, lastUpdated } = useLeaderboard();
  const [gradeTab, setGradeTab]     = useState<GradeTab>(ALL);
  const [timeMode, setTimeMode]     = useState<TimeMode>("alltime");
  const [view, setView]             = useState<BoardView>("overall");
  const [workouts, setWorkouts]     = useState<Workout[]>([]);
  const [allScores, setAllScores]   = useState<Score[]>([]);
  const [periodScores, setPeriodScores] = useState<Score[]>([]);
  const [profiles, setProfiles]     = useState<{id:string;name:string;grade_category?:string;avatar_url?:string}[]>([]);
  const [periodEntries, setPeriodEntries] = useState<PeriodEntry[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [teamComp, setTeamComp]           = useState<TeamCompetition | null>(null);
  const [teams, setTeams]                 = useState<Team[]>([]);
  const [teamProfiles, setTeamProfiles]   = useState<any[]>([]);


  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();

  useEffect(() => { loadData(); loadTeams(); }, []);
  useEffect(() => { if (periodScores.length > 0) buildPeriodBoard(); }, [periodScores, profiles]);


  async function loadTeams() {
    const comp = await getActiveTeamCompetition();
    setTeamComp(comp);
    if (comp) {
      const t = await getTeams(comp.id);
      setTeams(t);
      // Load profiles with team_id
      const { data } = await supabase.from("profiles")
        .select("id,name,avatar_url,grade_category,team_id")
        .eq("role", "player")
        .not("team_id", "is", null);
      setTeamProfiles(data ?? []);
    }
  }

  async function loadData() {
    const [{ data: ws }, { data: sc }, { data: pr }, { data: psc }] = await Promise.all([
      supabase.from("workouts").select("*").eq("is_active", true).order("created_at", { ascending: false }),
      // Note: leaderboard_active filtering handled client-side below
      supabase.from("scores").select("*"),
      supabase.from("profiles").select("id,name,grade_category,is_period_champion,avatar_url").eq("role", "player"),
      // Period scores: attempts logged within the current 2-week window
      supabase.from("score_attempts").select("*")
        .gte("attempted_at", periodStart.toISOString())
        .lte("attempted_at", periodEnd.toISOString()),
    ]);
    const allWorkouts = ws ?? [];
    setWorkouts(allWorkouts);
    // Only count scores from leaderboard-active workouts toward rankings
    const lbActiveIds = new Set((ws ?? []).filter((w: any) => w.leaderboard_active !== false).map((w: any) => w.id));
    setAllScores((sc ?? []).filter((s: any) => lbActiveIds.has(s.workout_id)));
    setProfiles(pr ?? []);
    setPeriodScores(psc ?? []);
  }

  function buildPeriodBoard() {
    // Use rank-based points from the scores table (same as all-time)
    // but only for players who logged at least one attempt this period
    const map: Record<string, PeriodEntry> = {};

    // Get unique player+workout combos that had attempts this period
    const periodActivity: Record<string, Set<string>> = {};
    for (const s of periodScores) {
      if (!periodActivity[s.player_id]) periodActivity[s.player_id] = new Set();
      periodActivity[s.player_id].add(s.workout_id);
    }

    // For each player active this period, sum their rank-based points
    // from the scores table (which has the correct 1st/2nd/3rd points)
    for (const playerId of Object.keys(periodActivity)) {
      const p = profiles.find(pr => pr.id === playerId);
      if (!p) continue;

      // Sum points from scores table for workouts they attempted this period
      const workoutIds = Array.from(periodActivity[playerId]);
      const playerScores = allScores.filter(
        s => s.player_id === playerId && workoutIds.includes(s.workout_id)
      );
      const periodPoints = playerScores.reduce((sum, s) => sum + (s.points ?? 0), 0);

      map[playerId] = {
        player_id: playerId,
        name: p.name,
        grade_category: p.grade_category,
        period_points: periodPoints,
        workouts_logged: periodActivity[playerId].size,
        avatar_url: profiles.find(p => p.id === playerId)?.avatar_url,
        is_period_champion: (p as any).is_period_champion,
      };
    }
    setPeriodEntries(Object.values(map).sort((a, b) => b.period_points - a.period_points));
  }

  if (loading) return <div className="loading">Loading leaderboard…</div>;

  const gradeTabs: GradeTab[] = [ALL, ...GRADE_CATEGORIES];
  const rankClass = (r: number) => r === 1 ? "gold" : r === 2 ? "silver" : r === 3 ? "bronze" : "";

  // ── All-time overall filtered by grade ──
  const filtered = gradeTab === ALL ? leaderboard : leaderboard.filter(e => e.grade_category === gradeTab);
  const ranked = filtered.map((e, i) => ({ ...e, rank: i + 1 }));
  const me = leaderboard.find(e => e.id === currentUserId);
  const myRankInTab = ranked.find(e => e.id === currentUserId);

  // ── Period overall filtered by grade ──
  const periodFiltered = gradeTab === ALL
    ? periodEntries
    : periodEntries.filter(e => e.grade_category === gradeTab);
  const periodRanked = periodFiltered.map((e, i) => ({ ...e, rank: i + 1 }));
  const myPeriodEntry = periodRanked.find(e => e.player_id === currentUserId);

  // ── Per-workout board (all-time personal bests) ──
  function getWorkoutBoard(workoutId: string, scoresSource: Score[]) {
    const wScores = scoresSource.filter(s => s.workout_id === workoutId);
    const gradeFiltered = gradeTab === ALL ? wScores
      : wScores.filter(s => profiles.find(pr => pr.id === s.player_id)?.grade_category === gradeTab);

    const workout = workouts.find(w => w.id === workoutId);

    const sorted = gradeFiltered.map(s => {
      const p = profiles.find(pr => pr.id === s.player_id);
      const rawScore = s.self_points > 0 ? s.self_points : (s.made + s.reps);
      const displayScore = s.sprint_secs > 0 && s.made === 0 && s.reps === 0 ? `${s.sprint_secs}s` : rawScore.toString();
      return {
        playerId: s.player_id,
        name: p?.name ?? "Unknown",
        rawScore: s.sprint_secs > 0 && s.made === 0 ? -s.sprint_secs : rawScore,
        displayScore,
        points: s.points ?? 0,
      };
    }).sort((a, b) => b.rawScore - a.rawScore);

    // Recalculate rank-based points based on current position
    return sorted.map((r, i) => {
      let rankPts = r.points;
      if (workout?.scoring_type === "competitive") {
        if (i === 0) rankPts = workout.first_place_pts ?? 5;
        else if (i === 1) rankPts = workout.second_place_pts ?? 3;
        else if (i === 2) rankPts = workout.third_place_pts ?? 1;
        else rankPts = 0;
      }
      return { ...r, points: rankPts, rank: i + 1 };
    });
  }

  // ── Per-workout period board (best attempt within period) ──
  function getPeriodWorkoutBoard(workoutId: string) {
    const wAttempts = periodScores.filter((s: any) => s.workout_id === workoutId);
    const gradeFiltered = gradeTab === ALL ? wAttempts
      : wAttempts.filter((s: any) => profiles.find(pr => pr.id === s.player_id)?.grade_category === gradeTab);

    // Best attempt per player within period
    const bestMap: Record<string, any> = {};
    for (const a of gradeFiltered) {
      const existing = bestMap[a.player_id];
      if (!existing || (a as any).raw_score > existing.raw_score) bestMap[a.player_id] = a;
    }

    return Object.values(bestMap).map((s: any) => {
      const p = profiles.find(pr => pr.id === s.player_id);
      const rawScore = s.raw_score ?? 0;
      return {
        playerId: s.player_id,
        name: p?.name ?? "Unknown",
        rawScore,
        displayScore: rawScore.toString(),
        points: rawScore,
      };
    }).sort((a, b) => b.rawScore - a.rawScore).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  const selectedWorkout = workouts.find(w => w.id === view);

  return (
    <div className="panel active">
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="section-title">Leaderboard</div>
          <div className="section-sub">{lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Syncing…"}</div>
        </div>
        <span className="live-badge"><span className="live-dot" /> LIVE</span>
      </div>

      {/* ── ALL-TIME vs CURRENT PERIOD toggle ── */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 12, padding: 4, marginBottom: 16, border: "1px solid var(--border)" }}>
        <button onClick={() => setTimeMode("alltime")} style={{
          flex: 1, padding: "10px", borderRadius: 9, border: "none", cursor: "pointer",
          fontFamily: "inherit", fontSize: 13, fontWeight: 600,
          background: timeMode === "alltime" ? "var(--royal)" : "transparent",
          color: timeMode === "alltime" ? "#fff" : "var(--muted)", transition: "all .2s",
        }}>🏆 All-Time</button>
        <button onClick={() => setTimeMode("period")} style={{
          flex: 1, padding: "10px", borderRadius: 9, border: "none", cursor: "pointer",
          fontFamily: "inherit", fontSize: 13, fontWeight: 600,
          background: timeMode === "period" ? "var(--royal)" : "transparent",
          color: timeMode === "period" ? "#fff" : "var(--muted)", transition: "all .2s",
        }}>📅 Current Period</button>
        <button onClick={() => { setTimeMode("teams"); setView("overall"); }} style={{
          flex: 1, padding: "10px", borderRadius: 9, border: "none", cursor: "pointer",
          fontFamily: "inherit", fontSize: 13, fontWeight: 600,
          background: timeMode === "teams" ? "var(--royal)" : "transparent",
          color: timeMode === "teams" ? "#fff" : "var(--muted)", transition: "all .2s",
        }}>🏆 Teams</button>


      </div>

      {/* Period date range banner */}
      {timeMode === "period" && (
        <div style={{ marginBottom: 16, padding: "10px 16px", background: "linear-gradient(135deg, rgba(26,63,168,0.2), rgba(240,192,64,0.1))", border: "1px solid rgba(240,192,64,0.25)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--gold)", letterSpacing: 1 }}>👑 Biweekly Race</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--silver-light)" }}>
            {Math.ceil((periodEnd.getTime() - Date.now()) / 86400000)} days remaining
          </div>
        </div>
      )}

      {/* ── Grade tabs ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, background: "var(--surface2)", padding: 6, borderRadius: 12, border: "1px solid var(--border)" }}>
        {gradeTabs.map(tab => (
          <button key={tab} onClick={() => setGradeTab(tab)} style={{
            padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 600,
            background: gradeTab === tab ? "var(--royal)" : "transparent",
            color: gradeTab === tab ? "#fff" : "var(--muted)", transition: "all .2s", whiteSpace: "nowrap",
          }}>{SHORT[tab] ?? tab}</button>
        ))}
      </div>

      {/* ── View selector: Overall + grouped by week ── */}
      {(() => {
        const groups = Array.from(new Set(workouts.map(w => w.group_name).filter(Boolean))) as string[];
        const ungrouped = workouts.filter(w => !w.group_name);
        const activeGroup = selectedGroup ?? (groups[0] ?? null);
        const visibleWorkouts = activeGroup
          ? workouts.filter(w => w.group_name === activeGroup)
          : ungrouped;

        return (
          <div style={{ marginBottom: 20 }}>
            {/* Row 1: Overall + group tabs */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <button onClick={() => { setView("overall"); setSelectedGroup(null); }} style={{
                padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                border: `1px solid ${view === "overall" ? "var(--royal-light)" : "var(--border)"}`,
                background: view === "overall" ? "rgba(26,63,168,0.2)" : "var(--surface2)",
                color: view === "overall" ? "#93b4ff" : "var(--muted)",
              }}>🏆 Overall</button>
              {groups.map(g => {
                const firstInGroup = workouts.find(w => w.group_name === g);
                return (
                <button key={g} onClick={() => { setSelectedGroup(g); if (firstInGroup) setView(firstInGroup.id); }} style={{
                  padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                  border: `1px solid ${activeGroup === g && view !== "overall" ? "var(--royal-light)" : "var(--border)"}`,
                  background: activeGroup === g && view !== "overall" ? "rgba(26,63,168,0.2)" : "var(--surface2)",
                  color: activeGroup === g && view !== "overall" ? "#93b4ff" : "var(--muted)",
                }}>📋 {g}</button>
                );
              })}
              {ungrouped.length > 0 && groups.length > 0 && (
                <button onClick={() => setSelectedGroup(null)} style={{
                  padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${!activeGroup && view !== "overall" ? "var(--royal-light)" : "var(--border)"}`,
                  background: !activeGroup && view !== "overall" ? "rgba(26,63,168,0.2)" : "var(--surface2)",
                  color: !activeGroup && view !== "overall" ? "#93b4ff" : "var(--muted)",
                }}>📋 Other</button>
              )}
            </div>
            {/* Row 2: individual drills within selected group (hidden when overall is selected) */}
            {view !== "overall" && visibleWorkouts.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
                {visibleWorkouts.map(w => (
                  <button key={w.id} onClick={() => setView(w.id)} style={{
                    padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                    border: `1px solid ${view === w.id ? "var(--royal-light)" : "var(--border)"}`,
                    background: view === w.id ? "rgba(26,63,168,0.2)" : "transparent",
                    color: view === w.id ? "#93b4ff" : "var(--muted)",
                  }}>{w.emoji} {w.title}</button>
                ))}
              </div>
            )}
            {/* If a group tab is clicked but no drill selected yet, auto-select first drill */}
            {view === "overall" && false && null}
          </div>
        );
      })()}

      {/* ── My stats (players only, overall view) ── */}
      {currentUserId && view === "overall" && (
        <div className="stats-row">
          {timeMode === "alltime" ? <>
            <div className="stat-card"><div className="stat-label">All-Time Rank</div><div className="stat-value gold">#{me ? myRankInTab?.rank ?? me.rank : "—"}</div></div>
            <div className="stat-card"><div className="stat-label">All-Time Points</div><div className="stat-value blue">{me?.total_points ?? 0}</div></div>
            <div className="stat-card"><div className="stat-label">Workouts Done</div><div className="stat-value">{me?.workouts_completed ?? 0}</div></div>
          </> : <>
            <div className="stat-card"><div className="stat-label">Period Rank</div><div className="stat-value gold">{myPeriodEntry ? `#${myPeriodEntry.rank}` : "—"}</div></div>
            <div className="stat-card"><div className="stat-label">Period Points</div><div className="stat-value blue">{myPeriodEntry?.period_points ?? 0}</div></div>
            <div className="stat-card"><div className="stat-label">Workouts Done</div><div className="stat-value">{myPeriodEntry?.workouts_logged ?? 0}</div></div>
          </>}
        </div>
      )}

      {/* ── Grade label ── */}
      {gradeTab !== ALL && (
        <div style={{ marginBottom: 14, padding: "8px 14px", background: "rgba(26,63,168,0.15)", borderRadius: 8, fontSize: 13, color: "#93b4ff", fontWeight: 600, border: "1px solid rgba(26,63,168,0.25)" }}>
          📋 {gradeTab}
        </div>
      )}

      {/* ══ ALL-TIME OVERALL ══ */}
      {timeMode === "alltime" && view === "overall" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="lb-header-row">
            <div>RNK</div><div>PLAYER</div>
            <div style={{ textAlign: "center" }}>PTS</div>
          </div>
          {ranked.map(entry => (
            <div key={entry.id} style={{
              display: "grid", gridTemplateColumns: "44px 1fr 80px",
              padding: "12px 16px", alignItems: "center",
              borderBottom: "1px solid rgba(176,184,200,0.05)",
              background: entry.id === currentUserId ? "rgba(26,63,168,0.15)" : undefined,
            }}>
              <div className={`lb-rank ${rankClass(entry.rank)}`}>{entry.rank}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
                  {entry.avatar_url
                    ? <img src={entry.avatar_url} alt={entry.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)" }}>{entry.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}</span>
                  }
                </div>
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
                    {entry.grade_category && gradeTab === ALL && <span style={{ color: "var(--muted)" }}>{SHORT[entry.grade_category] ?? entry.grade_category}</span>}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{entry.total_points}</div>
            </div>
          ))}
          {ranked.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No players yet. 🏀</div>}
        </div>
      )}

      {/* ══ PERIOD OVERALL ══ */}
      {timeMode === "period" && view === "overall" && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 80px 80px", padding: "8px 16px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)" }}>
            <div>RNK</div><div>PLAYER</div><div style={{ textAlign: "center" }}>PTS</div>
          </div>
          {periodRanked.map((entry, i) => (
            <div key={entry.player_id} style={{
              display: "grid", gridTemplateColumns: "44px 1fr 80px",
              padding: "12px 16px", alignItems: "center",
              borderBottom: "1px solid rgba(176,184,200,0.05)",
              background: entry.player_id === currentUserId ? "rgba(26,63,168,0.15)" : undefined,
            }}>
              <div className={`lb-rank ${rankClass(i + 1)}`}>{i + 1}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
                  {entry.avatar_url
                    ? <img src={entry.avatar_url} alt={entry.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)" }}>{entry.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase()}</span>
                  }
                </div>
                <div>
                  <div className="lb-name" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {entry.is_period_champion && <span>👑</span>}
                    {entry.name}
                    {entry.player_id === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff" }}>(you)</span>}
                  </div>
                  {entry.grade_category && gradeTab === ALL && (
                    <div className="lb-pos">{SHORT[entry.grade_category] ?? entry.grade_category}</div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{entry.period_points}</div>
            </div>
          ))}
          {periodRanked.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
              No activity yet this period. Start logging! 🏀
            </div>
          )}
        </div>
      )}


      {/* ══ TEAMS ══ */}
      {timeMode === "teams" && (
        <div>
          {!teamComp || !teamComp.is_active ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>👀</div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--gold)", letterSpacing: 1, marginBottom: 12 }}>
                Keep an eye out for the next team competition!
              </div>
              <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7 }}>
                The coaching staff will announce when the next team challenge begins.
                Train hard and be ready!
              </div>
            </div>
          ) : (
            <div>
              {/* Competition info banner */}
              <div style={{ background: "rgba(26,63,168,0.1)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#93b4ff" }}>🏆 Team Competition Active</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {teamComp.start_date} – {teamComp.end_date} · Winning team earns +{teamComp.bonus_points} pts each
                  </div>
                </div>
              </div>

              {/* Team standings + rosters */}
              {(() => {
                // Calculate team points from current period scores
                const teamPoints: Record<string, number> = {};
                teams.forEach(t => { teamPoints[t.id] = 0; });
                teamProfiles.forEach((p: any) => {
                  if (!p.team_id) return;
                  const periodEntry = periodEntries.find(e => e.player_id === p.id);
                  if (periodEntry) teamPoints[p.team_id] = (teamPoints[p.team_id] ?? 0) + periodEntry.period_points;
                });
                const sortedTeams = [...teams].sort((a, b) => (teamPoints[b.id] ?? 0) - (teamPoints[a.id] ?? 0));

                const rankMedal = (r: number) => r === 0 ? "🥇" : r === 1 ? "🥈" : r === 2 ? "🥉" : `${r+1}th`;
                const use2col = sortedTeams.length === 2 || sortedTeams.length === 4;

                const renderTeamCard = (team: Team, rank: number, compact: boolean) => {
                  const members = teamProfiles.filter((p: any) => p.team_id === team.id);
                  const pts = teamPoints[team.id] ?? 0;
                  const isFirst = rank === 0;
                  return (
                    <div key={team.id} style={{
                      background: isFirst ? "rgba(240,192,64,0.05)" : "var(--surface2)",
                      border: `${isFirst ? "1.5px" : "1px"} solid ${isFirst ? "var(--gold)" : "var(--border)"}`,
                      borderRadius: 12, overflow: "hidden",
                    }}>
                      {/* Header */}
                      <div style={{ padding: compact ? "10px 12px" : "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <div style={{ width: 9, height: 9, borderRadius: "50%", background: team.color, flexShrink: 0 }} />
                            <span style={{ fontWeight: 700, fontSize: compact ? 12 : 14, color: isFirst ? "var(--gold)" : "var(--text)" }}>{team.name}</span>
                            <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 20, background: isFirst ? "rgba(240,192,64,0.15)" : "var(--surface)", color: isFirst ? "var(--gold)" : "var(--muted)" }}>{rankMedal(rank)}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: compact ? 24 : 28, color: isFirst ? "var(--gold)" : "#93b4ff", lineHeight: 1 }}>{pts}</span>
                            <span style={{ fontSize: 10, color: "var(--muted)" }}>pts</span>
                          </div>
                        </div>
                      </div>
                      {/* Members */}
                      <div style={{ padding: compact ? "8px 10px" : "10px 14px", display: "flex", flexDirection: "column", gap: 5 }}>
                        {members
                          .map((p: any) => ({ ...p, pts: periodEntries.find(e => e.player_id === p.id)?.period_points ?? 0 }))
                          .sort((a: any, b: any) => b.pts - a.pts)
                          .map((p: any) => {
                            const initials = p.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase();
                            const isMe = p.id === currentUserId;
                            const avSize = compact ? 20 : 28;
                            return (
                              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8, padding: "4px 6px", borderRadius: 7, background: isMe ? "rgba(26,63,168,0.15)" : "transparent" }}>
                                <div style={{ width: avSize, height: avSize, borderRadius: "50%", overflow: "hidden", border: `1.5px solid ${isMe ? team.color : "var(--border)"}`, background: "rgba(26,63,168,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                  {p.avatar_url
                                    ? <img src={p.avatar_url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    : <span style={{ fontSize: compact ? 7 : 9, fontWeight: 700, color: team.color }}>{initials}</span>
                                  }
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: compact ? 11 : 12, color: "var(--text)", fontWeight: isMe ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {p.name.split(" ")[0]}{isMe && <span style={{ fontSize: 10, color: "#93b4ff", marginLeft: 4 }}>(you)</span>}
                                  </div>
                                </div>
                                <div style={{ fontSize: compact ? 10 : 11, color: p.pts > 0 ? "#93b4ff" : "var(--muted)", flexShrink: 0, fontWeight: 600 }}>{p.pts}</div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                };

                return use2col ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {sortedTeams.map((team, rank) => renderTeamCard(team, rank, true))}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {sortedTeams.map((team, rank) => renderTeamCard(team, rank, false))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ══ PER-WORKOUT LEADERBOARD ══ */}
      {view !== "overall" && selectedWorkout && (
        <div>
          <div className="card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 36 }}>{selectedWorkout.emoji}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>{selectedWorkout.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {selectedWorkout.category} · {timeMode === "alltime" ? "All-time personal bests" : `This period (${periodStart.toLocaleDateString()} – ${periodEnd.toLocaleDateString()})`}
              </div>
            </div>
          </div>
          {timeMode === "alltime"
            ? renderWorkoutTable(getWorkoutBoard(view, allScores))
            : renderWorkoutTable(getPeriodWorkoutBoard(view))
          }
        </div>
      )}
    </div>
  );

  function renderWorkoutTable(board: { playerId: string; name: string; rawScore: number; displayScore: string; points: number; rank: number }[]) {
    return (
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
            borderRadius: row.playerId === currentUserId ? 8 : undefined,
          }}>
            <div className={`lb-rank ${rankClass(row.rank)}`}>{row.rank}</div>
            <div className="lb-name">
              {row.name}
              {row.playerId === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff", marginLeft: 6 }}>(you)</span>}
            </div>
            <div style={{ textAlign: "center", fontWeight: 600, color: "var(--silver-light)", fontSize: 14 }}>{row.displayScore}</div>
            <div style={{ textAlign: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>{row.points}</div>
          </div>
        ))}
        {board.length === 0 && <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No scores yet this period. Be the first! 🏀</div>}
      </div>
    );
  }
}
