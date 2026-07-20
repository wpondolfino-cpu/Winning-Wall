// src/components/game-stats/GoalsManager.tsx
// Two things live here: the display order every report uses for its stats
// (up/down arrows, saved to report_layout -- see resolveStatOrder in
// gameStats.ts), and the target for each numeric stat. Goal targets are
// what every report's green/yellow/red coloring is computed against --
// change one here and every past and future report using that stat
// re-colors against the new target immediately, since nothing is baked
// into the report itself.

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
} from "../../lib/gameStats";

interface Props {
  userId: string;
}

export default function GoalsManager({ userId }: Props) {
  const [goals, setGoals] = useState<Record<string, StatGoal>>({});
  const [drafts, setDrafts] = useState<Record<string, { value: string; direction: "higher_better" | "lower_better" }>>({});
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const [order, setOrder] = useState<StatDef[]>(DEFAULT_STAT_ORDER);
  const [orderSaved, setOrderSaved] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data }, savedOrder] = await Promise.all([listStatGoals(), getReportLayout()]);
    const byKey: Record<string, StatGoal> = {};
    (data as StatGoal[] ?? []).forEach((g) => { byKey[g.stat_key] = g; });
    setGoals(byKey);
    const initDrafts: Record<string, { value: string; direction: "higher_better" | "lower_better" }> = {};
    GOAL_STATS.forEach((s) => {
      const existing = byKey[s.key];
      initDrafts[s.key] = { value: existing ? String(existing.target_value) : "", direction: existing?.direction ?? s.defaultDirection };
    });
    setDrafts(initDrafts);
    setOrder(resolveStatOrder(savedOrder));
    setLoading(false);
  }

  async function save(key: string) {
    const draft = drafts[key];
    const num = Number(draft.value);
    if (draft.value.trim() === "" || Number.isNaN(num)) return;
    const { error } = await upsertStatGoal(key, num, draft.direction, userId);
    if (!error) {
      setGoals((g) => ({ ...g, [key]: { stat_key: key, target_value: num, direction: draft.direction } }));
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
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
          Reports color a stat green/yellow/red against the target you set here. Leave a stat blank to skip coloring it.
        </div>

        {GOAL_STATS.map((s) => {
          const draft = drafts[s.key] ?? { value: "", direction: s.defaultDirection };
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, width: 150 }}>{s.label}</span>

              <input
                type="number"
                step="any"
                value={draft.value}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: { ...d[s.key], value: e.target.value } }))}
                placeholder="target"
                style={{ width: 90, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
              />

              <div className="role-tabs" style={{ margin: 0, width: "auto" }}>
                <button
                  className={`role-tab ${draft.direction === "higher_better" ? "active" : ""}`}
                  onClick={() => setDrafts((d) => ({ ...d, [s.key]: { ...d[s.key], direction: "higher_better" } }))}
                >
                  Higher is better
                </button>
                <button
                  className={`role-tab ${draft.direction === "lower_better" ? "active" : ""}`}
                  onClick={() => setDrafts((d) => ({ ...d, [s.key]: { ...d[s.key], direction: "lower_better" } }))}
                >
                  Lower is better
                </button>
              </div>

              <button className="btn-primary" style={{ width: "auto", padding: "6px 14px" }} onClick={() => save(s.key)}>
                {savedKey === s.key ? "Saved ✓" : "Save"}
              </button>

              {goals[s.key] && (
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  current: {goals[s.key].target_value} ({goals[s.key].direction === "higher_better" ? "higher better" : "lower better"})
                </span>
              )}
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
