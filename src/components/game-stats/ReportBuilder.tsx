// src/components/game-stats/ReportBuilder.tsx
// Answers "last 5 games, transition offense only" style questions. Reuses
// ReportBody so a filtered report looks identical to a normal one -- the
// only difference is which possessions get fetched and whether they're
// narrowed to one possession_type before the stat math runs.
//
// Can also reopen from a SavedReport (Reports tab history) -- the saved
// row only stores the filters, so reopening always re-runs against
// current data rather than showing a frozen snapshot.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { ReportBody } from "./GameReport";
import { saveReport, getReportLayout, resolveStatOrder } from "../../lib/gameStats";
import type { Possession, PlayCall, StatGoal, PossessionType, SavedReport, StatDef } from "../../lib/gameStats";

type GameCount = 3 | 5 | 10 | "season";
type CategoryFilter = "all" | PossessionType;

const CATEGORY_LABEL: Record<CategoryFilter, string> = {
  all: "All possessions",
  transition: "Transition",
  half_court: "Half-court",
  blob: "BLOB",
  slob: "SLOB",
  press: "Press",
};

interface Props {
  season: string;
  userId: string;
  initial?: SavedReport;
  onSaved?: () => void;
}

export default function ReportBuilder({ season, userId, initial, onSaved }: Props) {
  const [gameCount, setGameCount] = useState<GameCount>(initial ? (initial.game_count === "season" ? "season" : (Number(initial.game_count) as GameCount)) : 5);
  const [category, setCategory] = useState<CategoryFilter>(initial?.category ?? "all");
  const [possessions, setPossessions] = useState<Possession[] | null>(null);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [statOrder, setStatOrder] = useState<StatDef[]>([]);
  const [gameLabel, setGameLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { run(); setSaved(false); }, [gameCount, category]);

  async function run() {
    setLoading(true);
    const [{ data: goalRows }, { data: playRows }, savedOrder] = await Promise.all([
      supabase.from("stat_goals").select("*"),
      supabase.from("play_calls").select("*"),
      getReportLayout(),
    ]);
    setGoals((goalRows as StatGoal[]) ?? []);
    setPlayCalls((playRows as PlayCall[]) ?? []);
    setStatOrder(resolveStatOrder(savedOrder));

    let gamesQuery = supabase.from("games").select("id, opponent, game_date").eq("season", season).order("game_date", { ascending: false });
    if (gameCount !== "season") gamesQuery = gamesQuery.limit(gameCount);
    const { data: games } = await gamesQuery;
    const ids = (games ?? []).map((g: any) => g.id);
    setGameLabel(
      gameCount === "season"
        ? `Season ${season}`
        : `Last ${Math.min(gameCount, games?.length ?? 0)} games${games?.length ? ` (${games[games.length - 1].opponent} → ${games[0].opponent})` : ""}`
    );

    if (!ids.length) {
      setPossessions([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase.from("possessions").select("*").in("game_id", ids).order("sequence", { ascending: true });
    const filtered = category === "all" ? (data as Possession[]) : (data as Possession[]).filter((p) => p.possession_type === category);
    setPossessions(filtered ?? []);
    setLoading(false);
  }

  async function confirmSave() {
    const label = savingLabel?.trim() || `${gameCount === "season" ? "Full season" : `Last ${gameCount}`} · ${CATEGORY_LABEL[category]}`;
    const { error } = await saveReport({
      label,
      season,
      game_count: String(gameCount) as SavedReport["game_count"],
      category,
      created_by: userId,
    });
    if (!error) {
      setSavingLabel(null);
      setSaved(true);
      onSaved?.();
    }
  }

  return (
    <div>
      <div className="card" style={{ width: "100%", maxWidth: 1400, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Build a report</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {([3, 5, 10, "season"] as GameCount[]).map((n) => (
            <button key={n} onClick={() => setGameCount(n)} style={pillStyle(gameCount === n)}>
              {n === "season" ? "Full season" : `Last ${n}`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {(Object.keys(CATEGORY_LABEL) as CategoryFilter[]).map((c) => (
            <button key={c} onClick={() => setCategory(c)} style={pillStyle(category === c)}>
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>

        {savingLabel === null ? (
          <button style={pillStyle(false)} onClick={() => setSavingLabel("")} disabled={saved}>
            {saved ? "Saved to history ✓" : "Save this report"}
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              autoFocus
              value={savingLabel}
              onChange={(e) => setSavingLabel(e.target.value)}
              placeholder="Label (optional)"
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
            />
            <button className="btn-primary" style={{ width: "auto", padding: "6px 14px" }} onClick={confirmSave}>Save</button>
            <button style={pillStyle(false)} onClick={() => setSavingLabel(null)}>Cancel</button>
          </div>
        )}
      </div>

      {loading || possessions === null ? (
        <div className="card">Loading…</div>
      ) : (
        <ReportBody
          possessions={possessions}
          playCalls={playCalls}
          goals={goals}
          statOrder={statOrder}
          variant="full"
          title={`${gameLabel} · ${CATEGORY_LABEL[category]}`}
        />
      )}
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    fontSize: 13,
    borderRadius: 20,
    border: `1px solid ${active ? "var(--royal-light)" : "var(--border)"}`,
    background: active ? "var(--royal)" : "var(--surface2)",
    color: active ? "#fff" : "var(--text)",
    cursor: "pointer",
  };
}
