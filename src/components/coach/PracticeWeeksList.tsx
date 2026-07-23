// src/components/coach/PracticeWeeksList.tsx
// The home screen for practices: a stack of collapsible week groups,
// newest on top / oldest on bottom (same accordion pattern as
// LiftingPrograms.tsx's ProgramWeekGroup), each showing its practices
// with a live "needs attention" badge and a click-through into
// PracticeBuilder.

import { useState, useEffect, useCallback } from "react";
import {
  PracticeWeek, Practice, getPracticeWeeks, getPracticesInWeek,
  getPracticeAttentionCount, suggestNextWeekName, renamePracticeWeek,
  deletePracticeWeek, deletePractice,
} from "../../lib/practicePlanner";
import PracticeBuilder from "./PracticeBuilder";
import PracticePrintView from "./PracticePrintView";

interface WeekRowState {
  week: PracticeWeek;
  practices: Practice[];
  attention: Record<string, number>; // practice_id -> flagged group count
}

export default function PracticeWeeksList() {
  const [rows, setRows]         = useState<WeekRowState[]>([]);
  const [loading, setLoading]   = useState(true);
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
  const [openPracticeId, setOpenPracticeId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [selectedForPrint, setSelectedForPrint] = useState<Set<string>>(new Set());
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const [editingWeekId, setEditingWeekId] = useState<string | null>(null);
  const [editingWeekName, setEditingWeekName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const weeks = await getPracticeWeeks(); // newest first, per the lib helper
    const rowData = await Promise.all(weeks.map(async w => {
      const practices = await getPracticesInWeek(w.id);
      const attentionEntries = await Promise.all(practices.map(async p => [p.id, await getPracticeAttentionCount(p.id)] as const));
      return { week: w, practices, attention: Object.fromEntries(attentionEntries) };
    }));
    setRows(rowData);
    if (rowData.length > 0 && openWeekId === null) setOpenWeekId(rowData[0].week.id);
    setLoading(false);
  }, [openWeekId]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function formatDate(d: string) {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function toggleSelectForPrint(id: string) {
    setSelectedForPrint(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function startEditWeek(week: PracticeWeek, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingWeekId(week.id);
    setEditingWeekName(week.name);
  }

  async function saveWeekRename() {
    if (!editingWeekId || !editingWeekName.trim()) return;
    await renamePracticeWeek(editingWeekId, editingWeekName);
    setEditingWeekId(null);
    await load();
  }

  async function handleDeleteWeek(week: PracticeWeek, practiceCount: number, e: React.MouseEvent) {
    e.stopPropagation();
    const warning = practiceCount > 0
      ? ` ${practiceCount} practice${practiceCount === 1 ? "" : "s"} in it will NOT be deleted — they'll just show as having no week.`
      : "";
    if (!window.confirm(`Delete "${week.name}"?${warning}`)) return;
    await deletePracticeWeek(week.id);
    await load();
  }

  async function handleDeletePractice(practiceId: string, dateLabel: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete the ${dateLabel} practice? This can't be undone.`)) return;
    await deletePractice(practiceId);
    await load();
  }

  if (printIds) {
    return <PracticePrintView practiceIds={printIds} onClose={() => setPrintIds(null)} />;
  }

  if (openPracticeId || creatingNew) {
    return (
      <PracticeBuilder
        practiceId={openPracticeId ?? undefined}
        onClose={() => { setOpenPracticeId(null); setCreatingNew(false); }}
        onSaved={() => { load(); }}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1 }}>Practices</div>
        <div style={{ display: "flex", gap: 8 }}>
          {selectedForPrint.size > 0 && (
            <button onClick={() => setPrintIds(Array.from(selectedForPrint))} style={secondaryBtn}>
              🖨️ Print Selected ({selectedForPrint.size})
            </button>
          )}
          <button onClick={() => setCreatingNew(true)} style={primaryBtn}>+ New practice</button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>No practice weeks yet — create your first practice above to get started.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map(({ week, practices, attention }) => {
            const open = openWeekId === week.id;
            const totalFlags = Object.values(attention).reduce((a, b) => a + b, 0);
            return (
              <div key={week.id} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div onClick={() => setOpenWeekId(open ? null : week.id)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: open ? "rgba(26,63,168,0.06)" : "var(--surface2)", userSelect: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    {editingWeekId === week.id ? (
                      <input
                        autoFocus
                        value={editingWeekName}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setEditingWeekName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveWeekRename(); if (e.key === "Escape") setEditingWeekId(null); }}
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", color: "var(--text)", fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}
                      />
                    ) : (
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{week.name}</div>
                    )}
                    {totalFlags > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: "rgba(240,192,64,0.15)", color: "var(--gold)" }}>
                        ⚠ {totalFlags} group{totalFlags === 1 ? "" : "s"} need attention
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{practices.length} practice{practices.length === 1 ? "" : "s"}</span>
                    {editingWeekId === week.id ? (
                      <>
                        <button onClick={e => { e.stopPropagation(); saveWeekRename(); }} style={iconBtn} title="Save">✔️</button>
                        <button onClick={e => { e.stopPropagation(); setEditingWeekId(null); }} style={iconBtn} title="Cancel">✕</button>
                      </>
                    ) : (
                      <>
                        <button onClick={e => startEditWeek(week, e)} style={iconBtn} title="Rename week">✎</button>
                        <button onClick={e => handleDeleteWeek(week, practices.length, e)} style={iconBtn} title="Delete week">🗑️</button>
                      </>
                    )}
                    <span style={{ fontSize: 14, color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
                  </div>
                </div>
                {open && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {practices.map(p => {
                      const flags = attention[p.id] ?? 0;
                      return (
                        <div key={p.id} onClick={() => setOpenPracticeId(p.id)}
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--surface2)", borderRadius: 8, cursor: "pointer", border: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input type="checkbox" checked={selectedForPrint.has(p.id)}
                              onClick={e => e.stopPropagation()}
                              onChange={() => toggleSelectForPrint(p.id)} />
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(p.practice_date)} @ {p.start_time.slice(0, 5)}</div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button onClick={e => { e.stopPropagation(); setPrintIds([p.id]); }} style={iconBtn} title="Print this practice">🖨️</button>
                            <button onClick={e => handleDeletePractice(p.id, formatDate(p.practice_date), e)} style={iconBtn} title="Delete this practice">🗑️</button>
                            {flags > 0 && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "rgba(240,192,64,0.15)", color: "var(--gold)" }}>⚠ {flags}</span>
                            )}
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
                              background: p.status === "published" ? "rgba(40,180,80,0.15)" : "rgba(240,192,64,0.12)",
                              color: p.status === "published" ? "#5de098" : "var(--gold)",
                            }}>{p.status === "published" ? "Published" : "Draft"}</span>
                          </div>
                        </div>
                      );
                    })}
                    {practices.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>No practices in this week yet.</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
  padding: "8px 16px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
};
const iconBtn: React.CSSProperties = {
  background: "none", border: "none", fontSize: 14, cursor: "pointer", padding: "2px 4px",
};
