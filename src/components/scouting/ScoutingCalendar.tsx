// src/components/scouting/ScoutingCalendar.tsx
// The Scouting page's Calendar tab: other teams' games worth watching and
// who's scouting them.
//
//   One night   -- a day's games as cards; assign coaches here.
//   Whole week  -- seven columns, for planning: which nights are covered,
//                  which games still need someone. Tap a game to open
//                  that night.
//
// Each game can have any number of coaches, each one Live (in the gym) or
// Film (watching the video), and any number of video links (YouTube and
// shared Google Drive files play on the page; Hudl, NFHS and anything
// else open in a new tab). Every coach in the program sees the same
// calendar; players never do.
//
// "vs 2/10" is our next varsity game against that team. Tapping a team's
// name opens its scout sheet: the one for that game if varsity plays them,
// otherwise (after asking) a sheet not tied to any game -- for a possible
// playoff opponent -- which moves onto the game if we end up playing them.
// Sheets are only made when someone opens one, so assigning a scout never
// leaves a blank sheet behind. Each scout says which team they're watching;
// that's a label only, anyone can edit any sheet.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getStaff } from "../../lib/plays";
import { getTeamTags, TeamTag, findLooseScoutSheet, ensureLooseScoutSheet } from "../../lib/scoutSheets";
import { time12 } from "../../lib/scheduleImport";
import { inputStyle } from "../../lib/inputStyle";
import {
  ScoutingGame, Ranking, OurGame, ScoutMode, getScoutingGames, getRankings, getOurUpcomingGames,
  addScout, setScoutMode, setScoutTeam, removeScout, addVideo, removeVideo, deleteScoutingGame, updateScoutingGame, videoInfo,
  teamKey, isTBA, pickOurGame, isVarsityName, isoDate, parseIso, weekStart, addDays, seasonStartYear,
} from "../../lib/scoutingCalendar";
import { PasteGamesModal, AddGameModal, RankingsModal } from "./ScoutingImport";

interface Props {
  /** Opens the Scout Sheets tab on our game's sheet. */
  onOpenSheet: (ourGameId: string) => void;
  /** Opens the Scout Sheets tab on a sheet that isn't tied to a game. */
  onOpenLooseSheet: (target: { sheetId: string; opponentId: string }) => void;
}

type View = "night" | "week";
const VIEW_KEY = "ww.scoutingView";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const chip = (on: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  background: on ? "var(--royal)" : "transparent", color: on ? "#fff" : "var(--muted)",
  border: on ? "1px solid var(--royal)" : "1px solid var(--border)", fontWeight: on ? 600 : 400,
});
const actionBtn: React.CSSProperties = { fontSize: 12.5, padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", fontWeight: 600 };
const linkBtn: React.CSSProperties = { fontSize: 11.5, padding: "3px 9px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", background: "transparent", color: "var(--text)", border: "1px solid var(--border)" };
const LIVE = "var(--green, #2d9b5a)";
const FILM = "var(--royal-light)";

function shortDate(iso: string) {
  const d = parseIso(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}
/** 2/10 */
function slashDate(iso: string) {
  const d = parseIso(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function monthDay(iso: string) {
  const d = parseIso(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ScoutingCalendar({ onOpenSheet, onOpenLooseSheet }: Props) {
  const today = isoDate(new Date());
  const [week, setWeek] = useState<Date>(() => weekStart(new Date()));
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || "night"; } catch { return "night"; } });
  const [day, setDay] = useState<string>(today);
  const [games, setGames] = useState<ScoutingGame[]>([]);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [ourAll, setOurAll] = useState<Map<string, OurGame[]>>(new Map());
  const [teams, setTeams] = useState<TeamTag[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [divs, setDivs] = useState<Set<number>>(new Set());
  const [top10, setTop10] = useState(false);
  const [onlyOurs, setOnlyOurs] = useState(false);
  const [mine, setMine] = useState(false);
  const [needs, setNeeds] = useState(false);
  const [q, setQ] = useState("");

  const [modal, setModal] = useState<null | "paste" | "add" | "rankings">(null);
  const [allTeamNames, setAllTeamNames] = useState<string[]>([]);
  // One team's whole season, instead of a week (tap a team's name, or pick one).
  const [teamFocus, setTeamFocus] = useState<string | null>(null);
  const [teamPick, setTeamPick] = useState("");

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* fine */ } }, [view]);

  const from = isoDate(week), to = isoDate(addDays(week, 6));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(week, i))), [from]);

  const loadTeamNames = useCallback(async () => {
    const { data } = await supabase.from("scouting_games").select("away_team, home_team");
    const names = new Map<string, string>();
    ((data ?? []) as any[]).flatMap(g => [g.away_team, g.home_team]).forEach((n: string) => {
      if (n && !isTBA(n) && !names.has(teamKey(n))) names.set(teamKey(n), n);
    });
    const list = [...names.values()].sort((a, b) => a.localeCompare(b));
    setAllTeamNames(list);
    return list;
  }, []);

  const loadGames = useCallback(async () => {
    try {
      if (teamFocus) {
        // The whole season (Aug to Jul) for one team.
        const y = seasonStartYear();
        const k = teamKey(teamFocus);
        const all = await getScoutingGames(`${y}-08-01`, `${y + 1}-07-31`);
        setGames(all.filter(g => teamKey(g.away_team) === k || teamKey(g.home_team) === k)
          .sort((x, y) => (x.game_date + (x.tip_time ?? "")).localeCompare(y.game_date + (y.tip_time ?? ""))));
      } else {
        setGames(await getScoutingGames(from, to));
      }
      setErr(null);
    } catch (e: any) { setErr(e?.message ?? "Couldn't load the calendar."); }
  }, [from, to, teamFocus]);

  useEffect(() => { loadTeamNames(); }, [loadTeamNames]);

  // Everything that doesn't change week to week.
  useEffect(() => {
    (async () => {
      const [{ data: { user } }, s, r, o, t] = await Promise.all([
        supabase.auth.getUser(),
        getStaff().catch(() => []),
        getRankings().catch(() => []),
        getOurUpcomingGames().catch(() => new Map<string, OurGame[]>()),
        getTeamTags().catch(() => []),
      ]);
      setMe(user?.id ?? null);
      setStaff((s as any[]).map(p => ({ id: p.id, name: p.name ?? "Coach" })));
      setRankings(r); setOurAll(o); setTeams(t);
    })();
  }, []);

  useEffect(() => { setLoading(true); loadGames().finally(() => setLoading(false)); }, [loadGames]);

  // Keep the chosen night inside the week on screen: today if it's this
  // week, otherwise the first night with games.
  useEffect(() => {
    if (days.includes(day)) return;
    if (days.includes(today)) { setDay(today); return; }
    const first = days.find(d => games.some(g => g.game_date === d));
    setDay(first ?? days[0]);
  }, [from, games]);

  const rankBy = useMemo(() => new Map(rankings.map(r => [teamKey(r.team), r])), [rankings]);
  // One of our games per opponent: the next varsity game, or (if varsity
  // doesn't play them) the next JV/freshman one.
  const ours = useMemo(() => {
    const varsity = new Set(teams.filter(t => isVarsityName(t.name)).map(t => t.id));
    const m = new Map<string, OurGame>();
    ourAll.forEach((list, k) => { const g = pickOurGame(list, varsity); if (g) m.set(k, g); });
    return m;
  }, [ourAll, teams]);
  const nameOf = useMemo(() => new Map(staff.map(s => [s.id, s.name])), [staff]);
  const divisionsOnFile = useMemo(() => Array.from(new Set(rankings.map(r => r.division))).sort((a, b) => a - b), [rankings]);

  const coachLabel = (id: string) => {
    if (id === me) return "You";
    const n = nameOf.get(id) ?? "Coach";
    const parts = n.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : n;
  };

  const pass = (g: ScoutingGame) => {
    if (mine && !g.assignments.some(a => a.coach_id === me)) return false;
    if (needs && g.assignments.length) return false;
    const ra = rankBy.get(teamKey(g.away_team)), rh = rankBy.get(teamKey(g.home_team));
    if (divs.size && !(ra && divs.has(ra.division)) && !(rh && divs.has(rh.division))) return false;
    if (top10 && !((ra?.rank ?? 99) <= 10 || (rh?.rank ?? 99) <= 10)) return false;
    if (onlyOurs && !ours.has(teamKey(g.away_team)) && !ours.has(teamKey(g.home_team))) return false;
    if (q.trim() && !`${g.away_team} ${g.home_team}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    return true;
  };

  // Changes are shown straight away, then saved; a failed save reloads.
  async function act(p: Promise<{ error: string | null }>, optimistic?: (gs: ScoutingGame[]) => ScoutingGame[]) {
    if (optimistic) setGames(optimistic);
    const { error } = await p;
    if (error) alert(error);
    await loadGames();
  }

  async function openAllTeams(m: "rankings") {
    await loadTeamNames();
    setModal(m);
  }

  // Tapping a team's name: its scout sheet. Our game's if varsity plays
  // them; else its sheet that isn't tied to a game, asking before making one.
  const [askLoose, setAskLoose] = useState<string | null>(null);
  const [looseBusy, setLooseBusy] = useState(false);
  async function openTeamSheet(name: string) {
    if (!name || isTBA(name)) return;
    const o = ours.get(teamKey(name));
    if (o) { onOpenSheet(o.id); return; }
    try {
      const found = await findLooseScoutSheet(name);
      if (found) { onOpenLooseSheet(found); return; }
    } catch { /* fall through to asking */ }
    setAskLoose(name);
  }
  async function createLoose() {
    if (!askLoose) return;
    setLooseBusy(true);
    try {
      const { sheetId, opponent } = await ensureLooseScoutSheet(askLoose);
      setAskLoose(null);
      onOpenLooseSheet({ sheetId, opponentId: opponent.id });
    } catch (e: any) { alert(e?.message ?? "Couldn't start that scout sheet."); }
    finally { setLooseBusy(false); }
  }
  const looseModal = askLoose && (
    <div onClick={() => !looseBusy && setAskLoose(null)}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Create a scout sheet"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, maxWidth: 420, width: "100%" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{askLoose} isn't on your schedule</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
          Create a scout sheet for {askLoose}? It's kept under {askLoose} in Scout Sheets as "Not on our schedule". If you end up playing them, it moves onto that game.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" disabled={looseBusy} onClick={() => setAskLoose(null)} style={{ ...actionBtn }}>Cancel</button>
          <button type="button" disabled={looseBusy} onClick={createLoose}
            style={{ ...actionBtn, background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" }}>{looseBusy ? "Creating…" : "Create scout sheet"}</button>
        </div>
      </div>
    </div>
  );

  function showTeam(name: string) {
    if (!name || isTBA(name)) return;
    setTeamFocus(name); setTeamPick("");
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  const weekLabel = (() => {
    const a = parseIso(from), b = parseIso(to);
    const m = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
    return a.getMonth() === b.getMonth() ? `${m(a)} ${a.getDate()} – ${b.getDate()}` : `${m(a)} ${a.getDate()} – ${m(b)} ${b.getDate()}`;
  })();

  const nightGames = mine ? games.filter(pass) : games.filter(g => g.game_date === day && pass(g));
  const nightTotal = mine ? games.length : games.filter(g => g.game_date === day).length;

  if (teamFocus) {
    const k = teamKey(teamFocus);
    const o = ours.get(k);
    const upcoming = games.filter(g => g.game_date >= today).length;
    let dividerShown = false;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <button type="button" style={actionBtn} onClick={() => setTeamFocus(null)}>← Calendar</button>
          <span style={{ fontSize: 19, fontWeight: 800 }}>{teamFocus}</span>
          {o && <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "rgba(240,192,64,0.16)", color: "var(--gold-text)" }}>vs {slashDate(o.game_date)}</span>}
          <button type="button" style={{ ...linkBtn, fontSize: 12 }} onClick={() => openTeamSheet(teamFocus)}>Scout sheet →</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          {loading ? "Loading…" : `${games.length} game${games.length === 1 ? "" : "s"} on the calendar this season · ${upcoming} still to play. Only games you've pasted or added show here.`}
        </div>
        {err && <div className="error-msg">{err}</div>}
        <div style={{ display: "grid", gap: 10 }}>
          {games.map(g => {
            const past = g.game_date < today;
            const divider = !past && !dividerShown && games.some(x => x.game_date < today);
            if (!past) dividerShown = true;
            return (
              <div key={g.id}>
                {divider && <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--gold-text)", margin: "6px 0 8px", letterSpacing: 0.5 }}>UPCOMING</div>}
                <div style={{ opacity: past ? 0.6 : 1 }}>
                  <GameCard g={g} showDay={true} ours={ours} onTeam={openTeamSheet}
                    staff={staff} me={me} coachLabel={coachLabel} act={act} />
                </div>
              </div>
            );
          })}
          {!loading && games.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--muted)", padding: "18px 12px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
              No games for {teamFocus} this season yet. + Paste games from their schedule to fill it in.
            </div>
          )}
        </div>
        {looseModal}
      </div>
    );
  }

  return (
    <div>
      {/* Top row: view, week, and the ways to add things */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
          {(["night", "week"] as View[]).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              style={{ fontSize: 13, padding: "7px 16px", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                background: view === v ? "var(--royal)" : "transparent", color: view === v ? "#fff" : "var(--muted)" }}>
              {v === "night" ? "One night" : "Whole week"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" style={chip(false)} onClick={() => setWeek(w => addDays(w, -7))} aria-label="Previous week">‹</button>
          <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 110, textAlign: "center" }}>{weekLabel}</span>
          <button type="button" style={chip(false)} onClick={() => setWeek(w => addDays(w, 7))} aria-label="Next week">›</button>
          {!days.includes(today) && <button type="button" style={chip(false)} onClick={() => { setWeek(weekStart(new Date())); setDay(today); }}>This week</button>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={actionBtn} onClick={() => setModal("paste")}>+ Paste games</button>
          <button type="button" style={actionBtn} onClick={() => setModal("add")}>+ Add game</button>
          <button type="button" style={actionBtn} onClick={() => openAllTeams("rankings")}>Rankings</button>
        </div>
      </div>

      {/* Nights of the week */}
      {view === "night" && !mine && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
          {days.map(d => {
            const n = games.filter(g => g.game_date === d).length;
            const on = d === day;
            return (
              <button key={d} type="button" onClick={() => setDay(d)}
                style={{ flex: "1 0 60px", padding: "6px 4px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "center",
                  background: on ? "var(--royal)" : "var(--surface2)", color: on ? "#fff" : "var(--text)",
                  border: on ? "1px solid var(--royal)" : d === today ? "1px solid var(--gold)" : "1px solid var(--border)", opacity: n || on ? 1 : 0.5 }}>
                <div style={{ fontSize: 11 }}>{DAY_NAMES[parseIso(d).getDay()]}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{parseIso(d).getMonth() + 1}/{parseIso(d).getDate()}</div>
                <div style={{ fontSize: 10.5, opacity: 0.8 }}>{n} game{n === 1 ? "" : "s"}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {divisionsOnFile.map(d => (
          <button key={d} type="button" style={chip(divs.has(d))}
            onClick={() => setDivs(s => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; })}>D{d}</button>
        ))}
        {divisionsOnFile.length > 0 && <button type="button" style={chip(top10)} onClick={() => setTop10(v => !v)}>Top 10</button>}
        <button type="button" style={chip(onlyOurs)} onClick={() => setOnlyOurs(v => !v)}>Teams we play</button>
        <button type="button" style={chip(mine)} onClick={() => { setMine(v => !v); setNeeds(false); }}>My scouting</button>
        <button type="button" style={chip(needs)} onClick={() => { setNeeds(v => !v); setMine(false); }}>Needs a scout</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search this week"
          style={{ ...inputStyle, flex: "1 1 140px", minWidth: 120, padding: "6px 10px", fontSize: 13 }} />
        <input value={teamPick} list="scout-team-names" placeholder="Team schedule…"
          onChange={e => {
            const v = e.target.value; setTeamPick(v);
            const hit = allTeamNames.find(n => teamKey(n) === teamKey(v));
            if (hit && allTeamNames.some(n => n === v)) showTeam(hit);   // picked from the list
          }}
          onKeyDown={e => { if (e.key === "Enter") { const hit = allTeamNames.find(n => teamKey(n) === teamKey(teamPick)); if (hit) showTeam(hit); } }}
          style={{ ...inputStyle, flex: "1 1 160px", minWidth: 140, padding: "6px 10px", fontSize: 13 }} />
        <datalist id="scout-team-names">{allTeamNames.map(n => <option key={n} value={n} />)}</datalist>
      </div>
      {divisionsOnFile.length === 0 && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: -6, marginBottom: 10 }}>
          Add the MIAA rankings (Rankings button) to see divisions and ranks on every game and filter by them.
        </div>
      )}

      {err && <div className="error-msg">{err}</div>}

      {view === "night" ? (
        <>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {loading ? "Loading…" : mine
              ? `${nightGames.length} game${nightGames.length === 1 ? "" : "s"} you're scouting this week`
              : `${nightGames.length} of ${nightTotal} game${nightTotal === 1 ? "" : "s"} on ${shortDate(day)}`}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {nightGames.map(g => (
              <GameCard key={g.id} g={g} showDay={mine} ours={ours} onTeam={openTeamSheet}
                staff={staff} me={me} coachLabel={coachLabel} act={act} />
            ))}
            {!loading && nightGames.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--muted)", padding: "18px 12px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
                {games.length === 0 ? "No games on the calendar this week yet. + Paste games to add a schedule." : "No games match these filters."}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {(() => {
              const shown = games.filter(pass);
              const covered = shown.filter(g => g.assignments.length).length;
              return `${shown.length} game${shown.length === 1 ? "" : "s"} this week · ${covered} with scouts · tap a game to open that night`;
            })()}
          </div>
          <div className="scout-week">
            {days.map(d => {
              const list = games.filter(g => g.game_date === d && pass(g));
              return (
                <div key={d} className="scout-week-col" style={{ borderColor: d === today ? "var(--gold)" : undefined }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{DAY_NAMES[parseIso(d).getDay()]}</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{parseIso(d).getMonth() + 1}/{parseIso(d).getDate()}</div>
                  {list.map(g => {
                    const opp = ours.has(teamKey(g.away_team)) || ours.has(teamKey(g.home_team));
                    return (
                      <div key={g.id} role="button" tabIndex={0} onClick={() => { setDay(d); setMine(false); setView("night"); }}
                        onKeyDown={e => { if (e.key === "Enter") { setDay(d); setMine(false); setView("night"); } }}
                        style={{ fontSize: 11.5, lineHeight: 1.3, padding: "6px 7px", marginTop: 6, borderRadius: 8, cursor: "pointer",
                          background: "var(--surface)", border: `1px solid ${opp ? "var(--gold)" : "var(--border)"}`,
                          borderLeft: g.assignments.length ? `3px solid ${LIVE}` : undefined }}>
                        <div style={{ fontWeight: 600 }}>{g.away_team}</div>
                        <div>@ {g.home_team}</div>
                        <div style={{ color: "var(--muted)" }}>{g.tip_time ? time12(g.tip_time.slice(0, 5)) : "TBA"}{opp ? " · we play" : ""}</div>
                        {g.location && <div style={{ color: "var(--muted)" }}>at {g.location}</div>}
                        {g.assignments.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                            {g.assignments.map(a => (
                              <span key={a.id} style={{ fontSize: 10, padding: "0 5px", borderRadius: 4, color: "#fff", background: a.mode === "film" ? FILM : LIVE }}>
                                {coachLabel(a.coach_id)}{a.mode === "film" ? " · Film" : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {list.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>—</div>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 14 }}>
        Every coach in the program sees this calendar. Players don't.
      </div>

      {modal === "paste" && <PasteGamesModal onClose={() => setModal(null)} onSaved={first => {
        setModal(null); loadTeamNames();
        if (first) { setWeek(weekStart(parseIso(first))); setDay(first); }
        loadGames();
      }} />}
      {modal === "add" && <AddGameModal defaultDate={days.includes(day) ? day : from} onClose={() => setModal(null)} onSaved={d => {
        setModal(null); loadTeamNames(); setWeek(weekStart(parseIso(d))); setDay(d); setView("night"); loadGames();
      }} />}
      {looseModal}
      {modal === "rankings" && <RankingsModal current={rankings} scheduleTeams={allTeamNames} onClose={() => setModal(null)} onSaved={async () => {
        setModal(null); setRankings(await getRankings().catch(() => []));
      }} />}
    </div>
  );
}

// ── One game ─────────────────────────────────────────────────
function GameCard({ g, showDay, ours, staff, me, coachLabel, act, onTeam }: {
  g: ScoutingGame; showDay: boolean;
  /** Tapping a team's name opens its scout sheet (or offers to start one). */
  onTeam: (name: string) => void;
  ours: Map<string, OurGame>;
  staff: { id: string; name: string }[]; me: string | null; coachLabel: (id: string) => string;
  act: (p: Promise<{ error: string | null }>, optimistic?: (gs: ScoutingGame[]) => ScoutingGame[]) => Promise<void>;
}) {
  const [addingVideo, setAddingVideo] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Assign scouts: pick a coach, then which team they're watching.
  const [picker, setPicker] = useState<null | { step: "coach" } | { step: "team"; coachId: string; assignmentId?: string }>(null);

  const assigned = new Set(g.assignments.map(a => a.coach_id));
  const coachChoices = [
    ...(me && !assigned.has(me) && staff.some(s => s.id === me) ? [{ id: me, name: "Me" }] : []),
    ...staff.filter(s => !assigned.has(s.id) && s.id !== me),
  ];
  // Teams a scout can be watching (a TBA team can't be scouted yet).
  const watchable = [g.away_team, g.home_team].filter(t => !isTBA(t));

  const patchGame = (fn: (x: ScoutingGame) => ScoutingGame) => (gs: ScoutingGame[]) => gs.map(x => x.id === g.id ? fn(x) : x);

  function pickCoach(coachId: string) {
    if (watchable.length > 1) { setPicker({ step: "team", coachId }); return; }
    setPicker(null);
    act(addScout(g.id, coachId, watchable[0] ?? null));
  }
  function pickTeam(team: string | null) {
    if (!picker || picker.step !== "team") return;
    const p = picker;
    setPicker(null);
    if (p.assignmentId) {
      act(setScoutTeam(p.assignmentId, team), patchGame(x => ({ ...x, assignments: x.assignments.map(y => y.id === p.assignmentId ? { ...y, sheet_team: team } : y) })));
    } else {
      act(addScout(g.id, p.coachId, team));
    }
  }

  // A team's name -- tap it for its scout sheet -- and, if varsity plays
  // them, when.
  const team = (name: string) => {
    if (isTBA(name)) return <span title="Opponent not known yet; Edit game once it is" style={{ fontSize: 15, fontWeight: 600, color: "var(--muted)", fontStyle: "italic" }}>TBA</span>;
    const o = ours.get(teamKey(name));
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => onTeam(name)} title={o ? `${name} scout sheet (our ${monthDay(o.game_date)} game)` : `${name} scout sheet`}
          style={{ fontSize: 15, fontWeight: 700, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text)", fontFamily: "inherit", textAlign: "left", textDecoration: "underline", textDecorationColor: "var(--border)", textUnderlineOffset: 3 }}>{name}</button>
        {o && <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 6, background: "rgba(240,192,64,0.16)", color: "var(--gold-text)" }}>vs {slashDate(o.game_date)}</span>}
      </span>
    );
  };

  const popBox: React.CSSProperties = { position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 6, minWidth: 220, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" };
  const popOpt: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", fontSize: 13, padding: "7px 9px", borderRadius: 7, border: "none", background: "transparent", color: "var(--text)", cursor: "pointer", fontFamily: "inherit" };
  const popHead: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", padding: "3px 9px 6px" };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "11px 13px", background: "var(--surface2)" }}>
      {editing ? <EditGame g={g} onCancel={() => setEditing(false)} onSave={async patch => {
        const { error } = await updateScoutingGame(g.id, patch);
        if (error) { alert(error); return; }
        setEditing(false);
        await act(Promise.resolve({ error: null }));
      }} /> :
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          {team(g.away_team)}
          <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 600 }}>@</span>
          {team(g.home_team)}
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{g.tip_time ? time12(g.tip_time.slice(0, 5)) : "TBA"}</div>
          {(showDay || g.location) && (
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {[showDay ? shortDate(g.game_date) : null, g.location ? `at ${g.location}` : null].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>}

      {/* Video */}
      {(g.videos.length > 0 || addingVideo) && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {g.videos.map(v => {
            const info = videoInfo(v.url);
            return (
              <div key={v.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Video</span>
                  {v.note && <span style={{ fontSize: 12, color: "var(--muted)" }}>{v.note}</span>}
                  {info.embed && (
                    <button type="button" style={linkBtn} onClick={() => setPlaying(p => p === v.id ? null : v.id)}>
                      {playing === v.id ? "Hide video" : "Play here"}
                    </button>
                  )}
                  <a href={v.url} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, textDecoration: "none" }}>Open in {info.label} ↗</a>
                  <button type="button" title="Remove this link" aria-label="Remove video link"
                    onClick={() => { if (confirm("Remove this video link?")) act(removeVideo(v.id), patchGame(x => ({ ...x, videos: x.videos.filter(y => y.id !== v.id) }))); }}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
                {playing === v.id && info.embed && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 10, overflow: "hidden", background: "#000" }}>
                      <iframe src={info.embed} title="Game video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} />
                    </div>
                    {info.kind === "drive" && (
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                        Won't play here? It's shared only with certain people; use Open in Drive. A new upload can take a few minutes to be ready.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {addingVideo && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a link: YouTube, Google Drive, Hudl, NFHS…" autoFocus
                style={{ ...inputStyle, flex: "2 1 220px", padding: "6px 10px", fontSize: 13 }} />
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional): 2nd half only"
                style={{ ...inputStyle, flex: "1 1 140px", padding: "6px 10px", fontSize: 13 }} maxLength={120} />
              <button type="button" disabled={!url.trim()}
                onClick={async () => { await act(addVideo(g.id, url, note)); setUrl(""); setNote(""); setAddingVideo(false); }}
                style={{ ...linkBtn, background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)", padding: "6px 12px" }}>Save</button>
              <button type="button" style={{ ...linkBtn, padding: "6px 12px" }} onClick={() => { setAddingVideo(false); setUrl(""); setNote(""); }}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Scouts, then the card's actions, all on one row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        {g.assignments.map(a => {
          const canSwitch = watchable.length > 1;
          return (
            <span key={a.id} title={staff.find(s => s.id === a.coach_id)?.name ?? ""}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, padding: "3px 4px 3px 9px", borderRadius: 8,
                border: `1px solid ${a.mode === "film" ? FILM : LIVE}`, color: a.mode === "film" ? FILM : LIVE, background: "var(--surface)" }}>
              <span role={canSwitch ? "button" : undefined} tabIndex={canSwitch ? 0 : undefined}
                title={canSwitch ? "Change which team they're watching" : undefined}
                onClick={() => canSwitch && setPicker({ step: "team", coachId: a.coach_id, assignmentId: a.id })}
                onKeyDown={e => { if (canSwitch && e.key === "Enter") setPicker({ step: "team", coachId: a.coach_id, assignmentId: a.id }); }}
                style={{ cursor: canSwitch ? "pointer" : "default" }}>
                {a.coach_id === me ? "You" : `Coach ${coachLabel(a.coach_id)}`}
                {a.sheet_team
                  ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {a.sheet_team}</span>
                  : canSwitch ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · both</span> : null}
              </span>
              <span style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                {(["live", "film"] as ScoutMode[]).map(m => (
                  <button key={m} type="button" onClick={() => a.mode !== m && act(setScoutMode(a.id, m), patchGame(x => ({ ...x, assignments: x.assignments.map(y => y.id === a.id ? { ...y, mode: m } : y) })))}
                    style={{ fontSize: 11, padding: "2px 8px", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
                      background: a.mode === m ? (m === "film" ? FILM : LIVE) : "transparent", color: a.mode === m ? "#fff" : "var(--muted)" }}>
                    {m === "live" ? "Live" : "Film"}
                  </button>
                ))}
              </span>
              <button type="button" title="Remove" aria-label="Remove scout"
                onClick={() => act(removeScout(a.id), patchGame(x => ({ ...x, assignments: x.assignments.filter(y => y.id !== a.id) })))}
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: "0 4px", lineHeight: 1 }}>×</button>
            </span>
          );
        })}

        <span style={{ position: "relative" }}>
          {(coachChoices.length > 0 || picker) && (
            <button type="button" onClick={() => setPicker(p => p ? null : { step: "coach" })}
              style={{ ...linkBtn, borderRadius: 8, padding: "5px 11px", fontSize: 12.5, fontWeight: 600 }}>
              {g.assignments.length ? "+ Add scout" : "Assign scouts"}
            </button>
          )}
          {picker && (
            <>
              {/* Tap anywhere else to close. */}
              <div onClick={() => setPicker(null)} style={{ position: "fixed", inset: 0, zIndex: 29 }} />
              <div style={popBox} role="menu">
                {picker.step === "coach" ? (
                  <>
                    <div style={popHead}>Who's scouting?</div>
                    {coachChoices.map(c => (
                      <button key={c.id} type="button" role="menuitem" style={popOpt} onClick={() => pickCoach(c.id)}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        {c.name}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <div style={popHead}>
                      Which team is {picker.coachId === me ? "you" : `Coach ${coachLabel(picker.coachId)}`} watching?
                    </div>
                    {[...watchable.map(t => ({ value: t as string | null, label: t })), { value: null, label: "Both teams" }].map(o => {
                      const our = o.value ? ours.get(teamKey(o.value)) : undefined;
                      return (
                        <button key={o.label} type="button" role="menuitem" style={popOpt} onClick={() => pickTeam(o.value)}
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                          {o.label}
                          {our && <span style={{ color: "var(--muted)", fontSize: 11.5 }}> · vs {slashDate(our.game_date)}</span>}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </span>

        {!addingVideo && (
          <button type="button" onClick={() => setAddingVideo(true)} style={{ background: "none", border: "none", color: "var(--royal-light)", cursor: "pointer", fontSize: 12, padding: "0 4px", fontFamily: "inherit" }}>+ Add video link</button>
        )}
        <span style={{ display: "flex", gap: 14, marginLeft: "auto" }}>
          <button type="button" onClick={() => setEditing(true)}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11.5, padding: 0, fontFamily: "inherit" }}>Edit game</button>
          <button type="button"
            onClick={() => {
              const extra = g.assignments.length || g.videos.length ? " Its scouts and video links go with it." : "";
              if (confirm(`Remove ${g.away_team} at ${g.home_team} from the calendar?${extra}`)) act(deleteScoutingGame(g.id), gs => gs.filter(x => x.id !== g.id));
            }}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11.5, padding: 0, fontFamily: "inherit" }}>Remove game</button>
        </span>
      </div>
    </div>
  );
}

// ── Editing a game ───────────────────────────────────────────
function EditGame({ g, onCancel, onSave }: {
  g: ScoutingGame; onCancel: () => void;
  onSave: (patch: { game_date: string; tip_time: string | null; away_team: string; home_team: string; location: string | null }) => Promise<void>;
}) {
  const [date, setDate] = useState(g.game_date);
  const [time, setTime] = useState(g.tip_time ? g.tip_time.slice(0, 5) : "");
  const [away, setAway] = useState(g.away_team);
  const [home, setHome] = useState(g.home_team);
  const [loc, setLoc] = useState(g.location ?? "");
  const [busy, setBusy] = useState(false);
  const field: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box", padding: "6px 9px", fontSize: 13 };
  const lab: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 3 };
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        <label><span style={lab}>Away</span><input value={away} onChange={e => setAway(e.target.value)} placeholder="Team, or TBA" style={field} /></label>
        <label><span style={lab}>Home</span><input value={home} onChange={e => setHome(e.target.value)} placeholder="Team, or TBA" style={field} /></label>
        <label><span style={lab}>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} style={field} /></label>
        <label><span style={lab}>Tip time</span><input type="time" value={time} onChange={e => setTime(e.target.value)} style={field} /></label>
        <label style={{ gridColumn: "1 / -1" }}><span style={lab}>Location — only if it isn't at {home.trim() && !isTBA(home) ? home.trim() : "the home team"}'s gym</span>
          <input value={loc} onChange={e => setLoc(e.target.value)} placeholder="e.g. TD Garden, or the tournament site" style={field} maxLength={80} /></label>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" style={{ ...linkBtn, padding: "6px 12px" }} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy}
          onClick={async () => { setBusy(true); await onSave({ game_date: date, tip_time: time || null, away_team: away, home_team: home, location: loc || null }); setBusy(false); }}
          style={{ ...linkBtn, padding: "6px 12px", background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" }}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
