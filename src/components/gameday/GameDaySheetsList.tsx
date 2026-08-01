// src/components/gameday/GameDaySheetsList.tsx
import { useState, useEffect, useCallback } from "react";
import { GameDaySheet, getGameDaySheets, createGameDaySheet, renameGameDaySheet, deleteGameDaySheet, duplicateGameDaySheet } from "../../lib/gameDaySheets";
import { inputStyle } from "../../lib/inputStyle";
import GameDaySheetEditor from "./GameDaySheetEditor";

export default function GameDaySheetsList() {
  const [sheets, setSheets] = useState<GameDaySheet[]>([]);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [duplicatingFromId, setDuplicatingFromId] = useState<string | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { setSheets(await getGameDaySheets()); }, []);
  useEffect(() => { load().catch(console.error); }, [load]);

  async function addSheet() {
    if (!newName.trim()) return;
    setError(null);
    try {
      const s = await createGameDaySheet(newName.trim());
      setNewName("");
      await load();
      setOpenSheetId(s.id);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't create sheet — try again.");
    }
  }

  async function saveRename(id: string) {
    if (!renameValue.trim()) return;
    await renameGameDaySheet(id, renameValue.trim());
    setRenamingId(null);
    load();
  }

  async function confirmDelete(id: string) {
    await deleteGameDaySheet(id);
    setConfirmDeleteId(null);
    load();
  }

  async function confirmDuplicate() {
    if (!duplicatingFromId || !duplicateName.trim()) return;
    setError(null);
    try {
      const s = await duplicateGameDaySheet(duplicatingFromId, duplicateName.trim());
      setDuplicatingFromId(null);
      setDuplicateName("");
      await load();
      setOpenSheetId(s.id);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't duplicate sheet — try again.");
    }
  }

  if (openSheetId) {
    return <GameDaySheetEditor sheetId={openSheetId} onClose={() => { setOpenSheetId(null); load(); }} />;
  }

  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
      {error && <div className="error-msg">{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New sheet name (e.g. 2026–27 Varsity)"
          onKeyDown={e => { if (e.key === "Enter") addSheet(); }} style={{ ...inputStyle, flex: 1 }} />
        <button type="button" onClick={addSheet} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "0 16px", fontWeight: 600, cursor: "pointer" }}>Create</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sheets.map(s => (
          <div key={s.id} style={{ background: "var(--surface2)", borderRadius: 10, padding: "10px 12px" }}>
            {renamingId === s.id ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={renameValue} onChange={e => setRenameValue(e.target.value)} style={{ ...inputStyle, flex: 1 }}
                  onKeyDown={e => { if (e.key === "Enter") saveRename(s.id); if (e.key === "Escape") setRenamingId(null); }} autoFocus />
                <button type="button" onClick={() => saveRename(s.id)} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "0 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Save</button>
                <button type="button" onClick={() => setRenamingId(null)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "0 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : duplicatingFromId === s.id ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input value={duplicateName} onChange={e => setDuplicateName(e.target.value)} placeholder="Name for the new copy"
                  style={{ ...inputStyle, flex: 1 }} onKeyDown={e => { if (e.key === "Enter") confirmDuplicate(); if (e.key === "Escape") setDuplicatingFromId(null); }} autoFocus />
                <button type="button" onClick={confirmDuplicate} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "0 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Duplicate</button>
                <button type="button" onClick={() => setDuplicatingFromId(null)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "0 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : confirmDeleteId === s.id ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#ff7b7b", flex: 1 }}>Delete "{s.name}"? This can't be undone.</span>
                <button type="button" onClick={() => confirmDelete(s.id)} style={{ background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.3)", color: "#ff7b7b", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                <button type="button" onClick={() => setConfirmDeleteId(null)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span onClick={() => setOpenSheetId(s.id)} style={{ flex: 1, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{s.name}</span>
                <button type="button" onClick={() => { setRenameValue(s.name); setRenamingId(s.id); }} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>✏️</button>
                <button type="button" onClick={() => { setDuplicateName(`${s.name} (copy)`); setDuplicatingFromId(s.id); }} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>⎘ Duplicate</button>
                <button type="button" onClick={() => setConfirmDeleteId(s.id)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>🗑</button>
              </div>
            )}
          </div>
        ))}
        {sheets.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>No game day sheets yet — create one above to get started.</div>}
      </div>
    </div>
  );
}
