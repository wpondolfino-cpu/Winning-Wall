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

import QuizManager from "../quizzes/QuizManager";
import { createReviewQuiz } from "../../lib/gameReviewQuiz";
import { Fragment, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  computeTeamStats,
  computeShotQuality,
  computeStreaks,
  computePlayCallEffectiveness,
  computeOobEffectiveness,
  computePressBreakEffectiveness,
  computeInboundsDefense,
  computeHalfCourtStructure,
  computePaintBallMovement,
  PAINT_THIN_SHOTS,
  statInSections,
  StatSection,
  PaintGroup,
  computeQualityConversion,
  computeTurnoverBreakdown,
  computePeriodSplits,
  computePrevPossession,
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
  SAMPLE_UNITS,
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

// Three tiers, not two. "full" is the end-of-game / season report;
// "custom" is a report built in the report tab, which additionally shows
// everything flagged builderOnly -- the deeper cuts that would bury the
// end-of-game report but are the whole reason to build a report yourself.
export type ReportVariant = "in_game" | "full" | "custom";

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
        // An untracked game has no possessions and counts for nothing here —
        // not as a game played, and not toward the record.
        .eq("track_stats", true)
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

  return (
    <>
      {canManage && scope.kind === "game" && variant !== "in_game" && possessions.length > 0 && (
        <ReviewQuizButton gameId={scope.gameId} />
      )}
      <ReportBody possessions={possessions} playCalls={playCalls} goals={goals} title={title} statOrder={statOrder} variant={variant} opponentName={opponentName} isPractice={isPractice} canManage={canManage} />
    </>
  );
}

/**
 * "📝 Make review quiz" on a game's end-of-game report: drafts a quiz from
 * the team stats (never individual or lineup stats) and opens it right
 * here. Says "Open review quiz" once the game has one.
 */
function ReviewQuizButton({ gameId }: { gameId: string }) {
  const [existing, setExisting] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = () => {
    supabase.from("quizzes").select("id, status").eq("review_game_id", gameId).neq("status", "archived")
      .then(({ data }: { data: unknown }) => {
        const rows = (data ?? []) as { id: string; status: string }[];
        setExisting((rows.find(r => r.status === "published") ?? rows[0])?.id ?? null);
      });
  };
  useEffect(check, [gameId]);

  async function go() {
    if (existing) { setOpenId(existing); return; }
    setBusy(true); setError(null);
    try { setOpenId((await createReviewQuiz(gameId)).id); }
    catch (e: any) { setError(e?.message ?? "Couldn't build the review quiz."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginBottom: 10 }}>
        {error && <span style={{ fontSize: 12, color: "#ff7b7b" }}>{error}</span>}
        <button type="button" onClick={go} disabled={busy}
          style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8,
            padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          {busy ? "Building…" : existing ? "📝 Open review quiz" : "📝 Make review quiz"}
        </button>
      </div>
      {openId && (
        <div className="modal-overlay open" onClick={() => { setOpenId(null); check(); }}>
          <div className="log-modal" style={{ maxWidth: 820 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setOpenId(null); check(); }}>✕</button>
            <QuizManager quizId={openId} onDeleted={() => { setOpenId(null); check(); }} />
          </div>
        </div>
      )}
    </>
  );
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
  sections = null,
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
  /** Report builder "Show" filter. null / empty = every section. */
  sections?: StatSection[] | null;
}) {
  const visible = statOrder.filter((s) => {
    if (!statInSections(s.key, sections)) return false;
    if (s.builderOnly) return variant === "custom";
    return variant === "in_game" ? s.inGame : true;
  });
  const filtered = !!sections && sections.length > 0;
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
    if (variant === "in_game" || !possessions.length) { setSuggestions(null); return; }
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
  const zonePlays = computePlayCallEffectiveness(possessions, playCalls.filter((p) => p.category === "zone"));
  const pressBreak = computePressBreakEffectiveness(possessions, playCalls);
  const inbounds = computeInboundsDefense(possessions);
  // Their inbounds, split by what we were in -- the mirror of the block above.
  const inboundsD = computeInboundsDefense(possessions, "opponent");
  const halfCourt = computeHalfCourtStructure(possessions);
  const paintUs = computePaintBallMovement(possessions, "us");
  const paintThem = computePaintBallMovement(possessions, "opponent");
  const qualityUs = computeQualityConversion(possessions, "us");
  const qualityThem = computeQualityConversion(possessions, "opponent");
  const tovBreak = computeTurnoverBreakdown(possessions);
  const periods = computePeriodSplits(possessions);
  const prev = computePrevPossession(possessions);
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

      <PairedStatRows usRows={usRows} oppRows={oppRows} opponentName={opponentName} variant={variant} />

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
              <div style={{ height: 8 }} />
              <PlayCallTable rows={zonePlays} />
            </div>
          );
        }

        if (s.kind === "half_court_structure") {
          if (!halfCourt.total) return null;
          return (
            <div key={s.key}>
              <SectionDivider label="Half court (man / zone)" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <SplitCard label="vs man" row={halfCourt.vsMan} unit="looks" />
                <SplitCard label="vs zone" row={halfCourt.vsZone} unit="looks" />
              </div>
              <div style={{ height: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <SplitCard label="Man set" row={halfCourt.set} unit="looks" />
                <SplitCard label="Motion" row={halfCourt.motion} unit="looks" />
                <SplitCard label="Zone set" row={halfCourt.zone} unit="looks" />
                <SplitCard label="Unscripted" row={halfCourt.unscripted} unit="looks" />
              </div>
              {inbounds.total > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <SplitCard label="Inbounds vs man" row={inbounds.man} unit="looks" />
                    <SplitCard label="Inbounds vs zone" row={inbounds.zone} unit="looks" />
                  </div>
                  <div style={{ fontSize: 12, color: inbounds.untagged ? "#8a6512" : "var(--muted)", marginTop: 4 }}>
                    {inbounds.tagged} of {inbounds.total} inbounds looks tagged
                    {inbounds.untagged > 0 && " - the rest can be tagged in the possession editor"}
                  </div>
                </div>
              )}
            </div>
          );
        }

        if (s.kind === "paint_impact") {
          if (!paintUs.total && !paintThem.total) return null;
          return <PaintBallMovementBlock key={s.key} us={paintUs} them={paintThem} opponentName={opponentName} />;
        }

        if (s.kind === "quality_conversion") {
          if (!qualityUs.some((q) => q.attempts)) return null;
          return (
            <div key={s.key}>
              <SectionDivider label="Shot quality conversion" />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>
                <span>Grade</span><span>Us (eFG%)</span><span>Them (eFG%)</span>
              </div>
              {qualityUs.map((q, i) => (
                <div key={q.grade} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  <span style={{ textTransform: "capitalize" }}>{q.grade}</span>
                  <span>{q.efg}% <span style={{ color: "var(--muted)" }}>({q.made}/{q.attempts})</span></span>
                  <span>{qualityThem[i].efg}% <span style={{ color: "var(--muted)" }}>({qualityThem[i].made}/{qualityThem[i].attempts})</span></span>
                </div>
              ))}
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Every graded shot, including misses that were rebounded. Games tracked before rebounded misses kept their grade only include the shot that ended each trip.
              </div>
            </div>
          );
        }

        if (s.kind === "turnover_breakdown") {
          if (!tovBreak.us.total && !tovBreak.opponent.total) return null;
          return (
            <div key={s.key}>
              <SectionDivider label="Turnover breakdown" />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>
                <span /><span>Live</span><span>Dead</span><span>Charge</span><span>Live %</span>
              </div>
              {([["Us", tovBreak.us], ["Them", tovBreak.opponent]] as const).map(([label, t]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  <span>{label}</span><span>{t.live}</span><span>{t.dead}</span><span>{t.charge}</span><span>{t.livePct}%</span>
                </div>
              ))}
            </div>
          );
        }

        if (s.kind === "period_splits") {
          if (periods.length < 2) return null;
          return (
            <div key={s.key}>
              <SectionDivider label="By period" />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>
                <span>Period</span><span>Poss</span><span>Our PPP</span><span>Their PPP</span><span>Margin</span>
              </div>
              {periods.map((p) => (
                <div key={p.period} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  <span>{p.period}</span><span>{p.possessions}</span><span>{p.ourPpp}</span><span>{p.theirPpp}</span>
                  <span style={{ color: p.margin > 0 ? "#2f9e63" : p.margin < 0 ? "#8a2f2f" : undefined }}>
                    {p.margin > 0 ? "+" : ""}{p.margin}
                  </span>
                </div>
              ))}
            </div>
          );
        }

        if (s.kind === "prev_possession") {
          const any = prev.afterScore.trips + prev.afterMiss.trips + prev.afterTurnover.trips;
          if (!any) return null;
          return (
            <div key={s.key}>
              <SectionDivider label="After their possession" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <SplitCard label="After they score" row={prev.afterScore} />
                <SplitCard label="After they miss" row={prev.afterMiss} />
                <SplitCard label="After their turnover" row={prev.afterTurnover} />
              </div>
            </div>
          );
        }

        if (s.kind === "press_break") {
          if (!pressBreak.total) return null;
          return (
            <div key={s.key}>
              <SectionDivider label="Press break" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Press possessions</div>
                  <div style={{ fontSize: 20, fontWeight: 500 }}>{pressBreak.total}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{pressBreak.ppp} ppp</div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Press broken</div>
                  <div style={{ fontSize: 20, fontWeight: 500 }}>{pressBreak.broken}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{pressBreak.brokenPct}%</div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Press turnovers</div>
                  <div style={{ fontSize: 20, fontWeight: 500 }}>{pressBreak.turnovers}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{pressBreak.turnoverPct}%</div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Points off the break</div>
                  <div style={{ fontSize: 20, fontWeight: 500 }}>{pressBreak.pointsOffBreak}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>transition + FTs</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Broke into transition {pressBreak.toTransition}x, half court {pressBreak.toHalfCourt}x, to the line {pressBreak.toFtTrip}x, foul/jump/OOB {pressBreak.toOob}x
              </div>
              {pressBreak.byType.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {pressBreak.byType.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                      <span>{r.name}</span>
                      <span style={{ color: "var(--muted)" }}>{r.calls} faced · {r.broken} broken · {r.turnovers} TO · {r.ppp} ppp</span>
                    </div>
                  ))}
                </div>
              )}
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
              {/* Ours on top, theirs below — the same trips read from the
                  other side, so a game where nothing went wrong shows two
                  rows of zeros underneath and that's worth seeing. */}
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Us</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
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
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Them</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Scoring runs (3+)</div>
                  <div style={{ fontSize: 20, fontWeight: 500 }}>{streaks.theirScoringRuns.count}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>best run: {streaks.theirScoringRuns.best} straight</div>
                </div>
                <div className="stat-card">
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Stop runs (3+)</div>
                  <div style={{ fontSize: 20, fontWeight: 500 }}>{streaks.theirStopRuns.count}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>best run: {streaks.theirStopRuns.best} straight</div>
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
              {inboundsD.tagged > 0 && (
                <>
                  <div className="stat-grid" style={{ marginTop: 8 }}>
                    <SplitCard label="Their inbounds vs our man" row={inboundsD.man} unit="looks" />
                    <SplitCard label="Their inbounds vs our zone" row={inboundsD.zone} unit="looks" />
                  </div>
                  <div style={{ fontSize: 12, color: inboundsD.untagged ? "#8a6512" : "var(--muted)", marginTop: 4 }}>
                    {inboundsD.tagged} of {inboundsD.total} of their inbounds looks tagged
                    {inboundsD.untagged > 0 && " - the rest can be tagged in the possession editor"}
                  </div>
                </>
              )}
              {defense.press.calls > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  Press forced {defense.pressTurnovers} turnover{defense.pressTurnovers === 1 ? "" : "s"} · broke down to Man {defense.pressToMan}x, Zone {defense.pressToZone}x, transition {defense.pressToTransition}x · fouled/OOB {defense.pressToOob}x · to the line {defense.pressToFtTrip}x
                </div>
              )}
            </div>
          );
        }
        return null;
      })}

      {suggestions && !filtered && <PracticeSuggestionsPanel suggestions={suggestions} canManage={canManage} />}
    </div>
  );
}

/** `unit` says what was counted: whole trips (points per possession) or looks (points per look, each look bringing only what it scored). */
// ── Paint touch & ball movement (report builder) ──────────────────────
// Four groups that don't overlap, so they can be compared head to head.
// Cards on a phone, one table on a wider screen.
type PaintResult = ReturnType<typeof computePaintBallMovement>;

const QUALITY_COLORS = { great: "#1f7a4d", good: "#2f9e63", live: "#c48a1f", tough: "#8a2f2f" } as const;

function QualityMix({ g, height = 12 }: { g: PaintGroup; height?: number }) {
  if (!g.qualityGraded) return <span style={{ fontSize: 11, color: "var(--muted)" }}>no graded shots</span>;
  return (
    <div style={{ display: "flex", height, borderRadius: height / 2, overflow: "hidden" }}
      title={`Great ${g.quality.great}% · Good ${g.quality.good}% · Live ${g.quality.live}% · Tough ${g.quality.tough}%`}>
      {(["great", "good", "live", "tough"] as const).map((k) => (
        <div key={k} style={{ width: `${g.quality[k]}%`, background: QUALITY_COLORS[k] }} />
      ))}
    </div>
  );
}

function PaintBallMovementBlock({ us, them, opponentName }: { us: PaintResult; them: PaintResult; opponentName?: string }) {
  const [side, setSide] = useState<"us" | "them">("us");
  const [explain, setExplain] = useState(false);
  const r = side === "us" ? us : them;
  const maxPps = Math.max(1.5, ...r.groups.map((g) => g.pps));
  const vsAll = (g: PaintGroup) => {
    if (g.thin || r.all.thin) return null;
    const d = Math.round((g.efg - r.all.efg) * 10) / 10;
    // For "them" a higher eFG is worse for us, so the colour flips.
    const good = side === "us" ? d >= 0 : d <= 0;
    return <span style={{ fontSize: 11, color: good ? "#6fd3a0" : "#e07b6e" }}>{d >= 0 ? "+" : "−"}{Math.abs(d)} vs all</span>;
  };
  // Same convention as the rest of the built reports: an amber ⚠ on a
  // number from too few to lean on (explained once at the top, tap it for
  // the count) -- not fading, which the app doesn't use anywhere else.
  const fade = (_g: PaintGroup) => 1;
  const [sampleOpen, setSampleOpen] = useState<string | null>(null);
  const anyThin = r.groups.some((g) => g.thin);
  const warn = (g: PaintGroup) => g.thin ? (
    <button onClick={() => setSampleOpen(sampleOpen === g.key ? null : g.key)} title="Why this is flagged"
      style={{ background: "none", border: 0, padding: "0 0 0 4px", color: "#e8a33d", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>⚠</button>
  ) : null;
  const sampleNote = (g: PaintGroup) => sampleOpen === g.key ? (
    <div style={{ fontSize: 12, lineHeight: 1.5, color: "#e8a33d", padding: "4px 0" }}>
      From <b>{g.fga}</b> shot{g.fga === 1 ? "" : "s"}. Reads reliably from about <b>{PAINT_THIN_SHOTS}</b>{g.fga >= PAINT_THIN_SHOTS * 0.6 ? " — close; another game or two should do it." : " — run it over more games."}
    </div>
  ) : null;
  const tab = (key: "us" | "them", label: string) => (
    <button onClick={() => setSide(key)} style={{
      height: 32, padding: "0 14px", border: 0, borderRadius: 8, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
      background: side === key ? "var(--royal)" : "transparent", color: side === key ? "#f5f7fc" : "var(--muted)",
    }}>{label}</button>
  );
  const cell: CSSProperties = { padding: "10px 8px", borderTop: "1px solid var(--border)", fontSize: 13 };
  const sub = (a: number, b: number) => <span style={{ color: "var(--muted)" }}> {a}/{b}</span>;

  return (
    <div>
      <style>{`
        .pbm-table { display: grid; }
        .pbm-cards { display: none; }
        @media (max-width: 700px) { .pbm-table { display: none; } .pbm-cards { display: flex; } }
      `}</style>
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 10, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setExplain((v) => !v)} style={{ background: "none", border: 0, padding: 0, color: "var(--muted)", fontSize: 13, fontFamily: "inherit", cursor: "pointer", flex: 1, textAlign: "left" }}>
          Paint touch &amp; ball movement · {r.total} half-court looks <span style={{ fontSize: 11 }}>ⓘ</span>
        </button>
        <div style={{ display: "flex", background: "var(--surface2)", borderRadius: 10, padding: 3, gap: 2 }}>
          {tab("us", "Us")}
          {tab("them", opponentName ? opponentName : "Them")}
        </div>
      </div>
      {explain && (
        <div style={{ fontSize: 12, lineHeight: 1.55, color: "var(--muted)", marginBottom: 10 }}>
          {STAT_EXPLAINERS.paint_impact?.what}
        </div>
      )}

      {!r.total ? (
        <div style={{ fontSize: 13, color: "var(--muted)", padding: "6px 0" }}>No half-court looks with a paint touch answer yet.</div>
      ) : (
        <>
          {anyThin && (
            <div style={{ fontSize: 11, color: "#e8a33d", marginBottom: 8, lineHeight: 1.5 }}>
              ⚠ marks a group with too few shots to lean on. Tap it to see how many, and how close it is to reading reliably.
            </div>
          )}
          {/* Points per shot, all four groups at a glance */}
          <div className="stat-card" style={{ display: "grid", gridTemplateColumns: "130px minmax(0, 1fr) 40px", gap: "6px 8px", alignItems: "center", fontSize: 12, marginBottom: 10 }}>
            <span style={{ gridColumn: "1 / -1", color: "var(--muted)" }}>Points per shot</span>
            {r.groups.map((g) => (
              <Fragment key={g.key}>
                <span style={{ opacity: fade(g) }}>{g.label}{warn(g)}</span>
                <div style={{ height: 14, background: "var(--surface)", borderRadius: 4, opacity: fade(g) }}>
                  <div style={{ width: `${Math.min(100, (g.pps / maxPps) * 100)}%`, height: 14, borderRadius: 4, background: r.best === g.key ? "var(--gold)" : "var(--royal-light)" }} />
                </div>
                <span style={{ textAlign: "right", fontWeight: 600, opacity: fade(g) }}>{g.pps.toFixed(2)}</span>
              </Fragment>
            ))}
            <span style={{ color: "var(--muted)" }}>All half-court</span>
            <div style={{ height: 14, background: "var(--surface)", borderRadius: 4 }}>
              <div style={{ width: `${Math.min(100, (r.all.pps / maxPps) * 100)}%`, height: 14, borderRadius: 4, border: "1px dashed var(--muted)", boxSizing: "border-box" }} />
            </div>
            <span style={{ textAlign: "right", color: "var(--muted)" }}>{r.all.pps.toFixed(2)}</span>
          </div>

          {/* Wide screens: one table */}
          <div className="pbm-table" style={{ gridTemplateColumns: "190px 90px repeat(6, minmax(0, 1fr)) 60px 150px", overflowX: "auto" }}>
            {["Group", "Looks", "FG%", "2PT%", "3PT%", "eFG%", "Pts / shot", "Pts / look", "TO%", "Shot quality"].map((h) => (
              <span key={h} style={{ padding: "6px 8px", fontSize: 12, color: "var(--muted)" }}>{h}</span>
            ))}
            {[...r.groups, r.all].map((g) => {
              const isAll = g.key === "all";
              const bg = r.best === g.key ? "rgba(240,192,64,0.08)" : undefined;
              const st: CSSProperties = { ...cell, background: bg, opacity: fade(g), color: isAll ? "var(--muted)" : undefined, borderTop: isAll ? "1px dashed var(--border)" : cell.borderTop };
              return (
                <Fragment key={g.key}>
                  <span style={{ ...st, fontWeight: 600 }}>{g.label}{!isAll && warn(g)}</span>
                  <span style={st}>{g.looks}{!isAll && <span style={{ color: "var(--muted)" }}> {Math.round(g.share)}%</span>}</span>
                  <span style={st}>{g.fgPct}{sub(g.fgm, g.fga)}</span>
                  <span style={st}>{g.fg2Pct}{sub(g.fg2m, g.fg2a)}</span>
                  <span style={st}>{g.fg3Pct}{sub(g.fg3m, g.fg3a)}</span>
                  <span style={{ ...st, fontWeight: 600 }}>{g.efg}</span>
                  <span style={{ ...st, fontWeight: 600 }}>{g.pps.toFixed(2)}</span>
                  <span style={st}>{g.ppl.toFixed(2)}</span>
                  <span style={st}>{g.tovPct}</span>
                  <span style={{ ...st, display: "flex", alignItems: "center" }}><span style={{ flex: 1 }}><QualityMix g={g} /></span></span>
                </Fragment>
              );
            })}
          </div>

          <div className="pbm-table" style={{ display: "block" }}>{r.groups.map((g) => <Fragment key={g.key}>{sampleNote(g)}</Fragment>)}</div>

          {/* Phones: a card per group */}
          <div className="pbm-cards" style={{ flexDirection: "column", gap: 8 }}>
            {r.groups.map((g) => (
              <div key={g.key} className="stat-card" style={{ display: "flex", flexDirection: "column", gap: 10, opacity: fade(g), borderColor: r.best === g.key ? "var(--gold)" : undefined }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{g.label}{warn(g)}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{g.looks} looks · {Math.round(g.share)}%</span>
                </div>
                {sampleNote(g)}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 11, color: "var(--muted)" }}>eFG%</span><span style={{ fontSize: 20, fontWeight: 600 }}>{g.efg}</span>{vsAll(g)}</div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 11, color: "var(--muted)" }}>Pts / shot</span><span style={{ fontSize: 20, fontWeight: 600 }}>{g.pps.toFixed(2)}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 11, color: "var(--muted)" }}>Pts / look</span><span style={{ fontSize: 20, fontWeight: 600 }}>{g.ppl.toFixed(2)}</span></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6, fontSize: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--muted)" }}>FG%</span><span>{g.fgPct}{sub(g.fgm, g.fga)}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--muted)" }}>2PT%</span><span>{g.fg2Pct}{sub(g.fg2m, g.fg2a)}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--muted)" }}>3PT%</span><span>{g.fg3Pct}{sub(g.fg3m, g.fg3a)}</span></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={{ color: "var(--muted)" }}>TO%</span><span>{g.tovPct}</span></div>
                </div>
                <QualityMix g={g} />
                {g.qualityGraded > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
                    <span>Great {g.quality.great}%</span><span>Good {g.quality.good}%</span><span>Live {g.quality.live}%</span><span>Tough {g.quality.tough}%</span>
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "10px 14px", border: "1px dashed var(--border)", borderRadius: 12, fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>All half-court</span>
              <span style={{ color: "var(--muted)" }}>eFG {r.all.efg} · {r.all.pps.toFixed(2)} pts/shot · FG {r.all.fgm}/{r.all.fga} · TO {r.all.tovPct}%</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SplitCard({ label, row, unit = "trips" }: { label: string; row: { trips: number; points: number; ppp: number }; unit?: "trips" | "looks" }) {
  return (
    <div className="stat-card">
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500 }}>{row.ppp}</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{row.trips} {row.trips === 1 ? unit.slice(0, -1) : unit} · {row.points} pts</div>
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
    lines.push(`Scoring runs (3+): us ${streaks.scoringRuns.count} (best ${streaks.scoringRuns.best}), them ${streaks.theirScoringRuns.count} (best ${streaks.theirScoringRuns.best})`);
    lines.push(`Stop runs (3+): us ${streaks.stopRuns.count} (best ${streaks.stopRuns.best}), them ${streaks.theirStopRuns.count} (best ${streaks.theirStopRuns.best})`);
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

function PairedStatRows({ usRows, oppRows, opponentName, variant }: { usRows: StatRow[]; oppRows: StatRow[]; opponentName?: string; variant?: ReportVariant }) {
  // Tapping a stat name explains it. The definitions live in gameStats.ts
  // and are shared with the lineup reports, so a stat can't end up
  // explained two different ways in two places.
  const [explain, setExplain] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  if (!usRows.length) return <div style={{ fontSize: 13, color: "var(--muted)", padding: "6px 0" }}>No stats in this set yet.</div>;
  return (
    <div>
      <style>{`
        .gs-paired { grid-template-columns: 1fr 1fr 1fr; }
      `}</style>
      {/* Said once at the top rather than repeated on every flagged row —
          the icon needs a meaning, not an explanation each time. */}
      {variant === "custom" && usRows.some(r => r.sampleMin != null && r.sampleN != null && r.sampleN < r.sampleMin) && (
        <div style={{ fontSize: 11, color: "#e8a33d", marginBottom: 8, lineHeight: 1.5 }}>
          ⚠ marks a number computed from too few to lean on. Tap it to see how many, and how close it is to reading reliably.
        </div>
      )}
      <div className="gs-paired" style={{ display: "grid", gap: 8, marginBottom: 6 }}>
        <span style={{ textAlign: "center", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Us</span>
        <span />
        <span style={{ textAlign: "center", fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{opponentName ?? "Opponent"}</span>
      </div>
      {usRows.map((us, i) => {
        const opp = oppRows[i];
        return (
          <div key={us.key} className="gs-paired" style={{ display: "grid", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <StatChip row={us} flagThin={variant === "custom"} onExplainSample={() => setSample(sample === us.key ? null : us.key)} />
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
            {opp ? <StatChip row={opp} flagThin={variant === "custom"} onExplainSample={() => setSample(sample === us.key ? null : us.key)} /> : <span />}
            {sample === us.key && us.sampleN != null && us.sampleMin != null && (
              <div style={{ gridColumn: "1 / -1", padding: "8px 10px", marginTop: 4, background: "rgba(232,163,61,0.08)", border: "1px solid rgba(232,163,61,0.35)", borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>
                  From <b>{us.sampleN}</b> {SAMPLE_UNITS[us.key] ?? "of them"}
                  {opp?.sampleN != null && opp.sampleN !== us.sampleN && <> — {opp.sampleN} for {opponentName ?? "them"}</>}.
                  {" "}Reads reliably from about <b>{us.sampleMin}</b>. Most rates clear that in two or three games; threes and free throws take longer, because fewer of them happen.
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5, lineHeight: 1.5 }}>
                  {us.sampleN >= us.sampleMin * 0.8
                    ? "Close enough to the mark to be worth something — treat it as a strong hint rather than a finding."
                    : us.sampleN >= us.sampleMin * 0.4
                      ? "Some way short. Fine for noticing a pattern, not for making a call on it."
                      : "Far short — this number will move a lot as games are added."}
                  {" "}Adding games to the report, or loosening a filter, fills it in.
                </div>
              </div>
            )}
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

/**
 * Thin samples are annotated, never hidden or dimmed.
 *
 * The number still shows exactly as it did — dimming it would read as
 * broken rather than provisional. What's added is the count it came from,
 * because "from 6 possessions" is a fact you can judge while "small
 * sample" is a label you'd have to take on trust.
 *
 * Only on reports built in the Reports tab. A quarter is fifteen
 * possessions by definition, so flagging one would paint the whole thing
 * amber and teach you to ignore amber.
 */
function StatChip({ row, flagThin = false, onExplainSample }: { row: StatRow; flagThin?: boolean; onExplainSample?: () => void }) {
  const thin = flagThin && row.sampleMin != null && row.sampleN != null && row.sampleN < row.sampleMin;
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
        title={[
          row.goal != null ? `goal ${row.goal}` : null,
          thin ? `from ${row.sampleN} — under ${row.sampleMin}, so read it lightly` : null,
        ].filter(Boolean).join(" · ") || undefined}
      >
        {row.display ?? (row.signed && row.value > 0 ? `+${row.value}` : row.value)}
        {thin && (
          <span onClick={(e: any) => { e.stopPropagation(); onExplainSample?.(); }}
            title="Why this is flagged"
            style={{ marginLeft: 4, fontSize: 11, cursor: onExplainSample ? "pointer" : "default" }}>⚠</span>
        )}
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
 * worse, the bar's colors are category colors (great=green, tough=red) --
 * so a great defensive performance rendered as a solid red bar, the exact
 * opposite of what color means everywhere else in this report.
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
        Bar colors grade the shot itself, not who benefits — on the right, more red means better defence.
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
