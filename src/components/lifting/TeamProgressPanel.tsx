// src/components/lifting/TeamProgressPanel.tsx
// Coach/admin view of who's actually doing the lifting program — this
// tab was previously hidden entirely for canManage, leaving coaches with
// zero visibility into player lifting activity.

import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { LiftingProgram, LiftingDay, DayExercise, BankExercise, getAssignedPlayers, getAllLogsForProgram } from "./lifting";

interface Props {
  programs: LiftingProgram[];
  days: Record<string, LiftingDay[]>;
  dayExercises: Record<string, (DayExercise & { exercise: BankExercise })[]>;
}

interface Entry {
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  sessionsLogged: number;
  lastLoggedAt: string | null;
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000));
}

export default function TeamProgressPanel({ programs, days, dayExercises }: Props) {
  const assignablePrograms = programs.filter(p => p.visibility !== "personal");
  const [selectedProgramId, setSelectedProgramId] = useState<string>(assignablePrograms[0]?.id ?? "");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedProgramId) load(selectedProgramId);
  }, [selectedProgramId]);

  async function load(programId: string) {
    setLoading(true);
    try {
      const program = assignablePrograms.find(p => p.id === programId);
      const programDayIds = (days[programId] ?? []).map(d => d.id);
      const bankIds = [...new Set(
        programDayIds.flatMap(dId => (dayExercises[dId] ?? []).map(de => de.exercise?.id).filter(Boolean))
      )] as string[];

      // "Everyone" (public) programs have no explicit assignment rows —
      // every player has access implicitly. Anything else uses the real
      // assignment list.
      let relevantIds: string[];
      if (program?.visibility === "public") {
        const { data: allPlayers } = await supabase.from("profiles").select("id").eq("role", "player");
        relevantIds = (allPlayers ?? []).map((p: any) => p.id);
      } else {
        relevantIds = await getAssignedPlayers(programId);
      }
      if (relevantIds.length === 0) { setEntries([]); return; }

      const { data: profiles } = await supabase.from("profiles").select("id,name,avatar_url").in("id", relevantIds);
      const map: Record<string, Entry> = {};
      (profiles ?? []).forEach((p: any) => {
        map[p.id] = { playerId: p.id, playerName: p.name, avatarUrl: p.avatar_url ?? null, sessionsLogged: 0, lastLoggedAt: null };
      });

      if (bankIds.length > 0) {
        const logs = await getAllLogsForProgram(programDayIds, bankIds);
        const sessionDates: Record<string, Set<string>> = {};
        logs.forEach((log: any) => {
          const pid = log.player_id;
          if (!map[pid]) return; // only count players actually assigned to this program
          if (!sessionDates[pid]) sessionDates[pid] = new Set();
          sessionDates[pid].add(new Date(log.logged_at).toDateString());
          if (!map[pid].lastLoggedAt || log.logged_at > map[pid].lastLoggedAt!) map[pid].lastLoggedAt = log.logged_at;
        });
        Object.entries(sessionDates).forEach(([pid, dates]) => { map[pid].sessionsLogged = dates.size; });
      }

      const sorted = Object.values(map).sort((a, b) => {
        if (!a.lastLoggedAt && !b.lastLoggedAt) return a.playerName.localeCompare(b.playerName);
        if (!a.lastLoggedAt) return -1;
        if (!b.lastLoggedAt) return 1;
        return new Date(a.lastLoggedAt).getTime() - new Date(b.lastLoggedAt).getTime();
      });
      setEntries(sorted);
    } finally { setLoading(false); }
  }

  if (assignablePrograms.length === 0) {
    return <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0" }}>No active lifting programs yet.</div>;
  }

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 4 }}>📈 Team Progress</div>
      <div className="section-sub" style={{ marginBottom: 16 }}>Who's actually doing the lifting program — sorted by most overdue first</div>

      {assignablePrograms.length > 1 && (
        <select value={selectedProgramId} onChange={e => setSelectedProgramId(e.target.value)}
          style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", marginBottom: 16 }}>
          {assignablePrograms.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "30px 0" }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "30px 0" }}>No players assigned to this program yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map(e => {
            const since = daysSince(e.lastLoggedAt);
            const statusColor = since === null ? "#ff3c3c" : since <= 2 ? "#5de098" : since <= 5 ? "var(--gold)" : "#ff7b7b";
            const statusLabel = since === null ? "Never logged" : since === 0 ? "Today" : since === 1 ? "Yesterday" : `${since} days ago`;
            return (
              <div key={e.playerId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10 }}>
                {e.avatarUrl
                  ? <img src={e.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
                  : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--muted)" }}>{e.playerName[0]}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{e.playerName}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.sessionsLogged} session{e.sessionsLogged !== 1 ? "s" : ""} logged</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, whiteSpace: "nowrap" }}>{statusLabel}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
