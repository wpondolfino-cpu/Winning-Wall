// src/components/plays/TemplateEditorModal.tsx
// Opened from the pencil icon on a template card — lets you rename it
// and/or move, add, or delete whatever's drawn on it, then Save. Reuses
// PlayCanvas as the editing surface, restricted to just the Player (or
// Defender, for a defense template) tool plus Move and Erase, since a
// template is positions-only — no actions, no ball, nothing else.

import { useState } from "react";
import { Formation, PlayPlayer, PlayDefender, PlayFrame, genPlayerId, updateFormation } from "../../lib/plays";
import PlayCanvas from "./PlayCanvas";

interface Props {
  formation: Formation;
  onClose: () => void;
  onSaved: (updated: Formation) => void;
}

type Tool = "player" | "defender" | "move" | "erase" | null;

export default function TemplateEditorModal({ formation, onClose, onSaved }: Props) {
  const isPlayerBased = formation.side !== "defense";
  const [name, setName] = useState(formation.name);
  const [players, setPlayers] = useState<PlayPlayer[]>(formation.data.players ?? []);
  const [defenders, setDefenders] = useState<PlayDefender[]>(formation.data.defenders ?? []);
  const [tool, setTool] = useState<Tool>(isPlayerBased ? "player" : "defender");
  const [saving, setSaving] = useState(false);

  const frame: PlayFrame = { players, defenders, ball: null, actions: [], drawings: [] };

  function nearestIndex<T extends { x: number; y: number }>(list: T[], x: number, y: number, radius = 22): number {
    let best = -1, bestDist = radius;
    list.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function handleErase(x: number, y: number) {
    if (isPlayerBased) {
      const idx = nearestIndex(players, x, y);
      if (idx >= 0) setPlayers((p) => p.filter((_, i) => i !== idx));
    } else {
      const idx = nearestIndex(defenders, x, y);
      if (idx >= 0) setDefenders((d) => d.filter((_, i) => i !== idx));
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const data = isPlayerBased ? { players } : { defenders };
    try {
      await updateFormation(formation.id, { name: name.trim(), data });
      onSaved({ ...formation, name: name.trim(), data });
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(500px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1 }}>Edit template</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name"
          style={{ width: "100%", marginBottom: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />

        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {isPlayerBased ? (
            <button onClick={() => setTool("player")} style={{ flex: 1, padding: "7px 6px", fontSize: 12, border: tool === "player" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6 }}>+ Player</button>
          ) : (
            <button onClick={() => setTool("defender")} style={{ flex: 1, padding: "7px 6px", fontSize: 12, border: tool === "defender" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6 }}>+ Defender</button>
          )}
          <button onClick={() => setTool("move")} style={{ flex: 1, padding: "7px 6px", fontSize: 12, border: tool === "move" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6 }}>Move</button>
          <button onClick={() => setTool("erase")} style={{ flex: 1, padding: "7px 6px", fontSize: 12, border: tool === "erase" ? "1.5px solid var(--gold)" : "1px solid var(--border)", borderRadius: 6 }}>⌫ Erase</button>
        </div>

        <div style={{ background: "var(--surface2)", borderRadius: 10, padding: 8, marginBottom: 14 }}>
          <PlayCanvas
            frame={frame}
            courtTemplate="half"
            edit
            tool={tool}
            onAddPlayer={(p) => setPlayers((list) => [...list, { ...p, id: p.id ?? genPlayerId() }])}
            onAddDefender={(x, y) => setDefenders((list) => [...list, { x, y }])}
            onMovePlayer={(idx, x, y) => setPlayers((list) => list.map((p, i) => (i === idx ? { ...p, x, y } : p)))}
            onMoveDefender={(idx, x, y) => setDefenders((list) => list.map((d, i) => (i === idx ? { x, y } : d)))}
            onErase={handleErase}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px 12px" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="coach-add-btn" style={{ flex: 1, justifyContent: "center" }}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
