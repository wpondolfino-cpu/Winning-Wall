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
// "We play them Dec 22" comes from our own schedule. "Open scout sheet"
// opens (or starts) the sheet for that upcoming game -- the sheet is only
// made when someone opens it, so assigning a scout never leaves a blank
// sheet behind.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getStaff } from "../../lib/plays";
import { getTeamTags, TeamTag } from "../../lib/scoutSheets";
import { time12 } from "../../lib/scheduleImport";
import { inputStyle } from "../../lib/inputStyle";
import {
  ScoutingGame, Ranking, OurGame, ScoutMode, getScoutingGames, getRankings, getOurUpcomingGames,
  addScout, setScoutMode, removeScout, addVideo, removeVideo, deleteScoutingGame, videoInfo,
  teamKey, isoDate, parseIso, weekStart, addDays,
} from "../../lib/scoutingCalendar";
import { PasteGamesModal, AddGameModal, RankingsModal } from "./ScoutingImport";

interface Props {
  /** Opens the Scout Sheets tab on our game's sheet. */
  onOpenSheet: (ourGameId: string) => void;
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
function monthDay(iso: string) {
  const d = parseIso(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ScoutingCalendar({ onOpenSheet }: Props) {
  const today = isoDate(new Date());
  const [week, setWeek] = useState<Date>(() => weekStart(new Date()));
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || "night"; } catch { return "night"; } });
  const [day, setDay] = useState<string>(today);
  const [games, setGames] = useState<ScoutingGame[]>([]);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [ours, setOurs] = useState<Map<string, OurGame>>(new Map());
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

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* fine */ } }, [view]);

  const from = isoDate(week), to = isoDate(addDays(week, 6));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDate(addDays(week, i))), [from]);

  const loadGames = useCallback(async () => {
    try { setGames(await getScoutingGames(from, to)); setErr(null); }
    catch (e: any) { setErr(e?.message ?? "Couldn't load the calendar."); }
  }, [from, to]);

  // Everything that doesn't change week to week.
  useEffect(() => {
    (async () => {
      const [{ data: { user } }, s, r, o, t] = await Promise.all([
        supabase.auth.getUser(),
        getStaff().catch(() => []),
        getRankings().catch(() => []),
        getOurUpcomingGames().catch(() => new Map<string, OurGame>()),
        getTeamTags().catch(() => []),
      ]);
      setMe(user?.id ?? null);
      setStaff((s as any[]).map(p => ({ id: p.id, name: p.name ?? "Coach" })));
      setRankings(r); setOurs(o); setTeams(t);
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
  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);
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
    const { data } = await supabase.from("scouting_games").select("away_team, home_team");
    setAllTeamNames(Array.from(new Set(((data ?? []) as any[]).flatMap(g => [g.away_team, g.home_team]))));
    setModal(m);
  }

  const weekLabel = (() => {
    const a = parseIso(from), b = parseIso(to);
    const m = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
    return a.getMonth() === b.getMonth() ? `${m(a)} ${a.getDate()} – ${b.getDate()}` : `${m(a)} ${a.getDate()} – ${m(b)} ${b.getDate()}`;
  })();

  const nightGames = mine ? games.filter(pass) : games.filter(g => g.game_date === day && pass(g));
  const nightTotal = mine ? games.length : games.filter(g => g.game_date === day).length;

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
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a team"
          style={{ ...inputStyle, flex: "1 1 140px", minWidth: 120, padding: "6px 10px", fontSize: 13 }} />
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
              <GameCard key={g.id} g={g} showDay={mine} rankBy={rankBy} ours={ours} teamById={teamById}
                staff={staff} me={me} coachLabel={coachLabel} act={act} onOpenSheet={onOpenSheet} />
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
        setModal(null);
        if (first) { setWeek(weekStart(parseIso(first))); setDay(first); }
        loadGames();
      }} />}
      {modal === "add" && <AddGameModal defaultDate={days.includes(day) ? day : from} onClose={() => setModal(null)} onSaved={d => {
        setModal(null); setWeek(weekStart(parseIso(d))); setDay(d); setView("night"); loadGames();
      }} />}
      {modal === "rankings" && <RankingsModal current={rankings} scheduleTeams={allTeamNames} onClose={() => setModal(null)} onSaved={async () => {
        setModal(null); setRankings(await getRankings().catch(() => []));
      }} />}
    </div>
  );
}

// ── One game ─────────────────────────────────────────────────
function GameCard({ g, showDay, rankBy, ours, teamById, staff, me, coachLabel, act, onOpenSheet }: {
  g: ScoutingGame; showDay: boolean;
  rankBy: Map<string, Ranking>; ours: Map<string, OurGame>; teamById: Map<string, TeamTag>;
  staff: { id: string; name: string }[]; me: string | null; coachLabel: (id: string) => string;
  act: (p: Promise<{ error: string | null }>, optimistic?: (gs: ScoutingGame[]) => ScoutingGame[]) => Promise<void>;
  onOpenSheet: (ourGameId: string) => void;
}) {
  const [addingVideo, setAddingVideo] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);

  const assigned = new Set(g.assignments.map(a => a.coach_id));
  const free = staff.filter(s => !assigned.has(s.id));
  const live = g.assignments.filter(a => a.mode === "live").length;
  const film = g.assignments.length - live;
  const opponents = [g.away_team, g.home_team].map(t => ours.get(teamKey(t))).filter(Boolean) as OurGame[];

  const patchGame = (fn: (x: ScoutingGame) => ScoutingGame) => (gs: ScoutingGame[]) => gs.map(x => x.id === g.id ? fn(x) : x);

  const line = (team: string, side: string) => {
    const r = rankBy.get(teamKey(team));
    const o = ours.get(teamKey(team));
    const t = o?.roster_id ? teamById.get(o.roster_id) : null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{team}</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{side}</span>
        {r && <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 6, background: "rgba(37,80,212,0.14)", color: "var(--info-text, var(--royal-light))" }}>D{r.division}{r.rank ? ` #${r.rank}` : ""}{r.record ? ` · ${r.record}` : ""}</span>}
        {o && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 6, background: "rgba(240,192,64,0.16)", color: "var(--gold-text)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            We play them {monthDay(o.game_date)}
            {t && <span style={{ fontSize: 10, padding: "0 6px", borderRadius: 999, background: t.color, color: "#fff" }}>{t.name}</span>}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "11px 13px", background: "var(--surface2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>{line(g.away_team, "away")}{line(g.home_team, "home")}</div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{g.tip_time ? time12(g.tip_time.slice(0, 5)) : "TBA"}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{showDay ? `${shortDate(g.game_date)} · ` : ""}at {g.home_team}</div>
        </div>
      </div>

      {/* Scouts */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        {g.assignments.map(a => (
          <span key={a.id} title={staff.find(s => s.id === a.coach_id)?.name ?? ""}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, padding: "3px 4px 3px 9px", borderRadius: 8,
              border: `1px solid ${a.mode === "film" ? FILM : LIVE}`, color: a.mode === "film" ? FILM : LIVE, background: "var(--surface)" }}>
            {a.coach_id === me ? "You" : `Coach ${coachLabel(a.coach_id)}`}
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
        ))}
        {free.length > 0 && (
          <select value="" onChange={e => { const id = e.target.value; if (id) act(addScout(g.id, id)); }}
            style={{ ...inputStyle, padding: "5px 8px", fontSize: 12.5, width: "auto" }}>
            <option value="">{g.assignments.length ? "+ Add coach" : "Assign scouts…"}</option>
            {me && !assigned.has(me) && <option value={me}>Me</option>}
            {free.filter(s => s.id !== me).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {opponents.map(o => (
          <button key={o.id} type="button" style={linkBtn} onClick={() => onOpenSheet(o.id)}>
            Open {o.opponent} scout sheet →
          </button>
        ))}
      </div>
      {g.assignments.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          {[live && `${live} live`, film && `${film} on film`].filter(Boolean).join(" · ")}
        </div>
      )}

      {/* Video */}
      {(g.videos.length > 0 || addingVideo) && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--border)", display: "grid", gap: 6 }}>
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

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, gap: 8 }}>
        {!addingVideo
          ? <button type="button" onClick={() => setAddingVideo(true)} style={{ background: "none", border: "none", color: "var(--royal-light)", cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}>+ Add video link</button>
          : <span />}
        <button type="button"
          onClick={() => {
            const extra = g.assignments.length || g.videos.length ? " Its scouts and video links go with it." : "";
            if (confirm(`Remove ${g.away_team} at ${g.home_team} from the calendar?${extra}`)) act(deleteScoutingGame(g.id), gs => gs.filter(x => x.id !== g.id));
          }}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11.5, padding: 0, fontFamily: "inherit" }}>Remove game</button>
      </div>
    </div>
  );
}
