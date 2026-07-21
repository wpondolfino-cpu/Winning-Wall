// src/components/game-stats/GameReport.tsx
// Renders one report: quarter, half, full game, win/loss split, or season.
// Players only ever reach this for games where status = 'published' --
// RLS on `games`/`possessions` enforces that at the query level, so this
// component doesn't need its own visibility check.
//
// "variant" controls how much shows: "in_game" (quarter/half reports)
// shows only the stats flagged inGame in DEFAULT_STAT_ORDER; "full" (full
// game / season / custom reports) shows everything, including set-play
// and BLOB/SLOB effectiveness and streaks. Numeric stats render for both
// Us and Opponent, in whatever order the coach set on the Goals tab;
// shot quality / set plays / BLOB-SLOB / streaks are "us"-only sections
// (we don't track the opponent's shot selection or play calls) and keep
// their relative order among themselves.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  computeTeamStats,
  computeShotQuality,
  computeStreaks,
  computePlayCallEffectiveness,
  computeOobEffectiveness,
  computeExtraPossessions,
  computePointsOffLiveTurnovers,
  computeSecondChancePoints,
  scoreAgainstGoal,
  getReportLayout,
  resolveStatOrder,
  type Possession,
  type PlayCall,
  type StatGoal,
  type StatRow,
  type StatDef,
} from "../../lib/gameStats";

export type ReportScope =
  | { kind: "quarter"; gameId: string; quarter: number }
  | { kind: "half"; gameId: string; half: 1 | 2 }
  | { kind: "game"; gameId: string }
  | { kind: "season"; season: string; result?: "win" | "loss" };

export type ReportVariant = "in_game" | "full";

interface Props {
  scope: ReportScope;
  title: string;
  variant?: ReportVariant;
}

export default function GameReport({ scope, title, variant = "full" }: Props) {
  const [possessions, setPossessions] = useState<Possession[]>([]);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [statOrder, setStatOrder] = useState<StatDef[]>([]);
  const [opponentName, setOpponentName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [JSON.stringify(scope)]);

  async function load() {
    setLoading(true);
    const [{ data: goalRows }, { data: playRows }, savedOrder] = await Promise.all([
      supabase.from("stat_goals").select("*"),
      supabase.from("play_calls").select("*"),
      getReportLayout(),
    ]);
    setGoals((goalRows as StatGoal[]) ?? []);
    setPlayCalls((playRows as PlayCall[]) ?? []);
    setStatOrder(resolveStatOrder(savedOrder));

    // A season/win-loss report spans multiple games (multiple opponents),
    // so there's no single name to show -- only fetch one for scopes tied
    // to exactly one game.
    if (scope.kind === "quarter" || scope.kind === "half" || scope.kind === "game") {
      const { data: game } = await supabase.from("games").select("opponent").eq("id", scope.gameId).maybeSingle();
      setOpponentName((game as any)?.opponent ?? undefined);
    } else {
      setOpponentName(undefined);
    }

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

  return <ReportBody possessions={possessions} playCalls={playCalls} goals={goals} title={title} statOrder={statOrder} variant={variant} opponentName={opponentName} />;
}

/** The actual report card -- shared between GameReport (scope-based) and ReportBuilder (custom multi-game/category filters), so both stay visually identical. */
export function ReportBody({
  possessions,
  playCalls,
  goals,
  title,
  statOrder,
  variant = "full",
  opponentName,
}: {
  possessions: Possession[];
  playCalls: PlayCall[];
  goals: StatGoal[];
  title: string;
  statOrder: StatDef[];
  variant?: ReportVariant;
  opponentName?: string;
}) {
  const visible = statOrder.filter((s) => variant === "full" || s.inGame);
  const numberStats = visible.filter((s) => s.kind === "number");
  const specialStats = visible.filter((s) => s.kind !== "number");

  const usStatsAll = computeTeamStats(possessions, "us", goals);
  const oppStatsAll = computeTeamStats(possessions, "opponent", goals);
  const usByKey = new Map(usStatsAll.map((r) => [r.key, r]));
  const oppByKey = new Map(oppStatsAll.map((r) => [r.key, r]));

  // Extra Possessions is a two-team calculation (needs both sides' OREB/TOV
  // at once), so it's computed separately and colored by its own sign
  // rather than against a goal target.
  const extra = computeExtraPossessions(possessions);
  const signRole = (n: number) => (n > 0 ? "success" : n < 0 ? "danger" : null);
  usByKey.set("extra_possessions", { key: "extra_possessions", label: "Extra Possessions", value: extra.us, goal: null, role: signRole(extra.us), signed: true });
  oppByKey.set("extra_possessions", { key: "extra_possessions", label: "Extra Possessions", value: extra.opponent, goal: null, role: signRole(extra.opponent), signed: true });

  const liveToPts = computePointsOffLiveTurnovers(possessions);
  const liveToUs = scoreAgainstGoal(goals, "points_off_live_to", "us", liveToPts.us);
  const liveToOpp = scoreAgainstGoal(goals, "points_off_live_to", "opponent", liveToPts.opponent);
  usByKey.set("points_off_live_to", { key: "points_off_live_to", label: "Points off Live TO", value: liveToPts.us, goal: liveToUs.goal, role: liveToUs.role });
  oppByKey.set("points_off_live_to", { key: "points_off_live_to", label: "Points off Live TO", value: liveToPts.opponent, goal: liveToOpp.goal, role: liveToOpp.role });

  const secondChance = computeSecondChancePoints(possessions);
  const scUs = scoreAgainstGoal(goals, "second_chance_points", "us", secondChance.us);
  const scOpp = scoreAgainstGoal(goals, "second_chance_points", "opponent", secondChance.opponent);
  usByKey.set("second_chance_points", { key: "second_chance_points", label: "Second Chance Points", value: secondChance.us, goal: scUs.goal, role: scUs.role });
  oppByKey.set("second_chance_points", { key: "second_chance_points", label: "Second Chance Points", value: secondChance.opponent, goal: scOpp.goal, role: scOpp.role });

  const usRows = numberStats.map((s) => usByKey.get(s.key)).filter(Boolean) as StatRow[];
  const oppRows = numberStats.map((s) => oppByKey.get(s.key)).filter(Boolean) as StatRow[];

  const shotQuality = computeShotQuality(possessions, "us");
  const streaks = computeStreaks(possessions);
  const blob = computeOobEffectiveness(possessions, "blob");
  const slob = computeOobEffectiveness(possessions, "slob");
  const setPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "set"));
  const motionPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "motion"));

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)", marginBottom: 12 }}>
        {opponentName ? `${title} - Us vs. ${opponentName}` : title}
      </div>

      <PairedStatRows usRows={usRows} oppRows={oppRows} opponentName={opponentName} />

      {specialStats.map((s) => {
        if (s.kind === "shot_quality") {
          return (
            <div key={s.key}>
              <SectionDivider label="Shot quality" />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Overall</span>
                <span style={{ fontSize: 18, fontWeight: 500, textTransform: "capitalize" }}>{shotQuality.label ?? "—"}</span>
              </div>
              <ShotQualityBar breakdown={shotQuality.breakdown} />
            </div>
          );
        }
        if (s.kind === "set_plays") {
          return (
            <div key={s.key}>
              <SectionDivider label="Set plays" />
              <PlayCallTable rows={setPlays} />
              <div style={{ height: 8 }} />
              <PlayCallTable rows={motionPlays} />
            </div>
          );
        }
        if (s.kind === "oob") {
          return (
            <div key={s.key}>
              <SectionDivider label="Set plays (BLOB / SLOB)" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>BLOB</div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>
                    {blob.scored}-for-{blob.directAttempts} direct
                    <span style={{ fontSize: 12, color: "var(--muted)" }}> · {blob.flowed} flowed to HC · {blob.turnovers} TO</span>
                  </div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>SLOB</div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>
                    {slob.scored}-for-{slob.directAttempts} direct
                    <span style={{ fontSize: 12, color: "var(--muted)" }}> · {slob.flowed} flowed to HC · {slob.turnovers} TO</span>
                  </div>
                </div>
              </div>
            </div>
          );
        }
        if (s.kind === "streaks") {
          return (
            <div key={s.key}>
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
        return null;
      })}
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

// Solid backgrounds + white text -- the old tinted-background/colored-text
// chips were hard to read at a glance, especially green and red.
const roleBg: Record<string, string> = { success: "#1f7a4d", warning: "#a3690d", danger: "#b8342e" };

function PairedStatRows({ usRows, oppRows, opponentName }: { usRows: StatRow[]; oppRows: StatRow[]; opponentName?: string }) {
  if (!usRows.length) return <div style={{ fontSize: 13, color: "var(--muted)", padding: "6px 0" }}>No stats in this set yet.</div>;
  return (
    <div>
      <style>{`
        .gs-paired { grid-template-columns: 1fr 1fr 1fr; }
      `}</style>
      <div className="gs-paired" style={{ display: "grid", gap: 8, marginBottom: 6 }}>
        <span style={{ textAlign: "center", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Us</span>
        <span />
        <span style={{ textAlign: "center", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{opponentName ?? "Opponent"}</span>
      </div>
      {usRows.map((us, i) => {
        const opp = oppRows[i];
        return (
          <div key={us.key} className="gs-paired" style={{ display: "grid", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <StatChip row={us} />
            <span style={{ textAlign: "center", fontSize: 13, color: "var(--text)", whiteSpace: "nowrap" }}>{us.label}</span>
            {opp ? <StatChip row={opp} /> : <span />}
          </div>
        );
      })}
    </div>
  );
}

function StatChip({ row }: { row: StatRow }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span
        style={{
          textAlign: "center",
          fontSize: 13,
          fontWeight: 700,
          padding: "3px 8px",
          borderRadius: 6,
          background: row.role ? roleBg[row.role] : "var(--surface2)",
          color: row.role ? "#fff" : "var(--text)",
        }}
        title={row.goal != null ? `goal ${row.goal}` : undefined}
      >
        {row.display ?? (row.signed && row.value > 0 ? `+${row.value}` : row.value)}
      </span>
      {row.raw && <span style={{ fontSize: 10, color: "var(--muted)" }}>{row.raw}</span>}
    </span>
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
