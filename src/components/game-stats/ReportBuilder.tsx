// src/components/game-stats/ReportBuilder.tsx
// Answers "last 5 games, transition offense only" style questions. Reuses
// ReportBody so a filtered report looks identical to a normal one -- the
// only difference is which possessions get fetched and whether they're
// narrowed to one possession_type before the stat math runs.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { ReportBody } from "./GameReport";
import type { Possession, PlayCall, StatGoal, PossessionType } from "../../lib/gameStats";

type GameCount = 3 | 5 | 10 | "season";
type CategoryFilter = "all" | PossessionType;

const CATEGORY_LABEL: Record<CategoryFilter, string> = {
  all: "All possessions",
  transition: "Transition",
  half_court: "Half-court",
  blob: "BLOB",
  slob: "SLOB",
};

export default function ReportBuilder({ season }: { season: string }) {
  const [gameCount, setGameCount] = useState<GameCount>(5);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [possessions, setPossessions] = useState<Possession[] | null>(null);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [gameLabel, setGameLabel] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { run(); }, [gameCount, category]);

  async function run() {
    setLoading(true);
    const [{ data: goalRows }, { data: playRows }] = await Promise.all([
      supabase.from("stat_goals").select("*"),
      supabase.from("play_calls").select("*"),
    ]);
    setGoals((goalRows as StatGoal[]) ?? []);
    setPlayCalls((playRows as PlayCall[]) ?? []);

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

  return (
    <div>
      <div className="card" style={{ maxWidth: 640, marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Build a report</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {([3, 5, 10, "season"] as GameCount[]).map((n) => (
            <button
              key={n}
              onClick={() => setGameCount(n)}
              style={pillStyle(gameCount === n)}
            >
              {n === "season" ? "Full season" : `Last ${n}`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(CATEGORY_LABEL) as CategoryFilter[]).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              style={pillStyle(category === c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {loading || possessions === null ? (
        <div className="card">Loading…</div>
      ) : (
        <ReportBody
          possessions={possessions}
          playCalls={playCalls}
          goals={goals}
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
