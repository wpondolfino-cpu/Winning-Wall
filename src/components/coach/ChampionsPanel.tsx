// src/components/coach/ChampionsPanel.tsx
import { useState } from "react";
import { supabase, crownBiweeklyWinners, currentPeriodStart, currentPeriodEnd } from "../../lib/supabase";
import { getCurrentPeriodStandings } from "../../lib/leaderboard";

export default function ChampionsPanel() {
  const [crowning, setCrowning] = useState(false);
  const [undoing, setUndoing]   = useState(false);

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();

  async function handleCrown() {
    const periodName = window.prompt(
      "Name this period for the History tab:",
      `Week ${new Date(periodStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(periodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    );
    if (periodName === null) return; // cancelled
    setCrowning(true);
    try {
      // Crown based on the CURRENT PERIOD's standings — not all-time totals,
      // since that's what the biweekly reset is actually meant to reward.
      const periodStandings = await getCurrentPeriodStandings();
      await crownBiweeklyWinners(periodStandings);

      // Auto-save snapshot to History tab
      try {
        const snapshotData = periodStandings.map((e, i) => ({
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
          period_name: periodName || `Period ${new Date().toLocaleDateString()}`,
          period_start: periodStart.toISOString().split("T")[0],
          period_end: new Date().toISOString().split("T")[0],
          snapshot: snapshotData,
        });
      } catch (snapErr) {
        console.error("Snapshot save failed (non-critical):", snapErr);
      }

      try {
        await supabase.functions.invoke("send-push", {
          body: {
            title: "👑 Biweekly champions crowned!",
            message: "The leaderboard has reset — check who took the crown this period!",
            allPlayers: true,
          },
        });
      } catch (e) { console.error("Push notification failed to send:", e); }
      alert("👑 Biweekly champions have been crowned and leaderboard snapshot saved to History!");
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setCrowning(false); }
  }

  async function handleUndo() {
    if (!window.confirm("Undo the most recent crowning?\n\nThis will:\n• Remove the most recent Hall of Fame entries\n• Clear champion status from those players\n• Remove their crown emojis from My Progress")) return;
    setUndoing(true);
    try {
      const { data: recent } = await supabase.from("biweekly_champions")
        .select("crowned_at, player_id").order("crowned_at", { ascending: false }).limit(10);
      if (!recent || recent.length === 0) { alert("No crownings to undo."); return; }
      const latestTime = new Date(recent[0].crowned_at).getTime();
      const sameCrowning = recent.filter((r: any) => Math.abs(new Date(r.crowned_at).getTime() - latestTime) < 60000);
      const playerIds = sameCrowning.map((r: any) => r.player_id);
      await supabase.from("biweekly_champions").delete().in("player_id", playerIds).gte("crowned_at", new Date(latestTime - 60000).toISOString());
      await supabase.from("profiles").update({ is_period_champion: false, champion_since: null }).in("id", playerIds);
      alert("↩️ Crown has been undone successfully.");
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setUndoing(false); }
  }

  return (
    <div style={{ background: "linear-gradient(135deg, rgba(26,63,168,0.3), rgba(240,192,64,0.1))", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>👑 Biweekly Champions</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Current period: {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button onClick={handleCrown} disabled={crowning} style={{ flex: 1, minWidth: 100, background: "var(--gold)", color: "#0a0c14", border: "none", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>{crowning ? "Crowning…" : "Crown Winners"}</button>
        <button onClick={handleUndo} disabled={undoing || crowning} style={{ flex: 1, minWidth: 100, background: "rgba(255,107,107,0.15)", color: "#ff7b7b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>{undoing ? "Undoing…" : "↩️ Undo Crown"}</button>
      </div>
    </div>
  );
}
