// src/components/coach/DrillDetailCard.tsx
//
// One drill, the same everywhere: name, diagram (▶ Play, steps), Edit
// diagram / + Draw diagram, video, description, then whatever buttons the
// screen that opened it adds (Edit, Close, Add to practice…).
//
// Used by the Drill Library and the practice designer, so the card looks and
// works the same in both. Drawing or editing the diagram opens the drill
// designer over the whole screen; the first save links the new diagram to
// the drill, and Save diagram (or Close) comes back to this card with the
// diagram showing.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getYouTubeId } from "../../lib/youtube";
import { renderRichText } from "../../lib/richtext";
import { supabase } from "../../lib/supabase";
import { updatePracticeDrill, type PracticeDrillLibraryDrill } from "../../lib/practicePlanner";
import { getDrillDiagrams, getDrillLinkedPlays, deletePlay, type Play } from "../../lib/plays";
import DrillDiagram from "../plays/DrillDiagram";
import { getSendTargets, sendDrill, getShareCode, getShareStatus, revokeShareCode, shareLink, type SendTarget, type ShareCode } from "../../lib/drillSharing";
import PlayEditor from "../plays/PlayEditor";

interface Props {
  drill: PracticeDrillLibraryDrill;
  /** The drill's diagram, if it has one and it's loaded. */
  diagram: Play | null;
  /** Coaches who can change the drill: shows Edit diagram / + Draw diagram. */
  canManage: boolean;
  onClose: () => void;
  /** A diagram was drawn or changed: the screen can show it right away. */
  onDiagramChanged: (drillId: string, play: Play) => void;
  /** Small print under the description (category, default length, linked play…). */
  details?: ReactNode;
  /** The buttons along the bottom. */
  actions?: ReactNode;
  /** Show "Send to another team" (coaches on the drill's own team). */
  canSend?: boolean;
  /** Anything below the buttons. */
  footer?: ReactNode;
}

export default function DrillDetailCard({ drill, diagram, canManage, onClose, onDiagramChanged, details, actions, canSend = false, footer }: Props) {
  const [sending, setSending] = useState(false);
  const [drawing, setDrawing] = useState<{ play?: Play } | null>(null);
  // A new diagram not yet attached to its drill. If it still can't be
  // attached when the designer closes, it's removed rather than left saved
  // where nobody can ever see it.
  const unattached = useRef<string | null>(null);
  // The play linked to this drill (Blob 1 for "Intro to Blob 1"): watchable here, edited in Plays.
  const [linkedPlay, setLinkedPlay] = useState<Play | null>(null);
  const [showPlay, setShowPlay] = useState(false);
  useEffect(() => {
    let on = true;
    setLinkedPlay(null); setShowPlay(false);
    // With no diagram of its own, the drill opens on its play.
    if (drill.linked_play_id) getDrillLinkedPlays([drill.id]).then(got => { if (on) { setLinkedPlay(got[drill.id] ?? null); setShowPlay(!drill.diagram_play_id); } });
    return () => { on = false; };
  }, [drill.id, drill.linked_play_id]);

  if (drawing) {
    const back = () => {
      setDrawing(null);
      // The designer saves its last changes as it closes; pick them up.
      setTimeout(async () => {
        const pending = unattached.current;
        if (pending) {
          unattached.current = null;
          const { error } = await updatePracticeDrill(drill.id, { diagram_play_id: pending });
          if (error) {
            try { await deletePlay(pending); } catch { /* already gone */ }
            alert("The diagram couldn't be attached to this drill, so it wasn't kept: " + error);
            return;
          }
        }
        const fresh = await supabase.from("practice_drills_library").select("diagram_play_id").eq("id", drill.id).maybeSingle();
        const id = (fresh.data as { diagram_play_id: string | null } | null)?.diagram_play_id;
        if (!id) return;
        const got = await getDrillDiagrams([id]);
        if (got[id]) onDiagramChanged(drill.id, got[id]);
      }, 1200);
    };
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "var(--black, #0b1020)", overflowY: "auto", padding: 12 }}>
        <PlayEditor
          existingPlay={drawing.play}
          currentUserRole="coach"
          drill={{
            title: drill.title,
            onCreated: async (created) => {
              onDiagramChanged(drill.id, created);
              unattached.current = created.id;
              const { error } = await updatePracticeDrill(drill.id, { diagram_play_id: created.id });
              if (!error) { unattached.current = null; return; }
              // Tried once more as the designer closes.
              alert(/diagram_play_id/i.test(error) ? "Run SQL 214 in Supabase so diagrams can be attached to drills." : "Couldn't attach the diagram yet: " + error);
            },
          }}
          onSaved={back /* Save diagram saves and closes, back to the card */}
          onClose={back}
        />
      </div>
    );
  }

  const videoId = getYouTubeId(drill.video_url);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{drill.title}</div>
          <button onClick={onClose} style={smallBtn}>Close</button>
        </div>
        {/* With a linked play: tabs, or just the play when there's no diagram. */}
        {linkedPlay && (drill.diagram_play_id && diagram || canManage) && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <button onClick={() => setShowPlay(false)} style={tab(!showPlay)}>Drill diagram</button>
            <button onClick={() => setShowPlay(true)} style={tab(showPlay)}>🏀 Play: {linkedPlay.title}</button>
          </div>
        )}
        {linkedPlay && (showPlay || !(drill.diagram_play_id && diagram) && !canManage) ? (
          <div style={{ marginBottom: 10 }}>
            {!(drill.diagram_play_id && diagram) && !canManage && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🏀 Play: {linkedPlay.title}</div>}
            <DrillDiagram play={linkedPlay} />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Watch only — the play is changed in Plays by the coach who drew it.</div>
          </div>
        ) : drill.diagram_play_id && diagram ? (
          <div style={{ marginBottom: 10 }}>
            <DrillDiagram play={diagram} />
            {canManage && (
              <button onClick={() => setDrawing({ play: diagram })} style={{ ...smallBtn, marginTop: 8 }}>Edit diagram</button>
            )}
          </div>
        ) : canManage ? (
          <button onClick={() => setDrawing({})}
            style={{ width: "100%", padding: "22px 10px", marginBottom: 10, border: "1px dashed var(--border)", borderRadius: 8, background: "var(--surface2)", color: "var(--muted)", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
            + Draw diagram
          </button>
        ) : null}
        {videoId && (
          <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, marginBottom: 10, borderRadius: 8, overflow: "hidden" }}>
            <iframe src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`} title={drill.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
          </div>
        )}
        {drill.description && <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 10 }} dangerouslySetInnerHTML={{ __html: renderRichText(drill.description) }} />}
        {details}
        {(actions || canSend) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions}
          {canSend && <button onClick={() => setSending(v => !v)} style={smallBtn}>📨 Send to another team</button>}
        </div>}
        {sending && <SendPanel drillId={drill.id} title={drill.title} />}
        {footer}
      </div>
    </div>
  );
}

/**
 * Send this drill: tick teams at your school, or get a share code for a
 * coach at another school. They get their own copy (diagram, linked play
 * and all); yours never changes.
 */
function SendPanel({ drillId, title }: { drillId: string; title: string }) {
  const [targets, setTargets] = useState<SendTarget[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [code, setCode] = useState<ShareCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getSendTargets().then(setTargets);
    getShareStatus(drillId).then(setCode);
  }, [drillId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null); setNote(null);
    try { await fn(); } catch (e: any) { setErr(e?.message ?? "Couldn't do that."); }
    finally { setBusy(false); }
  }
  const send = () => run(async () => {
    const ids = [...picked];
    await sendDrill(drillId, ids);
    const names = (targets ?? []).filter(t => picked.has(t.id)).map(t => t.name).join(" and ");
    setNote(`Sent to ${names}. Their coaches will see it at the top of their Drill Library.`);
    setPicked(new Set());
  });
  const makeCode = () => run(async () => setCode(await getShareCode(drillId)));
  const stopCode = () => run(async () => { await revokeShareCode(drillId); setCode(null); setNote("Code turned off. Anyone who already added the drill keeps their copy."); });
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setNote(`${what} copied.`); } catch { setNote(text); }
  };

  const box: CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginTop: 10 };
  return (
    <div style={box}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Send "{title}"</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Teams at your school</div>
      {targets === null ? <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>
        : targets.length === 0 ? <div style={{ fontSize: 12, color: "var(--muted)" }}>No other teams at your school are on Winning Wall yet.</div>
        : <>
          {targets.map(t => (
            <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(t.id)}
                onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} />
              {t.name}
            </label>
          ))}
          <button onClick={send} disabled={busy || picked.size === 0} style={{ ...smallBtn, marginTop: 6, opacity: picked.size ? 1 : 0.5 }}>Send</button>
        </>}
      <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0 8px" }} />
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>A coach at another school</div>
      {code ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>{code.code}</span>
            <button onClick={() => copy(code.code, "Code")} style={smallBtn}>Copy code</button>
            <button onClick={() => copy(shareLink(code.code), "Link")} style={smallBtn}>Copy link</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            Good until {new Date(code.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Anyone with the code can add a copy of this drill until then.{" "}
            <button onClick={stopCode} disabled={busy} style={{ ...smallBtn, padding: "2px 8px" }}>Turn off now</button>
          </div>
        </div>
      ) : (
        <button onClick={makeCode} disabled={busy} style={smallBtn}>Get a share code</button>
      )}
      {note && <div style={{ fontSize: 12, color: "var(--success-text)", marginTop: 8, wordBreak: "break-all" }}>{note}</div>}
      {err && <div style={{ fontSize: 12, color: "var(--danger-text, #f08)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}

const overlayStyle: CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalStyle: CSSProperties = { background: "var(--surface)", borderRadius: 16, width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 20 };
const tab = (on: boolean): CSSProperties => ({
  background: on ? "var(--royal)" : "var(--surface2)", border: "1px solid " + (on ? "var(--royal)" : "var(--border)"),
  color: on ? "#fff" : "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
});
const smallBtn: CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
