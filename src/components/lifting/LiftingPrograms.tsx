// src/components/lifting/LiftingPrograms.tsx
import { useState } from "react";
import { LiftingProgram, LiftingDay, DayExercise, BankExercise, archiveProgram, restoreProgram, getLogsForExercises } from "./lifting";
import LiftingDayCard from "./LiftingDay";
import LiftingResults from "./LiftingResults";
import ProgramComplete from "./ProgramComplete";
import EditDayModal from "./EditDayModal";

interface Props {
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  canManage: boolean;
  programs: LiftingProgram[];
  archivedPrograms: LiftingProgram[];
  days: Record<string, LiftingDay[]>;
  dayExercises: Record<string, (DayExercise & { exercise: BankExercise })[]>;
  allPlayerLogs: any[]; // all this player's logs
  onEdit: (prog: LiftingProgram) => void;
  onNewProgram: (personal?: boolean) => void;
  onRefresh: () => void;
}

// ── ProgramWeekGroup ──────────────────────────────────────────
function ProgramWeekGroup({ label, days, dayExercises, programLogs, playerId, playerName, avatarUrl, currentDayNum, canManage, onRefresh, onEditDay, defaultOpen }: {
  label: string;
  days: LiftingDay[];
  dayExercises: Record<string, (DayExercise & { exercise: BankExercise })[]>;
  programLogs: any[];
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  currentDayNum: number | null;
  canManage: boolean;
  onRefresh: () => void;
  onEditDay: (day: LiftingDay) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isSpecial = days.length === 1 && !/week\s*\d+/i.test(label);
  const activeDays = days.filter(d => !d.is_rest_day).length;
  const hasToday = days.some(d => d.day_number === currentDayNum);

  if (isSpecial) {
    const day = days[0];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {canManage && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => onEditDay(day)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit Day</button>
          </div>
        )}
        <LiftingDayCard day={day} exercises={dayExercises[day.id] ?? []} logs={programLogs.filter((l: any) => (dayExercises[day.id] ?? []).some(de => de.exercise?.id === l.exercise_id))} playerId={playerId} playerName={playerName} avatarUrl={avatarUrl} isToday={currentDayNum === day.day_number} canManage={canManage} onLogged={onRefresh} />
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${hasToday ? "rgba(26,63,168,0.5)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: hasToday ? "rgba(26,63,168,0.15)" : open ? "rgba(26,63,168,0.06)" : "var(--surface2)", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: hasToday ? "#93b4ff" : "var(--text)" }}>{label}</div>
          {hasToday && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: "var(--royal)", color: "#fff" }}>TODAY</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{activeDays} training · {days.length - activeDays} rest</span>
          <span style={{ fontSize: 14, color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {days.map(day => (
            <div key={day.id}>
              {canManage && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                  <button onClick={() => onEditDay(day)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>✏️ Edit Day</button>
                </div>
              )}
              <LiftingDayCard day={day} exercises={dayExercises[day.id] ?? []} logs={programLogs.filter((l: any) => (dayExercises[day.id] ?? []).some(de => de.exercise?.id === l.exercise_id))} playerId={playerId} playerName={playerName} avatarUrl={avatarUrl} isToday={currentDayNum === day.day_number} canManage={canManage} onLogged={onRefresh} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LiftingPrograms({
  playerId, playerName, avatarUrl, canManage,
  programs, archivedPrograms, days, dayExercises, allPlayerLogs,
  onEdit, onNewProgram, onRefresh,
}: Props) {
  const [expandedProgram, setExpandedProgram] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [resultsProgram, setResultsProgram] = useState<LiftingProgram | null>(null);
  const [programLogs, setProgramLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [editingDay, setEditingDay] = useState<LiftingDay | null>(null);

  const coachPrograms = programs.filter(p => p.visibility !== "personal");
  const personalPrograms = programs.filter(p => p.visibility === "personal" && p.created_by === playerId);

  async function handleExpand(progId: string) {
    if (expandedProgram === progId) { setExpandedProgram(null); return; }
    setExpandedProgram(progId);
    // Load logs for all exercises in this program
    const progDays = days[progId] ?? [];
    const bankIds: string[] = [];
    progDays.forEach(d => (dayExercises[d.id] ?? []).forEach(de => { if (de.exercise?.id) bankIds.push(de.exercise.id); }));
    if (bankIds.length > 0) {
      setLogsLoading(true);
      const logs = await getLogsForExercises(playerId, bankIds);
      setProgramLogs(logs);
      setLogsLoading(false);
    }
  }

  async function handleArchive(prog: LiftingProgram) {
    if (!window.confirm(`Archive "${prog.title}"?\n\nAll logs are preserved. You can restore it anytime.`)) return;
    setArchiving(prog.id);
    try { await archiveProgram(prog.id); onRefresh(); } finally { setArchiving(null); }
  }

  async function handleRestore(prog: LiftingProgram) {
    setArchiving(prog.id);
    try { await restoreProgram(prog.id); onRefresh(); } finally { setArchiving(null); }
  }

  function getCurrentDayNumber(prog: LiftingProgram): number | null {
    if (!prog.start_date) return null;
    const start = new Date(prog.start_date);
    const today = new Date();
    const diff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const progDays = days[prog.id] ?? [];
    if (progDays.length === 0) return null;
    return (diff % progDays.length) + 1;
  }

  function isProgramComplete(prog: LiftingProgram): boolean {
    if (!prog.start_date) return false;
    const start = new Date(prog.start_date);
    const today = new Date();
    const diff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const progDays = days[prog.id] ?? [];
    return diff >= progDays.length;
  }

  function renderProgram(prog: LiftingProgram, isArchived = false) {
    const progDays = days[prog.id] ?? [];
    const isExpanded = expandedProgram === prog.id;
    const isPersonal = prog.visibility === "personal";
    const canEditThis = canManage || (isPersonal && prog.created_by === playerId);
    const currentDayNum = getCurrentDayNumber(prog);
    const activeDayCount = progDays.filter(d => !d.is_rest_day).length;

    return (
      <div key={prog.id} style={{ background: "var(--surface2)", border: `1px solid ${isPersonal ? "rgba(147,180,255,0.3)" : isArchived ? "rgba(255,255,255,0.08)" : "var(--border)"}`, borderRadius: 14, overflow: "hidden", opacity: isArchived ? 0.7 : 1 }}>
        {/* Header */}
        <div onClick={() => !isArchived && handleExpand(prog.id)} style={{ padding: "16px 18px", cursor: isArchived ? "default" : "pointer", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {prog.title}
              {isPersonal && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "rgba(147,180,255,0.15)", color: "#93b4ff" }}>PERSONAL</span>}
              {prog.visibility === "draft" && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "rgba(240,192,64,0.15)", color: "var(--gold)" }}>📝 DRAFT</span>}
              {isArchived && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.08)", color: "var(--muted)" }}>ARCHIVED</span>}
            </div>
            {prog.description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{prog.description}</div>}
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>{progDays.length} days</span>
              <span>{activeDayCount} training day{activeDayCount !== 1 ? "s" : ""}</span>
              {!isPersonal && <span style={{ color: prog.visibility === "public" ? "#5de098" : prog.visibility === "draft" ? "var(--gold)" : "#93b4ff" }}>{prog.visibility === "public" ? "🌐 Everyone" : prog.visibility === "draft" ? "📝 Draft" : "👤 Assigned"}</span>}
              {prog.start_date && currentDayNum && <span style={{ color: "var(--gold)" }}>📅 Day {currentDayNum} today</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {canManage && !isArchived && (
              <button onClick={e => { e.stopPropagation(); setResultsProgram(prog); }}
                style={{ background: "rgba(26,63,168,0.2)", border: "1px solid rgba(26,63,168,0.4)", color: "#93b4ff", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                📊 Results
              </button>
            )}
            {canEditThis && !isArchived && (
              <button onClick={e => { e.stopPropagation(); onEdit(prog); }}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>✏️</button>
            )}
            {canEditThis && (
              <button onClick={e => { e.stopPropagation(); isArchived ? handleRestore(prog) : handleArchive(prog); }}
                disabled={archiving === prog.id}
                style={{ background: isArchived ? "rgba(40,180,80,0.1)" : "rgba(255,107,107,0.1)", border: `1px solid ${isArchived ? "rgba(40,180,80,0.3)" : "rgba(255,107,107,0.3)"}`, color: isArchived ? "#5de098" : "#ff7b7b", borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                {archiving === prog.id ? "…" : isArchived ? "↩️ Restore" : "📦 Archive"}
              </button>
            )}
            {!isArchived && <span style={{ color: "var(--muted)", fontSize: 16 }}>{isExpanded ? "▲" : "▼"}</span>}
          </div>
        </div>

        {/* Days */}
        {isExpanded && !isArchived && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {isProgramComplete(prog) && !canManage ? (
              <ProgramComplete
                program={prog}
                days={progDays}
                dayExercises={dayExercises}
                playerId={playerId}
              />
            ) : logsLoading ? (
              <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0" }}>Loading…</div>
            ) : (() => {
              // Group days by week using name, same logic as builder
              const hasWeekNames = progDays.some((d: LiftingDay) => /^week\s*\d+/i.test(d.name));
              const weekMap: Record<string, { weekNum: number; label: string; days: LiftingDay[] }> = {};

              progDays.forEach((day: LiftingDay, di: number) => {
                let key: string;
                let label: string;
                let weekNum: number;

                const weekMatch = day.name.match(/^week\s*(\d+)/i);
                if (hasWeekNames && weekMatch) {
                  weekNum = parseInt(weekMatch[1]);
                  key = `week-${weekNum}`;
                  label = `Week ${weekNum}`;
                } else if (hasWeekNames) {
                  // Pre/post test — no "Week X" at start of name, own group
                  key = `special-${di}`;
                  label = day.name;
                  // Use index: first day = pre-test (-1), anything else = post-test (999)
                  weekNum = di === 0 ? -1 : 999;
                } else {
                  weekNum = Math.floor(di / 7) + 1;
                  key = `week-${weekNum}`;
                  label = `Week ${weekNum}`;
                }

                if (!weekMap[key]) weekMap[key] = { weekNum, label, days: [] };
                weekMap[key].days.push(day);
              });

              const sorted = Object.values(weekMap).sort((a, b) => a.weekNum - b.weekNum);

              return sorted.map(({ label, days: weekDays }, idx) => (
                <ProgramWeekGroup
                  key={label}
                  label={label}
                  days={weekDays}
                  dayExercises={dayExercises}
                  programLogs={programLogs}
                  playerId={playerId}
                  playerName={playerName}
                  avatarUrl={avatarUrl}
                  currentDayNum={currentDayNum}
                  canManage={canManage}
                  onRefresh={onRefresh}
                  onEditDay={setEditingDay}
                  defaultOpen={idx === 0}
                />
              ));
            })()}
          </div>
        )}
      </div>
    );
  }

  const isEmpty = coachPrograms.length === 0 && personalPrograms.length === 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="section-title" style={{ margin: 0 }}>💪 Lifting</div>
        <div style={{ display: "flex", gap: 8 }}>
          {!canManage && (
            <button onClick={() => onNewProgram(true)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--silver-light)", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              + My Program
            </button>
          )}
          {canManage && <button onClick={() => onNewProgram()} className="coach-add-btn">+ New Program</button>}
        </div>
      </div>
      <div className="section-sub" style={{ marginBottom: 20 }}>
        {canManage ? "Create and manage lifting programs" : "Log your sets, reps, and weight"}
      </div>

      {isEmpty ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💪</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No lifting programs yet</div>
          <div style={{ fontSize: 13 }}>{canManage ? "Create your first program above." : "Your coach hasn't added any programs yet. You can create your own with \"+ My Program\"."}</div>
        </div>
      ) : (
        <>
          {coachPrograms.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              {!canManage && personalPrograms.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Team Programs</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {coachPrograms.map(p => renderProgram(p))}
              </div>
            </div>
          )}
          {personalPrograms.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>My Personal Programs</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {personalPrograms.map(p => renderProgram(p))}
              </div>
            </div>
          )}
          {(archivedPrograms.length > 0 && canManage) && (
            <div>
              <button onClick={() => setShowArchived(s => !s)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "4px 0", marginBottom: 10 }}>
                {showArchived ? "▲" : "▼"} {archivedPrograms.length} archived program{archivedPrograms.length !== 1 ? "s" : ""}
              </button>
              {showArchived && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {archivedPrograms.map(p => renderProgram(p, true))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {resultsProgram && (
        <LiftingResults
          program={resultsProgram}
          days={days}
          dayExercises={dayExercises}
          onClose={() => setResultsProgram(null)}
        />
      )}

      {editingDay && (
        <EditDayModal
          day={editingDay}
          playerId={playerId}
          onSaved={onRefresh}
          onClose={() => setEditingDay(null)}
        />
      )}
    </>
  );
}
