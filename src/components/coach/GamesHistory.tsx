// src/components/coach/GamesHistory.tsx
// Every game gets a permanent row here. Coaches see draft and published
// games; the "Push to team" action flips status to 'published', which is
// the only thing that makes a game's report visible to players (enforced
// by RLS on games/possessions, not by this component). "Edit stats" only
// appears once a game has been explicitly finished (final score entered)
// -- that's the signal that live entry is done and correcting possessions
// from film is now safe. "Finish game" forces a sync attempt first, then
// pre-fills the score from what's actually tracked in Supabase (see
// gameStats.ts's computeFinalScore) -- that's both a convenience and a
// built-in sanity check: if the offline queue never fully synced, the
// pre-filled total will look obviously wrong, right at the moment you'd
// want to know it. Clicking a finished game's row opens the editor, not
// the tracker -- tracking is locked once a game is finished (see
// GameStatsHub's "Reopen for tracking" for the escape hatch).

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { resolveWeek } from "../../lib/schedule";
import NumberField from "../game-stats/NumberField";
import { getRosters } from "../../lib/practicePlanner";
import { finishGame, isGameFinal, computeFinalScore, syncQueue, listSeasons, GAME_STRUCTURES, buildGameFormat, structuresForGameType, defaultStructureForGameType, GAME_TYPES, GAME_GROUPS, gameTypesForGroup, type Game, type GameType, type GameGroup, type PeriodFormat, type Possession } from "../../lib/gameStats";

interface Props {
  userId: string;
  onOpenGame: (gameId: string) => void;
  /** Jump straight to a game's shift entry. The shifts chip in the list is the natural way in -- it's where you notice the game needs them. */
  onOpenShifts: (gameId: string) => void;
  onEditGame: (gameId: string, opponent: string) => void;
  onViewReport: (gameId: string, opponent: string) => void;
}

export default function GamesHistory({ userId, onOpenGame, onOpenShifts, onEditGame, onViewReport }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [opponent, setOpponent] = useState("");
  const [gameDate, setGameDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [structure, setStructure] = useState<PeriodFormat>("quarters");
  const [periods, setPeriods] = useState(4);
  const [minutes, setMinutes] = useState(8);
  const [gameType, setGameType] = useState<GameType>("regular");
  // Which roster this game's players come from. Shift entry needs it to
  // know whether to offer varsity, JV, or everyone.
  const [rosters, setRosters] = useState<{ id: string; name: string }[]>([]);
  // Scheduling fields: a game created here now shows on the Schedule with a
  // real time and place, and exists before it's tracked -- so nothing has to
  // be created on game night.
  // Weeks a coach has expanded by hand. The current week is always open,
  // so landing here shows what's imminent without any clicking.
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [tipTime, setTipTime]     = useState("");
  const [location, setLocation]   = useState("");
  const [homeAway, setHomeAway]   = useState("home");
  const [rosterId, setRosterId] = useState<string>("");
  const [gamesWithShifts, setGamesWithShifts] = useState<Set<string>>(new Set());

  // Picking a structure resets the count and minutes to that structure's
  // usual shape, which the coach can then type over.
  function pickStructure(next: PeriodFormat) {
    const preset = GAME_STRUCTURES.find((g) => g.value === next)!;
    setStructure(next);
    setPeriods(preset.periods);
    setMinutes(preset.minutes);
  }

  // Structure depends on type -- a practice can't be in quarters and a
  // scrimmage isn't playing halves -- so changing the type snaps the
  // structure to that type's default whenever the current one no longer
  // applies. Switching between Regular and Postseason leaves it alone,
  // since both allow the same two.
  function pickGameType(next: GameType) {
    setGameType(next);
    if (!structuresForGameType(next).includes(structure)) {
      pickStructure(defaultStructureForGameType(next));
    }
  }

  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [finalUs, setFinalUs] = useState("");
  const [finalThem, setFinalThem] = useState("");
  const [trackedCount, setTrackedCount] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [search, setSearch] = useState("");
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  // Once scrimmages and practices exist they'd otherwise be mixed in
  // among real games in this list, so it defaults to games only.
  const [groupFilter, setGroupFilter] = useState<GameGroup | "all">("games");
  const [seasons, setSeasons] = useState<string[]>([]);

  useEffect(() => { load(); listSeasons().then(setSeasons); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("games").select("*").order("game_date", { ascending: false });
    setGames((data as Game[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // getRosters() already excludes archived unless asked otherwise.
    getRosters().then((rs) => {
      const active = rs.map((r) => ({ id: r.id, name: r.name }));
      setRosters(active);
      setRosterId((cur) => cur || (active[0]?.id ?? ""));
    });
  }, []);

  // Which games already have shifts entered, so the list can flag the ones
  // that still need them. One query, not one per row.
  useEffect(() => {
    if (!games.length) return;
    supabase
      .from("shifts")
      .select("game_id")
      .in("game_id", games.map((g) => g.id))
      .then(({ data }) => setGamesWithShifts(new Set(((data ?? []) as any[]).map((r) => r.game_id))));
  }, [games]);

  async function createGame() {
    // A practice doesn't have an opponent to name, so let the field be
    // blank there and fall back to a label built from the date.
    const label = opponent.trim() || (gameType === "practice" ? `Practice ${gameDate}` : "");
    if (!label) return;
    const season = seasonForDate(gameDate);
    // ot_minutes is only the prefill for the "+ OT" prompt, so it takes the
    // structure's default rather than being typed at creation.
    const otDefault = GAME_STRUCTURES.find((g) => g.value === structure)?.otMinutes ?? 4;
    const fmt = buildGameFormat(structure, periods, minutes, otDefault);
    const { data, error } = await supabase
      .from("games")
      .insert({
        opponent: label,
        game_date: gameDate,
        season,
        created_by: userId,
        period_format: fmt.period_format,
        regulation_periods: fmt.regulation_periods,
        period_lengths: fmt.period_lengths,
        ot_minutes: fmt.ot_minutes,
        game_type: gameType,
        roster_id: rosterId || null,
        tip_time: tipTime || null,
        location: location.trim() || null,
        home_away: homeAway,
        week_id: await resolveWeek(gameDate, null),
      })
      .select()
      .single();
    if (!error && data) {
      setGames((g) => [data as Game, ...g]);
      setCreating(false);
      setOpponent(""); setTipTime(""); setLocation("");
      onOpenGame((data as Game).id);
    }
  }

  async function publish(gameId: string) {
    const { error } = await supabase.from("games").update({ status: "published" }).eq("id", gameId);
    if (!error) setGames((g) => g.map((game) => (game.id === gameId ? { ...game, status: "published" } : game)));
  }

  async function startFinishing(gameId: string) {
    setFinishingId(gameId);
    setFinalUs("");
    setFinalThem("");
    setTrackedCount(null);
    setNotesDraft(games.find((g) => g.id === gameId)?.notes ?? "");
    // Try to push anything still stuck locally before reading the score --
    // this is the best moment to catch a sync problem, since a stale
    // pre-fill would otherwise look like a mystery instead of a clue.
    await syncQueue();
    const { data } = await supabase.from("possessions").select("*").eq("game_id", gameId);
    const possessions = (data as Possession[]) ?? [];
    const score = computeFinalScore(possessions);
    setFinalUs(String(score.us));
    setFinalThem(String(score.them));
    setTrackedCount(possessions.length);
  }

  async function saveFinish(gameId: string) {
    const us = Number(finalUs);
    const them = Number(finalThem);
    if (Number.isNaN(us) || Number.isNaN(them)) return;
    const { error } = await finishGame(gameId, us, them, notesDraft.trim() || undefined);
    if (!error) {
      setGames((g) => g.map((game) => (game.id === gameId ? { ...game, final_score_us: us, final_score_them: them, notes: notesDraft.trim() || null } : game)));
      setFinishingId(null);
      setFinalUs("");
      setFinalThem("");
      setNotesDraft("");
    }
  }

  async function deleteGame(gameId: string, opponent: string) {
    if (!window.confirm(`Delete the game vs ${opponent}? This removes every possession logged for it and can't be undone.`)) return;
    const { error } = await supabase.from("games").delete().eq("id", gameId); // possessions cascade-delete with it
    if (!error) setGames((g) => g.filter((game) => game.id !== gameId));
  }

  if (loading) return <div className="card">Loading games…</div>;

  /**
   * Games grouped by the week their DATE falls in, mirroring how practices
   * already read.
   *
   * Once a season's schedule is imported this list holds thirty-odd games,
   * most of them months away — a flat list buries the one you're about to
   * track. Grouping by week means future weeks collapse out of the way and
   * the current week is what you land on.
   *
   * Grouped on date rather than the stored week_id so a game imported
   * before its week existed still lands correctly, and a mis-filed one
   * self-corrects.
   */
  /** Monday of the ISO week containing a date — the grouping key. */
  function weekKeyFor(dateStr: string): string {
    const d = new Date(dateStr + "T12:00:00");
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  }
  function weekLabelFor(key: string): string {
    const start = new Date(key + "T12:00:00");
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const f = (x: Date) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${f(start)} – ${f(end)}`;
  }

  const filteredGames = games.filter((g) => {
    if (seasonFilter !== "all" && g.season !== seasonFilter) return false;
    if (groupFilter !== "all" && !gameTypesForGroup(groupFilter).includes((g.game_type ?? "regular") as GameType)) return false;
    if (search.trim() && !g.opponent.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const currentWeekKey = weekKeyFor(new Date().toISOString().slice(0, 10));

  // Grouped on date rather than the stored week_id, so a game imported
  // before its week existed still lands correctly and a mis-filed one
  // self-corrects. Newest week first, matching how the list already read.
  type GameWeek = { key: string; label: string; games: typeof filteredGames };
  const gameWeekMap = filteredGames.reduce((acc, g) => {
    const key = weekKeyFor(g.game_date);
    (acc[key] ??= { key, label: weekLabelFor(key), games: [] }).games.push(g);
    return acc;
  }, {} as Record<string, GameWeek>);
  // Annotated rather than inferred: Object.values widens to unknown[] here.
  const gameWeeks: GameWeek[] = Object.keys(gameWeekMap)
    .sort((a, b) => b.localeCompare(a))
    .map(k => gameWeekMap[k]);

  return (
    <div className="card" style={{ width: "100%", maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Games</span>
        <button className="btn-primary" style={{ padding: "6px 14px", width: "auto" }} onClick={() => setCreating(true)}>
          New game
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by opponent…"
          style={{ flex: 1, minWidth: 160, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
        />
        <select
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
        >
          <option value="all">All seasons</option>
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value as GameGroup | "all")}
          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
        >
          {GAME_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
          <option value="all">All types</option>
        </select>
      </div>

      {creating && (
        // Every field carries a visible caption -- three bare number boxes
        // with only title tooltips read as nothing on desktop and nothing
        // at all on mobile, where there's no hover.
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label={gameType === "practice" ? "Session name" : "Opponent"} grow>
            <input
              autoFocus
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder={gameType === "practice" ? "e.g. Tues scrimmage" : "Opponent"}
              style={{ ...newGameField, width: "100%", minWidth: 140 }}
            />
          </Field>

          <Field label="Date">
            <input type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} style={newGameField} />
          </Field>

          {/* Optional: a tournament date is often known before its tip time,
              and the Schedule shows an unknown time as unknown rather than
              guessing midnight. */}
          <Field label="Tip time">
            <input type="time" value={tipTime} onChange={(e) => setTipTime(e.target.value)} style={newGameField} />
          </Field>

          {gameType !== "practice" && (
            <>
              <Field label="Home / Away">
                <select value={homeAway} onChange={(e) => setHomeAway(e.target.value)} style={newGameField}>
                  <option value="home">Home</option>
                  <option value="away">Away</option>
                  <option value="neutral">Neutral</option>
                </select>
              </Field>
              <Field label="Location">
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Gym" style={{ ...newGameField, minWidth: 140 }} />
              </Field>
            </>
          )}

          {rosters.length > 1 && (
            <Field label="Roster">
              <select value={rosterId} onChange={(e) => setRosterId(e.target.value)} style={newGameField}>
                {rosters.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Type">
            <select value={gameType} onChange={(e) => pickGameType(e.target.value as GameType)} style={newGameField}>
              {GAME_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Structure">
            <select value={structure} onChange={(e) => pickStructure(e.target.value as PeriodFormat)} style={newGameField}>
              {GAME_STRUCTURES.filter((g) => structuresForGameType(gameType).includes(g.value)).map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </Field>

          <Field label={structure === "sessions" ? "# sessions" : structure === "periods" ? "# periods" : structure === "halves" ? "# halves" : "# quarters"}>
            <NumberField value={periods} min={1} max={8} onChange={setPeriods} style={{ ...newGameField, width: 68 }} />
          </Field>

          <Field label="Min. each">
            <NumberField value={minutes} min={1} max={30} onChange={setMinutes} style={{ ...newGameField, width: 76 }} />
          </Field>

          <button className="btn-primary" style={{ width: "auto", padding: "8px 14px" }} onClick={createGame}>Start</button>
        </div>
      )}

      {filteredGames.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>No games match.</div>}

      {gameWeeks.map((wk) => {
        const collapsed = !openWeeks.has(wk.key) && wk.key !== currentWeekKey;
        return (
          <div key={wk.key}>
            <div
              onClick={() => setOpenWeeks((o) => { const n = new Set(o); n.has(wk.key) ? n.delete(wk.key) : n.add(wk.key); return n; })}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "10px 0 6px", borderTop: "1px solid var(--border)" }}
            >
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{collapsed ? "▸" : "▾"}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{wk.label}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
                {wk.games.length} game{wk.games.length === 1 ? "" : "s"}
              </span>
            </div>
            {!collapsed && wk.games.map((g) => {
        const final = isGameFinal(g);
        return (
          <div key={g.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ cursor: "pointer" }} onClick={() => (final ? onEditGame(g.id, g.opponent) : onOpenGame(g.id))}>
                <span style={{ fontSize: 14 }}>vs {g.opponent}</span>{" "}
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  · {g.game_date}
                  {final ? ` · ${g.final_score_us! > g.final_score_them! ? "W" : "L"} ${g.final_score_us}-${g.final_score_them}` : ""}
                </span>
                {g.game_type && g.game_type !== "regular" && (
                  <span style={{ fontSize: 11, marginLeft: 6, padding: "1px 7px", borderRadius: 7, background: "var(--surface2)", color: "var(--muted)" }}>
                    {GAME_TYPES.find((t) => t.value === g.game_type)?.label ?? g.game_type}
                  </span>
                )}
                <span
                  onClick={(e) => { e.stopPropagation(); onOpenShifts(g.id); }}
                  title="Enter or edit shifts for this game"
                  style={{
                    fontSize: 11, marginLeft: 6, padding: "2px 8px", borderRadius: 7, cursor: "pointer",
                    background: "var(--surface2)",
                    border: `1px solid ${gamesWithShifts.has(g.id) ? "var(--border)" : "#7a5a20"}`,
                    color: gamesWithShifts.has(g.id) ? "var(--muted)" : "#c9a227",
                  }}
                >
                  {gamesWithShifts.has(g.id) ? "shifts →" : "no shifts yet →"}
                </span>
                {g.period_format === "halves" && (
                  <span style={{ fontSize: 11, marginLeft: 6, padding: "1px 7px", borderRadius: 7, background: "var(--surface2)", color: "var(--muted)" }}>
                    Halves
                  </span>
                )}
                {g.notes && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, fontStyle: "italic" }}>{g.notes}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 10px",
                    borderRadius: 8,
                    background: g.status === "published" ? "#1f7a4d22" : "var(--surface2)",
                    color: g.status === "published" ? "#1f7a4d" : "var(--muted)",
                  }}
                >
                  {g.status === "published" ? "Published" : "Draft"}
                </span>
                {g.status === "draft" && (
                  <button style={actionBtn} onClick={() => publish(g.id)}>Push to team</button>
                )}
                {!final && (
                  <button style={actionBtn} onClick={() => startFinishing(g.id)}>
                    Finish game
                  </button>
                )}
                {final && (
                  <button style={actionBtn} onClick={() => onViewReport(g.id, g.opponent)}>Stats</button>
                )}
                {final && (
                  <button style={actionBtn} onClick={() => onEditGame(g.id, g.opponent)}>Edit stats</button>
                )}
                <button style={{ ...actionBtn, background: "transparent", color: "#8a2f2f" }} onClick={() => deleteGame(g.id, g.opponent)}>
                  Delete
                </button>
              </div>
            </div>

            {finishingId === g.id && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Final score — Us</span>
                  <input type="number" value={finalUs} onChange={(e) => setFinalUs(e.target.value)} style={{ width: 56, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }} />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Them</span>
                  <input type="number" value={finalThem} onChange={(e) => setFinalThem(e.target.value)} style={{ width: 56, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }} />
                  <button className="btn-primary" style={{ width: "auto", padding: "6px 14px" }} onClick={() => saveFinish(g.id)}>Save</button>
                  <button style={{ ...actionBtn, background: "transparent" }} onClick={() => setFinishingId(null)}>Cancel</button>
                </div>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Notes about this game (optional) — e.g. played zone 2nd half, starters in foul trouble Q3…"
                  rows={2}
                  style={{ width: "100%", marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
                />
                {trackedCount != null && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    Pre-filled from {trackedCount} tracked possession{trackedCount === 1 ? "" : "s"} — if that looks way off from the real final score, some possessions likely didn't sync. Edit the numbers here if needed, or go fix the underlying possessions first.
                  </div>
                )}
              </div>
            )}
          </div>
        );
            })}
          </div>
        );
      })}
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  cursor: "pointer",
};

function seasonForDate(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  // Basketball season spans Nov-Mar-ish; games from Aug-Dec count as
  // "start year - start year+1", games Jan-Jul count as the prior split.
  const month = d.getMonth() + 1;
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

const newGameField: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

/** A form control with a small caption above it. */
function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: grow ? "1 1 160px" : "0 0 auto", minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}
