// src/components/coach/ChampionsPanel.tsx
//
// The crown queue. Every competition that has ended and hasn't been
// crowned or skipped waits here -- the same list the daily crown
// reminder counts. Crowning works on that competition's own dates, so a
// one-day and a one-month competition crown correctly.
//
// Shown on the Leaderboard tab and in Settings → Competitions.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getCompetitionStandings, crownCompetition } from "../../lib/leaderboard";
import { Competition, useCompetition, loadCurrentCompetition, competitionRange, competitionLabel, daysLeft } from "../../lib/periods";

export default function ChampionsPanel() {
  const { current } = useCompetition();
  const [waiting, setWaiting] = useState<Competition[]>([]);
  const [lastCrowned, setLastCrowned] = useState<Competition | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const now = new Date().toISOString();
    const [{ data: w }, { data: lc }] = await Promise.all([
      supabase.from("competitions").select("*")
        .lte("ends_at", now).is("crowned_at", null).is("skipped_at", null)
        .order("ends_at", { ascending: true }),
      supabase.from("competitions").select("*")
        .not("crowned_at", "is", null)
        .order("crowned_at", { ascending: false }).limit(1),
    ]);
    setWaiting((w as Competition[]) ?? []);
    setLastCrowned(((lc as Competition[]) ?? [])[0] ?? null);
  }
  useEffect(() => { load(); }, []);

  async function refreshAll() {
    await Promise.all([load(), loadCurrentCompetition(true)]);
  }

  async function handleCrown(c: Competition) {
    if (!window.confirm(`Crown the champions of ${c.name}?\n\nThe top scorer in each leaderboard group gets the 👑, and the standings are saved to History.`)) return;
    setBusy(c.id);
    try {
      const standings = await getCompetitionStandings(c);
      const winnerIds = await crownCompetition(c, standings);

      // Snapshot to History, marked with the freshly picked winners.
      try {
        await supabase.from("period_snapshots").insert({
          period_name: c.name,
          period_start: c.starts_at.slice(0, 10),
          period_end: c.ends_at.slice(0, 10),
          competition_id: c.id,
          snapshot: standings.map((e, i) => ({
            rank: i + 1,
            player_id: e.id,
            name: e.name,
            grade_category: e.grade_category,
            total_points: e.total_points,
            workouts_completed: e.workouts_completed,
            avatar_url: (e as any).avatar_url,
            is_period_champion: winnerIds.has(e.id),
          })),
        });
      } catch (snapErr) {
        console.error("Snapshot save failed (non-critical):", snapErr);
      }

      try {
        await supabase.functions.invoke("send-push", {
          body: {
            title: "👑 Champions crowned!",
            message: `${c.name} is in the books — see who took the crown!`,
            allPlayers: true,
          },
        });
      } catch (e) { console.error("Push notification failed to send:", e); }

      alert(winnerIds.size
        ? `👑 ${c.name} crowned, and the standings are saved to History.`
        : `${c.name} is marked crowned. Nobody scored, so there were no champions to crown.`);
      await refreshAll();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setBusy(null); }
  }

  async function handleSkip(c: Competition) {
    if (!window.confirm(`Skip crowning ${c.name}?\n\nNobody is crowned, current champions keep their crowns, and the reminder stops. Its scores still count toward all-time.`)) return;
    setBusy(c.id);
    const { error } = await supabase.from("competitions").update({ skipped_at: new Date().toISOString() }).eq("id", c.id);
    setBusy(null);
    if (error) { alert("Couldn't skip: " + error.message); return; }
    await refreshAll();
  }

  async function handleUndo(c: Competition) {
    if (!window.confirm(`Undo the crowning of ${c.name}?\n\nThis will:\n• Remove its Hall of Fame entries\n• Take the crown off its champions\n• Remove its History snapshot\n• Put it back in the queue to crown or skip`)) return;
    setBusy(c.id);
    try {
      const { data: rows } = await supabase.from("biweekly_champions").select("player_id").eq("competition_id", c.id);
      const playerIds = (rows ?? []).map((r: any) => r.player_id);
      await supabase.from("biweekly_champions").delete().eq("competition_id", c.id);
      if (playerIds.length) {
        await supabase.from("profiles").update({ is_period_champion: false, champion_since: null }).in("id", playerIds);
      }
      await supabase.from("period_snapshots").delete().eq("competition_id", c.id);
      // The delete trigger clears crowned_at when rows existed; this covers
      // a crowning where nobody scored and no rows were written.
      await supabase.from("competitions").update({ crowned_at: null }).eq("id", c.id);
      alert(`↩️ ${c.name} is back in the queue.`);
      await refreshAll();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setBusy(null); }
  }

  const btn = (bg: string, color: string, border = "none"): React.CSSProperties => ({
    background: bg, color, border, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
  });

  return (
    <div style={{ background: "linear-gradient(135deg, rgba(26,63,168,0.3), rgba(240,192,64,0.1))", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>👑 Champions</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
        {current
          ? <>Running: {competitionLabel(current)} · {daysLeft(current) === 1 ? "last day" : `${daysLeft(current)} days left`}</>
          : "No competition running. Schedule one in Settings → Competitions."}
      </div>

      {waiting.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--silver-light)", marginTop: 10 }}>Nothing waiting to be crowned.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#ff8c42", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Ended, waiting to be crowned</div>
          {waiting.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "rgba(255,140,66,0.08)", border: "1px solid rgba(255,140,66,0.3)", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.name}</div>
                {c.name !== competitionRange(c) && <div style={{ fontSize: 11, color: "var(--muted)" }}>{competitionRange(c)}</div>}
              </div>
              <button onClick={() => handleSkip(c)} disabled={busy != null} style={btn("var(--surface2)", "var(--muted)", "1px solid var(--border)")}>Skip</button>
              <button onClick={() => handleCrown(c)} disabled={busy != null} style={btn("var(--gold)", "#0a0c14")}>
                {busy === c.id ? "Crowning…" : "Crown winners"}
              </button>
            </div>
          ))}
        </div>
      )}

      {lastCrowned && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(240,192,64,0.2)" }}>
          <div style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>Last crowned: {lastCrowned.name}</div>
          <button onClick={() => handleUndo(lastCrowned)} disabled={busy != null}
            style={btn("rgba(255,107,107,0.15)", "#ff7b7b", "1px solid rgba(255,107,107,0.3)")}>
            {busy === lastCrowned.id ? "Undoing…" : "↩️ Undo"}
          </button>
        </div>
      )}
    </div>
  );
}
