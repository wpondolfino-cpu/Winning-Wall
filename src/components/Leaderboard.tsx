// src/components/Leaderboard.tsx
import { useState, useEffect } from "react";
import { useLeaderboard } from "../hooks/useLeaderboard";
import {
  supabase, LeaderboardEntry, GRADE_CATEGORIES, GradeCategory,
  Workout, Score, currentPeriodStart, currentPeriodEnd,
  getXpPerks,
} from "../lib/supabase";
import type { XpPerk } from "../lib/supabase";

interface Props { currentUserId?: string; canManage?: boolean; }

const ALL = "All Players";
type GradeTab = typeof ALL | GradeCategory;
type MainTab = "overall" | "current" | "history";

const SHORT: Record<string, string> = {
  "Underclassman (9th-10th Grade)": "Fresh/Soph.",
  "Upperclassman (11th-12th Grade)": "Jr/Sr",
  "Alumni": "Alumni",
  "All Players": "All",
};

interface PeriodEntry {
  player_id: string; name: string; grade_category?: string;
  period_points: number; workouts_logged: number;
  is_period_champion?: boolean; avatar_url?: string;
}

interface Snapshot {
  id: string; period_name: string; period_start: string;
  period_end: string; snapshot: any[]; created_at: string;
}

export default function Leaderboard({ currentUserId, canManage = false }: Props) {
  const { leaderboard, loading, lastUpdated } = useLeaderboard();
  const [mainTab, setMainTab]           = useState<MainTab>("overall");
  const [gradeTab, setGradeTab]         = useState<GradeTab>(ALL);
  const [drillView, setDrillView]       = useState<string>("overall");
  const [workouts, setWorkouts]         = useState<Workout[]>([]);
  const [allScores, setAllScores]       = useState<Score[]>([]);
  const [periodScores, setPeriodScores] = useState<Score[]>([]);
  const [profiles, setProfiles]         = useState<any[]>([]);
  const [periodEntries, setPeriodEntries] = useState<PeriodEntry[]>([]);
  const [periodBonuses, setPeriodBonuses] = useState<any[]>([]);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [xpData, setXpData]             = useState<Record<string, number>>({});
  const [xpPerks, setXpPerks]           = useState<XpPerk[]>([]);
  const [snapshots, setSnapshots]       = useState<Snapshot[]>([]);
  const [expandedSnap, setExpandedSnap] = useState<string | null>(null);
  const [savingSnap, setSavingSnap]     = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();

  useEffect(() => {
    loadData();
    loadXpData();
    loadSnapshots();
    const channel = supabase.channel("scores-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => { if (periodScores.length > 0 || profiles.length > 0) buildPeriodBoard(); }, [periodScores, profiles, periodBonuses, allScores]);

  async function loadXpData() {
    const [perks, { data: profs }] = await Promise.all([
      getXpPerks(),
      supabase.from("profiles").select("id,total_xp").eq("role", "player"),
    ]);
    setXpPerks(perks);
    const map: Record<string, number> = {};
    (profs ?? []).forEach((p: any) => { map[p.id] = p.total_xp ?? 0; });
    setXpData(map);
  }

  async function loadData() {
    const [{ data: ws }, { data: sc }, { data: pr }, { data: psc }, { data: bon }] = await Promise.all([
      supabase.from("workouts").select("*").eq("is_active", true).order("created_at", { ascending: false }),
      supabase.from("scores").select("*"),
      supabase.from("profiles").select("id,name,grade_category,is_period_champion,avatar_url").eq("role", "player"),
      supabase.from("score_attempts").select("*")
        .gte("attempted_at", periodStart.toISOString())
        .lte("attempted_at", periodEnd.toISOString()),
      supabase.from("streak_bonuses").select("*")
        .gte("awarded_at", periodStart.toISOString())
        .lte("awarded_at", periodEnd.toISOString()),
    ]);
    const allWorkouts = ws ?? [];
    setWorkouts(allWorkouts);
    const lbActiveIds = new Set((ws ?? []).filter((w: any) => w.leaderboard_active !== false).map((w: any) => w.id));
    setAllScores((sc ?? []).filter((s: any) => lbActiveIds.has(s.workout_id)));
    setProfiles(pr ?? []);
    setPeriodScores(psc ?? []);
    setPeriodBonuses(bon ?? []);
  }

  async function loadSnapshots() {
    const { data } = await supabase.from("period_snapshots").select("*").order("created_at", { ascending: false });
    setSnapshots(data ?? []);
  }

  async function saveSnapshot(periodName: string) {
    if (!window.confirm(`Save a snapshot of the current leaderboard as "${periodName}"?\n\nThis freezes the current standings for the History tab.`)) return;
    setSavingSnap(true);
    try {
      const snapshotData = leaderboard.map((e, i) => ({
        rank: i + 1,
        player_id: e.id,
        name: e.name,
        grade_category: e.grade_category,
        total_points: e.total_points,
        workouts_completed: e.workouts_completed,
        avatar_url: (e as any).avatar_url,
        is_period_champion: e.is_period_champion,
      }));
      await supabase.from("period_snapshots").insert({
        period_name: periodName,
        period_start: periodStart.toISOString().split("T")[0],
        period_end: new Date().toISOString().split("T")[0],
        snapshot: snapshotData,
      });
      await loadSnapshots();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSavingSnap(false); }
  }

  function buildPeriodBoard() {
    const periodActivity: Record<string, Set<string>> = {};
    for (const s of periodScores) {
      if (!periodActivity[s.player_id]) periodActivity[s.player_id] = new Set();
      periodActivity[s.player_id].add(s.workout_id);
    }
    const map: Record<string, PeriodEntry> = {};
    for (const playerId of Object.keys(periodActivity)) {
      const p = profiles.find(pr => pr.id === playerId);
      if (!p) continue;
      const workoutIds = Array.from(periodActivity[playerId]);
      const playerScores = allScores.filter(s => s.player_id === playerId && workoutIds.includes(s.workout_id));
      const drillPoints = playerScores.reduce((sum, s) => sum + (s.points ?? 0), 0);
      const bonusPoints = periodBonuses.filter(b => b.player_id === playerId).reduce((sum, b) => sum + (b.points ?? 0), 0);
      map[playerId] = {
        player_id: playerId, name: p.name, grade_category: p.grade_category,
        period_points: drillPoints + bonusPoints,
        workouts_logged: periodActivity[playerId].size,
        avatar_url: p.avatar_url, is_period_champion: p.is_period_champion,
      };
    }
    setPeriodEntries(Object.values(map).sort((a, b) => b.period_points - a.period_points));
  }

  function getAvatarOutline(playerId: string): string {
    const xp = xpData[playerId] ?? 0;
    const sorted = [...xpPerks].sort((a, b) => a.xp_required - b.xp_required);
    const outlines: Record<string, string> = {
      "team_eligible": "#9ca3af", "streak_shield": "#c0c0c0",
      "team_bonus": "#2550d4", "score_boost": "#f0c040",
    };
    let outline = "var(--border)";
    for (const p of sorted) { if (xp >= p.xp_required && outlines[p.perk_key]) outline = outlines[p.perk_key]; }
    return outline;
  }

  const rankClass = (r: number) => r === 1 ? "gold" : r === 2 ? "silver" : r === 3 ? "bronze" : "";
  const gradeTabs: GradeTab[] = [ALL, ...GRADE_CATEGORIES];

  // ── Filtered lists ──
  const filtered = gradeTab === ALL ? leaderboard : leaderboard.filter(e => e.grade_category === gradeTab);
  const ranked = filtered.map((e, i) => ({ ...e, rank: i + 1 }));
  const me = leaderboard.find(e => e.id === currentUserId);
  const myRank = ranked.find(e => e.id === currentUserId);

  const periodFiltered = gradeTab === ALL ? periodEntries : periodEntries.filter(e => e.grade_category === gradeTab);
  const periodRanked = periodFiltered.map((e, i) => ({ ...e, rank: i + 1 }));
  const myPeriod = periodRanked.find(e => e.player_id === currentUserId);

  // ── Groups for drill subtabs ──
  const groups = Array.from(new Set(workouts.map(w => w.group_name).filter(Boolean))) as string[];
  const activeGroup = selectedGroup ?? (groups[0] ?? null);
  const visibleWorkouts = activeGroup ? workouts.filter(w => w.group_name === activeGroup) : workouts.filter(w => !w.group_name);

  function getWorkoutBoard(workoutId: string) {
    const workout = workouts.find(w => w.id === workoutId);
    const wScores = allScores.filter(s => s.workout_id === workoutId);
    const gf = gradeTab === ALL ? wScores : wScores.filter(s => profiles.find(p => p.id === s.player_id)?.grade_category === gradeTab);
    return gf.map(s => {
      const p = profiles.find(pr => pr.id === s.player_id);
      const raw = s.self_points > 0 ? s.self_points : (s.made + s.reps);
      const display = s.sprint_secs > 0 && s.made === 0 && s.reps === 0 ? `${s.sprint_secs}s` : raw.toString();
      return { playerId: s.player_id, name: p?.name ?? "Unknown", rawScore: s.sprint_secs > 0 && s.made === 0 ? -s.sprint_secs : raw, display, points: s.points ?? 0 };
    }).sort((a, b) => b.rawScore - a.rawScore).map((r, i) => {
      let pts = r.points;
      if (workout?.scoring_type === "competitive") {
        if (i === 0) pts = workout.first_place_pts ?? 5;
        else if (i === 1) pts = workout.second_place_pts ?? 3;
        else if (i === 2) pts = workout.third_place_pts ?? 1;
        else pts = 0;
      }
      return { ...r, points: pts, rank: i + 1 };
    });
  }

  function getPeriodWorkoutBoard(workoutId: string) {
    const wAttempts = periodScores.filter((s: any) => s.workout_id === workoutId);
    const gf = gradeTab === ALL ? wAttempts : wAttempts.filter((s: any) => profiles.find(p => p.id === s.player_id)?.grade_category === gradeTab);
    const bestMap: Record<string, any> = {};
    for (const a of gf) { if (!(bestMap as any)[a.player_id] || (a as any).raw_score > (bestMap as any)[a.player_id].raw_score) (bestMap as any)[a.player_id] = a; }
    return Object.values(bestMap).map((s: any) => {
      const p = profiles.find(pr => pr.id === s.player_id);
      return { playerId: s.player_id, name: p?.name ?? "Unknown", rawScore: s.raw_score ?? 0, display: (s.raw_score ?? 0).toString(), points: s.raw_score ?? 0 };
    }).sort((a, b) => b.rawScore - a.rawScore).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  if (loading) return <div className="loading">Loading leaderboard…</div>;

  // ── Avatar helper ──
  function Avatar({ id, name, url, size = 32 }: { id: string; name: string; url?: string; size?: number }) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${getAvatarOutline(id)}` }}>
        {url ? <img src={url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)" }}>{name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}</span>}
      </div>
    );
  }

  return (
    <div className="panel active">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div className="section-title">Leaderboard</div>
          <div className="section-sub">{lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Syncing…"}</div>
        </div>
        <span className="live-badge"><span className="live-dot" /> LIVE</span>
      </div>

      {/* ── Main tabs: Overall | Current Period | History ── */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 12, padding: 4, marginBottom: 16, border: "1px solid var(--border)" }}>
        {([
          { key: "overall", label: "📊 Overall" },
          { key: "current", label: "📅 Current" },
          { key: "history", label: "📋 History" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)} style={{
            flex: 1, padding: "10px 4px", borderRadius: 9, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, fontWeight: 600,
            background: mainTab === t.key ? "var(--royal)" : "transparent",
            color: mainTab === t.key ? "#fff" : "var(--muted)", transition: "all .2s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Grade tabs (Overall + Current only) ── */}
      {mainTab !== "history" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, background: "var(--surface2)", padding: 6, borderRadius: 12, border: "1px solid var(--border)" }}>
          {gradeTabs.map(tab => (
            <button key={tab} onClick={() => setGradeTab(tab)} style={{
              padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
              background: gradeTab === tab ? "var(--royal)" : "transparent",
              color: gradeTab === tab ? "#fff" : "var(--muted)", transition: "all .2s",
            }}>{SHORT[tab] ?? tab}</button>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════
          OVERALL TAB — all-time cumulative points
          ══════════════════════════════════════════ */}
      {mainTab === "overall" && (
        <>
          {currentUserId && (
            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">All-Time Rank</div><div className="stat-value gold">#{myRank?.rank ?? "—"}</div></div>
              <div className="stat-card"><div className="stat-label">Total Points</div><div className="stat-value blue">{me?.total_points ?? 0}</div></div>
              <div className="stat-card"><div className="stat-label">Workouts</div><div className="stat-value">{me?.workouts_completed ?? 0}</div></div>
            </div>
          )}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="lb-header-row"><div>RNK</div><div>PLAYER</div><div style={{ textAlign: "center" }}>PTS</div></div>
            {ranked.map(entry => (
              <div key={entry.id}>
                <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 80px", padding: "12px 16px", alignItems: "center", borderBottom: expandedPlayer === entry.id ? "none" : "1px solid rgba(176,184,200,0.05)", background: entry.id === currentUserId ? "rgba(26,63,168,0.15)" : undefined, cursor: "pointer" }}
                  onClick={() => setExpandedPlayer(expandedPlayer === entry.id ? null : entry.id)}>
                  <div className={`lb-rank ${rankClass(entry.rank)}`}>{entry.rank}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar id={entry.id} name={entry.name} url={(entry as any).avatar_url} />
                    <div>
                      <div className="lb-name" style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                        {entry.is_period_champion && <span>👑</span>}
                        {entry.name}
                        {entry.id === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff" }}>(you)</span>}
                        {(entry.current_streak ?? 0) >= 2 && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "rgba(255,100,0,0.2)", color: "#ff8c42", border: "1px solid rgba(255,100,0,0.3)" }}>🔥 {entry.current_streak}d</span>}
                      </div>
                      {gradeTab === ALL && <div className="lb-pos"><span style={{ color: "var(--muted)" }}>{SHORT[entry.grade_category ?? ""] ?? entry.grade_category}</span></div>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{entry.total_points}</div>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{expandedPlayer === entry.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandedPlayer === entry.id && (
                  <div style={{ padding: "10px 16px 14px", background: "rgba(26,63,168,0.07)", borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, fontWeight: 700 }}>Score Breakdown</div>
                    {allScores.filter(s => s.player_id === entry.id && (s.points ?? 0) > 0).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).map(s => {
                      const w = workouts.find(wk => wk.id === s.workout_id);
                      const raw = s.self_points > 0 ? s.self_points : (s.made + s.reps);
                      return (
                        <div key={s.workout_id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(176,184,200,0.06)" }}>
                          <div style={{ fontSize: 12, color: "var(--silver-light)" }}>{w?.emoji ?? "🏀"} {w?.title ?? "Unknown"}</div>
                          <div style={{ display: "flex", gap: 12 }}>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Score: {raw}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>+{s.points} pts</span>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                      <span style={{ color: "var(--muted)" }}>Total</span>
                      <span style={{ color: "var(--gold)" }}>{entry.total_points} pts</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {ranked.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No players yet. 🏀</div>}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════
          CURRENT PERIOD TAB
          Overall subtab + per-drill subtabs
          ══════════════════════════════════════════ */}
      {mainTab === "current" && (
        <>
          {/* Period banner */}
          <div style={{ marginBottom: 14, padding: "10px 16px", background: "linear-gradient(135deg, rgba(26,63,168,0.2), rgba(240,192,64,0.1))", border: "1px solid rgba(240,192,64,0.25)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--gold)", letterSpacing: 1 }}>👑 Current Period</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--silver-light)" }}>{Math.ceil((periodEnd.getTime() - Date.now()) / 86400000)} days left</div>
          </div>

          {/* Subtab: Overall + drills from active group only */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            <button onClick={() => setDrillView("overall")} style={{
              padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
              border: `1px solid ${drillView === "overall" ? "var(--royal-light)" : "var(--border)"}`,
              background: drillView === "overall" ? "rgba(26,63,168,0.2)" : "var(--surface2)",
              color: drillView === "overall" ? "#93b4ff" : "var(--muted)",
            }}>🏆 Overall</button>
            {visibleWorkouts.map(w => (
              <button key={w.id} onClick={() => setDrillView(w.id)} style={{
                padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                border: `1px solid ${drillView === w.id ? "var(--royal-light)" : "var(--border)"}`,
                background: drillView === w.id ? "rgba(26,63,168,0.2)" : "var(--surface2)",
                color: drillView === w.id ? "#93b4ff" : "var(--muted)",
              }}>{w.emoji} {w.title}</button>
            ))}
          </div>

          {/* My period stats */}
          {currentUserId && drillView === "overall" && (
            <div className="stats-row">
              <div className="stat-card"><div className="stat-label">Period Rank</div><div className="stat-value gold">{myPeriod ? `#${myPeriod.rank}` : "—"}</div></div>
              <div className="stat-card"><div className="stat-label">Period Points</div><div className="stat-value blue">{myPeriod?.period_points ?? 0}</div></div>
              <div className="stat-card"><div className="stat-label">Workouts</div><div className="stat-value">{myPeriod?.workouts_logged ?? 0}</div></div>
            </div>
          )}

          {/* Period overall board */}
          {drillView === "overall" && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 80px", padding: "8px 16px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)" }}>
                <div>RNK</div><div>PLAYER</div><div style={{ textAlign: "center" }}>PTS</div>
              </div>
              {periodRanked.map((entry, i) => (
                <div key={entry.player_id}>
                  <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 80px", padding: "12px 16px", alignItems: "center", borderBottom: expandedPlayer === entry.player_id ? "none" : "1px solid rgba(176,184,200,0.05)", background: entry.player_id === currentUserId ? "rgba(26,63,168,0.15)" : undefined, cursor: "pointer" }}
                    onClick={() => setExpandedPlayer(expandedPlayer === entry.player_id ? null : entry.player_id)}>
                    <div className={`lb-rank ${rankClass(i + 1)}`}>{i + 1}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar id={entry.player_id} name={entry.name} url={entry.avatar_url} />
                      <div>
                        <div className="lb-name" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          {entry.is_period_champion && <span>👑</span>}
                          {entry.name}
                          {entry.player_id === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff" }}>(you)</span>}
                        </div>
                        {gradeTab === ALL && <div className="lb-pos"><span style={{ color: "var(--muted)" }}>{SHORT[entry.grade_category ?? ""] ?? entry.grade_category}</span></div>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{entry.period_points}</div>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>{expandedPlayer === entry.player_id ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {expandedPlayer === entry.player_id && (
                    <div style={{ padding: "10px 16px 14px", background: "rgba(26,63,168,0.07)", borderTop: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, fontWeight: 700 }}>This Period</div>
                      {allScores.filter(s => s.player_id === entry.player_id && (s.points ?? 0) > 0).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).map(s => {
                        const w = workouts.find(wk => wk.id === s.workout_id);
                        const raw = s.self_points > 0 ? s.self_points : (s.made + s.reps);
                        return (
                          <div key={s.workout_id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(176,184,200,0.06)" }}>
                            <div style={{ fontSize: 12, color: "var(--silver-light)" }}>{w?.emoji ?? "🏀"} {w?.title ?? "Unknown"}</div>
                            <div style={{ display: "flex", gap: 12 }}>
                              <span style={{ fontSize: 11, color: "var(--muted)" }}>Score: {raw}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>+{s.points} pts</span>
                            </div>
                          </div>
                        );
                      })}
                      {periodBonuses.filter(b => b.player_id === entry.player_id).map((b, bi) => {
                        const label = b.reason === "daily_completion" ? "✅ Daily Bonus" : b.reason === "challenge_win" ? "⚔️ Challenge Win" : b.reason === "streak" ? "🔥 Streak" : b.reason === "personal_best" ? "🎯 Personal Best" : "⭐ Bonus";
                        return <div key={bi} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(176,184,200,0.06)" }}><div style={{ fontSize: 12, color: "#ff8c42" }}>{label}</div><span style={{ fontSize: 13, fontWeight: 700, color: "#ff8c42" }}>+{b.points}</span></div>;
                      })}
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
                        <span style={{ color: "var(--muted)" }}>Total This Period</span>
                        <span style={{ color: "var(--gold)" }}>{entry.period_points} pts</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {periodRanked.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No activity yet this period. Start logging! 🏀</div>}
            </div>
          )}

          {/* Per-drill board */}
          {drillView !== "overall" && (() => {
            const w = workouts.find(wk => wk.id === drillView);
            if (!w) return null;
            const board = getPeriodWorkoutBoard(drillView);
            return (
              <div>
                <div className="card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontSize: 36 }}>{w.emoji}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>{w.title}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>This period · {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}</div>
                  </div>
                </div>
                {renderWorkoutTable(board)}
              </div>
            );
          })()}
        </>
      )}

      {/* ══════════════════════════════════════════
          HISTORY TAB — frozen snapshots
          ══════════════════════════════════════════ */}
      {mainTab === "history" && (
        <div>
          {canManage && (
            <div style={{ marginBottom: 16, padding: "12px 16px", background: "rgba(26,63,168,0.08)", border: "1px solid rgba(26,63,168,0.25)", borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>📸 Save current leaderboard as a snapshot</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Do this when closing out a period. The snapshot freezes the standings so you can audit them later.</div>
              <div style={{ display: "flex", gap: 8 }}>
                {groups.map(g => (
                  <button key={g} onClick={() => saveSnapshot(g)} disabled={savingSnap}
                    style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                    {savingSnap ? "Saving…" : `📸 Save "${g}"`}
                  </button>
                ))}
                {groups.length === 0 && (
                  <button onClick={() => saveSnapshot("Period " + (snapshots.length + 1))} disabled={savingSnap}
                    style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                    {savingSnap ? "Saving…" : "📸 Save Snapshot"}
                  </button>
                )}
              </div>
            </div>
          )}

          {snapshots.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No snapshots yet</div>
              <div style={{ fontSize: 13 }}>{canManage ? "Save a snapshot when you close out a period to preserve the standings." : "Your coach will save period snapshots here."}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {snapshots.map(snap => {
                const isOpen = expandedSnap === snap.id;
                const champions = snap.snapshot.filter((e: any) => e.is_period_champion);
                return (
                  <div key={snap.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                    {/* Snapshot header */}
                    <div onClick={() => setExpandedSnap(isOpen ? null : snap.id)} style={{ padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 3 }}>{snap.period_name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>
                          {new Date(snap.period_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(snap.period_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          {" · "}{snap.snapshot.length} players
                        </div>
                        {/* Champions */}
                        {champions.length > 0 && (
                          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            {champions.map((c: any) => (
                              <span key={c.player_id} style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "rgba(240,192,64,0.15)", color: "var(--gold)" }}>
                                👑 {c.name} · {SHORT[c.grade_category] ?? c.grade_category}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span style={{ color: "var(--muted)", fontSize: 16, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                    {/* Full ranked list */}
                    {isOpen && (
                      <div style={{ borderTop: "1px solid var(--border)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 80px", padding: "8px 16px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)" }}>
                          <div>RNK</div><div>PLAYER</div><div style={{ textAlign: "center" }}>PTS</div>
                        </div>
                        {snap.snapshot
                          .filter((e: any) => gradeTab === ALL || e.grade_category === gradeTab)
                          .map((e: any, i: number) => (
                          <div key={e.player_id} style={{ display: "grid", gridTemplateColumns: "44px 1fr 80px", padding: "10px 16px", alignItems: "center", borderBottom: "1px solid rgba(176,184,200,0.05)", background: e.player_id === currentUserId ? "rgba(26,63,168,0.1)" : undefined }}>
                            <div className={`lb-rank ${rankClass(i + 1)}`}>{i + 1}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(26,63,168,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                {e.avatar_url ? <img src={e.avatar_url} alt={e.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  : <span style={{ fontSize: 9, fontWeight: 700, color: "var(--gold)" }}>{e.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}</span>}
                              </div>
                              <div>
                                <div className="lb-name" style={{ fontSize: 13 }}>
                                  {e.is_period_champion && <span>👑 </span>}{e.name}
                                  {e.player_id === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff" }}> (you)</span>}
                                </div>
                                {gradeTab === ALL && <div style={{ fontSize: 11, color: "var(--muted)" }}>{SHORT[e.grade_category] ?? e.grade_category}</div>}
                              </div>
                            </div>
                            <div style={{ textAlign: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>{e.total_points}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  function renderWorkoutTable(board: any[]) {
    return (
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 100px 80px", padding: "8px 16px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", borderBottom: "1px solid var(--border)" }}>
          <div>RNK</div><div>PLAYER</div><div style={{ textAlign: "center" }}>SCORE</div><div style={{ textAlign: "center" }}>PTS</div>
        </div>
        {board.map(row => (
          <div key={row.playerId} style={{ display: "grid", gridTemplateColumns: "44px 1fr 100px 80px", padding: "11px 16px", alignItems: "center", borderBottom: "1px solid rgba(176,184,200,0.05)", background: row.playerId === currentUserId ? "rgba(26,63,168,0.15)" : undefined }}>
            <div className={`lb-rank ${rankClass(row.rank)}`}>{row.rank}</div>
            <div className="lb-name">{row.name}{row.playerId === currentUserId && <span style={{ fontSize: 11, color: "#93b4ff", marginLeft: 6 }}>(you)</span>}</div>
            <div style={{ textAlign: "center", fontWeight: 600, color: "var(--silver-light)", fontSize: 14 }}>{row.display}</div>
            <div style={{ textAlign: "center", fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>{row.points}</div>
          </div>
        ))}
        {board.length === 0 && <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No scores yet. Be the first! 🏀</div>}
      </div>
    );
  }
}
