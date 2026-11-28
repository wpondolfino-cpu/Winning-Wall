// src/components/messages/FamilyAdminTabs.tsx
// Coaches, Announcements → Families (SQL 223): sign-ups, checklist,
// family messages and the per-team switches.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { formatDay, todayIso } from "../../lib/family";
import {
  archiveChecklistItem, blankSignup, draftFrom, getChecklist, getStaffThreads, getTeamSettings, listSignups, saveChecklistItem,
  saveTeamSetting, setReceived,
  type ChecklistItem, type ChecklistMark, type Signup, type SignupDraft, type StaffThread, type TeamSetting,
} from "../../lib/familyHub";
import SignupCard from "../parent/SignupCard";
import SignupEditor from "../parent/SignupEditor";
import FamilyThread from "../parent/FamilyThread";
import { fu, errText } from "../parent/familyUi";

interface Team { id: string; name: string }
interface Player { id: string; name: string; jersey: number | null; home_roster_id: string | null }

function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);
  useEffect(() => {
    supabase.from("rosters").select("id, name, status").order("sort_order", { ascending: true })
      .then(({ data }: any) => setTeams(((data ?? []) as any[]).filter(r => r.status !== "archived").map(r => ({ id: r.id, name: r.name }))));
  }, []);
  return teams;
}

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1c2742", color: "#eef2ff", border: "1px solid rgba(147,180,255,0.45)", borderRadius: 10, padding: "10px 16px", fontSize: 13, zIndex: 80, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>{msg}</div>;
}
function useToast(): [string | null, (m: string) => void] {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => { if (!t) return; const x = setTimeout(() => setT(null), 3500); return () => clearTimeout(x); }, [t]);
  return [t, setT];
}

// ── Sign-ups ──────────────────────────────────────────────────
export function FamilySignupsAdmin({ onPendingChange }: { onPendingChange?: (n: number) => void }) {
  const teams = useTeams();
  const [list, setList] = useState<Signup[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<SignupDraft | null>(null);
  const [team, setTeam] = useState("all");
  const [toast, setToast] = useToast();

  const load = () => listSignups(null).then(l => {
    setList(l); setErr(null);
    onPendingChange?.(l.filter(s => s.status === "pending").length);
  }).catch(e => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  const shown = (list ?? []).filter(s => team === "all" || !s.roster_id || s.roster_id === team);
  const pending = shown.filter(s => s.status === "pending");
  const live = shown.filter(s => s.status === "open" || s.status === "closed");
  const declined = shown.filter(s => s.status === "declined");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
      <div style={{ ...fu.card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={fu.h2}>🙋 Sign-ups</div>
          <div style={fu.muted}>Team dinners, rides, volunteers. Families can suggest their own (you approve them), unless you turn that off in Settings.</div>
        </div>
        <button style={fu.btn("go")} onClick={() => setEditing(blankSignup())}>+ New sign-up</button>
      </div>
      {teams.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={fu.pill(team === "all")} onClick={() => setTeam("all")}>All teams</button>
          {teams.map(t => <button key={t.id} style={fu.pill(team === t.id)} onClick={() => setTeam(t.id)}>{t.name}</button>)}
        </div>
      )}
      {err && <div role="alert" style={{ ...fu.card, color: "var(--danger-text)", fontSize: 13 }}>{err}</div>}
      {list === null && !err && <div style={fu.muted}>Loading…</div>}

      {pending.length > 0 && <div style={{ ...fu.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Suggested by families · waiting for you</div>}
      {pending.map(s => <SignupCard key={s.id} s={s} isStaff onChanged={load} onToast={setToast} onEdit={x => setEditing(draftFrom(x))} />)}

      {live.length > 0 && pending.length > 0 && <div style={{ ...fu.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Posted</div>}
      {live.map(s => <SignupCard key={s.id} s={s} isStaff onChanged={load} onToast={setToast} onEdit={x => setEditing(draftFrom(x))} />)}
      {list && live.length === 0 && pending.length === 0 && <div style={{ ...fu.card, ...fu.muted, textAlign: "center" }}>No sign-ups yet.</div>}

      {declined.length > 0 && (
        <details>
          <summary style={{ ...fu.muted, cursor: "pointer" }}>Declined ({declined.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {declined.map(s => <SignupCard key={s.id} s={s} isStaff onChanged={load} onToast={setToast} onEdit={x => setEditing(draftFrom(x))} />)}
          </div>
        </details>
      )}

      {editing && (
        <SignupEditor draft={editing} teams={teams} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setToast("Saved."); load(); }} />
      )}
      <Toast msg={toast} />
    </div>
  );
}

// ── Checklist ─────────────────────────────────────────────────
export function FamilyChecklistAdmin() {
  const teams = useTeams();
  const [team, setTeam] = useState<string | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [marks, setMarks] = useState<ChecklistMark[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ id?: string; title: string; details: string; due_date: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useToast();

  useEffect(() => { if (!team && teams.length) setTeam(teams[0].id); }, [teams]);
  const load = async (rosterId: string) => {
    setErr(null);
    try {
      const [{ items, marks }, { data: p }] = await Promise.all([
        getChecklist(rosterId),
        supabase.from("profiles").select("id, name, jersey, home_roster_id").eq("role", "player").eq("home_roster_id", rosterId).order("name"),
      ]);
      setItems(items); setMarks(marks); setPlayers((p ?? []) as Player[]);
    } catch (e) { setErr(errText(e)); }
  };
  useEffect(() => { if (team) load(team); }, [team]);

  const has = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of marks) m.set(`${k.item_id}|${k.player_id}`, k.received_on);
    return m;
  }, [marks]);

  async function toggle(item: ChecklistItem, p: Player) {
    const key = `${item.id}|${p.id}`;
    const on = !has.has(key);
    setBusy(key);
    // Show it right away; undo if the save fails.
    setMarks(ms => on ? [...ms, { item_id: item.id, player_id: p.id, received_on: todayIso() }] : ms.filter(m => !(m.item_id === item.id && m.player_id === p.id)));
    try { await setReceived(item.id, p.id, on); }
    catch (e) { setErr(errText(e)); if (team) load(team); }
    finally { setBusy(null); }
  }

  async function saveItem() {
    if (!adding || !team) return;
    if (!adding.title.trim()) { setErr("Give the item a name."); return; }
    try {
      await saveChecklistItem({ id: adding.id, roster_id: team, title: adding.title, details: adding.details, due_date: adding.due_date || null, ...(adding.id ? {} : { sort_order: items.length }) });
      setAdding(null); setToast("Saved."); load(team);
    } catch (e) { setErr(errText(e)); }
  }

  async function remove(item: ChecklistItem) {
    if (!window.confirm(`Take "${item.title}" off the checklist? Families stop seeing it.`)) return;
    try { await archiveChecklistItem(item.id); if (team) load(team); } catch (e) { setErr(errText(e)); }
  }

  const done = (it: ChecklistItem) => players.filter(p => has.has(`${it.id}|${p.id}`)).length;

  return (
    <div style={{ ...fu.card, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={fu.h2}>✅ Checklist</div>
          <div style={fu.muted}>Tap a box when you get it. Families see "Received" with the date, read-only.</div>
        </div>
        <button style={fu.btn("go")} disabled={!team} onClick={() => setAdding({ title: "", details: "", due_date: "" })}>+ Add item</button>
      </div>
      {teams.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 4px" }}>
          {teams.map(t => <button key={t.id} style={fu.pill(team === t.id)} onClick={() => setTeam(t.id)}>{t.name}</button>)}
        </div>
      )}

      {adding && (
        <div style={{ ...fu.inner, marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
            <label style={fu.label}>Item
              <input autoFocus value={adding.title} onChange={e => setAdding({ ...adding, title: e.target.value.slice(0, 120) })} placeholder="Physical form" style={fu.input} list="checklist-ideas" />
              <datalist id="checklist-ideas">{["Physical form", "Concussion (ImPACT) baseline", "Emergency contact form", "Team fee", "Code of conduct signed", "Uniform returned"].map(i => <option key={i} value={i} />)}</datalist>
            </label>
            <label style={fu.label}>Due (optional)
              <input type="date" value={adding.due_date} onChange={e => setAdding({ ...adding, due_date: e.target.value })} style={fu.input} />
            </label>
          </div>
          <label style={fu.label}>Details for families (optional)
            <input value={adding.details} onChange={e => setAdding({ ...adding, details: e.target.value.slice(0, 500) })} placeholder="Turn in to the athletic office" style={fu.input} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={fu.btn("go")} onClick={saveItem}>{adding.id ? "Save" : "Add"}</button>
            <button style={fu.btn("plain")} onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      )}

      {err && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13, marginTop: 10 }}>{err}</div>}

      {items.length === 0 ? <div style={{ ...fu.muted, marginTop: 14 }}>Nothing on this team's checklist yet.</div> : (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)", fontWeight: 600, position: "sticky", left: 0, background: "var(--surface2)" }}>Player</th>
                {items.map(it => (
                  <th key={it.id} style={{ padding: "6px 8px", color: "var(--text)", fontWeight: 600, minWidth: 96, verticalAlign: "bottom" }}>
                    <div style={{ lineHeight: 1.25 }}>{it.title}</div>
                    <div style={{ ...fu.muted, fontWeight: 500, fontSize: 11 }}>{done(it)}/{players.length}{it.due_date ? ` · due ${formatDay(it.due_date, { month: "short", day: "numeric" })}` : ""}</div>
                    <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                      <button aria-label={`Edit ${it.title}`} style={{ ...fu.btn("quiet"), fontSize: 11 }} onClick={() => setAdding({ id: it.id, title: it.title, details: it.details ?? "", due_date: it.due_date ?? "" })}>Edit</button>
                      <button aria-label={`Remove ${it.title}`} style={{ ...fu.btn("quiet"), fontSize: 11 }} onClick={() => remove(it)}>Remove</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map(p => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 8px", color: "var(--text)", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--surface2)" }}>
                    {p.jersey != null && <span style={{ color: "var(--muted)" }}>#{p.jersey} </span>}{p.name}
                  </td>
                  {items.map(it => {
                    const key = `${it.id}|${p.id}`;
                    const on = has.get(key);
                    return (
                      <td key={it.id} style={{ textAlign: "center", padding: 4 }}>
                        <button aria-label={`${it.title} for ${p.name}: ${on ? "received" : "not received"}`} aria-pressed={!!on} disabled={busy === key} onClick={() => toggle(it, p)}
                          title={on ? `Received ${formatDay(on, { month: "short", day: "numeric" })}. Tap to undo.` : "Tap when received"}
                          style={{ width: 64, padding: "5px 0", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 600,
                                   border: `1px solid ${on ? "rgba(111,211,138,0.5)" : "var(--border)"}`, background: on ? "rgba(111,211,138,0.15)" : "transparent",
                                   color: on ? "var(--success-text)" : "var(--muted)" }}>
                          {on ? `✓ ${formatDay(on, { month: "numeric", day: "numeric" })}` : "—"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Toast msg={toast} />
    </div>
  );
}

// ── Messages ──────────────────────────────────────────────────
export function FamilyMessagesAdmin({ onUnreadChange }: { onUnreadChange?: (n: number) => void }) {
  const [threads, setThreads] = useState<StaffThread[] | null>(null);
  const [open, setOpen] = useState<StaffThread | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => getStaffThreads().then(t => { setThreads(t); onUnreadChange?.(t.reduce((n, x) => n + x.unread, 0)); }).catch(e => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  const anyOn = (threads ?? []).some(t => t.messages_on);
  const shown = (threads ?? []).filter(t => !q.trim() || `${t.player_name} ${t.parents}`.toLowerCase().includes(q.trim().toLowerCase()));
  const first = (n: string | null) => (n ?? "").trim().split(/\s+/)[0] || "this player";

  if (open) {
    return (
      <div style={{ ...fu.card, marginBottom: 16 }}>
        <button style={{ ...fu.btn("quiet"), marginBottom: 8 }} onClick={() => { setOpen(null); load(); }}>← All families</button>
        <div style={fu.h2}>💬 {open.player_name}'s family</div>
        <div style={{ ...fu.muted, marginBottom: 10 }}>{open.parents}{open.team_name ? ` · ${open.team_name}` : ""}</div>
        <FamilyThread playerId={open.player_id} withWhom={`${first(open.player_name)}'s family`} canSend={open.messages_on} viewer="staff" />
      </div>
    );
  }

  return (
    <div style={{ ...fu.card, marginBottom: 16 }}>
      <div style={fu.h2}>💬 Family messages</div>
      <div style={{ ...fu.muted, margin: "4px 0 10px" }}>One thread per family with the whole staff. Nothing can be deleted. Turn messages on per team in Settings.</div>
      {threads && !anyOn && (
        <div style={{ ...fu.inner, ...fu.muted, marginBottom: 10, color: "var(--amber-text, #f0c96a)" }}>Messages are off for every team. Turn them on in Settings if you want families to be able to message the staff.</div>
      )}
      {(threads?.length ?? 0) > 8 && <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search player or parent" style={{ ...fu.input, marginBottom: 10 }} />}
      {err && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13 }}>{err}</div>}
      {threads === null ? <div style={fu.muted}>Loading…</div> : shown.length === 0 ? <div style={fu.muted}>No approved families yet.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.map(t => (
            <button key={t.player_id} onClick={() => setOpen(t)}
              style={{ ...fu.inner, display: "flex", gap: 10, alignItems: "center", textAlign: "left", cursor: "pointer", fontFamily: "inherit", borderColor: t.unread ? "var(--royal)" : undefined, opacity: t.messages_on || t.last_message_at ? 1 : 0.6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                  {t.player_name} <span style={{ ...fu.muted, fontWeight: 500 }}>· {t.parents}</span>
                </div>
                <div style={{ ...fu.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.last_body ? `${t.last_kind === "staff" ? "Coach: " : ""}${t.last_body}` : t.messages_on ? "No messages yet" : `Messages off${t.team_name ? ` for ${t.team_name}` : ""}`}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {t.last_message_at && <div style={fu.muted}>{new Date(t.last_message_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>}
                {t.unread > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--royal)", borderRadius: 999, padding: "1px 7px" }}>{t.unread}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────
export function FamilyTeamSettings() {
  const [rows, setRows] = useState<TeamSetting[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => { getTeamSettings().then(setRows).catch(e => setErr(errText(e))); }, []);

  async function change(r: TeamSetting, patch: Partial<TeamSetting>) {
    const next = { ...r, ...patch };
    setRows(rs => (rs ?? []).map(x => (x.roster_id === r.roster_id ? next : x)));
    setSaving(r.roster_id); setErr(null);
    try { await saveTeamSetting(next); }
    catch (e) { setErr(errText(e)); setRows(rs => (rs ?? []).map(x => (x.roster_id === r.roster_id ? r : x))); }
    finally { setSaving(null); }
  }

  const Switch = ({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 46, height: 26, borderRadius: 999, border: "none", cursor: "pointer", position: "relative", background: on ? "var(--royal)" : "rgba(176,184,200,0.25)", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
    </button>
  );

  return (
    <div style={{ ...fu.card, marginBottom: 16 }}>
      <div style={fu.h2}>⚙️ Family settings</div>
      <div style={{ ...fu.muted, margin: "4px 0 12px" }}>Per team. Changes save right away.</div>
      {err && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {rows === null ? <div style={fu.muted}>Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map(r => (
            <div key={r.roster_id} style={{ ...fu.inner, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{r.name}</div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={fu.text}>Families can suggest sign-ups</div>
                  <div style={fu.muted}>Rides, team dinners they host. You approve each one before other families see it.</div>
                </div>
                <Switch on={r.suggestions_on} label={`${r.name}: families can suggest sign-ups`} disabled={saving === r.roster_id} onChange={v => change(r, { suggestions_on: v })} />
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={fu.text}>Family messages</div>
                  <div style={fu.muted}>Parents can message the whole staff about their player. Every coach sees every thread, and nothing can be deleted.</div>
                </div>
                <Switch on={r.messages_on} label={`${r.name}: family messages`} disabled={saving === r.roster_id} onChange={v => change(r, { messages_on: v })} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
