// src/components/parent/FamilyThread.tsx
// One family's thread with the whole coaching staff. Used by parents and
// coaches. Messages can't be edited or deleted, by anyone.
import { useEffect, useRef, useState } from "react";
import { getThreadMessages, sendFamilyMessage, type FamilyMessage } from "../../lib/familyHub";
import { fu, errText } from "./familyUi";

interface Props {
  playerId: string;
  /** Parent: "the coaches". Coach: "Liam's family". */
  withWhom: string;
  canSend: boolean;
  viewer: "parent" | "staff";
  color?: string;
  onRead?: () => void;
}

export default function FamilyThread({ playerId, withWhom, canSend, viewer, color = "var(--royal, #1a3fa8)", onRead }: Props) {
  const [msgs, setMsgs] = useState<FamilyMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = () => getThreadMessages(playerId).then(m => { setMsgs(m); onRead?.(); }).catch(e => setErr(errText(e)));
  useEffect(() => { setMsgs(null); load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [playerId]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { await sendFamilyMessage(playerId, text); setText(""); await load(); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  }

  let lastDay = "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...fu.muted, lineHeight: 1.5 }}>
        {viewer === "parent"
          ? "Messages go to the whole coaching staff, and every parent linked to your player sees them. Messages can't be deleted."
          : `Every coach on staff and every parent linked to this player sees this thread. Messages can't be deleted.`}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "55vh", overflowY: "auto", padding: "4px 2px" }}>
        {msgs === null ? <div style={fu.muted}>Loading…</div>
          : msgs.length === 0 ? <div style={{ ...fu.muted, textAlign: "center", padding: 20 }}>No messages yet{canSend ? `. Start one with ${withWhom}.` : "."}</div>
          : msgs.map(m => {
              const day = new Date(m.created_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
              const showDay = day !== lastDay; lastDay = day;
              const right = viewer === "staff" ? m.author_kind === "staff" : m.mine;
              return (
                <div key={m.id}>
                  {showDay && <div style={{ ...fu.muted, textAlign: "center", margin: "6px 0" }}>{day}</div>}
                  <div style={{ display: "flex", justifyContent: right ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "80%", background: right ? color : "var(--surface, #0f1524)", color: right ? "#fff" : "var(--text, #e8ecf4)", border: right ? "none" : "1px solid var(--border, rgba(176,184,200,0.15))", borderRadius: 14, padding: "8px 12px" }}>
                      <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 2 }}>
                        {m.mine ? "You" : m.author_name ?? (m.author_kind === "staff" ? "Coach" : "Parent")}{m.author_kind === "staff" && !m.mine ? " · Coach" : ""} · {new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </div>
                      <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                    </div>
                  </div>
                </div>
              );
            })}
        <div ref={end} />
      </div>
      {canSend ? (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea value={text} onChange={e => setText(e.target.value.slice(0, 2000))} rows={2} placeholder={`Message ${withWhom}`}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
            style={{ ...fu.input, flex: 1, resize: "vertical" }} />
          <button onClick={send} disabled={busy || !text.trim()} style={{ ...fu.btn("go", color), padding: "11px 16px", opacity: busy || !text.trim() ? 0.6 : 1 }}>{busy ? "…" : "Send"}</button>
        </div>
      ) : (
        <div style={{ ...fu.muted, textAlign: "center" }}>Messages are turned off for this team.</div>
      )}
      {err && <div role="alert" style={{ color: "var(--danger-text, #ff9b9b)", fontSize: 13 }}>{err}</div>}
    </div>
  );
}
