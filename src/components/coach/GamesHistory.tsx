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

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { finishGame, isGameFinal, computeFinalScore, syncQueue, listSeasons, type Game, type Possession } from "../../lib/gameStats";

interface Props {
  userId: string;
  onOpenGame: (gameId: string) => void;
  onEditGame: (gameId: string, opponent: string) => void;
}

export default function GamesHistory({ userId, onOpenGame, onEditGame }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [opponent, setOpponent] = useState("");
  const [gameDate, setGameDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [finalUs, setFinalUs] = useState("");
  const [finalThem, setFinalThem] = useState("");
  const [trackedCount, setTrackedCount] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [search, setSearch] = useState("");
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [seasons, setSeasons] = useState<string[]>([]);

  useEffect(() => { load(); listSeasons().then(setSeasons); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("games").select("*").order("game_date", { ascending: false });
    setGames((data as Game[]) ?? []);
    setLoading(false);
  }

  async function createGame() {
    if (!opponent.trim()) return;
    const season = seasonForDate(gameDate);
    const { data, error } = await supabase
      .from("games")
      .insert({ opponent: opponent.trim(), game_date: gameDate, season, created_by: userId })
      .select()
      .single();
    if (!error && data) {
      setGames((g) => [data as Game, ...g]);
      setCreating(false);
      setOpponent("");
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

  const filteredGames = games.filter((g) => {
    if (seasonFilter !== "all" && g.season !== seasonFilter) return false;
    if (search.trim() && !g.opponent.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

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
      </div>

      {creating && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            autoFocus
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="Opponent"
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
          />
          <input
            type="date"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)" }}
          />
          <button className="btn-primary" style={{ width: "auto", padding: "8px 14px" }} onClick={createGame}>Start</button>
        </div>
      )}

      {filteredGames.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>No games match.</div>}

      {filteredGames.map((g) => {
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
