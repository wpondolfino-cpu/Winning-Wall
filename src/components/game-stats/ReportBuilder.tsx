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
import { saveReport, getReportLayout, resolveStatOrder, GAME_GROUPS, gameTypesForGroup, isGameFinal } from "../../lib/gameStats";
import GameScopePicker, { type ScopeGame } from "./GameScopePicker";
import type { Possession, PlayCall, StatGoal, PossessionType, SavedReport, StatDef, GameGroup } from "../../lib/gameStats";

type GameCount = 3 | 5 | 10 | "season";
type CategoryFilter = "all" | PossessionType;

const CATEGORY_LABEL: Record<CategoryFilter, string> = {
  all: "All possessions",
  transition: "Transition",
  half_court: "Half-court",
  blob: "BLOB",
  slob: "SLOB",
  press: "Press",
  // A broken press has already become transition or half-court by the time
  // it commits, so this filter catches the trips that ended against the
  // press. Press break as a whole is a report block, not a filter.
  press_break: "Press break (unbroken)",
  non_possession_ft: "Awarded FTs",
};

interface Props {
  season: string;
  userId: string;
  initial?: SavedReport;
  onSaved?: () => void;
}

export default function ReportBuilder({ season, userId, initial, onSaved }: Props) {
  // Not state any more -- the pills became presets inside the picker. This
  // only resolves what a relative saved report should open on.
  const initialCount: GameCount = initial ? (initial.game_count === "season" ? "season" : (Number(initial.game_count) as GameCount)) : 5;
  const [category, setCategory] = useState<CategoryFilter>(initial?.category ?? "all");
  // Defaults to real games. Scrimmage and practice data is deliberately
  // a separate report rather than a filter you have to remember to set.
  const [gameGroup, setGameGroup] = useState<GameGroup>(initial?.game_group ?? "games");
  const [possessions, setPossessions] = useState<Possession[] | null>(null);
  const [playCalls, setPlayCalls] = useState<PlayCall[]>([]);
  const [goals, setGoals] = useState<StatGoal[]>([]);
  const [statOrder, setStatOrder] = useState<StatDef[]>([]);
  const [gameLabel, setGameLabel] = useState("");
  // The pool this season/type offers, and which of them are picked.
  // A saved report with explicit ids reopens on exactly those games; one
  // saved from a preset stays relative and re-resolves each time.
  const [pool, setPool] = useState<ScopeGame[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(initial?.game_ids ?? []);
  const [pickedByHand, setPickedByHand] = useState<boolean>(!!initial?.game_ids?.length);
  const [loading, setLoading] = useState(false);
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { loadPool(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [season, gameGroup]);
  useEffect(() => { run(); setSaved(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [category, selectedIds.join(",")]);

  /** Every game this season/type could offer, newest first. */
  async function loadPool() {
    const { data } = await supabase
      .from("games")
      .select("id, opponent, game_date, final_score_us, final_score_them")
      .eq("season", season)
      .in("game_type", gameTypesForGroup(gameGroup))
      .order("game_date", { ascending: false });
    const rows = ((data ?? []) as any[]).map((g) => ({
      id: g.id, opponent: g.opponent, game_date: g.game_date,
      won: isGameFinal(g) ? g.final_score_us > g.final_score_them : null,
    }));
    setPool(rows);
    // A hand-picked saved report keeps its games; anything else falls back to
    // the count it was saved with.
    if (pickedByHand && selectedIds.length) {
      setSelectedIds(selectedIds.filter((id) => rows.some((r) => r.id === id)));
    } else {
      setSelectedIds(initialCount === "season" ? rows.map((r) => r.id) : rows.slice(0, initialCount).map((r) => r.id));
    }
  }

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

    const ids = selectedIds;
    const groupLabel = GAME_GROUPS.find((g) => g.value === gameGroup)?.label ?? "Games";
    const chosen = pool.filter((g) => ids.includes(g.id));
    const opps = [...new Set(chosen.map((g) => g.opponent))];
    setGameLabel(
      !chosen.length ? `${groupLabel} · nothing selected`
      : chosen.length === pool.length ? `${groupLabel} · Season ${season}`
      : opps.length <= 3 ? `${groupLabel} · ${opps.join(", ")} (${chosen.length})`
      : `${groupLabel} · ${chosen.length} games`
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
    const groupLabel = GAME_GROUPS.find((g) => g.value === gameGroup)?.label ?? "Games";
    const isWholeSeason = selectedIds.length === pool.length;
    const label = savingLabel?.trim() || `${gameLabel} · ${CATEGORY_LABEL[category]}`;
    const { error } = await saveReport({
      label,
      season,
      // Kept in step for reports that stay relative; a hand-picked one is
      // pinned by game_ids and this is only a fallback if those games vanish.
      game_count: String(isWholeSeason ? "season" : initialCount) as SavedReport["game_count"],
      category,
      game_group: gameGroup,
      // Null keeps the report relative -- reopening it in March should pick
      // up the games that are recent THEN, not the ones that were recent
      // when it was saved. A hand-picked set is fixed and stores its ids.
      game_ids: pickedByHand && !isWholeSeason ? selectedIds : null,
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
          {GAME_GROUPS.map((g) => (
            <button key={g.value} onClick={() => setGameGroup(g.value)} style={pillStyle(gameGroup === g.value)}>
              {g.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          <GameScopePicker
            games={pool}
            selected={selectedIds}
            onChange={(ids) => { setSelectedIds(ids); setPickedByHand(true); }}
            noun={(GAME_GROUPS.find((g) => g.value === gameGroup)?.label ?? "Games").toLowerCase()}
          />
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
          canManage={true}
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
