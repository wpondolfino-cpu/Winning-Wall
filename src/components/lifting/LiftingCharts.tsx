// src/components/lifting/LiftingCharts.tsx
// Phase 2: per-exercise 1RM progress chart (players only)
import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { LiftingLog, calc1RM, getBestSet } from "./lifting";

interface Props {
  exerciseName: string;
  logs: LiftingLog[]; // chronological (oldest first)
}

export default function LiftingChart({ exerciseName, logs }: Props) {
  if (logs.length < 2) return null;

  const chartData = [...logs].reverse().map(log => {
    const best = getBestSet(log.sets_data);
    const est1RM = best ? calc1RM(best.weight, best.reps) : 0;
    return {
      date: new Date(log.logged_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      "Est. 1RM": est1RM,
      "Best Weight": best?.weight ?? 0,
    };
  });

  const max1RM = Math.max(...chartData.map(d => d["Est. 1RM"]));
  const min1RM = Math.min(...chartData.map(d => d["Est. 1RM"]));
  const gained = max1RM - chartData[0]["Est. 1RM"];

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{exerciseName} — Est. 1RM Progress</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{logs.length} sessions logged</div>
        </div>
        {gained !== 0 && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: gained > 0 ? "#5de098" : "#ff7b7b", lineHeight: 1 }}>
              {gained > 0 ? "+" : ""}{gained} lbs
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>total gain</div>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <YAxis domain={[Math.max(0, min1RM - 10), max1RM + 10]} tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
            itemStyle={{ color: "#93b4ff" }}
            formatter={(val: number) => [`${val} lbs`]}
          />
          <Line type="monotone" dataKey="Est. 1RM" stroke="#93b4ff" strokeWidth={2} dot={{ r: 3, fill: "#93b4ff" }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Progress panel: shows charts for all exercises a player has logged ──
interface ProgressProps {
  playerId: string;
  allLogs: LiftingLog[];
  exerciseNames: Record<string, string>; // bank_exercise_id → name
}

export function LiftingProgressPanel({ allLogs, exerciseNames }: ProgressProps) {
  // Group logs by exercise, oldest first
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
        <LiftingChart
          key={exId}
          exerciseName={exerciseNames[exId] ?? "Unknown Exercise"}
          logs={logs}
        />
      ))}
    </div>
  );
}
