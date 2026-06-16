// src/components/lifting/ProgramComplete.tsx
import { useState, useEffect } from "react";
import { LiftingProgram, LiftingDay, DayExercise, BankExercise, ProgramStats, getProgramStats } from "./lifting";

interface Props {
  program: LiftingProgram;
  days: LiftingDay[];
  dayExercises: Record<string, (DayExercise & { exercise: BankExercise })[]>;
  playerId: string;
}

export default function ProgramComplete({ program, days, dayExercises, playerId }: Props) {
  const [stats, setStats] = useState<ProgramStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const s = await getProgramStats(playerId, days.map(d => d.id), dayExercises);
        setStats(s);
      } finally { setLoading(false); }
    }
    load();
  }, [playerId]);

  const startDate = program.start_date ? new Date(program.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const endDate = program.start_date ? new Date(new Date(program.start_date).getTime() + days.length * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

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
      ) : stats && (
        <>
          {/* Stats grid */}
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

          {/* Top strength gains */}
          {stats.topGains.length > 0 && (
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
          {stats.oneRMGains.length > 0 && (
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

          {stats.topGains.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>
              No lifting logs found for this program. Start logging sessions to see your progress here next time!
            </div>
          )}

          {/* Motivational footer */}
          <div style={{ textAlign: "center", padding: "16px 20px", background: "rgba(240,192,64,0.08)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 12 }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)", letterSpacing: 1, marginBottom: 4 }}>Outwork Everyone</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>10 weeks of work. Season starts soon. Let's go.</div>
          </div>
        </>
      )}
    </div>
  );
}
