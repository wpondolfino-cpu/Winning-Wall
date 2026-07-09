// src/components/lifting/index.tsx
// Main entry point — loads all data, manages view state, routes to sub-components
import { useState, useEffect, useCallback } from "react";
import {
  LiftingProgram, LiftingDay, DayExercise, BankExercise, LiftingLog,
  getVisiblePrograms, getArchivedPrograms, getDaysForPrograms,
  getExercisesForDays, getLogsForExercises,
} from "./lifting";
import { LiftingProgressPanel } from "./LiftingCharts";
import LiftingPrograms from "./LiftingPrograms";
import LiftingBuilder from "./LiftingBuilder";
import ExerciseBank from "./ExerciseBank";
import TeamProgressPanel from "./TeamProgressPanel";

interface Props {
  playerId: string;
  playerName: string;
  avatarUrl?: string;
  isCoach?: boolean;
  isAdmin?: boolean;
}

type View = "programs" | "builder" | "progress";

export default function LiftingPanel({ playerId, playerName, avatarUrl, isCoach = false, isAdmin = false }: Props) {
  const canManage = isCoach || isAdmin;

  const [view, setView] = useState<View>("programs");
  const [loading, setLoading] = useState(true);

  // Data
  const [programs, setPrograms] = useState<LiftingProgram[]>([]);
  const [archivedPrograms, setArchivedPrograms] = useState<LiftingProgram[]>([]);
  const [days, setDays] = useState<Record<string, LiftingDay[]>>({}); // keyed by program_id
  const [dayExercises, setDayExercises] = useState<Record<string, (DayExercise & { exercise: BankExercise })[]>>({}); // keyed by day_id
  const [allPlayerLogs, setAllPlayerLogs] = useState<LiftingLog[]>([]);

  // Builder state
  const [editProgram, setEditProgram] = useState<LiftingProgram | null>(null);
  const [editDays, setEditDays] = useState<LiftingDay[] | undefined>();
  const [editDayExercises, setEditDayExercises] = useState<Record<string, (DayExercise & { exercise: BankExercise })[]> | undefined>();
  const [isPersonalBuilder, setIsPersonalBuilder] = useState(false);

  // Active tab (players only)
  const [activeTab, setActiveTab] = useState<"programs" | "progress" | "bank">("programs");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [progs, archived] = await Promise.all([
        getVisiblePrograms(playerId, canManage),
        getArchivedPrograms(canManage),
      ]);
      setPrograms(progs);
      setArchivedPrograms(archived);

      if (progs.length > 0) {
        const progDays = await getDaysForPrograms(progs.map(p => p.id));
        const byProg: Record<string, LiftingDay[]> = {};
        progDays.forEach(d => { if (!byProg[d.program_id]) byProg[d.program_id] = []; byProg[d.program_id].push(d); });
        setDays(byProg);

        if (progDays.length > 0) {
          const exs = await getExercisesForDays(progDays.map(d => d.id));
          const byDay: Record<string, (DayExercise & { exercise: BankExercise })[]> = {};
          exs.forEach((e: any) => { if (!byDay[e.day_id]) byDay[e.day_id] = []; byDay[e.day_id].push(e); });
          setDayExercises(byDay);

          // Load all player logs for progress charts
          const bankIds = [...new Set(exs.map((e: any) => e.bank_exercise_id).filter(Boolean))];
          if (bankIds.length > 0) {
            const logs = await getLogsForExercises(playerId, bankIds as string[]);
            setAllPlayerLogs(logs);
          }
        }
      }
    } finally { setLoading(false); }
  }, [playerId, canManage]);

  useEffect(() => { load(); }, [load]);

  function openBuilder(prog?: LiftingProgram, personal = false) {
    setIsPersonalBuilder(personal);
    if (prog) {
      setEditProgram(prog);
      setEditDays(days[prog.id] ?? []);
      const progDayIds = (days[prog.id] ?? []).map(d => d.id);
      const de: Record<string, (DayExercise & { exercise: BankExercise })[]> = {};
      progDayIds.forEach(id => { de[id] = dayExercises[id] ?? []; });
      setEditDayExercises(de);
    } else {
      setEditProgram(null);
      setEditDays(undefined);
      setEditDayExercises(undefined);
    }
    setView("builder");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Build exercise name lookup for charts
  const exerciseNames: Record<string, string> = {};
  Object.values(dayExercises).flat().forEach((de: any) => {
    if (de.exercise) exerciseNames[de.exercise.id] = de.exercise.name;
  });

  if (loading) return <div className="panel active" style={{ textAlign: "center", color: "var(--muted)", padding: "60px 0" }}>Loading…</div>;

  if (view === "builder") {
    return (
      <LiftingBuilder
        playerId={playerId}
        editProgram={editProgram}
        editDays={editDays}
        editDayExercises={editDayExercises}
        isPersonal={isPersonalBuilder}
        onSaved={() => { setView("programs"); load(); }}
        onCancel={() => setView("programs")}
      />
    );
  }

  return (
    <div className="panel active">
      {/* Tab bar — coaches: Programs | Bank, players: Programs | Exercises | Progress */}
      <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 12, padding: 5, marginBottom: 20, border: "1px solid var(--border)" }}>
        <button onClick={() => setActiveTab("programs")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: activeTab === "programs" ? "var(--royal)" : "transparent", color: activeTab === "programs" ? "#fff" : "var(--muted)", transition: "all .2s" }}>
          💪 Programs
        </button>
        <button onClick={() => setActiveTab("bank")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: activeTab === "bank" ? "var(--royal)" : "transparent", color: activeTab === "bank" ? "#fff" : "var(--muted)", transition: "all .2s" }}>
          📚 {canManage ? "Exercise Bank" : "Exercises"}
        </button>
        <button onClick={() => setActiveTab("progress")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, background: activeTab === "progress" ? "var(--royal)" : "transparent", color: activeTab === "progress" ? "#fff" : "var(--muted)", transition: "all .2s" }}>
          📈 {canManage ? "Team Progress" : "Progress"}
        </button>
      </div>

      {activeTab === "programs" && (
        <LiftingPrograms
          playerId={playerId}
          playerName={playerName}
          avatarUrl={avatarUrl}
          canManage={canManage}
          programs={programs}
          archivedPrograms={archivedPrograms}
          days={days}
          dayExercises={dayExercises}
          allPlayerLogs={allPlayerLogs}
          onEdit={prog => openBuilder(prog, prog.visibility === "personal")}
          onNewProgram={(personal = false) => openBuilder(undefined, personal)}
          onRefresh={load}
        />
      )}

      {activeTab === "bank" && (
        <ExerciseBank playerId={playerId} canManage={canManage} />
      )}

      {activeTab === "progress" && (
        canManage ? (
          <TeamProgressPanel programs={programs} days={days} dayExercises={dayExercises} />
        ) : (
          <div>
            <div className="section-title" style={{ marginBottom: 4 }}>📈 My Progress</div>
            <div className="section-sub" style={{ marginBottom: 20 }}>Estimated 1RM over time — requires 2+ sessions per exercise</div>
            <LiftingProgressPanel
              playerId={playerId}
              allLogs={allPlayerLogs}
              exerciseNames={exerciseNames}
            />
          </div>
        )
      )}
    </div>
  );
}
