// src/components/messages/MessageInbox.tsx
// Email-style inbox between a program's head coaches and Winning Wall
// (migration 192). Used on Platform › Messages (asPlatform) and on a head
// coach's Announcements page. Each conversation is one collapsed row; tap
// to expand its messages and a reply box, tap the header again to
// minimize. Several can be open at once.

import { CSSProperties, useEffect, useState } from "react";
import {
  Conversation, ConvMessage, loadInbox, loadConversation, startConversation, reply,
  deleteConversation, deleteMessage,
} from "../../lib/messages";

export interface ProgramOption { id: string; name: string; org: string; hasHeadCoach: boolean; }

interface Props {
  asPlatform: boolean;
  /** Platform admin: programs to start a conversation with. */
  programs?: ProgramOption[];
  /** Head coach: the program they're in. */
  myProgram?: { id: string; name: string } | null;
  /** Called after anything that changes unread counts. */
  onActivity?: () => void;
}

const btn: CSSProperties = { height: 42, padding: "0 16px", borderRadius: 10, border: 0, background: "var(--royal)", color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghost: CSSProperties = { ...btn, background: "transparent", border: "1px solid rgba(176,184,200,0.3)", color: "var(--info-text-2)" };
const field: CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(176,184,200,0.25)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14, width: "100%" };

function short(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function stamp(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MessageInbox({ asPlatform, programs, myProgram, onActivity }: Props) {
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [composing, setComposing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function refresh() {
    try { setConvs(await loadInbox()); onActivity?.(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't load messages."); setConvs([]); }
  }
  useEffect(() => { refresh(); }, []);

  const toggle = (id: number) => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const needle = q.trim().toLowerCase();
  const shown = (convs ?? []).filter(c => !needle || c.subject.toLowerCase().includes(needle) || c.program.toLowerCase().includes(needle)
    || c.org.toLowerCase().includes(needle) || (c.last_body ?? "").toLowerCase().includes(needle));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button style={btn} onClick={() => setComposing(c => !c)}>{composing ? "Cancel" : "+ New message"}</button>
        {(convs?.length ?? 0) > 4 && (
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages"
            style={{ ...field, height: 42, flex: "1 1 220px", width: "auto", padding: "0 12px" }} />
        )}
        {open.size > 0 && <button style={ghost} onClick={() => setOpen(new Set())}>Minimize all</button>}
      </div>

      {composing && (
        <Compose asPlatform={asPlatform} programs={programs} myProgram={myProgram}
          onSent={async (id) => { setComposing(false); await refresh(); setOpen(prev => new Set(prev).add(id)); }} />
      )}

      {err && <div style={{ color: "var(--danger-text-2)", fontSize: 13 }}>{err}</div>}
      {convs === null && <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>}
      {convs !== null && convs.length === 0 && !composing && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
          {asPlatform ? "No messages yet. Head coaches can message you from their Announcements page, or start one with “+ New message”."
            : "Questions, problems or ideas? Start a message and Winning Wall will reply here."}
        </div>
      )}

      <div style={{ background: "var(--surface)", border: shown.length ? "1px solid var(--border)" : "none", borderRadius: 14, overflow: "hidden" }}>
        {shown.map((c, i) => (
          <ConversationRow key={c.id} conv={c} asPlatform={asPlatform} open={open.has(c.id)} first={i === 0}
            onToggle={() => toggle(c.id)} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

function Compose({ asPlatform, programs, myProgram, onSent }: {
  asPlatform: boolean; programs?: ProgramOption[]; myProgram?: { id: string; name: string } | null; onSent: (id: number) => void;
}) {
  const [to, setTo] = useState<string>(asPlatform ? "" : myProgram?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = asPlatform ? programs?.find(p => p.id === to) : myProgram ? { id: myProgram.id, name: myProgram.name, org: "", hasHeadCoach: true } : undefined;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {asPlatform ? (
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--muted-2)" }}>
          To (the program's head coaches)
          <select value={to} onChange={e => setTo(e.target.value)} style={{ ...field, height: 44, padding: "0 10px" }}>
            <option value="">Pick a program…</option>
            {(programs ?? []).map(p => <option key={p.id} value={p.id}>{p.org} · {p.name}{p.hasHeadCoach ? "" : " (no head coach yet)"}</option>)}
          </select>
        </label>
      ) : (
        <span style={{ fontSize: 13, color: "var(--muted-2)" }}>To: Winning Wall</span>
      )}
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--muted-2)" }}>
        Subject
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={140} placeholder="e.g. Question about team codes" style={{ ...field, height: 44 }} />
      </label>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} maxLength={4000} placeholder="Write your message…" aria-label="Message" style={{ ...field, resize: "vertical" }} />
      {target && asPlatform && !target.hasHeadCoach && <span style={{ fontSize: 12, color: "var(--amber-text)" }}>This program has no head coach yet, so nobody will see it until one is added.</span>}
      {err && <div style={{ color: "var(--danger-text-2)", fontSize: 13 }}>{err}</div>}
      <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy || !target || !subject.trim() || !body.trim()}
        onClick={async () => {
          if (!target) return;
          setBusy(true); setErr(null);
          try { const id = await startConversation(target.id, subject.trim(), body.trim(), { fromPlatform: asPlatform, programName: target.name }); onSent(id); }
          catch (e: any) { setErr(e?.message ?? "Couldn't send."); setBusy(false); }
        }}>{busy ? "Sending…" : "Send"}</button>
    </div>
  );
}

function ConversationRow({ conv: c, asPlatform, open, first, onToggle, onChanged }: {
  conv: Conversation; asPlatform: boolean; open: boolean; first: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const [msgs, setMsgs] = useState<ConvMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try { setMsgs(await loadConversation(c.id)); if (c.unread) onChanged(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't load."); }
  }
  useEffect(() => { if (open) load(); }, [open, c.messages, c.last_at]);

  const unread = c.unread > 0;
  const who = asPlatform ? `${c.program} · ${c.org}` : "Winning Wall";

  return (
    <div style={{ borderTop: first ? "none" : "1px solid rgba(176,184,200,0.12)" }}>
      <button onClick={onToggle} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: open ? "var(--surface2)" : "transparent", border: 0, color: "var(--text)", fontFamily: "inherit", textAlign: "left", cursor: "pointer", minHeight: 64 }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: unread ? "#4c8dff" : "transparent", flexShrink: 0 }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: unread ? 700 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.subject}</span>
            {c.messages > 1 && <span style={{ fontSize: 12, color: "var(--muted-3)", flexShrink: 0 }}>{c.messages}</span>}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{who}</span>
          {!open && c.last_body && (
            <span style={{ fontSize: 13, color: unread ? "var(--text)" : "var(--muted-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.last_from_platform === asPlatform ? "You: " : ""}{c.last_body}
            </span>
          )}
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: "var(--muted-3)" }}>{short(c.last_at)}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3adc4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
        </span>
      </button>

      {open && (
        <div style={{ padding: "4px 16px 16px", background: "var(--surface2)", display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs === null && <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>}
          {(msgs ?? []).map(m => {
            const ours = asPlatform ? m.from_platform : !m.from_platform;
            return (
              <div key={m.id} style={{ alignSelf: ours ? "flex-end" : "flex-start", maxWidth: "min(85%, 560px)", display: "flex", flexDirection: "column", gap: 3, alignItems: ours ? "flex-end" : "flex-start" }}>
                <span style={{ fontSize: 11, color: "var(--muted-3)", display: "flex", gap: 8, alignItems: "center" }}>
                  {m.mine ? "You" : m.sender_name} · {stamp(m.created_at)}
                  {m.mine && (
                    <button aria-label="Delete this message" title="Delete this message (for both sides)"
                      onClick={async () => {
                        if (!window.confirm("Delete this message? It's removed for both sides.")) return;
                        try { await deleteMessage(m.id); onChanged(); } catch (e: any) { setErr(e?.message ?? "Couldn't delete."); }
                      }}
                      style={{ background: "transparent", border: 0, color: "var(--muted-3)", cursor: "pointer", padding: 4, display: "flex" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                    </button>
                  )}
                </span>
                <div style={{ padding: "10px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                  background: ours ? "var(--royal)" : "var(--surface)", color: ours ? "#fff" : "var(--text)", border: ours ? "none" : "1px solid var(--border)" }}>{m.body}</div>
              </div>
            );
          })}
          {err && <div style={{ fontSize: 13, color: "var(--danger-text-2)" }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000} aria-label={`Reply to ${c.subject}`} placeholder="Reply…"
              style={{ ...field, flex: 1, minHeight: 48, resize: "vertical" }} />
            <button style={{ ...btn, height: 48 }} disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true); setErr(null);
                try { await reply(c, text.trim(), asPlatform); setText(""); onChanged(); }
                catch (e: any) { setErr(e?.message ?? "Couldn't send."); }
                finally { setBusy(false); }
              }}>{busy ? "Sending…" : "Reply"}</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={{ ...ghost, height: 36, fontSize: 13 }} onClick={onToggle}>Minimize</button>
            <button style={{ ...ghost, height: 36, fontSize: 13, color: "#ff9a9a", borderColor: "rgba(255,140,140,0.35)" }}
              onClick={async () => {
                if (!window.confirm(`Delete “${c.subject}” from your inbox? ${asPlatform ? "The head coaches" : "Winning Wall"} still keep it, and it comes back if someone replies.`)) return;
                try { await deleteConversation(c.id); onChanged(); } catch (e: any) { setErr(e?.message ?? "Couldn't delete."); }
              }}>Delete conversation</button>
          </div>
        </div>
      )}
    </div>
  );
}
