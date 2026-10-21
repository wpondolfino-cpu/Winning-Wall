// src/components/messages/StaffInbox.tsx
// The coaches' Messages inbox (migration 203): head coaches and assistants
// messaging each other, one-to-one, a few coaches, or the whole staff.
// For a head coach it's one inbox with their Winning Wall conversations
// too (migration 192): both kinds in one list, newest first, each row
// tagged, and "Winning Wall" is just another choice in To.
// Same look as the Winning Wall inbox: each conversation is a collapsed
// row; tap to open its messages and a reply box, tap again to minimize.

import { CSSProperties, useEffect, useState } from "react";
import {
  StaffConversation, StaffMessage, StaffPerson, loadStaffInbox, loadStaffThread, loadStaffPeople,
  startStaffConversation, replyStaff, hideStaffConversation, deleteStaffMessage,
} from "../../lib/staffMessages";
import { Conversation, loadInbox, startConversation } from "../../lib/messages";
import { ConversationRow } from "./MessageInbox";

/** Head coaches: their program, so Winning Wall conversations join the inbox. */
export interface PlatformLink { programId: string; programName: string; }
type Item = { kind: "staff"; c: StaffConversation; key: string; at: string; text: string }
          | { kind: "platform"; c: Conversation; key: string; at: string; text: string };

const btn: CSSProperties = { height: 42, padding: "0 16px", borderRadius: 10, border: 0, background: "var(--royal)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghost: CSSProperties = { ...btn, background: "transparent", border: "1px solid var(--border)", color: "var(--info-text-2)" };
const field: CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14, width: "100%" };

function short(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function stamp(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function StaffInbox({ myName, onActivity, platform }: { myName: string; onActivity?: () => void; platform?: PlatformLink | null }) {
  const [convs, setConvs] = useState<StaffConversation[] | null>(null);
  const [pconvs, setPconvs] = useState<Conversation[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function refresh() {
    if (platform) loadInbox().then(setPconvs).catch(() => setPconvs([]));
    try { setConvs(await loadStaffInbox()); onActivity?.(); }
    catch (e: any) {
      setErr(/staff_inbox/.test(e?.message ?? "") ? "Staff messages aren't switched on yet (migration 203)." : (e?.message ?? "Couldn't load messages."));
      setConvs([]);
    }
  }
  useEffect(() => { refresh(); }, []);

  const toggle = (key: string) => setOpen(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const needle = q.trim().toLowerCase();
  const items: Item[] = [
    ...(convs ?? []).map(c => ({ kind: "staff" as const, c, key: `s${c.id}`, at: c.last_at, text: `${c.subject} ${c.people} ${c.last_body ?? ""}` })),
    ...pconvs.map(c => ({ kind: "platform" as const, c, key: `p${c.id}`, at: c.last_at, text: `${c.subject} winning wall ${c.last_body ?? ""}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const shown = items.filter(i => !needle || i.text.toLowerCase().includes(needle));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button style={btn} onClick={() => setComposing(c => !c)}>{composing ? "Cancel" : "+ New message"}</button>
        {items.length > 4 && (
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search messages" aria-label="Search staff messages"
            style={{ ...field, height: 42, flex: "1 1 220px", width: "auto", padding: "0 12px" }} />
        )}
        {open.size > 0 && <button style={ghost} onClick={() => setOpen(new Set())}>Minimize all</button>}
      </div>

      {composing && (
        <Compose myName={myName} platform={platform}
          onSent={async (key) => { setComposing(false); await refresh(); setOpen(prev => new Set(prev).add(key)); }} />
      )}

      {err && <div style={{ color: "var(--danger-text-2)", fontSize: 13 }}>{err}</div>}
      {convs === null && <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>}
      {convs !== null && items.length === 0 && !composing && !err && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
          No messages yet. Start one with a coach, a few coaches, or the whole staff{platform ? ", or Admin" : ""}.
        </div>
      )}

      <div style={{ background: "var(--surface)", border: shown.length ? "1px solid var(--border)" : "none", borderRadius: 14, overflow: "hidden" }}>
        {shown.map((it, i) => it.kind === "staff" ? (
          <Row key={it.key} conv={it.c} myName={myName} open={open.has(it.key)} first={i === 0} onToggle={() => toggle(it.key)} onChanged={refresh} />
        ) : (
          <ConversationRow key={it.key} conv={it.c} asPlatform={false} open={open.has(it.key)} first={i === 0} onToggle={() => toggle(it.key)} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

function Compose({ myName, onSent, platform }: { myName: string; onSent: (key: string) => void; platform?: PlatformLink | null }) {
  const [people, setPeople] = useState<StaffPerson[] | null>(null);
  const [everyone, setEveryone] = useState(false);
  // Head coaches: Winning Wall is a choice in To, on its own (not mixed
  // with coaches -- it's a separate conversation that only head coaches see).
  const [toPlatform, setToPlatform] = useState(false);
  const [to, setTo] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadStaffPeople().then(setPeople).catch(e => { setErr(e?.message ?? "Couldn't load the staff."); setPeople([]); }); }, []);

  const pick = (id: string) => setTo(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ready = (toPlatform || everyone || to.size > 0) && subject.trim() && body.trim();
  const chip = (on: boolean): CSSProperties => ({
    height: 34, padding: "0 12px", borderRadius: 99, fontFamily: "inherit", fontSize: 13, cursor: "pointer",
    border: `1px solid ${on ? "var(--royal)" : "var(--border)"}`, background: on ? "var(--royal)" : "transparent", color: on ? "#fff" : "var(--text)",
  });

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 12, color: "var(--muted-2)" }}>To</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button type="button" style={chip(everyone)} onClick={() => { setEveryone(e => !e); setTo(new Set()); setToPlatform(false); }}>👥 Whole staff</button>
        {(people ?? []).map(p => (
          <button key={p.id} type="button" style={chip(!everyone && to.has(p.id))} disabled={everyone} onClick={() => { pick(p.id); setToPlatform(false); }}>
            {p.name}{p.role === "head_coach" ? " · HC" : ""}
          </button>
        ))}
        {platform && (
          <button type="button" style={chip(toPlatform)} onClick={() => { setToPlatform(t => !t); setEveryone(false); setTo(new Set()); }}>Admin</button>
        )}
        {people?.length === 0 && !platform && <span style={{ fontSize: 12, color: "var(--muted)" }}>No other coaches in this program yet.</span>}
      </div>
      {toPlatform && <span style={{ fontSize: 12, color: "var(--muted)" }}>Questions, problems or ideas for Admin. Only your program's head coaches see this one.</span>}
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--muted-2)" }}>
        Subject
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={140} placeholder="e.g. Practice plan for Thursday" style={{ ...field, height: 44 }} />
      </label>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} maxLength={4000} placeholder="Write your message…" aria-label="Message" style={{ ...field, resize: "vertical" }} />
      {err && <div style={{ color: "var(--danger-text-2)", fontSize: 13 }}>{err}</div>}
      <button style={{ ...btn, alignSelf: "flex-start", opacity: ready ? 1 : 0.5 }} disabled={busy || !ready}
        onClick={async () => {
          setBusy(true); setErr(null);
          try {
            if (toPlatform && platform) {
              onSent("p" + await startConversation(platform.programId, subject.trim(), body.trim(), { fromPlatform: false, programName: platform.programName }));
            } else {
              onSent("s" + await startStaffConversation(subject.trim(), body.trim(), everyone ? [] : [...to], myName));
            }
          }
          catch (e: any) { setErr(e?.message ?? "Couldn't send."); setBusy(false); }
        }}>{busy ? "Sending…" : "Send"}</button>
    </div>
  );
}

function Row({ conv: c, myName, open, first, onToggle, onChanged }: {
  conv: StaffConversation; myName: string; open: boolean; first: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const [msgs, setMsgs] = useState<StaffMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setMsgs(await loadStaffThread(c.id)); if (c.unread) onChanged(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't load."); }
  }
  useEffect(() => { if (open) load(); }, [open, c.messages, c.last_at]);
  const unread = c.unread > 0;

  return (
    <div style={{ borderTop: first ? "none" : "1px solid var(--border)" }}>
      <button onClick={onToggle} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: open ? "var(--surface2)" : "transparent", border: 0, borderRadius: 0, color: "var(--text)", fontFamily: "inherit", textAlign: "left", cursor: "pointer", minHeight: 64 }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: unread ? "#4c8dff" : "transparent", flexShrink: 0 }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: unread ? 700 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.subject}</span>
            {c.messages > 1 && <span style={{ fontSize: 12, color: "var(--muted-3)", flexShrink: 0 }}>{c.messages}</span>}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {c.everyone ? "👥 " : ""}{c.people}
          </span>
          {!open && c.last_body && (
            <span style={{ fontSize: 13, color: unread ? "var(--text)" : "var(--muted-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.last_mine ? "You" : c.last_sender}: {c.last_body}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: "var(--muted-3)", flexShrink: 0 }}>{short(c.last_at)}</span>
      </button>

      {open && (
        <div style={{ padding: "4px 16px 16px", background: "var(--surface2)", display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs === null && <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>}
          {(msgs ?? []).map(m => (
            <div key={m.id} style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "min(85%, 560px)", display: "flex", flexDirection: "column", gap: 3, alignItems: m.mine ? "flex-end" : "flex-start" }}>
              <span style={{ fontSize: 11, color: "var(--muted-3)", display: "flex", gap: 8, alignItems: "center" }}>
                {m.mine ? "You" : m.sender_name} · {stamp(m.created_at)}
                {m.mine && (
                  <button aria-label="Delete this message" title="Delete this message (for everyone)"
                    onClick={async () => {
                      if (!window.confirm("Delete this message? It's removed for everyone in the conversation.")) return;
                      try { await deleteStaffMessage(m.id); onChanged(); } catch (e: any) { setErr(e?.message ?? "Couldn't delete."); }
                    }}
                    style={{ background: "transparent", border: 0, color: "var(--muted-3)", cursor: "pointer", padding: 4, display: "flex" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  </button>
                )}
              </span>
              <div style={{ padding: "10px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                background: m.mine ? "var(--royal)" : "var(--surface)", color: m.mine ? "#fff" : "var(--text)", border: m.mine ? "none" : "1px solid var(--border)" }}>{m.body}</div>
            </div>
          ))}
          {err && <div style={{ fontSize: 13, color: "var(--danger-text-2)" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000} aria-label={`Reply to ${c.subject}`} placeholder="Reply…"
              style={{ ...field, flex: 1, minHeight: 48, resize: "vertical" }} />
            <button style={{ ...btn, height: 48 }} disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true); setErr(null);
                try { await replyStaff(c, text.trim(), myName); setText(""); onChanged(); }
                catch (e: any) { setErr(e?.message ?? "Couldn't send."); }
                finally { setBusy(false); }
              }}>{busy ? "Sending…" : "Reply"}</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={{ ...ghost, height: 36, fontSize: 13 }} onClick={onToggle}>Minimize</button>
            <button style={{ ...ghost, height: 36, fontSize: 13, color: "var(--danger-text)" }}
              onClick={async () => {
                if (!window.confirm(`Delete “${c.subject}” from your inbox? Everyone else keeps it, and it comes back if someone replies.`)) return;
                try { await hideStaffConversation(c.id); onChanged(); } catch (e: any) { setErr(e?.message ?? "Couldn't delete."); }
              }}>Delete conversation</button>
          </div>
        </div>
      )}
    </div>
  );
}
