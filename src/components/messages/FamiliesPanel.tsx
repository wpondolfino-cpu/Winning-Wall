// src/components/messages/FamiliesPanel.tsx
// Coaches: the parent portal (SQL 222). Approve parents who used a family
// link, see absences families reported, and get a player's family link.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  createFamilyInvite, decideFamilyLink, formatDay, getStaffAbsences, getStaffFamilies, markAbsencesSeen, removeFamilyLink,
  type StaffAbsence, type StaffFamily,
} from "../../lib/family";

interface Props {
  /** Called when the count of things waiting changes (for the tab badge). */
  onWaitingChange?: (n: number) => void;
}

interface Player { id: string; name: string; jersey: number | null; home_roster_id: string | null }
interface Team { id: string; name: string }

const card: CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 16 };
const title: CSSProperties = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--info-text)", letterSpacing: 1 };
const sub: CSSProperties = { fontSize: 12, color: "var(--muted)", marginTop: 2 };
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" };
const btn = (kind: "go" | "plain" | "danger"): CSSProperties => ({
  background: kind === "go" ? "var(--royal)" : "transparent", color: kind === "go" ? "#fff" : kind === "danger" ? "var(--danger-text)" : "var(--text)",
  border: kind === "go" ? "none" : "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
});
const pill = (on: boolean): CSSProperties => ({
  padding: "5px 11px", borderRadius: 999, border: `1px solid ${on ? "var(--royal)" : "var(--border)"}`, background: on ? "var(--royal)" : "transparent",
  color: on ? "#fff" : "var(--muted-2)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
});
const KIND: Record<string, string> = { practice: "Practice", game: "Game", event: "Event" };

export default function FamiliesPanel({ onWaitingChange }: Props) {
  const [families, setFamilies] = useState<StaffFamily[] | null>(null);
  const [absences, setAbsences] = useState<StaffAbsence[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [team, setTeam] = useState<string>("all");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const [f, a, { data: p }, { data: t }] = await Promise.all([
        getStaffFamilies(),
        getStaffAbsences(7),
        supabase.from("profiles").select("id, name, jersey, home_roster_id").eq("role", "player").order("name"),
        supabase.from("rosters").select("id, name, status").order("sort_order", { ascending: true }),
      ]);
      setFamilies(f);
      setAbsences(a);
      setPlayers((p ?? []) as Player[]);
      setTeams(((t ?? []) as any[]).filter(r => r.status !== "archived").map(r => ({ id: r.id, name: r.name })));
      const unseen = a.filter(x => !x.seen_at).map(x => x.id);
      setNewIds(prev => new Set([...prev, ...unseen]));
      if (unseen.length) markAbsencesSeen(unseen).catch(() => {});
      onWaitingChange?.(f.filter(x => x.status === "pending").length);
    } catch (e: any) {
      setErr(e?.message ?? "Couldn't load families.");
      setFamilies([]);
    }
  }
  useEffect(() => { load(); }, []);

  const pending = (families ?? []).filter(f => f.status === "pending");
  const activeByPlayer = useMemo(() => {
    const m = new Map<string, StaffFamily[]>();
    for (const f of families ?? []) if (f.status === "active") { if (!m.has(f.player_id)) m.set(f.player_id, []); m.get(f.player_id)!.push(f); }
    return m;
  }, [families]);
  const shown = players.filter(p => team === "all" || p.home_roster_id === team);
  const teamName = (id: string | null) => teams.find(t => t.id === id)?.name ?? null;
  const upcomingAbs = absences.filter(a => a.item_date >= new Date(Date.now() - 86400000).toISOString().slice(0, 10));

  async function decide(f: StaffFamily, approve: boolean) {
    if (!approve && !window.confirm(`Turn down ${f.parent_name ?? "this parent"} for ${f.player_name ?? "this player"}?`)) return;
    setBusy(f.link_id);
    try { await decideFamilyLink(f.link_id, approve); await load(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't do that."); }
    finally { setBusy(null); }
  }

  async function remove(f: StaffFamily) {
    if (!window.confirm(`Remove ${f.parent_name ?? "this parent"} from ${f.player_name ?? "this player"}? They'll stop seeing the schedule and announcements.`)) return;
    setBusy(f.link_id);
    try { await removeFamilyLink(f.link_id); await load(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't remove."); }
    finally { setBusy(null); }
  }

  async function copyLink(p: Player) {
    setBusy(p.id);
    try {
      const url = await createFamilyInvite(p.id);
      try { await navigator.clipboard.writeText(url); setCopied(p.id); setTimeout(() => setCopied(c => (c === p.id ? null : c)), 2500); }
      catch { window.prompt(`Family link for ${p.name}:`, url); }
    } catch (e: any) { setErr(e?.message ?? "Couldn't make the link."); }
    finally { setBusy(null); }
  }

  if (!families) return <div style={{ ...card, fontSize: 13, color: "var(--muted)" }}>Loading families…</div>;

  return (
    <>
      {err && <div role="alert" style={{ ...card, color: "var(--danger-text)", fontSize: 13 }}>{err}</div>}

      {pending.length > 0 && (
        <div style={{ ...card, borderColor: "rgba(240,192,64,0.4)" }}>
          <div style={title}>⏳ Waiting for approval</div>
          <div style={{ ...sub, marginBottom: 12 }}>These people used a family link. Approve only parents and guardians you recognize.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map(f => (
              <div key={f.link_id} style={row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{f.parent_name ?? "(no name)"}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {f.parent_email ?? ""}{f.parent_email ? " · " : ""}for <b style={{ color: "var(--text)" }}>{f.player_name}</b>{f.team_name ? ` (${f.team_name})` : ""} · {new Date(f.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                </div>
                <button style={btn("go")} disabled={busy === f.link_id} onClick={() => decide(f, true)}>Approve</button>
                <button style={btn("danger")} disabled={busy === f.link_id} onClick={() => decide(f, false)}>Decline</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={title}>🙋 Absences from families</div>
        <div style={{ ...sub, marginBottom: 12 }}>Counted as excused on Practice Day. Families can take one back up until that day.</div>
        {upcomingAbs.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)" }}>None reported.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {upcomingAbs.map(a => (
              <div key={a.id} style={{ ...row, borderColor: newIds.has(a.id) ? "var(--royal)" : "var(--border)" }}>
                <div style={{ width: 84, flexShrink: 0, fontSize: 12, color: "var(--muted)" }}>{formatDay(a.item_date)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--text)" }}>
                    {newIds.has(a.id) && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "var(--royal)", borderRadius: 5, padding: "1px 6px", marginRight: 6 }}>NEW</span>}
                    <b>{a.player_name}</b> · {a.reason}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {a.item_label && a.item_label !== KIND[a.item_kind] ? `${KIND[a.item_kind]}: ${a.item_label}` : KIND[a.item_kind]}{teamName(a.roster_id) ? ` · ${teamName(a.roster_id)}` : ""} · from {a.parent_name ?? "a parent"}
                  </div>
                  {a.note && <div style={{ fontSize: 12, color: "var(--tx-c8cfde, #c8cfde)", marginTop: 2 }}>“{a.note}”</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={title}>👨‍👩‍👧 Families</div>
        <div style={{ ...sub, marginBottom: 10 }}>
          Each player has a family link on their My Profile page. You can copy one here too. Parents see their own player's schedule and announcements you send to parents, nothing else.
        </div>
        {teams.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <button style={pill(team === "all")} onClick={() => setTeam("all")}>All teams</button>
            {teams.map(t => <button key={t.id} style={pill(team === t.id)} onClick={() => setTeam(t.id)}>{t.name}</button>)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No players.</div>}
          {shown.map(p => {
            const fam = activeByPlayer.get(p.id) ?? [];
            return (
              <div key={p.id} style={{ ...row, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                    {p.jersey != null ? <span style={{ color: "var(--muted)", fontWeight: 500 }}>#{p.jersey} </span> : null}{p.name}
                    {team === "all" && teamName(p.home_roster_id) && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}> · {teamName(p.home_roster_id)}</span>}
                  </div>
                  {fam.length === 0
                    ? <div style={{ fontSize: 12, color: "var(--muted)" }}>No parents linked</div>
                    : <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                        {fam.map(f => (
                          <span key={f.link_id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text)", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 4px 3px 10px" }}>
                            {f.parent_name ?? f.parent_email ?? "Parent"}
                            <button aria-label={`Remove ${f.parent_name ?? "parent"}`} disabled={busy === f.link_id} onClick={() => remove(f)}
                              style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: "0 4px" }}>✕</button>
                          </span>
                        ))}
                      </div>}
                </div>
                <button style={btn("plain")} disabled={busy === p.id} onClick={() => copyLink(p)}>
                  {copied === p.id ? "✓ Copied" : busy === p.id ? "…" : "🔗 Copy family link"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
