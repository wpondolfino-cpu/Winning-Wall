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
  computeDefenseEffectiveness,
  scoreAgainstGoal,
  getReportLayout,
  resolveStatOrder,
  gameFormat,
  halfPeriods,
  qualityShotStatus,
  gameTypesForGroup,
  STAT_EXPLAINERS,
  type GameGroup,
  type Possession,
  type PlayCall,
  type StatGoal,
  type StatRow,
  type StatDef,
} from "../../lib/gameStats";
import { computePracticeSuggestions, PracticeSuggestions } from "../../lib/practiceSuggestions";
import PracticeSuggestionsPanel from "./PracticeSuggestionsPanel";

export type ReportScope =
  | { kind: "quarter"; gameId: string; quarter: number }
  | { kind: "half"; gameId: string; half: 1 | 2 }
  | { kind: "game"; gameId: string }
  | { kind: "season"; season: string; result?: "win" | "loss"; gameGroup?: GameGroup };

export type ReportVariant = "in_game" | "full";

interface Props {
  scope: ReportScope;
  title: string;
  variant?: ReportVariant;
  canManage?: boolean;
}

export default function GameReport({ scope, title, variant = "full", canManage = false }: Props) {
  const [possessions, setPossessions] = useState<Possession[]>([]);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [statOrder, setStatOrder] = useState<StatDef[]>([]);
  const [opponentName, setOpponentName] = useState<string | undefined>(undefined);
  const [isPractice, setIsPractice] = useState(false);
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
    // to exactly one game. The same fetch supplies the period format,
    // which the half scope needs below.
    let fmt = gameFormat(null);
    if (scope.kind === "quarter" || scope.kind === "half" || scope.kind === "game") {
      const { data: game } = await supabase
        .from("games")
        .select("opponent, game_type, period_format, regulation_periods, period_lengths, ot_minutes")
        .eq("id", scope.gameId)
        .maybeSingle();
      setOpponentName((game as any)?.opponent ?? undefined);
      setIsPractice((game as any)?.game_type === "practice");
      fmt = gameFormat(game as any);
    } else {
      setOpponentName(undefined);
      setIsPractice(false);
    }

    let query = supabase.from("possessions").select("*");
    if (scope.kind === "quarter") query = query.eq("game_id", scope.gameId).eq("quarter", scope.quarter);
    // Half periods come from the game's format now. For a 4-quarter game
    // this resolves to [1,2] / [3,4] exactly as before; for a halves game
    // it resolves to [1] / [2], which is what was broken -- a halves
    // game's "Halftime" report used to match [1,2] and return everything.
    if (scope.kind === "half") query = query.eq("game_id", scope.gameId).in("quarter", halfPeriods(fmt, scope.half));
    if (scope.kind === "game") query = query.eq("game_id", scope.gameId);
    if (scope.kind === "season") {
      // Defaults to the "games" group -- real competition only. Without
      // this, a tracked scrimmage or practice would land in season
      // averages next to actual games.
      const { data: games } = await supabase
        .from("games")
        .select("id, final_score_us, final_score_them")
        .eq("season", scope.season)
        .in("game_type", gameTypesForGroup(scope.gameGroup ?? "games"));
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

  return <ReportBody possessions={possessions} playCalls={playCalls} goals={goals} title={title} statOrder={statOrder} variant={variant} opponentName={opponentName} isPractice={isPractice} canManage={canManage} />;
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
  isPractice,
  canManage = false,
}: {
  possessions: Possession[];
  playCalls: PlayCall[];
  goals: StatGoal[];
  title: string;
  statOrder: StatDef[];
  variant?: ReportVariant;
  opponentName?: string;
  isPractice?: boolean;
  canManage?: boolean;
}) {
  const visible = statOrder.filter((s) => variant === "full" || s.inGame);
  const numberStats = visible.filter((s) => s.kind === "number" && !s.goalOnly);
  const specialStats = visible.filter((s) => s.kind !== "number");

  const usStatsAll = computeTeamStats(possessions, "us", goals);
  const oppStatsAll = computeTeamStats(possessions, "opponent", goals);
  const usByKey = new Map(usStatsAll.map((r) => [r.key, r]));
  const oppByKey = new Map(oppStatsAll.map((r) => [r.key, r]));

  // Practice Focus: only meaningful for full reports with enough data
  // behind them to rank -- not the quick in-game quarter/half view.
  const [suggestions, setSuggestions] = useState<PracticeSuggestions | null>(null);
  useEffect(() => {
    if (variant !== "full" || !possessions.length) { setSuggestions(null); return; }
    computePracticeSuggestions(usStatsAll, oppStatsAll, goals).then(setSuggestions).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [possessions, goals, variant]);

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
  // Graded on defence too now: this is the shot diet we ALLOWED, so a
  // high great+good share here is bad for us. scoreAgainstGoal inverts
  // the direction automatically when only an "us" goal is set.
  const shotQualityAgainst = computeShotQuality(possessions, "opponent");
  const streaks = computeStreaks(possessions);
  const blob = computeOobEffectiveness(possessions, "blob");
  const slob = computeOobEffectiveness(possessions, "slob");
  const setPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "set"));
  const motionPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "motion"));
  const blobPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "blob"));
  const slobPlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "slob"));

  return (
    <div className="card gs-report-printable" style={{ width: "100%", maxWidth: 1400 }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .gs-report-printable, .gs-report-printable * { visibility: visible; }
          .gs-report-printable { position: absolute; left: 0; top: 0; width: 100%; }
          .gs-no-print { display: none !important; }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}>
          {opponentName ? (isPractice ? `${title} - ${opponentName}` : `${title} - Us vs. ${opponentName}`) : title}
        </div>
        <div className="gs-no-print" style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => window.print()}
            style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer" }}
          >
            Print / Save as PDF
          </button>
          <CopyReportButton
            title={title}
            opponentName={opponentName}
            isPractice={isPractice}
            usRows={usRows}
            oppRows={oppRows}
            shotQuality={shotQuality} shotQualityAgainst={shotQualityAgainst}
            streaks={streaks}
          />
        </div>
      </div>

      <PairedStatRows usRows={usRows} oppRows={oppRows} opponentName={opponentName} />

      {specialStats.map((s) => {
        if (s.kind === "shot_quality") {
          const usGoal = scoreAgainstGoal(goals, "quality_shot_pct", "us", shotQuality.qualityPct ?? 0).goal;
          const oppGoal = scoreAgainstGoal(goals, "quality_shot_pct", "opponent", shotQualityAgainst.qualityPct ?? 0).goal;
          // On defence a LOW share of good looks is the win, so the status is
          // read against the mirror of the target.
          const usStatus = qualityShotStatus(shotQuality.qualityPct, usGoal);
          const oppStatus =
            shotQualityAgainst.qualityPct == null || oppGoal == null
              ? null
              : qualityShotStatus(2 * oppGoal - shotQualityAgainst.qualityPct, oppGoal);
          return (
            <ShotQualityPair
              key={s.key}
              us={shotQuality}
              them={shotQualityAgainst}
              usStatus={usStatus}
              oppStatus={oppStatus}
              usGoal={usGoal}
              oppGoal={oppGoal}
              opponentName={opponentName}
            />
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
                    <span style={{ fontSize: 12, color: "var(--muted)" }}> · {blob.flowed} flowed to HC ({blob.scoredOnFlow} scored) · {blob.turnovers} TO</span>
                  </div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>SLOB</div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>
                    {slob.scored}-for-{slob.directAttempts} direct
                    <span style={{ fontSize: 12, color: "var(--muted)" }}> · {slob.flowed} flowed to HC ({slob.scoredOnFlow} scored) · {slob.turnovers} TO</span>
                  </div>
                </div>
              </div>
              <div style={{ height: 8 }} />
              <PlayCallTable rows={blobPlays} />
              <div style={{ height: 8 }} />
              <PlayCallTable rows={slobPlays} />
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
        if (s.kind === "defense_schemes") {
          const defense = computeDefenseEffectiveness(possessions);
          return (
            <div key={s.key}>
              <SectionDivider label="Defense schemes" />
              <DefenseSchemeRow row={defense.man} />
              <DefenseSchemeRow row={defense.zone} />
              <DefenseSchemeRow row={defense.press} />
              {defense.press.calls > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Press forced {defense.pressTurnovers} turnover{defense.pressTurnovers === 1 ? "" : "s"}, broke down to Man {defense.pressToMan}x, Zone {defense.pressToZone}x
                </div>
              )}
            </div>
          );
        }
        return null;
      })}

      {suggestions && <PracticeSuggestionsPanel suggestions={suggestions} canManage={canManage} />}
    </div>
  );
}

function DefenseSchemeRow({ row }: { row: ReturnType<typeof computeDefenseEffectiveness>["man"] }) {
  if (!row.calls) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
      <span>{row.label}</span>
      <span style={{ color: "var(--muted)" }}>{row.calls} calls · {row.pointsAllowed} pts allowed · {row.stopPct}% stops · {row.ppp} ppp</span>
    </div>
  );
}

function CopyReportButton({
  title,
  opponentName,
  isPractice,
  shotQualityAgainst,
  usRows,
  oppRows,
  shotQuality,
  streaks,
}: {
  title: string;
  opponentName?: string;
  isPractice?: boolean;
  usRows: StatRow[];
  oppRows: StatRow[];
  shotQuality: ReturnType<typeof computeShotQuality>;
  shotQualityAgainst: ReturnType<typeof computeShotQuality>;
  streaks: ReturnType<typeof computeStreaks>;
}) {
  const [copied, setCopied] = useState(false);

  function buildText(): string {
    const lines: string[] = [];
    lines.push(opponentName ? (isPractice ? `${title} - ${opponentName}` : `${title} - Us vs. ${opponentName}`) : title);
    lines.push("");
    lines.push(`Stat | Us | ${opponentName ?? "Opponent"}`);
    usRows.forEach((us, i) => {
      const opp = oppRows[i];
      lines.push(`${us.label}: ${us.value}${us.raw ? ` (${us.raw})` : ""} | ${opp ? `${opp.value}${opp.raw ? ` (${opp.raw})` : ""}` : "—"}`);
    });
    if (shotQuality.qualityPct != null || shotQualityAgainst.qualityPct != null) {
      lines.push("");
      if (shotQuality.qualityPct != null) {
        lines.push(`Quality shots taken (Great + Good): ${shotQuality.qualityPct}% (Great ${shotQuality.breakdown.great}% / Good ${shotQuality.breakdown.good}% / Live ${shotQuality.breakdown.live}% / Tough ${shotQuality.breakdown.tough}%)`);
      }
      if (shotQualityAgainst.qualityPct != null) {
        lines.push(`Quality shots allowed (Great + Good): ${shotQualityAgainst.qualityPct}% (Great ${shotQualityAgainst.breakdown.great}% / Good ${shotQualityAgainst.breakdown.good}% / Live ${shotQualityAgainst.breakdown.live}% / Tough ${shotQualityAgainst.breakdown.tough}%)`);
      }
    }
    lines.push("");
    lines.push(`Scoring runs (3+): ${streaks.scoringRuns.count}, best ${streaks.scoringRuns.best}`);
    lines.push(`Stop runs (3+): ${streaks.stopRuns.count}, best ${streaks.stopRuns.best}`);
    return lines.join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied or unavailable -- nothing to recover here silently
    }
  }

  return (
    <button
      onClick={copy}
      style={{ padding: "5px 10px", fontSize: 12, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer" }}
    >
      {copied ? "Copied ✓" : "Copy as text"}
    </button>
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
  // Tapping a stat name explains it. The definitions live in gameStats.ts
  // and are shared with the lineup reports, so a stat can't end up
  // explained two different ways in two places.
  const [explain, setExplain] = useState<string | null>(null);
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
            <span
              onClick={() => STAT_EXPLAINERS[us.key] && setExplain(explain === us.key ? null : us.key)}
              style={{
                textAlign: "center", fontSize: 13, color: "var(--text)", whiteSpace: "nowrap",
                cursor: STAT_EXPLAINERS[us.key] ? "pointer" : "default",
                textDecoration: STAT_EXPLAINERS[us.key] ? "underline dotted" : "none",
              }}
            >
              {us.label}
            </span>
            {opp ? <StatChip row={opp} /> : <span />}
            {explain === us.key && STAT_EXPLAINERS[us.key] && (
              <div style={{ gridColumn: "1 / -1", padding: "8px 10px", marginTop: 4, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>{STAT_EXPLAINERS[us.key].what}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5, fontFamily: "monospace" }}>{STAT_EXPLAINERS[us.key].how}</div>
              </div>
            )}
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

/**
 * Shot quality as a paired row, matching every other stat in the report:
 * our number on the left, theirs on the right, label between. Two stacked
 * full-width bars were nearly impossible to tell apart at a glance, and
 * worse, the bar's colours are category colours (great=green, tough=red) --
 * so a great defensive performance rendered as a solid red bar, the exact
 * opposite of what colour means everywhere else in this report.
 *
 * The breakdown is still one tap away; it just isn't the default view.
 */
function ShotQualityPair({ us, them, usStatus, oppStatus, usGoal, oppGoal, opponentName }: {
  us: ReturnType<typeof computeShotQuality>;
  them: ReturnType<typeof computeShotQuality>;
  usStatus: { label: string; role: "success" | "warning" | "danger" } | null;
  oppStatus: { label: string; role: "success" | "warning" | "danger" } | null;
  usGoal: number | null;
  oppGoal: number | null;
  opponentName?: string;
}) {
  const [open, setOpen] = useState(false);
  const tone = (r?: string) => (r === "success" ? "#2f9e63" : r === "warning" ? "#c48a1f" : r === "danger" ? "#8a2f2f" : "var(--muted)");

  return (
    <div>
      <SectionDivider label="Shot quality" />
      <div
        onClick={() => setOpen((o) => !o)}
        className="gs-paired"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer" }}
      >
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{us.qualityPct != null ? `${us.qualityPct}%` : "—"}</span>
          {usStatus && <span style={{ fontSize: 11, color: tone(usStatus.role) }}>{usStatus.label}</span>}
        </span>
        <span style={{ textAlign: "center", fontSize: 13, color: "var(--text)" }}>
          Quality shots{" "}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>(Great + Good)</span>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {open ? "tap to hide breakdown ▲" : "tap for breakdown ▼"}
          </div>
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{them.qualityPct != null ? `${them.qualityPct}%` : "—"}</span>
          {oppStatus && <span style={{ fontSize: 11, color: tone(oppStatus.role) }}>{oppStatus.label}</span>}
        </span>
      </div>

      {(usGoal != null || oppGoal != null) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
          <span style={{ textAlign: "center" }}>{usGoal != null ? `goal ${usGoal}%+` : ""}</span>
          <span />
          <span style={{ textAlign: "center" }}>{oppGoal != null ? `goal under ${oppGoal}%` : ""}</span>
        </div>
      )}

      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 6 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Shots we took</div>
            {us.total ? <ShotQualityBar breakdown={us.breakdown} /> : <NotGraded />}
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Looks we gave up{opponentName ? ` to ${opponentName}` : ""}</div>
            {them.total ? <ShotQualityBar breakdown={them.breakdown} /> : <NotGraded />}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, fontStyle: "italic" }}>
        Bar colours grade the shot itself, not who benefits — on the right, more red means better defence.
      </div>
    </div>
  );
}

function NotGraded() {
  return (
    <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic", padding: "6px 0" }}>
      Not graded in this game.
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
