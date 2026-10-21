// src/components/scouting/ScoutSheetsHub.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { formatDateOnly } from "../../lib/schedule";
import { createGame } from "../../lib/gameStats";
import { deleteScoutSheet, renameOpponent, deleteOpponent,
  Opponent, getOpponents, createOpponent, uploadOpponentLogo,
  getOpponentGames, OpponentGame, getScoutSheetsForOpponent, getTeamTags, TeamTag,
  createScoutSheet, duplicateScoutSheet, ensureScoutSheetForGame,
  scoutSheetToExportPayload, importScoutSheetFromExportPayload, SCOUT_SHEET_EXPORT_SCHEMA_VERSION,
} from "../../lib/scoutSheets";
import { embedJsonInPdf, extractJsonFromPdf, drawTextDocument } from "../../lib/pdfDataExport";
import ScoutSheetBuilder from "./ScoutSheetBuilder";
import { inputStyle } from "../../lib/inputStyle";

interface Props {
  /** Opens straight to this game's scout sheet — what tapping a Schedule row means. */
  initialGameId?: string | null;
  canManage: boolean; // coach/admin = true, player = false (read-only, published only)
}

/** A team's name in its colour, so varsity and JV rows can't be confused. */
function TeamPill({ team }: { team: TeamTag | null | undefined }) {
  if (!team) return <span style={{ fontSize: 10.5, fontWeight: 600, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--muted)" }}>No team</span>;
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: team.color, color: "#fff" }}>{team.name}</span>;
}

const iconBtnStyle: React.CSSProperties = { background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "2px 7px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" };

export default function ScoutSheetsHub(props: Props) {
  const { canManage } = props;
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [newOpponentName, setNewOpponentName] = useState("");
  const [activeOpponent, setActiveOpponent] = useState<Opponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oppGames, setOppGames] = useState<OpponentGame[]>([]);
  const [teams, setTeams] = useState<TeamTag[]>([]);
  // Which team's games the opponent page shows ("all" = every team).
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [allSheets, setAllSheets] = useState<any[]>([]);
  const [showAllSheets, setShowAllSheets] = useState(false);
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [newGameDate, setNewGameDate] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const loadOpponents = useCallback(async () => {
    setOpponents(await getOpponents());
  }, []);

  useEffect(() => { loadOpponents().catch(console.error); }, [loadOpponents]);

  async function handleExportSheet(sheetId: string) {
    setError(null);
    try {
      const payload = await scoutSheetToExportPayload(sheetId);
      const sections = [
        { heading: "Overview", lines: [`Opponent: ${payload.opponentName}`, `Record: ${payload.team_record ?? "—"} · Tempo: ${payload.tempo ?? "—"}`] },
        { heading: "Keys to game", lines: payload.keys_to_game },
        { heading: "Team offensive strengths", lines: payload.team_offensive_strengths },
        { heading: "Roster", lines: payload.players.map((p: any) => `${p.name}${p.number ? ` #${p.number}` : ""}${p.position ? ` — ${p.position}` : ""}${p.notes ? ` (${p.notes})` : ""}`) },
        { heading: "Offense sets", lines: payload.offenseSets.map((s: any) => `${s.call_name}${s.description ? ` — ${s.description}` : ""}`) },
        { heading: "Specials", lines: payload.specials.map((s: any) => `${s.kind.toUpperCase()}: ${s.call_name}${s.description ? ` — ${s.description}` : ""}`) },
      ];
      const doc = await drawTextDocument(`Scout Sheet — ${payload.opponentName}`, "Winning Wall — re-importable scout sheet export", sections);
      const withData = await embedJsonInPdf(doc, { dataType: "scout_sheet", schemaVersion: SCOUT_SHEET_EXPORT_SCHEMA_VERSION, data: payload });
      const blob = new Blob([withData as BlobPart], { type: "application/pdf" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `scout-${payload.opponentName.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
      a.click();
    } catch (e: any) {
      setError("Export failed: " + e.message);
    }
  }

  async function handleImportFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const payload = await extractJsonFromPdf(file);
      if (!payload) { setError("This PDF doesn't contain scout sheet data."); return; }
      if (payload.dataType !== "scout_sheet") { setError(`This file contains a ${payload.dataType.replace("_", " ")}, not a scout sheet.`); return; }
      await importScoutSheetFromExportPayload(payload.data);
      await loadOpponents();
      setError(null);
    } catch (e: any) {
      setError("Import failed: " + e.message);
    }
  }

  /** keepTeam: stay on the team being viewed (after a delete or a new sheet). preferTeam: open on this team. */
  async function openOpponent(o: Opponent, opts: { keepTeam?: boolean; preferTeam?: string | null } = {}) {
    setActiveOpponent(o);
    setShowAllSheets(false);
    const [games, sheets, tt] = await Promise.all([getOpponentGames(o.id), getScoutSheetsForOpponent(o.id), getTeamTags()]);
    setOppGames(games);
    setAllSheets(sheets);
    setTeams(tt);
    if (opts.keepTeam) return;
    // Open on a team that has played them: the asked-for one, else the
    // first in the usual order (varsity before JV before freshman).
    const played = new Set(games.map(g => g.roster_id).filter(Boolean) as string[]);
    const pick = opts.preferTeam && played.has(opts.preferTeam) ? opts.preferTeam : tt.find(t => played.has(t.id))?.id;
    setTeamFilter(pick ?? "all");
  }

  /**
   * Opens the sheet for a specific game.
   *
   * Routing to this tab alone landed on the opponents list, which is a
   * different screen from the sheet you tapped. Resolves the game to its
   * opponent, opens that opponent, then opens the sheet — or leaves you on
   * the opponent with the New sheet box ready if none exists yet.
   */
  async function openForGame(gameId: string) {
    // Coaches: open a sheet that's ready to edit, creating it (and linking
    // a typed-name game to an opponent) if it doesn't exist yet. There used
    // to be a separate "New sheet" step here, and a game whose opponent
    // was typed rather than picked did nothing at all.
    if (canManage) {
      try {
        const { sheet, opponentId } = await ensureScoutSheetForGame(gameId);
        const [{ data: opp }, { data: g }] = await Promise.all([
          supabase.from("opponents").select("*").eq("id", opponentId).single(),
          supabase.from("games").select("roster_id").eq("id", gameId).maybeSingle(),
        ]);
        if (opp) await openOpponent(opp as Opponent, { preferTeam: (g as any)?.roster_id ?? null });
        setOpenSheetId(sheet.id);
      } catch (e: any) {
        setError(e?.message ?? "Couldn't open the scout sheet for that game.");
      }
      return;
    }
    const { data: game } = await supabase
      .from("games").select("id, opponent_id, game_date, roster_id").eq("id", gameId).single();
    if (!game?.opponent_id) return;                 // typed-name game, no opponent page to open
    const { data: opp } = await supabase
      .from("opponents").select("*").eq("id", game.opponent_id).single();
    if (!opp) return;
    await openOpponent(opp as Opponent, { preferTeam: (game as any).roster_id ?? null });
    const { data: sheet } = await supabase
      .from("scout_sheets").select("id").eq("game_id", gameId).maybeSingle();
    if (sheet?.id) setOpenSheetId(sheet.id);
    else setNewGameDate(game.game_date);            // pre-fills the date so New sheet is one tap
  }

  useEffect(() => {
    if (props.initialGameId) openForGame(props.initialGameId);
  }, [props.initialGameId]);

  async function addOpponent() {
    if (!newOpponentName.trim()) return;
    setError(null);
    try {
      const o = await createOpponent(newOpponentName.trim());
      setNewOpponentName("");
      loadOpponents();
      openOpponent(o);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't add opponent — try again.");
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!activeOpponent || !e.target.files?.[0]) return;
    try {
      const url = await uploadOpponentLogo(activeOpponent.id, e.target.files[0]);
      setActiveOpponent({ ...activeOpponent, logo_url: url });
      loadOpponents();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't upload logo — try again.");
    }
  }

  async function handleRenameOpponent() {
    if (!activeOpponent) return;
    const next = window.prompt("Team name:", activeOpponent.name);
    if (!next || !next.trim() || next.trim() === activeOpponent.name) return;
    try {
      await renameOpponent(activeOpponent.id, next);
      setActiveOpponent({ ...activeOpponent, name: next.trim() });
      loadOpponents();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't rename that team — try again.");
    }
  }

  async function handleDeleteOpponent() {
    if (!activeOpponent) return;
    if (!window.confirm(`Delete ${activeOpponent.name}? Only possible if no games or scout sheets reference them.`)) return;
    const { error: err } = await deleteOpponent(activeOpponent.id);
    if (err) { setError(err); return; }
    setActiveOpponent(null);
    loadOpponents();
  }

  /**
   * Deletes a scout sheet.
   *
   * deleteScoutSheet has existed in scoutSheets.ts since the feature was
   * built, but nothing ever called it -- a sheet made by mistake was
   * permanent. The game it belongs to is deliberately left alone: it may
   * have possessions, a report, and a place on the schedule, none of which
   * should disappear because a scouting note was removed.
   */
  async function handleDeleteSheet(sheetId: string, dateLabel: string) {
    if (!window.confirm(`Delete the scout sheet for ${dateLabel}? Their sets, personnel and specials on it are removed. The game itself stays.`)) return;
    try {
      await deleteScoutSheet(sheetId);
      if (openSheetId === sheetId) setOpenSheetId(null);
      if (activeOpponent) openOpponent(activeOpponent, { keepTeam: true });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't delete that scout sheet — try again.");
    }
  }

  // Creates a bare-bones game record tied to this opponent, then the
  // scout sheet on top of it. Keeps this feature usable without
  // requiring a full trip through the Game Stats game-creation flow.
  async function startNewScoutSheet(duplicateFromSheetId?: string) {
    if (!activeOpponent || !newGameDate) return;
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); return; }
    // REUSE an existing game for this opponent and date before making one.
    // Creating unconditionally produced a second game whenever a scout
    // sheet was made for a game already created in the tracker -- two rows
    // for one fixture, each with its own tracker, report and scout sheet,
    // and neither showing the other's data.
    //
    // Matched on opponent_id when the existing game has one, and on the
    // name otherwise, so a game typed in before opponent linking existed
    // still gets picked up rather than duplicated.
    //
    // Varsity and JV often play the same team the same night, so with a
    // team picked only that team's game (or one with no team) counts.
    const teamId = teamFilter === "all" ? null : teamFilter;
    const { data: sameDay } = await supabase
      .from("games").select("id, opponent, opponent_id, roster_id")
      .eq("game_date", newGameDate);
    const existing = (sameDay ?? []).find((g: any) =>
      (!teamId || !g.roster_id || g.roster_id === teamId) && (
        g.opponent_id === activeOpponent.id ||
        (!g.opponent_id && (g.opponent ?? "").trim().toLowerCase() === activeOpponent.name.trim().toLowerCase()))
    );

    let game: any = existing ?? null;
    if (game) {
      // Backfill the link on a game that was created by typing a name, so
      // the opponent page and its last-5 results start seeing it.
      if (!game.opponent_id) {
        await supabase.from("games").update({ opponent_id: activeOpponent.id }).eq("id", game.id);
      }
    } else {
      // Through the shared path, so it gets a school-year season, a week
      // and a format like every other game — it used to get the calendar
      // year, no week, and nothing for the tracker to run with.
      const { game: created, error: gameErr } = await createGame({
        opponent: activeOpponent.name,
        opponent_id: activeOpponent.id,
        game_date: newGameDate,
        roster_id: teamId,
      });
      if (gameErr || !created) { setError(gameErr ?? "Couldn't create the game."); return; }
      game = created;
    }

    try {
      const sheet = duplicateFromSheetId
        ? await duplicateScoutSheet(duplicateFromSheetId, game.id)
        : await createScoutSheet(game.id, activeOpponent.id);
      setNewGameDate("");
      openOpponent(activeOpponent, { keepTeam: true });
      setOpenSheetId(sheet.id);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't create the scout sheet — try again.");
    }
  }

  if (openSheetId) {
    return <ScoutSheetBuilder scoutSheetId={openSheetId} canManage={canManage} onClose={() => { setOpenSheetId(null); if (activeOpponent) openOpponent(activeOpponent, { keepTeam: true }); }} />;
  }

  if (activeOpponent) {
    const teamById = new Map(teams.map(t => [t.id, t]));
    // A game with no team shows under every team (it was entered before
    // games had teams); set its team on the schedule to file it properly.
    const onTeam = (rid: string | null | undefined) => teamFilter === "all" || !rid || rid === teamFilter;
    const teamGames = oppGames.filter(g => onTeam(g.roster_id));
    const lastGames = teamGames.slice(0, 5);
    const teamSheets = allSheets.filter((s: any) => onTeam((Array.isArray(s.games) ? s.games[0] : s.games)?.roster_id));
    const mostRecentSheet = teamSheets[0];
    // Chips only for teams that have actually played this opponent.
    const playedTeams = teams.filter(t => oppGames.some(g => g.roster_id === t.id));
    const filterName = teamFilter === "all" ? null : teamById.get(teamFilter)?.name;
    return (
      <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
        <button type="button" onClick={() => setActiveOpponent(null)} style={{ marginBottom: 16, background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>← All opponents</button>
        {error && <div className="error-msg">{error}</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div onClick={() => canManage && fileRef.current?.click()} style={{ width: 56, height: 56, borderRadius: 12, background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: canManage ? "pointer" : "default", overflow: "hidden" }}>
            {activeOpponent.logo_url ? <img src={activeOpponent.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "var(--muted)" }}>Logo</span>}
          </div>
          {canManage && <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: "none" }} />}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{activeOpponent.name}</div>
              {canManage && (
                <>
                  <button type="button" title="Rename this team" onClick={handleRenameOpponent} style={iconBtnStyle}>✎</button>
                  <button type="button" title="Delete this team" onClick={handleDeleteOpponent} style={iconBtnStyle}>✕</button>
                </>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{allSheets.length} scout sheet{allSheets.length === 1 ? "" : "s"} on file</div>
          </div>
        </div>

        {playedTeams.length > 1 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {[...playedTeams.map(t => ({ id: t.id, name: t.name, color: t.color })), { id: "all", name: "All teams", color: "" }].map(t => {
              const on = teamFilter === t.id;
              return (
                <button key={t.id} type="button" onClick={() => { setTeamFilter(t.id); setShowAllSheets(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    background: on ? (t.color || "var(--royal)") : "var(--surface2)", color: on ? "#fff" : "var(--text)",
                    border: on ? "1px solid transparent" : "1px solid var(--border)" }}>
                  {t.color && !on && <span style={{ width: 8, height: 8, borderRadius: 999, background: t.color }} />}
                  {t.name}
                </button>
              );
            })}
          </div>
        )}

        {canManage && (
          <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
            <input type="date" value={newGameDate} onChange={e => setNewGameDate(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <button type="button" disabled={!newGameDate} onClick={() => startNewScoutSheet()} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "0 14px", fontWeight: 600, cursor: "pointer" }}>New sheet</button>
            {mostRecentSheet && (
              <button type="button" disabled={!newGameDate} onClick={() => startNewScoutSheet(mostRecentSheet.id)} style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 14px", fontWeight: 600, cursor: "pointer" }}>Duplicate last</button>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Last 5 games{filterName ? ` — ${filterName}` : ""}</div>
        {lastGames.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>No games against them yet.</div>}
        {lastGames.map(g => (
          <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {g.final_score_us != null && g.final_score_them != null
                  ? `${g.final_score_us > g.final_score_them ? "W" : "L"} ${g.final_score_us}–${g.final_score_them}`
                  : "Not final"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                {formatDateOnly(g.game_date)}
                {(teamFilter === "all" || !g.roster_id) && <TeamPill team={g.roster_id ? teamById.get(g.roster_id) : null} />}
              </div>
            </div>
            {g.scout_sheet
              ? (
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" onClick={() => setOpenSheetId(g.scout_sheet!.id)} style={{ background: "none", border: "none", color: "var(--royal-light)", cursor: "pointer", fontSize: 12 }}>View scout sheet →</button>
                  {canManage && (
                    <button type="button" title="Delete this scout sheet" onClick={() => handleDeleteSheet(g.scout_sheet!.id, formatDateOnly(g.game_date))} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 7px", fontSize: 11, cursor: "pointer" }}>✕</button>
                  )}
                </span>
              )
              // Scout sheet switched off for this game (Edit game on the
              // schedule): nothing to start here. Turn it back on there.
              : !g.uses_scout_sheet
                ? <span style={{ fontSize: 12, color: "var(--muted)" }}>Scout sheet off</span>
              : canManage
                ? <button type="button" onClick={() => openForGame(g.id)} style={{ background: "none", border: "none", color: "var(--royal-light)", cursor: "pointer", fontSize: 12 }}>Start scout sheet →</button>
                : <span style={{ fontSize: 12, color: "var(--muted)" }}>No scout sheet</span>}
          </div>
        ))}

        {teamSheets.length > 0 && !showAllSheets && (
          <button type="button" onClick={() => setShowAllSheets(true)} style={{ marginTop: 10, background: "none", border: "none", color: "var(--royal-light)", cursor: "pointer", fontSize: 12 }}>View all scout sheets{filterName ? ` — ${filterName}` : ""} ({teamSheets.length}) →</button>
        )}
        {showAllSheets && (
          <div style={{ marginTop: 10 }}>
            {teamSheets.map((s: any) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 12 }}>
                <span onClick={() => setOpenSheetId(s.id)} style={{ cursor: "pointer", flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                  {s.games?.game_date ? formatDateOnly(s.games.game_date) : "—"}
                  <TeamPill team={s.games?.roster_id ? teamById.get(s.games.roster_id) : null} />
                </span>
                <span style={{ color: "var(--muted)", marginRight: 8 }}>{s.status}</span>
                <button type="button" title="Export (re-importable)" onClick={(e) => { e.stopPropagation(); handleExportSheet(s.id); }} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 7px", fontSize: 11, cursor: "pointer" }}>💾</button>
                {canManage && (
                  <button type="button" title="Delete this scout sheet" onClick={(e) => { e.stopPropagation(); handleDeleteSheet(s.id, s.games?.game_date ? formatDateOnly(s.games.game_date) : "this game"); }} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 7px", fontSize: 11, cursor: "pointer", marginLeft: 6 }}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
      {error && <div className="error-msg">{error}</div>}
      {canManage && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input value={newOpponentName} onChange={e => setNewOpponentName(e.target.value)} placeholder="New opponent name"
            onKeyDown={e => { if (e.key === "Enter") addOpponent(); }} style={{ ...inputStyle, flex: 1 }} />
          <button type="button" onClick={addOpponent} style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "0 16px", fontWeight: 600, cursor: "pointer" }}>Add</button>
        </div>
      )}
      {canManage && (
        <div style={{ marginBottom: 16 }}>
          <input ref={importFileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleImportFileChosen} />
          <button type="button" onClick={() => importFileRef.current?.click()} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📥 Import scout sheet from PDF</button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {opponents.map(o => (
          <div key={o.id} onClick={() => openOpponent(o)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10, cursor: "pointer" }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface1)", overflow: "hidden", flexShrink: 0 }}>
              {o.logo_url && <img src={o.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{o.name}</span>
          </div>
        ))}
        {opponents.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>No opponents yet — add one above.</div>}
      </div>
    </div>
  );
}
