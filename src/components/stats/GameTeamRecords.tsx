// src/components/stats/GameTeamRecords.tsx
// Hall of Fame → Records: player game records (from box scores) and team
// records, for one team. Only records the coach has ticked show. Coaches
// pick the team; players see their own team's.
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getRosters, type RosterWithCount } from "../../lib/practicePlanner";
import { RECORD_DEFS, formatStat, getGameRecords, getStatSettings, type GameRecord } from "../../lib/boxScores";
import { TEAM_RECORD_DEFS, getTeamRecords, recomputeTeamRecords, type TeamRecordRow } from "../../lib/teamRecords";

const title = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--title)", letterSpacing: 1, marginBottom: 14 } as const;
const card = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 } as const;

export default function GameTeamRecords({ isCoach }: { isCoach: boolean }) {
  const [rosters, setRosters] = useState<RosterWithCount[]>([]);
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [players, setPlayers] = useState<GameRecord[]>([]);
  const [team, setTeam] = useState<TeamRecordRow[]>([]);
  const [teamTicks, setTeamTicks] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isCoach) {
      getRosters().then((r) => { setRosters(r); setRosterId(r[0]?.id ?? null); });
    } else {
      supabase.auth.getUser().then(async ({ data }) => {
        const uid = data.user?.id;
        if (!uid) return;
        const { data: p } = await supabase.from("profiles").select("home_roster_id").eq("id", uid).maybeSingle();
        setRosterId((p as any)?.home_roster_id ?? null);
      });
    }
  }, [isCoach]);

  useEffect(() => {
    if (!rosterId) return;
    setLoaded(false);
    (async () => {
      if (isCoach) await recomputeTeamRecords(rosterId).catch(() => {});
      const [pr, tr, st] = await Promise.all([
        getGameRecords(rosterId).catch(() => []),
        getTeamRecords(rosterId).catch(() => []),
        getStatSettings(rosterId).catch(() => null),
      ]);
      setPlayers(pr);
      const ticks = st?.team_hof ?? [];
      setTeamTicks(ticks);
      setTeam(tr.filter((t) => ticks.includes(t.record_key)));
      setLoaded(true);
    })();
  }, [rosterId, isCoach]);

  if (!rosterId) return null;
  const playerKeys = RECORD_DEFS.filter((d) => players.some((p) => p.record_key === d.key));
  const teamDefs = TEAM_RECORD_DEFS.filter((d) => teamTicks.includes(d.key));
  if (loaded && !playerKeys.length && !teamDefs.length && !isCoach) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      {isCoach && rosters.length > 1 && (
        <select value={rosterId} onChange={(e) => setRosterId(e.target.value)} aria-label="Team"
          style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", marginBottom: 12 }}>
          {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}

      <div style={title}>🏀 Game Records</div>
      {!playerKeys.length && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
          {isCoach ? "None ticked yet. Game Stats → Players → ⚙ Player view settings chooses which game records go in the Hall of Fame." : "No game records yet."}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        {playerKeys.map((d) => {
          const holders = players.filter((p) => p.record_key === d.key);
          return (
            <div key={d.key} style={card}>
              <div style={{ fontSize: 24 }}>🏆</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--gold-text)" }}>{d.label}</div>
                {holders.map((h) => (
                  <div key={h.game_id + (h.player_id ?? "")} style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{h.name} · vs {h.opponent} · {h.game_date}</div>
                ))}
              </div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--info-text)" }}>{formatStat(d.key, holders[0].value)}</div>
            </div>
          );
        })}
      </div>

      <div style={title}>🛡️ Team Records</div>
      {!teamDefs.length && (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {isCoach ? "None ticked yet. Choose them in Game Stats → Players → ⚙ Player view settings." : "No team records yet."}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {teamDefs.map((d) => {
          const holders = team.filter((t) => t.record_key === d.key);
          return (
            <div key={d.key} style={card}>
              <div style={{ fontSize: 24 }}>{d.scope === "season" ? "📅" : "🏀"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--gold-text)" }}>{d.label}</div>
                {holders.length ? holders.map((h, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {d.scope === "season" && d.key !== "longest_win_streak" ? h.season_name ?? "" : `${h.opponent ? `vs ${h.opponent}` : ""}${h.game_date ? ` · ${h.game_date}` : ""}${h.season_name ? ` · ${h.season_name}` : ""}`}
                  </div>
                )) : <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>Not set yet</div>}
              </div>
              {holders[0] && <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, color: "var(--info-text)", textAlign: "right" }}>{holders[0].display}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
