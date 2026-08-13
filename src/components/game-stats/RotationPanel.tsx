// src/components/game-stats/RotationPanel.tsx
// Phase 4, observational: the rotation heatmap and the season's findings.
//
// Both are shown from the first game, with a reliability banner that
// changes as thresholds are met, rather than a wall that hides everything
// until some threshold passes. "Not enough data" implies there's nothing to
// see; there is something to see, you just shouldn't act on it yet, and
// those are different messages.
//
// The per-item protection is what makes that safe: anything under its
// sample floor keeps its caveat and sorts below everything that isn't. You
// lose the wall, you don't lose the ordering.

import { useEffect, useMemo, useState } from "react";
import {
  computeFindings, computeRotationHeatmap,
  CONTEXT_POSSESSION_FLOOR, SEGMENT_POSSESSION_FLOOR,
  type Finding,
} from "../../lib/rotationStats";
import { possessionContexts } from "../../lib/lineupStats";
import { useLineupData, playerLabeller } from "../../lib/useLineupData";
import RotationBuilder from "./RotationBuilder";
import { getBlocksPerPeriod } from "../../lib/rotationPlans";
import { supabase } from "../../lib/supabase";

/** Roughly ten games before an "average rotation" means anything. */
const HEATMAP_GAME_FLOOR = 10;

export default function RotationPanel({ gameIds, userId, rosterId }: { gameIds: string[]; userId: string; rosterId: string | null }) {
  const { slices, goals, players, loading, error } = useLineupData(gameIds);
  const [closeOnly, setCloseOnly] = useState(false);
  const [view, setView] = useState<"season" | "plan">("season");
  // Which game a plan is being built for. The season view spans many games;
  // a plan belongs to exactly one.
  const [planGame, setPlanGame] = useState<string>("");
  const [planGames, setPlanGames] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    // Upcoming and recent games on this roster, newest first -- a plan is
    // usually for the next one, occasionally a review of the last.
    (async () => {
      let q = supabase.from("games").select("id, opponent, game_date, game_type").order("game_date", { ascending: false }).limit(30);
      if (rosterId) q = q.eq("roster_id", rosterId);
      const { data } = await q;
      const list = ((data ?? []) as any[])
        .filter((g) => g.game_type !== "practice")
        .map((g) => ({ id: g.id, label: `${g.opponent} · ${g.game_date}` }));
      setPlanGames(list);
      setPlanGame((cur) => cur || list[0]?.id || "");
    })();
  }, [rosterId]);
  const name = useMemo(() => playerLabeller(players), [players]);

  // A close game is the honest picture of your rotation -- blowouts in
  // either direction dilute it with minutes you'd never plan.
  const shown = useMemo(() => {
    if (!closeOnly) return slices;
    return slices.filter((s) => {
      const ctx = possessionContexts(s.possessions);
      const last = [...s.possessions].sort((a, b) => a.sequence - b.sequence).slice(-1)[0];
      const final = last ? ctx.get(last.id)?.margin ?? 0 : 0;
      return Math.abs(final) <= 6;
    });
  }, [slices, closeOnly]);

  // Same grid as the planner, so what you did and what you're planning
  // are read on the same axis.
  const heat = useMemo(() => computeRotationHeatmap(shown, getBlocksPerPeriod()), [shown, view]);
  // Split so a five-man observation and an individual one aren't interleaved
  // -- they're different questions and you read them at different times.
  const lineupFindings = useMemo(() => computeFindings(shown, "lineup"), [shown]);
  const playerFindings = useMemo(() => computeFindings(shown, "individual"), [shown]);

  if (loading) return <div className="card">Loading rotation…</div>;
  if (error) return <div className="card" style={{ color: "#c66", fontSize: 13 }}>{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
        <button onClick={() => setView("season")} style={tab(view === "season")}>What happened</button>
        <button onClick={() => setView("plan")} style={tab(view === "plan")}>Plan</button>
      </div>

      {view === "plan" ? (
        <>
          {planGames.length > 1 && (
            <div style={{ marginBottom: 10 }}>
              <select
                value={planGame}
                onChange={(e) => setPlanGame(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13 }}
              >
                {planGames.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </div>
          )}
          {planGame ? (
            <RotationBuilder
              gameId={planGame}
              userId={userId}
              rosterId={rosterId}
              historySlices={slices}
              goals={goals}
              name={name}
            />
          ) : (
            <div className="card"><span style={{ fontSize: 13, color: "var(--muted)" }}>No games to plan for yet.</span></div>
          )}
        </>
      ) : (
      <>
      <div className="card" style={{ width: "100%", maxWidth: 1400, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 14 }}>Rotation</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{heat.games} game{heat.games === 1 ? "" : "s"} with shifts</span>
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={closeOnly} onChange={(e) => setCloseOnly(e.target.checked)} />
            Close games only
          </label>
        </div>

        <Reliability
          state={heat.games >= HEATMAP_GAME_FLOOR ? "reliable" : heat.games >= 4 ? "building" : "early"}
          detail={`${heat.games} of about ${HEATMAP_GAME_FLOOR} games needed before an average rotation means much.`}
        />

        {!heat.rows.length ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            No shifts in this selection yet — the heatmap is built from who was on the floor.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 520 }}>
              <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
                <span style={{ width: 92, flexShrink: 0 }} />
                {heat.blocks.map((b, i) => (
                  <span key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "var(--muted)" }}>{b}</span>
                ))}
              </div>
              {heat.rows.map((r) => (
                <div key={r.playerId} style={{ display: "flex", gap: 3, marginBottom: 3, alignItems: "center" }}>
                  <span style={{ width: 92, flexShrink: 0, fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name(r.playerId)}
                  </span>
                  {r.cells.map((c) => (
                    <span key={c.block} style={{ flex: 1, height: 24, borderRadius: 3, background: shade(c.share), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: c.share > 0.55 ? "#fff" : "var(--muted)" }}>
                      {c.share ? Math.round(c.share * 100) : ""}
                    </span>
                  ))}
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, lineHeight: 1.6 }}>
                Percentage of games each player was on the floor in that stretch. Blocks are cut by possession, three per period,
                on the same grid the planner will use.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
        <FindingSection title="Five-man findings" findings={lineupFindings} name={name} />
        <FindingSection title="Individual findings" findings={playerFindings} name={name} />
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.7 }}>
          These state what happened, not why. The personnel notes are the biggest differences in who was on the floor for
          those possessions — chosen by size, not by whether they'd explain the result. Three at most per section, and
          fewer when there isn't more worth pointing at.
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function tab(active: boolean): React.CSSProperties {
  return {
    padding: "5px 12px", fontSize: 13, borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent, #3a5fd0)" : "var(--border)"}`,
    background: active ? "var(--accent, #3a5fd0)" : "var(--surface2)",
    color: active ? "#fff" : "var(--muted)",
  };
}

function FindingSection({ title, findings, name }: { title: string; findings: Finding[]; name: (id: string) => string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14, marginBottom: 4 }}>{title}</div>
      {!findings.length ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Nothing stands out yet — no stretch of the game differs from the rest by enough to be worth a line.
        </div>
      ) : (
        findings.map((f, i) => <FindingRow key={i} finding={f} name={name} />)
      )}
    </div>
  );
}

function FindingRow({ finding, name }: { finding: Finding; name: (id: string) => string }) {
  const worse = finding.diff < 0;
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <span style={{ fontWeight: 500 }}>{finding.label}</span>{" "}
        runs{" "}
        <span style={{ color: worse ? "#d98b8b" : "#5cb98b" }}>
          {Math.abs(finding.diff).toFixed(2)} PPP {worse ? "below" : "above"}
        </span>{" "}
        the rest of the game.
        <span style={{ color: "var(--muted)" }}> ({finding.segmentPPP.toFixed(2)} vs {finding.baselinePPP.toFixed(2)}, {finding.possessions} possessions)</span>
      </div>

      {!finding.confident && (
        <Caveat text={`${finding.possessions} possessions — not enough to say this with confidence yet. This caveat drops at ${SEGMENT_POSSESSION_FLOOR}.`} />
      )}

      {finding.context.length > 0 && (
        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>What's different about these possessions</div>
          {finding.context.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
              {/* Player ids are embedded as __id__ so names resolve here rather than in the maths. */}
              {c.text.split(/__(.*?)__/).map((part, j) => (j % 2 ? <span key={j} style={{ color: "var(--text)" }}>{name(part)}</span> : part))}
            </div>
          ))}
          {!finding.context[0].confident && (
            <Caveat text={`${finding.context[0].possessions} possessions — not enough to say this with confidence yet. This caveat drops at ${CONTEXT_POSSESSION_FLOOR}.`} />
          )}
        </div>
      )}
    </div>
  );
}

function Caveat({ text }: { text: string }) {
  return <div style={{ fontSize: 11, color: "#c9a227", marginTop: 4, fontStyle: "italic" }}>⚠ {text}</div>;
}

export function Reliability({ state, detail }: { state: "early" | "building" | "reliable"; detail: string }) {
  const copy = {
    early: { icon: "⚠", color: "#c9a227", text: "Early days — treat everything here as a curiosity rather than a finding." },
    building: { icon: "⚠", color: "#c9a227", text: "Building — rows without a caveat are worth reading; the rest aren't there yet." },
    reliable: { icon: "✓", color: "#5cb98b", text: "Enough data behind this to read it straight." },
  }[state];
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 12, color: copy.color, marginBottom: 10, lineHeight: 1.6 }}>
      <span>{copy.icon}</span>
      <span>{copy.text} <span style={{ color: "var(--muted)" }}>{detail}</span></span>
    </div>
  );
}

/** Pale to deep green by share. */
function shade(share: number): string {
  if (!share) return "var(--surface2)";
  const t = Math.min(1, share);
  const r = Math.round(36 + (47 - 36) * t);
  const g = Math.round(42 + (158 - 42) * t);
  const b = Math.round(48 + (99 - 48) * t);
  return `rgb(${r},${g},${b})`;
}
