// src/components/coach/ChampionsPanel.tsx
import { useState } from "react";
import { supabase, BiweeklyChampion, getBiweeklyChampions, crownBiweeklyWinners, currentPeriodStart, currentPeriodEnd } from "../../lib/supabase";
import { useLeaderboard } from "../../hooks/useLeaderboard";

export default function ChampionsPanel() {
  const [champions, setChampions]     = useState<BiweeklyChampion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [crowning, setCrowning]       = useState(false);
  const [undoing, setUndoing]         = useState(false);
  const { leaderboard } = useLeaderboard();

  const periodStart = currentPeriodStart();
  const periodEnd   = currentPeriodEnd();

  async function loadChampions() {
    const data = await getBiweeklyChampions();
    setChampions(data); setShowHistory(true);
  }

  async function handleCrown() {
    setCrowning(true);
    try {
      await crownBiweeklyWinners(leaderboard);
      await loadChampions();
      alert("👑 Biweekly champions have been crowned!");
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
      await loadChampions();
      alert("↩️ Crown has been undone successfully.");
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setUndoing(false); }
  }

  return (
    <>
      <div style={{ background: "linear-gradient(135deg, rgba(26,63,168,0.3), rgba(240,192,64,0.1))", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>👑 Biweekly Champions</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Current period: {periodStart.toLocaleDateString()} – {periodEnd.toLocaleDateString()}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button onClick={loadChampions} style={{ flex: 1, minWidth: 100, background: "var(--surface2)", color: "var(--silver-light)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>View History</button>
          <button onClick={handleCrown} disabled={crowning} style={{ flex: 1, minWidth: 100, background: "var(--gold)", color: "#0a0c14", border: "none", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>{crowning ? "Crowning…" : "Crown Winners"}</button>
          <button onClick={handleUndo} disabled={undoing || crowning} style={{ flex: 1, minWidth: 100, background: "rgba(255,107,107,0.15)", color: "#ff7b7b", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>{undoing ? "Undoing…" : "↩️ Undo Crown"}</button>
        </div>
      </div>

      {showHistory && (
        <div className="modal-overlay open" onClick={() => setShowHistory(false)}>
          <div className="log-modal" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowHistory(false)}>✕</button>
            <div className="modal-title">👑 Champion History</div>
            {champions.length === 0
              ? <div style={{ color: "var(--muted)", fontSize: 14, padding: "20px 0" }}>No champions crowned yet.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
                  {champions.map(c => (
                    <div key={c.id} style={{ background: "var(--surface2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>👑 {c.player_name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{c.grade_category} · {new Date(c.period_start).toLocaleDateString()} – {new Date(c.period_end).toLocaleDateString()}</div>
                      </div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)" }}>{c.points} pts</div>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      )}
    </>
  );
}
