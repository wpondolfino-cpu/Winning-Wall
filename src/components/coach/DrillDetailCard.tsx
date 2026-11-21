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

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getYouTubeId } from "../../lib/youtube";
import { renderRichText } from "../../lib/richtext";
import { supabase } from "../../lib/supabase";
import { updatePracticeDrill, type PracticeDrillLibraryDrill } from "../../lib/practicePlanner";
import { getDrillDiagrams, deletePlay, type Play } from "../../lib/plays";
import DrillDiagram from "../plays/DrillDiagram";
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
  /** Anything below the buttons. */
  footer?: ReactNode;
}

export default function DrillDetailCard({ drill, diagram, canManage, onClose, onDiagramChanged, details, actions, footer }: Props) {
  const [drawing, setDrawing] = useState<{ play?: Play } | null>(null);
  // A new diagram not yet attached to its drill. If it still can't be
  // attached when the designer closes, it's removed rather than left saved
  // where nobody can ever see it.
  const unattached = useRef<string | null>(null);

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
        {/* The drill's diagram, or a spot to draw one. */}
        {drill.diagram_play_id && diagram ? (
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
        {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
        {footer}
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const modalStyle: CSSProperties = { background: "var(--surface)", borderRadius: 16, width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 20 };
const smallBtn: CSSProperties = {
  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6,
  padding: "5px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
};
