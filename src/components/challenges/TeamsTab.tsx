// src/components/TeamsTab.tsx
import { useState, useEffect } from "react";
import { supabase, getActiveTeamCompetition, getTeams, TeamCompetition, Team } from "../../lib/supabase";

interface Props { currentUserId: string; }

export default function TeamsTab({ currentUserId }: Props) {
  const [teamComp, setTeamComp]         = useState<TeamCompetition | null>(null);
  const [teams, setTeams]               = useState<Team[]>([]);
  const [teamProfiles, setTeamProfiles] = useState<any[]>([]);
  const [myTeam, setMyTeam]             = useState<Team | null>(null);
  const [newTeamNotif, setNewTeamNotif] = useState(false);

  useEffect(() => {
    loadTeamData();
    const channel = supabase.channel("team-scores-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, () => loadTeamData())
      .on("postgres_changes", { event: "*", schema: "public", table: "streak_bonuses" }, () => loadTeamData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUserId]);

  async function loadTeamData() {
    const comp = await getActiveTeamCompetition();
    setTeamComp(comp);
    if (!comp) return;
    const t = await getTeams(comp.id);
    setTeams(t);
    const { data: profs } = await supabase.from("profiles")
      .select("id,name,avatar_url,grade_category,team_id").eq("role","player").not("team_id","is",null);
    setTeamProfiles(profs ?? []);
    const me = (profs ?? []).find((p: any) => p.id === currentUserId);
    if (me?.team_id) {
      const mine = t.find((tm: any) => tm.id === me.team_id) ?? null;
      setMyTeam(mine);
      const createdAt = (comp as any).created_at;
      if (createdAt) {
        const age = Date.now() - new Date(createdAt).getTime();
        const dismissed = localStorage.getItem("dismissed_team_notif");
        if (age < 86400000 && dismissed !== (comp as any).id) setNewTeamNotif(true);
      }
    }
  }

  if (!teamComp || !teamComp.is_active) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>👀</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", letterSpacing: 1, marginBottom: 10 }}>Keep an eye out for the next team competition!</div>
        <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7 }}>The coaching staff will announce when the next team challenge begins.</div>
      </div>
    );
  }

  const teamPoints: Record<string, number> = {};
  teams.forEach(t => { teamPoints[t.id] = (t as any).score ?? 0; });
  const sortedTeams = [...teams].sort((a, b) => (teamPoints[b.id] ?? 0) - (teamPoints[a.id] ?? 0));
  const use2col = sortedTeams.length === 2 || sortedTeams.length === 4;
  const medals = ["🥇","🥈","🥉","4th"];

  return (
    <div>
      {newTeamNotif && myTeam && (
        <div style={{ background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--gold)", fontWeight: 600 }}>🏆 Teams are live! You're on <span style={{ fontWeight: 700 }}>{myTeam.name}</span></div>
          <button onClick={() => { setNewTeamNotif(false); localStorage.setItem("dismissed_team_notif", (myTeam as any).competition_id ?? "dismissed"); }} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
        </div>
      )}
      {myTeam && (
        <div style={{ background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Your team</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: myTeam.color }} />
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--gold)" }}>{myTeam.name}</div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{teamComp.start_date} – {teamComp.end_date} · Winning team earns +{teamComp.bonus_points} pts each</div>
        </div>
      )}
      {use2col ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{sortedTeams.map((t, r) => renderCard(t, r))}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{sortedTeams.map((t, r) => renderCard(t, r))}</div>
      )}
    </div>
  );

  function renderCard(team: Team, rank: number) {
    const members = teamProfiles.filter((p: any) => p.team_id === team.id);
    const pts = teamPoints[team.id] ?? 0;
    const isFirst = rank === 0;
    const isMyTeam = myTeam?.id === team.id;
    return (
      <div key={team.id} style={{ background: isFirst ? "rgba(240,192,64,0.05)" : "var(--surface2)", border: `${isFirst || isMyTeam ? "1.5px" : "1px"} solid ${isFirst ? "var(--gold)" : isMyTeam ? team.color : "var(--border)"}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: team.color }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: isFirst ? "var(--gold)" : "var(--text)" }}>{team.name}</span>
              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 20, background: "var(--surface)", color: "var(--muted)" }}>{medals[rank] ?? `${rank+1}th`}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: isFirst ? "var(--gold)" : "#93b4ff", lineHeight: 1 }}>{pts}</span>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>pts</span>
            </div>
          </div>
        </div>
        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
          {[...members].sort((a: any, b: any) => ((team as any).playerPoints?.[b.id] ?? 0) - ((team as any).playerPoints?.[a.id] ?? 0)).map((p: any) => {
            const initials = p.name.split(" ").map((n: string) => n[0]).join("").slice(0,2).toUpperCase();
            const isMe = p.id === currentUserId;
            const playerPts = (team as any).playerPoints?.[p.id] ?? 0;
            const maxPts = Math.max(...members.map((m: any) => (team as any).playerPoints?.[m.id] ?? 0), 1);
            const pct = Math.round((playerPts / maxPts) * 100);
            return (
              <div key={p.id} style={{ padding: "5px 6px", borderRadius: 6, background: isMe ? "rgba(26,63,168,0.12)" : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", overflow: "hidden", border: `1.5px solid ${isMe ? team.color : "var(--border)"}`, background: "rgba(26,63,168,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {p.avatar_url ? <img src={p.avatar_url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 6, fontWeight: 700, color: team.color }}>{initials}</span>}
                  </div>
                  <span style={{ flex: 1, fontSize: 11, color: "var(--text)", fontWeight: isMe ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name.split(" ")[0]}{isMe && <span style={{ color: "#93b4ff", marginLeft: 3 }}>(you)</span>}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: playerPts > 0 ? "#93b4ff" : "var(--muted)", flexShrink: 0 }}>{playerPts} pts</span>
                </div>
                <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: playerPts > 0 ? team.color : "var(--border)", borderRadius: 2, transition: "width 0.3s" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}
