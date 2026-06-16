// src/components/lifting/ProgramComplete.tsx
import { useState, useEffect } from "react";
import { LiftingProgram, LiftingDay, DayExercise, BankExercise, ProgramStats, getProgramStats, getLogsForExercises } from "./lifting";
import { supabase } from "../../lib/supabase";

interface Props {
  program: LiftingProgram;
  days: LiftingDay[];
  dayExercises: Record<string, (DayExercise & { exercise: BankExercise })[]>;
  playerId: string;
}

interface TestResult {
  name: string;
  unit: string;
  preValue: number | null;
  postValue: number | null;
  higherIsBetter: boolean;
}

const TEST_EXERCISES = [
  { name: "Vertical Jump", unit: "inches", higherIsBetter: true },
  { name: "Broad Jump", unit: "inches", higherIsBetter: true },
  { name: "Full Court Sprints", unit: "secs", higherIsBetter: false },
  { name: "17s Conditioning Test", unit: "secs", higherIsBetter: false },
  { name: "Chin-Up", unit: "reps", higherIsBetter: true },
  { name: "Trap Bar Deadlift", unit: "lbs", higherIsBetter: true },
];

export default function ProgramComplete({ program, days, dayExercises, playerId }: Props) {
  const [stats, setStats] = useState<ProgramStats | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Load lifting stats
        const s = await getProgramStats(playerId, days.map(d => d.id), dayExercises);
        setStats(s);

        // Load test day results (Day 0 and Day 71)
        const preTestDay = days.find(d => d.day_number === 0);
        const postTestDay = days.find(d => d.day_number === 71);

        if (preTestDay || postTestDay) {
          // Get bank exercise IDs for test exercises
          const { data: bankExs } = await supabase
            .from("lifting_exercise_bank")
            .select("id, name")
            .in("name", TEST_EXERCISES.map(t => t.name));

          const bankById: Record<string, string> = {};
          const idByName: Record<string, string> = {};
          (bankExs ?? []).forEach((e: any) => {
            bankById[e.id] = e.name;
            idByName[e.name] = e.id;
          });

          const testBankIds = Object.values(idByName);

          // Get all logs for test exercises by this player
          const { data: logs } = await supabase
            .from("lifting_logs")
            .select("*")
            .eq("player_id", playerId)
            .in("exercise_id", testBankIds)
            .order("logged_at", { ascending: true });

          const allLogs = logs ?? [];

          // Find pre-test date range (Day 0 = program start date)
          const startDate = program.start_date ? new Date(program.start_date) : null;
          const endDate = startDate ? new Date(startDate.getTime() + 71 * 86400000) : null;

          // Pre-test = first log of each exercise near start
          // Post-test = last log of each exercise near end
          const results: TestResult[] = TEST_EXERCISES.map(test => {
            const exId = idByName[test.name];
            if (!exId) return { ...test, preValue: null, postValue: null };

            const exLogs = allLogs.filter((l: any) => l.exercise_id === exId);
            if (exLogs.length === 0) return { ...test, preValue: null, postValue: null };

            // Pre-test: first log (earliest)
            const preLog = exLogs[0];
            // Post-test: last log (latest)
            const postLog = exLogs[exLogs.length - 1];

            // Extract value — for jumps use reps (inches), for deadlift use weight
            function getValue(log: any): number | null {
              if (!log?.sets_data?.length) return null;
              const sets = log.sets_data;
              if (test.name === "Chin-Up") {
                // Max reps
                return Math.max(...sets.map((s: any) => s.reps));
              } else if (test.name === "Vertical Jump" || test.name === "Broad Jump") {
                // Stored as reps = inches
                return Math.max(...sets.map((s: any) => s.reps));
              } else if (test.name === "Trap Bar Deadlift") {
                return Math.max(...sets.map((s: any) => s.weight));
              } else {
                // Sprints/conditioning — stored as weight = seconds
                return Math.min(...sets.map((s: any) => s.weight > 0 ? s.weight : 999));
              }
            }

            const preValue = preLog && preLog.id !== postLog?.id ? getValue(preLog) : null;
            const postValue = getValue(postLog);

            return { ...test, preValue, postValue };
          });

          setTestResults(results);
        }
      } finally { setLoading(false); }
    }
    load();
  }, [playerId]);

  const startDate = program.start_date ? new Date(program.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const endDate = program.start_date ? new Date(new Date(program.start_date).getTime() + days.length * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

  const hasTestData = testResults.some(r => r.preValue !== null || r.postValue !== null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ textAlign: "center", padding: "24px 16px 8px" }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>🏆</div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, color: "var(--gold)", letterSpacing: 1, marginBottom: 6 }}>Program Complete!</div>
        <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>{program.title}</div>
        {startDate && endDate && (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{startDate} – {endDate}</div>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0" }}>Calculating your results…</div>
      ) : (
        <>
          {/* Stats grid */}
          {stats && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { label: "Sessions Logged", value: stats.sessionsLogged, sub: `of ${Math.round(stats.totalDays / 7) * 4} training days`, color: "#93b4ff" },
                { label: "Total Volume", value: stats.totalVolume > 1000 ? `${Math.round(stats.totalVolume / 1000)}k` : stats.totalVolume, sub: "lbs lifted", color: "var(--gold)" },
                { label: "Sets Completed", value: stats.totalSets, sub: "total sets", color: "#5de098" },
                { label: "Weeks Done", value: Math.round(stats.totalDays / 7), sub: "week program", color: "#ff8c42" },
              ].map(s => (
                <div key={s.label} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 12px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, color: s.color, lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.sub}</div>
                </div>
              ))}
            </div>
          )}

          {/* Athletic Test Results */}
          {hasTestData && (
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>🏀 Athletic Test Results</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Pre-test vs Post-test</div>
              </div>
              {testResults.map((r, i) => {
                if (r.preValue === null && r.postValue === null) return null;
                const diff = r.preValue !== null && r.postValue !== null
                  ? r.postValue - r.preValue
                  : null;
                const improved = diff !== null && (r.higherIsBetter ? diff > 0 : diff < 0);
                const diffLabel = diff !== null
                  ? `${improved ? "+" : ""}${r.higherIsBetter ? diff : -diff} ${r.unit}`
                  : null;
                const diffColor = improved ? "#5de098" : diff !== null && diff !== 0 ? "#ff7b7b" : "var(--muted)";

                return (
                  <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: i < testResults.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                        {r.preValue !== null ? `Before: ${r.preValue} ${r.unit}` : "No pre-test logged"}
                        {r.preValue !== null && r.postValue !== null && " → "}
                        {r.postValue !== null && r.preValue !== null ? `After: ${r.postValue} ${r.unit}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {r.postValue !== null && (
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", lineHeight: 1 }}>
                          {r.postValue} <span style={{ fontSize: 12 }}>{r.unit}</span>
                        </div>
                      )}
                      {diffLabel && (
                        <div style={{ fontSize: 12, fontWeight: 700, color: diffColor, marginTop: 2 }}>{diffLabel}</div>
                      )}
                    </div>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          )}

          {/* Top strength gains */}
          {stats && stats.topGains.length > 0 && (
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                💪 Top Strength Gains
              </div>
              {stats.topGains.map((g, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: i < stats.topGains.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{g.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{g.firstWeight} lbs → {g.lastWeight} lbs</div>
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "#5de098" }}>+{g.gain} lbs</div>
                </div>
              ))}
            </div>
          )}

          {/* Est 1RM gains */}
          {stats && stats.oneRMGains.length > 0 && (
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13, color: "var(--text)" }}>
                📈 Estimated 1RM Progress
              </div>
              {stats.oneRMGains.map((g, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: i < stats.oneRMGains.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{g.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{g.first1RM} lbs</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>→</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#5de098" }}>{g.last1RM} lbs</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!hasTestData && (!stats || stats.topGains.length === 0) && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>
              No logs found. Start logging sessions to see your results here!
            </div>
          )}

          {/* Motivational footer */}
          <div style={{ textAlign: "center", padding: "16px 20px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 12 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1, marginBottom: 4 }}>Outwork Everyone</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>10 weeks of work. Season starts soon. Let's go. 🏀</div>
          </div>
        </>
      )}
    </div>
  );
}
