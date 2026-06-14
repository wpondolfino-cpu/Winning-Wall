// src/components/lifting/LiftingCharts.tsx
// Phase 2: per-exercise 1RM progress chart (players only)
// Uses pure SVG — no external chart library needed
import { LiftingLog, calc1RM, getBestSet } from "./lifting";

interface Props {
  exerciseName: string;
  logs: LiftingLog[]; // chronological oldest first
}

export default function LiftingChart({ exerciseName, logs }: Props) {
  if (logs.length < 2) return null;

  const points = [...logs].reverse().map((log, i) => {
    const best = getBestSet(log.sets_data);
    return {
      date: new Date(log.logged_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: best ? calc1RM(best.weight, best.reps) : 0,
      index: i,
    };
  }).filter(p => p.value > 0);

  if (points.length < 2) return null;

  const W = 320, H = 100, PAD = 8;
  const minV = Math.min(...points.map(p => p.value)) - 5;
  const maxV = Math.max(...points.map(p => p.value)) + 5;
  const scaleX = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const scaleY = (v: number) => H - PAD - ((v - minV) / (maxV - minV)) * (H - PAD * 2);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i)},${scaleY(p.value)}`).join(" ");
  const gained = points[points.length - 1].value - points[0].value;

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{exerciseName}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>Est. 1RM · {points.length} sessions</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: gained >= 0 ? "#5de098" : "#ff7b7b", lineHeight: 1 }}>
            {gained > 0 ? "+" : ""}{gained} lbs
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)" }}>total gain</div>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(t => (
          <line key={t} x1={PAD} x2={W - PAD} y1={PAD + t * (H - PAD * 2)} y2={PAD + t * (H - PAD * 2)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        ))}
        {/* Line */}
        <path d={pathD} fill="none" stroke="#93b4ff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={scaleX(i)} cy={scaleY(p.value)} r={3} fill="#93b4ff" />
        ))}
        {/* First and last labels */}
        <text x={scaleX(0)} y={H - 1} textAnchor="middle" fontSize={9} fill="var(--muted)">{points[0].date}</text>
        <text x={scaleX(points.length - 1)} y={H - 1} textAnchor="middle" fontSize={9} fill="var(--muted)">{points[points.length - 1].date}</text>
        {/* Current 1RM label */}
        <text x={scaleX(points.length - 1)} y={scaleY(points[points.length - 1].value) - 6} textAnchor="middle" fontSize={10} fontWeight="700" fill="#5de098">
          {points[points.length - 1].value} lbs
        </text>
      </svg>
    </div>
  );
}

interface ProgressProps {
  playerId: string;
  allLogs: LiftingLog[];
  exerciseNames: Record<string, string>;
}

export function LiftingProgressPanel({ allLogs, exerciseNames }: ProgressProps) {
  const byEx: Record<string, LiftingLog[]> = {};
  [...allLogs].reverse().forEach(log => {
    if (!byEx[log.exercise_id]) byEx[log.exercise_id] = [];
    byEx[log.exercise_id].push(log);
  });

  const exercisesWithData = Object.entries(byEx).filter(([, logs]) => logs.length >= 2);

  if (exercisesWithData.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)", fontSize: 13 }}>
        Log at least 2 sessions on the same exercise to see your progress chart.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {exercisesWithData.map(([exId, logs]) => (
        <LiftingChart key={exId} exerciseName={exerciseNames[exId] ?? "Unknown"} logs={logs} />
      ))}
    </div>
  );
}
