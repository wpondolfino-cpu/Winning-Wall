// src/components/game-stats/GameReport.tsx
// Renders one report: quarter, half, full game, win/loss split, or season.
// Players only ever reach this for games where status = 'published' --
// RLS on `games`/`possessions` enforces that at the query level, so this
// component doesn't need its own visibility check.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  computeTeamStats,
  computeShotQuality,
  computeStreaks,
  computePlayCallEffectiveness,
  computeOobEffectiveness,
  type Possession,
  type PlayCall,
  type StatGoal,
  type StatRow,
} from "../../lib/gameStats";

export type ReportScope =
  | { kind: "quarter"; gameId: string; quarter: number }
  | { kind: "half"; gameId: string; half: 1 | 2 }
  | { kind: "game"; gameId: string }
  | { kind: "season"; season: string; result?: "win" | "loss" };

interface Props {
  scope: ReportScope;
  title: string;
}

export default function GameReport({ scope, title }: Props) {
  const [possessions, setPossessions] = useState<Possession[]>([]);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [JSON.stringify(scope)]);

  async function load() {
    setLoading(true);
    const [{ data: goalRows }, { data: playRows }] = await Promise.all([
      supabase.from("stat_goals").select("*"),
      supabase.from("play_calls").select("*"),
    ]);
    setGoals((goalRows as StatGoal[]) ?? []);
    setPlayCalls((playRows as PlayCall[]) ?? []);

    let query = supabase.from("possessions").select("*");
    if (scope.kind === "quarter") query = query.eq("game_id", scope.gameId).eq("quarter", scope.quarter);
    if (scope.kind === "half") query = query.eq("game_id", scope.gameId).in("quarter", scope.half === 1 ? [1, 2] : [3, 4]);
    if (scope.kind === "game") query = query.eq("game_id", scope.gameId);
    if (scope.kind === "season") {
      const { data: games } = await supabase
        .from("games")
        .select("id, final_score_us, final_score_them")
        .eq("season", scope.season);
      // Win/loss isn't a stored column -- it's derived from the final score,
      // so the filter happens here rather than in the query.
      const filtered = (games ?? []).filter((g: any) => {
        if (!scope.result || g.final_score_us == null || g.final_score_them == null) return !scope.result;
        const won = g.final_score_us > g.final_score_them;
        return scope.result === "win" ? won : !won;
      });
      const ids = filtered.map((g: any) => g.id);
      query = query.in("game_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }

    const { data } = await query.order("sequence", { ascending: true });
    setPossessions((data as Possession[]) ?? []);
    setLoading(false);
  }

  if (loading) return <div className="card">Loading report…</div>;

  const usStats = computeTeamStats(possessions, "us", goals);
  const shotQuality = computeShotQuality(possessions, "us");
  const streaks = computeStreaks(possessions);
  const blob = computeOobEffectiveness(possessions, "blob");
  const slob = computeOobEffectiveness(possessions, "slob");
  const setPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "set"));
  const motionPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "motion"));

  const usPoints = possessions.filter((p) => p.team === "us").reduce((s, p) => s + p.points, 0);
  const themPoints = possessions.filter((p) => p.team === "opponent").reduce((s, p) => s + p.points, 0);
  const usTrips = possessions.filter((p) => p.team === "us").length;
  const themTrips = possessions.filter((p) => p.team === "opponent").length;

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>{title}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>PPP</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{usTrips ? (usPoints / usTrips).toFixed(2) : "—"}</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Opp PPP</div>
          <div style={{ fontSize: 22, fontWeight: 500 }}>{themTrips ? (themPoints / themTrips).toFixed(2) : "—"}</div>
        </div>
      </div>

      <StatRows rows={usStats} />

      <SectionDivider label="Set plays" />
      <PlayCallTable rows={setPlays} />
      <div style={{ height: 8 }} />
      <PlayCallTable rows={motionPlays} />

      <SectionDivider label="Set plays (BLOB / SLOB)" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>BLOB</div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>
            {blob.scored}-for-{blob.total} scored
            <span style={{ fontSize: 12, color: "var(--muted)" }}> · {blob.flowed} flowed to HC</span>
          </div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>SLOB</div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>
            {slob.scored}-for-{slob.total} scored
            <span style={{ fontSize: 12, color: "var(--muted)" }}> · {slob.flowed} flowed to HC</span>
          </div>
        </div>
      </div>

      <SectionDivider label="Shot quality" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Overall</span>
        <span style={{ fontSize: 18, fontWeight: 500, textTransform: "capitalize" }}>{shotQuality.label ?? "—"}</span>
      </div>
      <ShotQualityBar breakdown={shotQuality.breakdown} />

      <SectionDivider label="Streaks" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Scoring runs (3+)</div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{streaks.scoringRuns.count}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>best run: {streaks.scoringRuns.best} straight</div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Stop runs (3+)</div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{streaks.stopRuns.count}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>best run: {streaks.stopRuns.best} straight</div>
        </div>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>{label}</span>
    </div>
  );
}

const roleColor: Record<string, string> = { success: "#1f7a4d", warning: "#8a6512", danger: "#8a2f2f" };

function StatRows({ rows }: { rows: StatRow[] }) {
  return (
    <div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--border)" }}>
          <span style={{ fontSize: 14 }}>{r.label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {r.goal != null && <span style={{ fontSize: 12, color: "var(--muted)" }}>goal {r.goal}</span>}
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                padding: "2px 10px",
                borderRadius: 8,
                background: r.role ? roleColor[r.role] + "22" : "var(--surface2)",
                color: r.role ? roleColor[r.role] : "var(--text)",
              }}
            >
              {r.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayCallTable({ rows }: { rows: ReturnType<typeof computePlayCallEffectiveness> }) {
  if (!rows.length) return null;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.playCallId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
          <span>{r.name}</span>
          <span style={{ color: "var(--muted)" }}>{r.calls} calls · {r.conversionPct}% · {r.ppp} ppp</span>
        </div>
      ))}
    </div>
  );
}

function ShotQualityBar({ breakdown }: { breakdown: { great: number; good: number; live: number; tough: number } }) {
  return (
    <div>
      <div style={{ display: "flex", height: 20, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ width: `${breakdown.great}%`, background: "#1f7a4d" }} />
        <div style={{ width: `${breakdown.good}%`, background: "#2f9e63" }} />
        <div style={{ width: `${breakdown.live}%`, background: "#c48a1f" }} />
        <div style={{ width: `${breakdown.tough}%`, background: "#8a2f2f" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        <span>Great {breakdown.great}%</span>
        <span>Good {breakdown.good}%</span>
        <span>Live {breakdown.live}%</span>
        <span>Tough {breakdown.tough}%</span>
      </div>
    </div>
  );
}
