// src/components/parent/ParentApp.tsx
// The whole app for a parent account (SQL 222). One child at a time, with
// a switcher when there's more than one: what's next, announcements for
// families, the schedule (times and places only, changes flagged), and
// "Report an absence". Nothing else of the team's is open to a parent.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { signOut } from "../../lib/supabase";
import NotificationToggle from "../NotificationToggle";
import {
  ABSENCE_REASONS, cancelAbsence, downloadIcs, formatDay, formatTime, getParentAnnouncements, getParentCancellations,
  getParentChildren, getParentSchedule, mapsUrl, markAnnouncementsRead, reportAbsence, todayIso,
  type FamilyAnnouncement, type FamilyCancellation, type FamilyScheduleItem, type ParentChild,
} from "../../lib/family";

interface Props {
  parentId: string;
  parentName: string;
  isTest?: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;
const card: CSSProperties = { background: "var(--surface2, #141b2d)", border: "1px solid var(--border, rgba(176,184,200,0.15))", borderRadius: 14, padding: "14px 16px" };
const h2: CSSProperties = { fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 1, color: "var(--info-text, #93b4ff)", margin: "0 0 10px" };
const muted: CSSProperties = { fontSize: 12, color: "var(--muted, #9aa3b5)" };
const chip = (on: boolean, color: string): CSSProperties => ({
  padding: "7px 12px", borderRadius: 999, border: `1px solid ${on ? color : "var(--border, rgba(176,184,200,0.2))"}`,
  background: on ? color : "transparent", color: on ? "#fff" : "var(--text, #e8ecf4)", fontSize: 13, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
});
const tag = (bg: string, fg: string): CSSProperties => ({ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 7px", borderRadius: 6, background: bg, color: fg, textTransform: "uppercase" });

const KIND_ICON: Record<string, string> = { practice: "🏀", game: "🏆", event: "📌" };

function whenText(i: FamilyScheduleItem): string {
  if (i.kind === "game" && i.home_away === "away" && i.bus_time) return `Bus ${formatTime(i.bus_time)} · Tip ${formatTime(i.start_time)}`;
  if (!i.start_time) return "Time TBA";
  return i.end_time ? `${formatTime(i.start_time)} – ${formatTime(i.end_time)}` : formatTime(i.start_time);
}

function changedText(i: FamilyScheduleItem): string | null {
  if (i.changed === "moved") {
    const parts = [i.old_date && i.old_date !== i.item_date ? formatDay(i.old_date) : null, i.old_time ? formatTime(i.old_time) : null].filter(Boolean);
    return parts.length ? `Moved · was ${parts.join(" ")}` : "Time changed";
  }
  if (i.changed === "place") return "New place";
  return null;
}

export default function ParentApp({ parentId, parentName, isTest }: Props) {
  const [kids, setKids] = useState<ParentChild[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [childId, setChildId] = useState<string | null>(() => { try { return localStorage.getItem("ww_parent_child"); } catch { return null; } });
  const [items, setItems] = useState<FamilyScheduleItem[]>([]);
  const [cancels, setCancels] = useState<FamilyCancellation[]>([]);
  const [anns, setAnns] = useState<FamilyAnnouncement[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAbsence, setShowAbsence] = useState<FamilyScheduleItem | true | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadKids = () => {
    setLoadErr(null);
    getParentChildren().then(setKids).catch(e => setLoadErr(e?.message ?? "Couldn't load."));
  };
  useEffect(loadKids, []);

  const active = useMemo(() => (kids ?? []).filter(k => k.status === "active"), [kids]);
  const pending = useMemo(() => (kids ?? []).filter(k => k.status === "pending"), [kids]);
  const child = active.find(k => k.player_id === childId) ?? active[0] ?? null;
  const color = child?.primary_color && HEX.test(child.primary_color) ? child.primary_color : "#1a3fa8";

  const loadChild = async (id: string) => {
    setLoading(true);
    try {
      const [s, c, a] = await Promise.all([getParentSchedule(id), getParentCancellations(id), getParentAnnouncements(id)]);
      setItems(s); setCancels(c); setAnns(a);
      const unread = a.filter(x => !x.read).map(x => x.id);
      if (unread.length) markAnnouncementsRead(unread).catch(() => {});
    } catch (e: any) {
      setLoadErr(e?.message ?? "Couldn't load.");
    } finally { setLoading(false); }
  };
  useEffect(() => {
    if (!child) return;
    try { localStorage.setItem("ww_parent_child", child.player_id); } catch { /* fine */ }
    loadChild(child.player_id);
  }, [child?.player_id]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "your player";
  const today = todayIso();
  const upcoming = items.filter(i => i.item_date >= today);
  const next = upcoming.find(i => !i.absence_reason) ?? upcoming[0] ?? null;

  // Group by day for the list.
  const byDay = useMemo(() => {
    const m = new Map<string, FamilyScheduleItem[]>();
    for (const i of upcoming) { if (!m.has(i.item_date)) m.set(i.item_date, []); m.get(i.item_date)!.push(i); }
    return [...m.entries()];
  }, [items]);

  async function undoAbsence(i: FamilyScheduleItem) {
    if (!child) return;
    try { await cancelAbsence(child.player_id, i.id); setToast("Absence taken back."); loadChild(child.player_id); }
    catch (e: any) { setToast(e?.message ?? "Couldn't change it."); }
  }

  const top = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      {child?.logo_url
        ? <img src={child.logo_url} alt="" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 10 }} />
        : <img src="/logo.png" alt="" style={{ height: 40, objectFit: "contain" }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: 1, color: "var(--white, #fff)", lineHeight: 1 }}>
          {child ? child.program_name : "Winning Wall"}
        </div>
        <div style={muted}>Family · {parentName}</div>
      </div>
      <button onClick={signOut} style={{ background: "var(--surface2, #141b2d)", color: "var(--muted, #9aa3b5)", border: "1px solid var(--border, rgba(176,184,200,0.2))", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>Sign out</button>
    </div>
  );

  const wrap = (body: ReactNode) => (
    <div style={{ minHeight: "100vh", background: "var(--bg, #0a0c14)", backgroundImage: `radial-gradient(ellipse 90% 40% at 50% 0%, ${color}40 0%, transparent 70%)` }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 14px 60px", display: "flex", flexDirection: "column", gap: 14 }}>
        {top}
        {body}
      </div>
      {toast && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1c2742", color: "#eef2ff", border: "1px solid rgba(147,180,255,0.45)", borderRadius: 10, padding: "10px 16px", fontSize: 13, zIndex: 60, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>{toast}</div>}
    </div>
  );

  if (loadErr && !kids) return wrap(<div style={card}><div style={{ color: "var(--text)", marginBottom: 8 }}>Couldn't load: {loadErr}</div><button style={chip(true, color)} onClick={loadKids}>Try again</button></div>);
  if (!kids) return wrap(<div style={{ ...muted, textAlign: "center", padding: 30 }}>Loading…</div>);

  if (!child) return wrap(
    <div style={{ ...card, textAlign: "center", padding: "28px 20px" }}>
      <div style={{ fontSize: 34 }}>⏳</div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, color: "var(--gold-text, #f0c040)", letterSpacing: 1, marginTop: 6 }}>
        {pending.length ? "Waiting for the coach" : "No players yet"}
      </div>
      <div style={{ fontSize: 14, color: "var(--muted, #9aa3b5)", marginTop: 10, lineHeight: 1.6 }}>
        {pending.length
          ? `A coach needs to approve you for ${pending.map(p => first(p.name)).join(" and ")}. We let them know. Check back soon.`
          : "Ask your player for their family link. It's on their My Profile page in Winning Wall."}
      </div>
      <button onClick={loadKids} style={{ ...chip(false, color), marginTop: 16 }}>Check again</button>
    </div>
  );

  const unreadCount = anns.filter(a => !a.read).length;

  return wrap(<>
    {(active.length > 1 || pending.length > 0) && (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {active.map(k => (
          <button key={k.player_id} style={chip(k.player_id === child.player_id, color)} onClick={() => setChildId(k.player_id)}>
            {first(k.name)}{k.team_name ? ` · ${k.team_name}` : ""}
          </button>
        ))}
        {pending.map(k => <span key={k.player_id} style={{ ...muted, padding: "7px 6px" }}>⏳ {first(k.name)} (waiting for approval)</span>)}
      </div>
    )}

    {cancels.length > 0 && (
      <div style={{ ...card, background: "rgba(220,50,50,0.10)", border: "1px solid rgba(220,50,50,0.35)" }}>
        {cancels.map(c => (
          <div key={c.item_id} style={{ fontSize: 13, color: "var(--danger-text, #ff9b9b)", lineHeight: 1.6 }}>
            ❌ <b>Cancelled:</b> {c.label} · {formatDay(c.old_date)}{c.old_time ? ` ${formatTime(c.old_time)}` : ""}
          </div>
        ))}
      </div>
    )}

    {/* Next up */}
    <div style={{ ...card, borderColor: `${color}88` }}>
      <div style={{ ...muted, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>Next up for {first(child.name)}</div>
      {next ? (<>
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--white, #fff)" }}>{KIND_ICON[next.kind]} {next.title}</div>
        <div style={{ fontSize: 14, color: "var(--text, #e8ecf4)", marginTop: 4 }}>
          {next.item_date === today ? "Today" : formatDay(next.item_date, { weekday: "long", month: "short", day: "numeric" })} · {whenText(next)}
        </div>
        {next.location && <div style={{ fontSize: 13, color: "var(--muted, #9aa3b5)", marginTop: 3 }}>📍 {next.location}</div>}
        {next.note && <div style={{ fontSize: 13, color: "var(--gold-text, #f0c040)", marginTop: 6 }}>📝 {next.note}</div>}
        {changedText(next) && <div style={{ marginTop: 6 }}><span style={tag("rgba(240,192,64,0.18)", "var(--gold-text, #f0c040)")}>{changedText(next)}</span></div>}
        {next.absence_reason && <div style={{ marginTop: 6 }}><span style={tag("rgba(147,180,255,0.18)", "var(--info-text, #93b4ff)")}>Absent · {next.absence_reason}</span></div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {next.location && <a href={mapsUrl(next.location)} target="_blank" rel="noreferrer" style={{ ...chip(false, color), textDecoration: "none" }}>🧭 Directions</a>}
          <button style={chip(false, color)} onClick={() => downloadIcs(next, first(child.name))}>📅 Add to calendar</button>
          {!next.absence_reason && <button style={chip(false, color)} onClick={() => setShowAbsence(next)}>🙋 Won't be there</button>}
        </div>
      </>) : <div style={{ fontSize: 14, color: "var(--muted, #9aa3b5)" }}>Nothing on the schedule in the next few weeks.</div>}
    </div>

    {/* Announcements */}
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={h2}>📢 Announcements{unreadCount ? ` · ${unreadCount} new` : ""}</div>
      </div>
      {anns.length === 0 ? <div style={muted}>Nothing from the coaches yet.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {anns.slice(0, 10).map(a => (
            <div key={a.id} style={{ padding: "10px 12px", borderRadius: 10, background: a.is_pinned ? "rgba(240,192,64,0.08)" : "var(--surface, #0f1524)", border: `1px solid ${!a.read ? color : a.is_pinned ? "rgba(240,192,64,0.25)" : "var(--border, rgba(176,184,200,0.15))"}` }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                {!a.read && <span style={tag(color, "#fff")}>New</span>}
                {a.is_pinned && <span style={tag("rgba(240,192,64,0.18)", "var(--gold-text, #f0c040)")}>Pinned</span>}
              </div>
              <div style={{ fontSize: 14, color: "var(--text, #e8ecf4)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{a.message}</div>
              <div style={{ ...muted, marginTop: 4 }}>{a.coach_name ?? "Coach"} · {new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Schedule */}
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ ...h2, margin: 0 }}>📅 Schedule</div>
        <button style={chip(true, color)} onClick={() => setShowAbsence(true)} disabled={!upcoming.length}>🙋 Report an absence</button>
      </div>
      <div style={{ ...muted, marginBottom: 10 }}>{first(child.name)}{child.team_name ? ` · ${child.team_name}` : ""} · next 6 weeks</div>
      {loading && !items.length ? <div style={muted}>Loading…</div> : byDay.length === 0 ? <div style={muted}>Nothing scheduled yet.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {byDay.map(([day, list]) => (
            <div key={day}>
              <div style={{ fontSize: 12, fontWeight: 700, color: day === today ? "var(--gold-text, #f0c040)" : "var(--muted-2, #b5bdcc)", marginBottom: 4 }}>
                {day === today ? "Today · " : ""}{formatDay(day, { weekday: "long", month: "short", day: "numeric" })}
              </div>
              {list.map(i => (
                <div key={i.kind + i.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border, rgba(176,184,200,0.1))", opacity: i.absence_reason ? 0.75 : 1 }}>
                  <div style={{ fontSize: 18, width: 24, textAlign: "center" }}>{KIND_ICON[i.kind]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text, #e8ecf4)" }}>{i.title}</div>
                    <div style={{ fontSize: 13, color: "var(--muted, #9aa3b5)" }}>{whenText(i)}</div>
                    {i.location && <a href={mapsUrl(i.location)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--muted, #9aa3b5)", textDecoration: "none" }}>📍 {i.location}</a>}
                    {i.note && <div style={{ fontSize: 12, color: "var(--gold-text, #f0c040)" }}>📝 {i.note}</div>}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                      {changedText(i) && <span style={tag("rgba(240,192,64,0.18)", "var(--gold-text, #f0c040)")}>{changedText(i)}</span>}
                      {i.absence_reason && <span style={tag("rgba(147,180,255,0.18)", "var(--info-text, #93b4ff)")}>Absent · {i.absence_reason}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <button title="Add to calendar" aria-label="Add to calendar" onClick={() => downloadIcs(i, first(child.name))} style={{ background: "none", border: 0, cursor: "pointer", fontSize: 16 }}>📅</button>
                    {i.absence_reason
                      ? <button onClick={() => undoAbsence(i)} style={{ background: "none", border: 0, color: "var(--muted, #9aa3b5)", fontSize: 11, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>Undo</button>
                      : <button onClick={() => setShowAbsence(i)} style={{ background: "none", border: 0, color: "var(--muted, #9aa3b5)", fontSize: 11, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>Absent</button>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>

    {!isTest && <NotificationToggle playerId={parentId} />}

    {showAbsence && (
      <AbsenceModal
        childName={first(child.name)} color={color}
        items={upcoming.filter(i => !i.absence_reason)}
        preselect={showAbsence === true ? null : showAbsence.kind + showAbsence.id}
        onClose={() => setShowAbsence(null)}
        onSend={async (picked, reason, note) => {
          await reportAbsence(child.player_id, picked.map(p => ({ kind: p.kind, id: p.id })), reason, note);
          setShowAbsence(null);
          setToast(`Sent. The coaches know ${first(child.name)} won't be there.`);
          loadChild(child.player_id);
        }} />
    )}
  </>);
}

function AbsenceModal({ childName, color, items, preselect, onClose, onSend }: {
  childName: string; color: string; items: FamilyScheduleItem[]; preselect: string | null;
  onClose: () => void; onSend: (picked: FamilyScheduleItem[], reason: string, note: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect ? [preselect] : []));
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = items.slice(0, 20);
  const toggle = (k: string) => setPicked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function send() {
    setErr(null);
    if (!picked.size) { setErr("Pick at least one."); return; }
    if (!reason) { setErr("Pick a reason."); return; }
    setBusy(true);
    try { await onSend(list.filter(i => picked.has(i.kind + i.id)), reason, note); }
    catch (e: any) { setErr(e?.message ?? "Couldn't send."); setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Report an absence" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#111828", borderRadius: "18px 18px 0 0", width: 560, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", padding: "18px 16px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1, fontSize: 18, fontWeight: 700, color: "var(--white, #fff)" }}>{childName} won't be at…</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: 0, color: "var(--muted, #9aa3b5)", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {list.length === 0 && <div style={muted}>Nothing coming up to report.</div>}
          {list.map(i => {
            const k = i.kind + i.id;
            return (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, cursor: "pointer", background: picked.has(k) ? `${color}33` : "var(--surface, #0f1524)", border: `1px solid ${picked.has(k) ? color : "transparent"}` }}>
                <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} />
                <span style={{ fontSize: 16 }}>{KIND_ICON[i.kind]}</span>
                <span style={{ flex: 1, fontSize: 14, color: "var(--text, #e8ecf4)" }}>{i.title}</span>
                <span style={{ fontSize: 12, color: "var(--muted, #9aa3b5)" }}>{formatDay(i.item_date)} {formatTime(i.start_time)}</span>
              </label>
            );
          })}
        </div>
        <div>
          <div style={{ ...muted, marginBottom: 6 }}>Reason</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ABSENCE_REASONS.map(r => <button key={r} style={chip(reason === r, color)} onClick={() => setReason(r)}>{r}</button>)}
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted, #9aa3b5)" }}>Note for the coaches (optional)
          <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Back on Thursday"
            style={{ width: "100%", background: "#1a2235", border: "1px solid rgba(176,184,200,0.15)", borderRadius: 10, padding: "10px 12px", color: "var(--text, #e8ecf4)", fontSize: 14, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
        </label>
        <div style={{ ...muted }}>Keep health details general. "Illness" is enough. It's counted as excused, and the coaches get a notification.</div>
        {err && <div role="alert" style={{ color: "var(--danger-text, #ff9b9b)", fontSize: 13 }}>{err}</div>}
        <button onClick={send} disabled={busy} style={{ width: "100%", background: color, color: "#fff", border: "none", borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Sending…" : picked.size > 1 ? `Send (${picked.size})` : "Send"}
        </button>
      </div>
    </div>
  );
}
