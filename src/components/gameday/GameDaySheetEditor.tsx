// src/components/gameday/GameDaySheetEditor.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import {
  GameDaySheet, GameDayCall, GameDaySection, GAMEDAY_SECTIONS,
  getGameDaySheet, getGameDayCalls, createGameDayCall, updateGameDayCall, deleteGameDayCall, deleteGameDayCalls, reorderGameDayCalls,
  bulkCreateGameDayCalls,
} from "../../lib/gameDaySheets";
import { getMyPlays, Play } from "../../lib/plays";
import { inputStyle } from "../../lib/inputStyle";
import GameDaySheetPrintView from "./GameDaySheetPrintView";

interface Props {
  sheetId: string;
  onClose: () => void;
}

type UndoAction = { label: string; run: () => Promise<void> };

export default function GameDaySheetEditor({ sheetId, onClose }: Props) {
  const [sheet, setSheet] = useState<GameDaySheet | null>(null);
  const [calls, setCalls] = useState<GameDayCall[]>([]);
  const [myPlays, setMyPlays] = useState<Play[]>([]);
  const [addingSection, setAddingSection] = useState<GameDaySection | null>(null);
  const [addName, setAddName] = useState("");
  const [addPlayId, setAddPlayId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPlayId, setEditPlayId] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [importingSection, setImportingSection] = useState<GameDaySection | null>(null);
  const [importMode, setImportMode] = useState<"paste" | "plays">("paste");
  const [pasteText, setPasteText] = useState("");
  const [selectedPlayIds, setSelectedPlayIds] = useState<string[]>([]);
  const undoStack = useRef<UndoAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  const load = useCallback(async () => {
    const [s, c, p] = await Promise.all([getGameDaySheet(sheetId), getGameDayCalls(sheetId), getMyPlays()]);
    setSheet(s);
    setCalls(c);
    setMyPlays(p);
  }, [sheetId]);

  useEffect(() => { load().catch(console.error); }, [load]);

  function pushUndo(action: UndoAction) {
    undoStack.current.push(action);
    if (undoStack.current.length > 20) undoStack.current.shift();
    setCanUndo(true);
  }

  async function handleUndo() {
    const action = undoStack.current.pop();
    setCanUndo(undoStack.current.length > 0);
    if (!action) return;
    await action.run();
    load();
  }

  function callsFor(section: GameDaySection): GameDayCall[] {
    return calls.filter(c => c.section === section);
  }

  async function submitAdd(section: GameDaySection) {
    if (!addName.trim()) return;
    const sectionCalls = callsFor(section);
    const nextOrder = sectionCalls.length ? Math.max(...sectionCalls.map(c => c.sort_order)) + 1 : 0;
    const created = await createGameDayCall(sheetId, section, addName.trim(), addPlayId || null, nextOrder);
    pushUndo({ label: `Add "${created.call_name}"`, run: async () => { await deleteGameDayCall(created.id); } });
    setAddName("");
    setAddPlayId("");
    setAddingSection(null);
    load();
  }

  function openImport(section: GameDaySection) {
    setImportingSection(section);
    setImportMode("paste");
    setPasteText("");
    setSelectedPlayIds([]);
  }

  async function submitPasteImport(section: GameDaySection) {
    const lines = pasteText.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const sectionCalls = callsFor(section);
    const nextOrder = sectionCalls.length ? Math.max(...sectionCalls.map(c => c.sort_order)) + 1 : 0;
    const created = await bulkCreateGameDayCalls(sheetId, section, lines.map(callName => ({ callName })), nextOrder);
    pushUndo({ label: `Import ${created.length} calls`, run: async () => { await deleteGameDayCalls(created.map(c => c.id)); } });
    setImportingSection(null);
    load();
  }

  async function submitPlaysImport(section: GameDaySection) {
    if (!selectedPlayIds.length) return;
    const chosen = myPlays.filter(p => selectedPlayIds.includes(p.id));
    const sectionCalls = callsFor(section);
    const nextOrder = sectionCalls.length ? Math.max(...sectionCalls.map(c => c.sort_order)) + 1 : 0;
    const created = await bulkCreateGameDayCalls(sheetId, section, chosen.map(p => ({ callName: p.title, playId: p.id })), nextOrder);
    pushUndo({ label: `Import ${created.length} calls`, run: async () => { await deleteGameDayCalls(created.map(c => c.id)); } });
    setImportingSection(null);
    load();
  }

  function togglePlaySelection(id: string) {
    setSelectedPlayIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function startEdit(c: GameDayCall) {
    setEditingId(c.id);
    setEditName(c.call_name);
    setEditPlayId(c.play_id ?? "");
  }

  async function submitEdit(c: GameDayCall) {
    if (!editName.trim()) return;
    const prevName = c.call_name;
    const prevPlayId = c.play_id;
    await updateGameDayCall(c.id, { call_name: editName.trim(), play_id: editPlayId || null });
    pushUndo({ label: `Edit "${prevName}"`, run: async () => { await updateGameDayCall(c.id, { call_name: prevName, play_id: prevPlayId }); } });
    setEditingId(null);
    load();
  }

  async function confirmDelete(c: GameDayCall) {
    await deleteGameDayCall(c.id);
    pushUndo({ label: `Delete "${c.call_name}"`, run: async () => { await createGameDayCall(c.sheet_id, c.section, c.call_name, c.play_id, c.sort_order); } });
    setConfirmDeleteId(null);
    load();
  }

  async function handleDrop(section: GameDaySection, targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const sectionCalls = callsFor(section);
    const prevOrder = sectionCalls.map(c => c.id);
    const withoutDragged = sectionCalls.filter(c => c.id !== dragId);
    const targetIdx = withoutDragged.findIndex(c => c.id === targetId);
    const reordered = [...withoutDragged.slice(0, targetIdx), sectionCalls.find(c => c.id === dragId)!, ...withoutDragged.slice(targetIdx)];
    const newOrder = reordered.map(c => c.id);
    setDragId(null);
    await reorderGameDayCalls(newOrder);
    pushUndo({ label: "Reorder", run: async () => { await reorderGameDayCalls(prevOrder); } });
    load();
  }

  function renderCallRow(c: GameDayCall) {
    if (editingId === c.id) {
      return (
        <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0" }}>
          <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...inputStyle, fontSize: 12, padding: "4px 6px" }}
            onKeyDown={e => { if (e.key === "Enter") submitEdit(c); if (e.key === "Escape") setEditingId(null); }} autoFocus />
          <select value={editPlayId} onChange={e => setEditPlayId(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "4px 6px" }}>
            <option value="">— No play link —</option>
            {myPlays.map(pl => <option key={pl.id} value={pl.id}>{pl.title}</option>)}
          </select>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => submitEdit(c)} style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 6, padding: "3px 0", fontSize: 11, cursor: "pointer" }}>Save</button>
            <button type="button" onClick={() => setEditingId(null)} style={{ flex: 1, background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 0", fontSize: 11, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      );
    }
    if (confirmDeleteId === c.id) {
      return (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 11 }}>
          <span style={{ color: "#ff7b7b", flex: 1 }}>Delete "{c.call_name}"?</span>
          <button type="button" onClick={() => confirmDelete(c)} style={{ background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 5, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}>Delete</button>
          <button type="button" onClick={() => setConfirmDeleteId(null)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 5, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}>Cancel</button>
        </div>
      );
    }
    return (
      <div key={c.id} draggable
        onDragStart={() => setDragId(c.id)}
        onDragOver={e => e.preventDefault()}
        onDrop={() => handleDrop(c.section, c.id)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 12, cursor: "grab", opacity: dragId === c.id ? 0.4 : 1 }}>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>⠿</span>
        <span style={{ flex: 1 }}>{c.call_name}{c.play_id && " 🏀"}</span>
        <span onClick={() => startEdit(c)} style={{ cursor: "pointer", fontSize: 11, color: "var(--muted)" }}>✏️</span>
        <span onClick={() => setConfirmDeleteId(c.id)} style={{ cursor: "pointer", fontSize: 11, color: "var(--muted)" }}>🗑</span>
      </div>
    );
  }

  function renderSection(section: GameDaySection, label: string) {
    const sectionCalls = callsFor(section);
    return (
      <div key={section} style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 12, margin: "6px 0 3px" }}>{label}</div>
        {sectionCalls.map(renderCallRow)}
        {addingSection === section ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, padding: 6, background: "var(--surface2)", borderRadius: 6 }}>
            <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Call name" autoFocus
              style={{ ...inputStyle, fontSize: 12, padding: "4px 6px" }} onKeyDown={e => { if (e.key === "Enter") submitAdd(section); if (e.key === "Escape") setAddingSection(null); }} />
            <select value={addPlayId} onChange={e => setAddPlayId(e.target.value)} style={{ ...inputStyle, fontSize: 11, padding: "4px 6px" }}>
              <option value="">— Link a play (optional) —</option>
              {myPlays.map(pl => <option key={pl.id} value={pl.id}>{pl.title}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={() => submitAdd(section)} style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 6, padding: "3px 0", fontSize: 11, cursor: "pointer" }}>Add</button>
              <button type="button" onClick={() => setAddingSection(null)} style={{ flex: 1, background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 0", fontSize: 11, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        ) : importingSection === section ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4, padding: 8, background: "var(--surface2)", borderRadius: 6 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={() => setImportMode("paste")}
                style={{ flex: 1, background: importMode === "paste" ? "var(--royal)" : "var(--surface1)", color: importMode === "paste" ? "#fff" : "var(--muted)", border: "none", borderRadius: 6, padding: "4px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Paste list</button>
              <button type="button" onClick={() => setImportMode("plays")}
                style={{ flex: 1, background: importMode === "plays" ? "var(--royal)" : "var(--surface1)", color: importMode === "plays" ? "#fff" : "var(--muted)", border: "none", borderRadius: 6, padding: "4px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>From plays</button>
            </div>

            {importMode === "paste" ? (
              <>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={"One call per line, e.g.\n12 – Stagger\n24 – Sneaky"}
                  style={{ ...inputStyle, fontSize: 12, minHeight: 70 }} />
                <button type="button" onClick={() => submitPasteImport(section)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Import {pasteText.split("\n").map(l => l.trim()).filter(Boolean).length || ""} calls
                </button>
              </>
            ) : (
              <>
                <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  {myPlays.map(pl => (
                    <label key={pl.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedPlayIds.includes(pl.id)} onChange={() => togglePlaySelection(pl.id)} />
                      {pl.title}
                    </label>
                  ))}
                  {myPlays.length === 0 && <div style={{ color: "var(--muted)", fontSize: 11 }}>No saved plays yet.</div>}
                </div>
                <button type="button" onClick={() => submitPlaysImport(section)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Import {selectedPlayIds.length || ""} calls
                </button>
              </>
            )}
            <button type="button" onClick={() => setImportingSection(null)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 0", fontSize: 11, cursor: "pointer" }}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <span onClick={() => { setAddingSection(section); setAddName(""); setAddPlayId(""); }}
              style={{ cursor: "pointer", fontSize: 12, color: "var(--royal-light)", border: "1px dashed var(--border)", borderRadius: 6, padding: "3px 10px" }}>
              + Add
            </span>
            <span onClick={() => openImport(section)}
              style={{ cursor: "pointer", fontSize: 12, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 6, padding: "3px 10px" }}>
              ⬆ Import
            </span>
          </div>
        )}
      </div>
    );
  }

  if (!sheet) return <div style={{ padding: 24 }}>Loading…</div>;

  if (showPrint) {
    return (
      <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button type="button" onClick={() => setShowPrint(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>← Back to editor</button>
        </div>
        <GameDaySheetPrintView sheet={sheet} calls={calls} />
      </div>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>← All sheets</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {canUndo && (
            <button type="button" onClick={handleUndo} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>↶ Undo</button>
          )}
          <button type="button" onClick={() => setShowPrint(true)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🖨️ Print view</button>
          <strong style={{ fontSize: 16 }}>{sheet.name}</strong>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div>
          <div style={{ background: "rgba(26,63,168,0.1)", color: "#93b4ff", fontWeight: 700, padding: "5px 10px", borderRadius: 6, marginBottom: 4 }}>OFFENSE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 14px" }}>
            {GAMEDAY_SECTIONS.filter(s => s.group === "offense").map(s => renderSection(s.key, s.label))}
          </div>

          <div style={{ background: "rgba(99,153,34,0.12)", color: "#a3d060", fontWeight: 700, padding: "5px 10px", borderRadius: 6, margin: "14px 0 4px" }}>BLOBS &amp; SLOBS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
            {GAMEDAY_SECTIONS.filter(s => s.group === "blobsSlobs").map(s => renderSection(s.key, s.label))}
          </div>
        </div>

        <div>
          <div style={{ background: "rgba(226,75,74,0.12)", color: "#ff9b9b", fontWeight: 700, padding: "5px 10px", borderRadius: 6, marginBottom: 4 }}>DEFENSE</div>
          {GAMEDAY_SECTIONS.filter(s => s.group === "defense").map(s => renderSection(s.key, s.label))}

          <div style={{ background: "rgba(240,192,64,0.12)", color: "var(--gold)", fontWeight: 700, padding: "5px 10px", borderRadius: 6, margin: "14px 0 4px" }}>SPECIALS</div>
          {GAMEDAY_SECTIONS.filter(s => s.group === "specials").map(s => renderSection(s.key, s.label))}
        </div>
      </div>
    </div>
  );
}
