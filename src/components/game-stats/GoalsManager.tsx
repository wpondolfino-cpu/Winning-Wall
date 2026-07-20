// src/components/game-stats/GoalsManager.tsx
// Three things live here: the display order every report uses for its
// stats (up/down arrows, saved to report_layout -- see resolveStatOrder
// in gameStats.ts), and independent goal targets for Us and Opponent per
// numeric stat. If no Opponent-specific goal is set for a stat, reports
// fall back to inverting the Us goal (see computeTeamStats) -- setting one
// here overrides that fallback with a real target, e.g. holding the
// opponent's eFG% to something tighter than just "below ours."

import { useEffect, useState } from "react";
import {
  GOAL_STATS,
  DEFAULT_STAT_ORDER,
  listStatGoals,
  upsertStatGoal,
  getReportLayout,
  saveReportLayout,
  resolveStatOrder,
  type StatGoal,
  type StatDef,
  type Team,
} from "../../lib/gameStats";

interface Props {
  userId: string;
}

type Draft = { value: string; direction: "higher_better" | "lower_better" };

export default function GoalsManager({ userId }: Props) {
  const [goals, setGoals] = useState<Record<string, StatGoal>>({}); // keyed "team:statKey"
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [goalTeam, setGoalTeam] = useState<Team>("us");

  const [order, setOrder] = useState<StatDef[]>(DEFAULT_STAT_ORDER);
  const [orderSaved, setOrderSaved] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data }, savedOrder] = await Promise.all([listStatGoals(), getReportLayout()]);
    const byKey: Record<string, StatGoal> = {};
    (data as StatGoal[] ?? []).forEach((g) => { byKey[`${g.team}:${g.stat_key}`] = g; });
    setGoals(byKey);
    const initDrafts: Record<string, Draft> = {};
    (["us", "opponent"] as Team[]).forEach((team) => {
      GOAL_STATS.forEach((s) => {
        const existing = byKey[`${team}:${s.key}`];
        initDrafts[`${team}:${s.key}`] = { value: existing ? String(existing.target_value) : "", direction: existing?.direction ?? s.defaultDirection };
      });
    });
    setDrafts(initDrafts);
    setOrder(resolveStatOrder(savedOrder));
    setLoading(false);
  }

  async function save(team: Team, key: string) {
    const draftKey = `${team}:${key}`;
    const draft = drafts[draftKey];
    const num = Number(draft.value);
    if (draft.value.trim() === "" || Number.isNaN(num)) return;
    const { error } = await upsertStatGoal(key, team, num, draft.direction, userId);
    if (!error) {
      setGoals((g) => ({ ...g, [draftKey]: { stat_key: key, team, target_value: num, direction: draft.direction } }));
      setSavedKey(draftKey);
      setTimeout(() => setSavedKey((k) => (k === draftKey ? null : k)), 1500);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setOrderDirty(true);
    setOrderSaved(false);
  }

  async function saveOrder() {
    const { error } = await saveReportLayout(order.map((s) => s.key), userId);
    if (!error) {
      setOrderDirty(false);
      setOrderSaved(true);
      setTimeout(() => setOrderSaved(false), 1500);
    }
  }

  if (loading) return <div className="card">Loading goals…</div>;

  return (
    <div>
      <div className="card" style={{ width: "100%", maxWidth: 1400, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Report order</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          Controls the order stats appear in on every report. Any stat added later falls in at the bottom by default.
        </div>

        {order.map((s, i) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ fontSize: 14, flex: 1 }}>{s.label}</span>
            {!s.inGame && <span style={{ fontSize: 11, color: "var(--muted)" }}>full report only</span>}
            <button onClick={() => move(i, -1)} disabled={i === 0} style={arrowBtnStyle(i === 0)}>↑</button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} style={arrowBtnStyle(i === order.length - 1)}>↓</button>
          </div>
        ))}

        <button className="btn-primary" style={{ width: "auto", padding: "6px 14px", marginTop: 12 }} onClick={saveOrder} disabled={!orderDirty && !orderSaved}>
          {orderSaved ? "Saved ✓" : "Save order"}
        </button>
      </div>

      <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>Season goals</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          Reports color a stat green/yellow/red against the target you set here. Leave Opponent blank to just invert your Us target instead of setting a separate number.
        </div>

        <div className="role-tabs" style={{ marginBottom: 12, maxWidth: 300 }}>
          <button className={`role-tab ${goalTeam === "us" ? "active" : ""}`} onClick={() => setGoalTeam("us")}>Us</button>
          <button className={`role-tab ${goalTeam === "opponent" ? "active" : ""}`} onClick={() => setGoalTeam("opponent")}>Opponent</button>
        </div>

        {GOAL_STATS.map((s) => {
          const draftKey = `${goalTeam}:${s.key}`;
          const draft = drafts[draftKey] ?? { value: "", direction: s.defaultDirection };
          const existing = goals[draftKey];
          const usGoal = goals[`us:${s.key}`];
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, width: 150 }}>{s.label}</span>

              <input
                type="number"
                step="any"
                value={draft.value}
                onChange={(e) => setDrafts((d) => ({ ...d, [draftKey]: { ...d[draftKey], value: e.target.value } }))}
                placeholder={goalTeam === "opponent" && !draft.value ? "falls back to Us" : "target"}
                style={{ width: 110, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              />

              <div className="role-tabs" style={{ margin: 0, width: "auto" }}>
                <button
                  className={`role-tab ${draft.direction === "higher_better" ? "active" : ""}`}
                  onClick={() => setDrafts((d) => ({ ...d, [draftKey]: { ...d[draftKey], direction: "higher_better" } }))}
                >
                  Higher is better
                </button>
                <button
                  className={`role-tab ${draft.direction === "lower_better" ? "active" : ""}`}
                  onClick={() => setDrafts((d) => ({ ...d, [draftKey]: { ...d[draftKey], direction: "lower_better" } }))}
                >
                  Lower is better
                </button>
              </div>

              <button className="btn-primary" style={{ width: "auto", padding: "6px 14px" }} onClick={() => save(goalTeam, s.key)}>
                {savedKey === draftKey ? "Saved ✓" : "Save"}
              </button>

              {existing ? (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  current: {existing.target_value} ({existing.direction === "higher_better" ? "higher better" : "lower better"})
                </span>
              ) : goalTeam === "opponent" && usGoal ? (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  not set — using inverse of Us ({usGoal.target_value}, {usGoal.direction === "higher_better" ? "lower better for them" : "higher better for them"})
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function arrowBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface2)",
    color: disabled ? "var(--muted)" : "var(--text)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}
