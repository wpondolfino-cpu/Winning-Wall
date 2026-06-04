// src/components/AdminSettings.tsx
import { useState, useEffect } from "react";
import { supabase, setPeriodAnchor, getPeriodAnchor, currentPeriodStart, currentPeriodEnd } from "../lib/supabase";

// ── Badge stored in Supabase ──────────────────────────────────
interface Badge {
  id: string;
  icon: string;
  name: string;
  description: string;
  trigger_type: "workouts" | "points" | "streak" | "champion" | "top_score" | "challenges_won" | "team_wins";
  trigger_value: number;
  is_active: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  workouts:        "Workouts logged",
  points:          "Total points earned",
  streak:          "Day logging streak",
  champion:        "Won a biweekly period",
  top_score:       "Scored #1 on any drill",
  challenges_won:  "Challenges won",
  team_wins:       "Team competition wins",
};

const DEFAULT_BADGES: Omit<Badge, "id">[] = [
  { icon: "🏀", name: "First Rep",       description: "Logged your first workout",        trigger_type: "workouts",  trigger_value: 1,   is_active: true },
  { icon: "💪", name: "Getting Reps",    description: "Logged 5 workouts",                trigger_type: "workouts",  trigger_value: 5,   is_active: true },
  { icon: "🔟", name: "Grinder",         description: "Logged 10 workouts",               trigger_type: "workouts",  trigger_value: 10,  is_active: true },
  { icon: "⚡", name: "Workhorse",       description: "Logged 25 workouts",               trigger_type: "workouts",  trigger_value: 25,  is_active: true },
  { icon: "🔥", name: "On Fire",         description: "3-day logging streak",             trigger_type: "streak",    trigger_value: 3,   is_active: true },
  { icon: "🌟", name: "Week Warrior",    description: "7-day logging streak",             trigger_type: "streak",    trigger_value: 7,   is_active: true },
  { icon: "💯", name: "Two Week Grind",  description: "14-day logging streak",            trigger_type: "streak",    trigger_value: 14,  is_active: true },
  { icon: "🥉", name: "On the Board",    description: "Earned 10 total points",           trigger_type: "points",    trigger_value: 10,  is_active: true },
  { icon: "🥈", name: "Rising Star",     description: "Earned 25 total points",           trigger_type: "points",    trigger_value: 25,  is_active: true },
  { icon: "🥇", name: "Elite",           description: "Earned 50 total points",           trigger_type: "points",    trigger_value: 50,  is_active: true },
  { icon: "💎", name: "Century Club",    description: "Earned 100 total points",          trigger_type: "points",    trigger_value: 100, is_active: true },
  { icon: "👑", name: "Champion",        description: "Won a biweekly period",            trigger_type: "champion",  trigger_value: 1,   is_active: true },
  { icon: "🎯", name: "Sharpshooter",    description: "Scored #1 on any drill",           trigger_type: "top_score", trigger_value: 1,   is_active: true },
];

export default function AdminSettings() {
  const [exporting, setExporting]   = useState(false);
  const [resetting, setResetting]   = useState(false);
  const [resetStep, setResetStep]   = useState(0);
  const [seasonLabel, setSeasonLabel] = useState(() => {
    const y = new Date().getFullYear(); return `${y-1}-${String(y).slice(2)} Season`;
  });
  const [anchorDate, setAnchorDate] = useState(() => {
    const d = getPeriodAnchor(); return d.toISOString().split("T")[0];
  });
  const [anchorSaved, setAnchorSaved] = useState(false);
  const [toast, setToast]             = useState("");

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();
  const daysLeft    = Math.ceil((periodEnd.getTime() - Date.now()) / 86400000);




  function saveAnchor() {
    setPeriodAnchor(new Date(anchorDate));
    setAnchorSaved(true);
    setTimeout(() => { setAnchorSaved(false); window.location.reload(); }, 1000);
  }

  async function exportLeaderboard() {
    setExporting(true);
    try {
      const { data: profiles } = await supabase.from("profiles").select("id,name,grade_category").eq("role", "player");
      const { data: scores }   = await supabase.from("scores").select("*");
      const { data: workouts } = await supabase.from("workouts").select("id,title");
      if (!profiles || !scores || !workouts) return;

      const headers = ["Player", "Grade", "Total Points", ...workouts.map(w => w.title)];
      const rows = profiles.map(p => {
        const total = scores.filter(s => s.player_id === p.id).reduce((sum, s) => sum + (s.points ?? 0), 0);
        const wPts = workouts.map(w => {
          const s = scores.find(sc => sc.player_id === p.id && sc.workout_id === w.id);
          return s ? `${s.made + s.reps} (${s.points}pts)` : "—";
        });
        return [p.name, p.grade_category ?? "—", total, ...wPts];
      });

      const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `winning-wall-${new Date().toLocaleDateString().replace(/\//g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }


  async function handleSeasonReset() {
    if (resetStep === 0) { setResetStep(1); return; }
    if (resetStep === 1) { setResetStep(2); return; }
    setResetting(true);
    try {
      // ── Snapshot season stats before reset ──
      const { data: profiles } = await supabase.from("profiles").select("id,grade_category").eq("role","player");
      const { data: allScores } = await supabase.from("scores").select("player_id,points");
      const { data: chalWins } = await supabase.from("challenges").select("winner_id").eq("status","completed").not("winner_id","is",null);
      const { data: drillBests } = await supabase.from("scores").select("player_id,workout_id,points");

      if (profiles && allScores) {
        // Calculate totals per player
        const ptMap: Record<string,number> = {};
        allScores.forEach((s:any) => { ptMap[s.player_id] = (ptMap[s.player_id]||0) + (s.points||0); });
        // Sort for overall rank
        const sorted = Object.entries(ptMap).sort((a,b) => b[1]-a[1]);
        // Drill wins (#1 on any drill)
        const drillWinMap: Record<string,number> = {};
        const workoutIds = [...new Set((drillBests??[]).map((s:any) => s.workout_id))];
        workoutIds.forEach(wid => {
          const top = (drillBests??[]).filter((s:any) => s.workout_id === wid).sort((a:any,b:any) => b.points-a.points)[0];
          if (top) drillWinMap[top.player_id] = (drillWinMap[top.player_id]||0) + 1;
        });
        // H2H wins
        const h2hMap: Record<string,number> = {};
        (chalWins??[]).forEach((c:any) => { h2hMap[c.winner_id] = (h2hMap[c.winner_id]||0) + 1; });
        // Build group ranks
        const gradeGroups: Record<string,string[]> = {};
        profiles.forEach((p:any) => {
          if (!gradeGroups[p.grade_category]) gradeGroups[p.grade_category] = [];
          gradeGroups[p.grade_category].push(p.id);
        });
        const gradeRankMap: Record<string,number> = {};
        Object.entries(gradeGroups).forEach(([grade, ids]) => {
          const sortedGrade = ids.sort((a,b) => (ptMap[b]||0) - (ptMap[a]||0));
          sortedGrade.forEach((id,i) => { gradeRankMap[id] = i+1; });
        });
        // Insert snapshot records
        const snapshots = profiles.map((p:any) => ({
          player_id: p.id,
          season_label: seasonLabel,
          overall_rank: sorted.findIndex(([id]) => id === p.id) + 1 || null,
          group_rank: gradeRankMap[p.id] || null,
          grade_category: p.grade_category,
          total_points: ptMap[p.id] || 0,
          drill_wins: drillWinMap[p.id] || 0,
          h2h_wins: h2hMap[p.id] || 0,
          team_wins: 0,
        }));
        await supabase.from("season_history").insert(snapshots);

        // ── Award period champion badges ──
        // Find the top overall scorer — they become the period champion
        const topPlayer = sorted[0];
        if (topPlayer) {
          const now = new Date().toISOString();
          // Record in biweekly_champions so the badge checker finds it
          await supabase.from("biweekly_champions").insert({
            player_id: topPlayer[0],
            period_start: periodStart.toISOString(),
            period_end: periodEnd.toISOString(),
            points: topPlayer[1],
          });
          // Also mark them as period champion on their profile
          await supabase.from("profiles")
            .update({ is_period_champion: true, champion_since: now })
            .eq("id", topPlayer[0]);
        }
      }

      // Records table preserved (all-time records survive resets)
      // Personal bests preserved — zero out points only so leaderboard resets
      // but players can still see and beat their best scores year to year
      await supabase.from("scores").update({ points: 0 }).neq("id", "00000000-0000-0000-0000-000000000000");
      // Delete score_attempts history (the per-attempt log) so history starts fresh
      await supabase.from("score_attempts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("streaks").delete().neq("player_id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("streak_bonuses").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("profiles").update({ is_period_champion: false, champion_since: null }).neq("id", "00000000-0000-0000-0000-000000000000");
      setResetStep(0);
      showToast("✅ Season reset complete!");
    } catch (e: any) {
      showToast("Error: " + e.message);
      setResetStep(0);
    } finally { setResetting(false); }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  const inputStyle = {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "9px 12px", color: "var(--text)",
    fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%",
  } as const;

  const COMMON_EMOJIS = ["🏅","🏀","🔥","💪","⚡","🌟","🎯","👑","💯","🥇","🥈","🥉","💎","🏆","🎽","⏱️","🦅"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Period Settings ── */}
      <div className="card">
        <div className="card-title">📅 Biweekly Period Settings</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
          Set the start date of Period 1. All future 2-week periods calculate automatically from there.
        </div>
        <div style={{ background: "rgba(26,63,168,0.15)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Current Period</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>
            {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{daysLeft} days remaining</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140, maxWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Period 1 Start Date</label>
            <input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} style={inputStyle} />
          </div>
          <button onClick={saveAnchor} style={{
            background: anchorSaved ? "#5de098" : "var(--royal)", color: anchorSaved ? "#051a0a" : "#fff",
            border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600,
            fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", width: "100%",
          }}>{anchorSaved ? "✓ Saved!" : "Save Date"}</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          💡 Set this to the first day of your offseason. The app handles everything else.
        </div>
      </div>

      {/* ── Export ── */}
      <div className="card">
        <div className="card-title">📊 Export Leaderboard</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          Download the full leaderboard as a spreadsheet (CSV). Opens in Excel or Google Sheets.
        </div>
        <button onClick={exportLeaderboard} disabled={exporting} style={{
          background: "var(--royal)", color: "#fff", border: "none", borderRadius: 10,
          padding: "10px 20px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>{exporting ? "Exporting…" : "⬇️ Download CSV"}</button>
      </div>

      {/* ── Season Reset ── */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>Season Label (for history)</label>
        <input value={seasonLabel} onChange={e => setSeasonLabel(e.target.value)}
          placeholder="e.g. 2024-25 Season"
          style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" as const }} />
      </div>
      <div style={{ marginTop: 32, background: "rgba(255,60,60,0.05)", border: "2px solid rgba(255,60,60,0.2)", borderRadius: 14, padding: "20px 24px" }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "#ff7b7b", letterSpacing: 1, marginBottom: 8 }}>
          🔄 Season / All-Time Reset
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16 }}>
          Use this at the end of an offseason to start fresh. This will:
          <ul style={{ marginTop: 8, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Reset leaderboard points to zero (personal bests are preserved)</li>
            <li>Clear score history and attempt logs</li>
            <li>Reset all streaks to zero</li>
            <li>Clear biweekly champion status</li>
            <li>Keep all player accounts, workouts, badges and Hall of Fame intact</li>
          </ul>
        </div>

        {resetStep === 0 && (
          <button onClick={handleSeasonReset} style={{ background: "rgba(255,60,60,0.15)", color: "#ff7b7b", border: "1px solid rgba(255,60,60,0.4)", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
            🔄 Start Season Reset
          </button>
        )}

        {resetStep === 1 && (
          <div style={{ padding: "14px 16px", background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, color: "#ff7b7b", marginBottom: 8 }}>⚠️ Are you sure? This will erase ALL scores.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleSeasonReset} style={{ background: "#ff3c3c", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                Yes, continue
              </button>
              <button onClick={() => setResetStep(0)} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {resetStep === 2 && (
          <div style={{ padding: "14px 16px", background: "rgba(255,60,60,0.1)", border: "1px solid rgba(255,60,60,0.3)", borderRadius: 10 }}>
            <div style={{ fontWeight: 700, color: "#ff7b7b", marginBottom: 8 }}>🚨 FINAL CONFIRMATION — This cannot be undone!</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>Type this to confirm you understand all scores will be permanently deleted.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={handleSeasonReset} disabled={resetting} style={{ background: "#ff3c3c", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                {resetting ? "Resetting…" : "🔄 RESET SEASON NOW"}
              </button>
              <button onClick={() => setResetStep(0)} style={{ background: "var(--surface2)", color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div style={{ marginTop: 12, padding: "8px 14px", background: "rgba(40,180,80,0.15)", border: "1px solid rgba(40,180,80,0.3)", borderRadius: 8, fontSize: 13, color: "#5de098", fontWeight: 600 }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
