// src/components/gameday/GameDaySheetsList.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { GameDaySheet, getGameDaySheets, createGameDaySheet, renameGameDaySheet, deleteGameDaySheet, duplicateGameDaySheet, gameDaySheetToExportPayload, importGameDaySheetFromExportPayload, GAMEDAY_SHEET_EXPORT_SCHEMA_VERSION } from "../../lib/gameDaySheets";
import { embedJsonInPdf, extractJsonFromPdf, drawTextDocument } from "../../lib/pdfDataExport";
import { GAMEDAY_SECTIONS } from "../../lib/gameDaySheets";
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
  const importFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => { setSheets(await getGameDaySheets()); }, []);
  useEffect(() => { load().catch(console.error); }, [load]);

  async function handleExportSheet(sheetId: string) {
    setError(null);
    try {
      const payload = await gameDaySheetToExportPayload(sheetId);
      const sections = GAMEDAY_SECTIONS.map(s => ({
        heading: s.label,
        lines: payload.calls.filter((c: any) => c.section === s.key).map((c: any) => c.call_name),
      })).filter(s => s.lines.length > 0);
      const doc = await drawTextDocument(payload.name, "Winning Wall — re-importable game day sheet export", sections);
      const withData = await embedJsonInPdf(doc, { dataType: "gameday_sheet", schemaVersion: GAMEDAY_SHEET_EXPORT_SCHEMA_VERSION, data: payload });
      const blob = new Blob([withData as BlobPart], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${payload.name.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
      a.click();
    } catch (e: any) {
      setError("Export failed: " + e.message);
    }
  }

  async function handleImportFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const payload = await extractJsonFromPdf(file);
      if (!payload) { setError("This PDF doesn't contain game day sheet data."); return; }
      if (payload.dataType !== "gameday_sheet") { setError(`This file contains a ${payload.dataType.replace("_", " ")}, not a game day sheet.`); return; }
      await importGameDaySheetFromExportPayload(payload.data);
      await load();
    } catch (e: any) {
      setError("Import failed: " + e.message);
    }
  }

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

      <input ref={importFileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleImportFileChosen} />
      <button type="button" onClick={() => importFileRef.current?.click()} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginBottom: 16 }}>📥 Import game day sheet from PDF</button>

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
                <button type="button" onClick={() => handleExportSheet(s.id)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>💾</button>
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
