// src/components/messages/MessageThread.tsx
// One program's conversation with Winning Wall (migration 191). Used by
// the platform admin (Platform › Messages) and by a program's head coaches
// (Settings). Opening it marks it read.

import { useEffect, useRef, useState } from "react";
import { loadThread, sendMessage, ThreadMessage } from "../../lib/messages";

interface Props {
  programId: string;
  programName: string;
  /** true on the platform admin's side */
  asPlatform: boolean;
  /** called after the conversation is opened or a message is sent (badges) */
  onActivity?: () => void;
}

function stamp(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MessageThread({ programId, programName, asPlatform, onActivity }: Props) {
  const [msgs, setMsgs] = useState<ThreadMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function load() {
    try { setMsgs(await loadThread(programId)); onActivity?.(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't load the conversation."); setMsgs([]); }
  }
  useEffect(() => { setMsgs(null); load(); }, [programId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [msgs?.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setErr(null);
    try { await sendMessage(programId, body, { fromPlatform: asPlatform, programName }); setText(""); await load(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't send."); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 460, overflowY: "auto", padding: "4px 2px" }}>
        {msgs === null && <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>}
        {msgs !== null && msgs.length === 0 && (
          <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            {asPlatform ? `No messages with ${programName} yet. Anything you send goes to its head coaches.`
              : "Questions, problems, ideas: send them here and Winning Wall will reply in this conversation."}
          </span>
        )}
        {(msgs ?? []).map(m => {
          // Right side = your side of the conversation (Winning Wall for the
          // platform admin, the program for head coaches).
          const ours = asPlatform ? m.from_platform : !m.from_platform;
          return (
            <div key={m.id} style={{ alignSelf: ours ? "flex-end" : "flex-start", maxWidth: "min(80%, 520px)", display: "flex", flexDirection: "column", gap: 3, alignItems: ours ? "flex-end" : "flex-start" }}>
              <span style={{ fontSize: 11, color: "#8b95ae" }}>{m.mine ? "You" : m.sender_name} · {stamp(m.created_at)}</span>
              <div style={{ padding: "10px 14px", borderRadius: 14, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                background: ours ? "var(--royal)" : "var(--surface2)", color: ours ? "var(--white)" : "var(--text)",
                border: ours ? "none" : "1px solid var(--border)" }}>{m.body}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {err && <div style={{ fontSize: 13, color: "#ff8a8a" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000}
          aria-label={asPlatform ? `Message ${programName}` : "Message Winning Wall"}
          placeholder={asPlatform ? `Message ${programName}'s head coaches…` : "Message Winning Wall…"}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
          style={{ flex: 1, minHeight: 48, boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(176,184,200,0.25)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }} />
        <button onClick={send} disabled={busy || !text.trim()}
          style={{ height: 48, padding: "0 18px", borderRadius: 10, border: 0, background: "var(--royal)", color: "var(--white)", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
