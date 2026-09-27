// src/components/CompetitionsCard.tsx
//
// Settings → Competitions. Replaces the biweekly anchor-date card.
//
// Competitions are scheduled, not computed: each has its own first and
// last day (midnight to midnight Eastern), and only one runs at a time.
// "Repeat" starts the next one of the same length when it ends; turning
// it off is how you pause. The crown queue sits underneath.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  Competition, CompetitionLength, useCompetition, loadCurrentCompetition,
  easternDate, easternMidnightISO, addDays, presetLastDay, defaultCompetitionName,
  competitionRange, firstDay, lastDay, daysLeft, LENGTH_LABEL, shortDate,
  CompetitionScoring, SCORING_LABEL,
} from "../lib/periods";
import { getSeasonMode } from "../lib/seasonMode";
import ChampionsPanel from "./coach/ChampionsPanel";

const PRESETS: CompetitionLength[] = ["day", "week", "two_weeks", "month", "custom"];

function friendlyError(msg: string): string {
  if (/exclu|overlap|conflicting key/i.test(msg)) return "Those dates overlap another competition. Only one can run at a time.";
  return msg;
}

export default function CompetitionsCard() {
  const { current } = useCompetition();
  const [upcoming, setUpcoming] = useState<Competition[]>([]);
  const [latestLastDay, setLatestLastDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Schedule form
  const today = easternDate(new Date());
  const [kind, setKind] = useState<CompetitionLength>("two_weeks");
  const [first, setFirst] = useState(today);
  const [last, setLast] = useState(presetLastDay(today, "two_weeks"));
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [repeats, setRepeats] = useState(true);
  // Follows the offseason / in-season switch unless changed here.
  const [scoring, setScoring] = useState<CompetitionScoring>(getSeasonMode() === "inseason" ? "practice_wins" : "points");

  // Changing the running one's last day
  const [editingEnd, setEditingEnd] = useState(false);
  const [newLast, setNewLast] = useState("");

  async function load() {
    const [{ data: up }, { data: latest }] = await Promise.all([
      supabase.from("competitions").select("*").gt("starts_at", new Date().toISOString()).order("starts_at"),
      supabase.from("competitions").select("*").order("ends_at", { ascending: false }).limit(1),
    ]);
    setUpcoming((up as Competition[]) ?? []);
    const l = ((latest as Competition[]) ?? [])[0];
    // The form defaults to the day after whatever is scheduled last, or today.
    const nextFirst = l && Date.parse(l.ends_at) > Date.now() ? addDays(lastDay(l), 1) : easternDate(new Date());
    setLatestLastDay(l ? lastDay(l) : null);
    setFirst(nextFirst);
    setLast(presetLastDay(nextFirst, kind === "custom" ? "two_weeks" : kind));
  }
  useEffect(() => { load(); }, []);

  async function refreshAll() {
    await Promise.all([load(), loadCurrentCompetition(true)]);
  }

  // Presets set the last day; the name follows the dates until typed over.
  function pickKind(k: CompetitionLength) {
    setKind(k);
    if (k !== "custom") setLast(presetLastDay(first, k));
  }
  function pickFirst(d: string) {
    setFirst(d);
    if (kind !== "custom") setLast(presetLastDay(d, kind));
  }
  const shownName = nameTouched ? name : (first && last ? defaultCompetitionName(first, last) : "");

  async function schedule() {
    setErr(null);
    if (!first || !last) { setErr("Pick a first and last day."); return; }
    if (first < today) { setErr("The first day can't be in the past."); return; }
    if (last < first) { setErr("The last day is before the first day."); return; }
    if (!shownName.trim()) { setErr("Give it a name."); return; }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("competitions").insert({
      name: shownName.trim(),
      starts_at: easternMidnightISO(first),
      ends_at: easternMidnightISO(addDays(last, 1)),
      length_kind: kind,
      repeats,
      scored_by: scoring,
      created_by: user?.id ?? null,
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error.message)); return; }
    setNameTouched(false); setName("");
    await refreshAll();
  }

  async function update(id: string, patch: Partial<Competition>) {
    setErr(null); setBusy(true);
    const { error } = await supabase.from("competitions").update(patch).eq("id", id);
    setBusy(false);
    if (error) { setErr(friendlyError(error.message)); return false; }
    await refreshAll();
    return true;
  }

  async function saveNewEnd() {
    if (!current || !newLast) return;
    if (newLast < today) { setErr("The last day can't be in the past."); return; }
    if (newLast < firstDay(current)) { setErr("The last day is before it started."); return; }
    if (await update(current.id, { ends_at: easternMidnightISO(addDays(newLast, 1)), name: followDates(current, newLast) })) setEditingEnd(false);
  }

  /**
   * A name that is just the dates ("Sep 21 – Oct 4") follows them when the
   * dates change. A name you typed yourself ("Fall week 3") is left alone.
   */
  function followDates(c: Competition, newLastDay: string): string {
    return c.name === competitionRange(c) ? defaultCompetitionName(firstDay(c), newLastDay) : c.name;
  }

  async function endEarly() {
    if (!current) return;
    if (!window.confirm(`End ${current.name} now?\n\nIt stops counting immediately and goes to the crown queue. Repeat is turned off, so nothing new starts until you schedule it.`)) return;
    await update(current.id, { ends_at: new Date().toISOString(), repeats: false, name: followDates(current, today) });
  }

  async function rename(c: Competition) {
    const n = window.prompt("Rename competition:", c.name);
    if (n == null || !n.trim() || n.trim() === c.name) return;
    await update(c.id, { name: n.trim() });
  }

  async function toggleScoring(c: Competition) {
    const next: CompetitionScoring = c.scored_by === "practice_wins" ? "points" : "practice_wins";
    if (!window.confirm(`Score ${c.name} on ${SCORING_LABEL[next].toLowerCase()} instead?\n\nThis decides how its champions are crowned.`)) return;
    await update(c.id, { scored_by: next });
  }

  async function removeUpcoming(c: Competition) {
    if (!window.confirm(`Delete ${c.name}? It hasn't started, so nothing is lost.`)) return;
    setBusy(true);
    const { error } = await supabase.from("competitions").delete().eq("id", c.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await refreshAll();
  }

  const label: React.CSSProperties = { fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 };
  const input: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%" };
  const small = (active = false): React.CSSProperties => ({
    background: active ? "rgba(26,63,168,0.25)" : "var(--surface2)", color: active ? "#93b4ff" : "var(--text)",
    border: `1px solid ${active ? "var(--royal-light)" : "var(--border)"}`, borderRadius: 8, padding: "6px 12px",
    fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap",
  });

  const total = current ? Math.max(1, Math.round((Date.parse(current.ends_at) - Date.parse(current.starts_at)) / 86400000)) : 1;
  const elapsed = current ? Math.min(total, Math.max(0, total - daysLeft(current) + 1)) : 0;

  return (
    <div className="card">
      <div className="card-title">🏆 Competitions</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
        Each competition runs midnight to midnight Eastern, one at a time. Perks reset with each one. Turn repeat off to pause after the current one.
      </div>

      {/* Running now */}
      <div style={label}>Running now</div>
      {current ? (
        <div style={{ background: "rgba(26,63,168,0.15)", border: "1px solid rgba(26,63,168,0.35)", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--gold)", cursor: "pointer" }} onClick={() => rename(current)} title="Rename">{current.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {competitionRange(current)} · {daysLeft(current) === 1 ? "last day" : `${daysLeft(current)} days left`}
            </div>
          </div>
          <div style={{ height: 4, background: "var(--surface2)", borderRadius: 2, margin: "8px 0 10px" }}>
            <div style={{ width: `${Math.round((elapsed / total) * 100)}%`, height: 4, background: "var(--gold)", borderRadius: 2 }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)", marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={current.repeats} disabled={busy}
              onChange={e => update(current.id, { repeats: e.target.checked })} />
            {current.repeats
              ? `Repeats: the next ${LENGTH_LABEL[current.length_kind].toLowerCase()} starts on its own`
              : "Doesn't repeat: competitions pause after this one"}
          </label>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Crowned on: <b style={{ color: "var(--text)" }}>{SCORING_LABEL[current.scored_by ?? "points"]}</b>
            {" · "}<span onClick={() => toggleScoring(current)} style={{ color: "#93b4ff", cursor: "pointer" }}>change</span>
          </div>
          {editingEnd ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Last day</span>
              <input type="date" value={newLast} min={today} onChange={e => setNewLast(e.target.value)} style={{ ...input, width: 160 }} />
              <button onClick={saveNewEnd} disabled={busy} style={small(true)}>Save</button>
              <button onClick={() => setEditingEnd(false)} style={small()}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => { setNewLast(lastDay(current)); setEditingEnd(true); }} style={small()}>Change last day</button>
              <button onClick={() => rename(current)} style={small()}>Rename</button>
              <button onClick={endEarly} disabled={busy} style={{ ...small(), color: "#ff7b7b" }}>End now</button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "var(--muted)" }}>
          ⏸️ No competition running. {upcoming[0] ? `${upcoming[0].name} starts ${shortDate(firstDay(upcoming[0]))}.` : "Schedule one below."}
        </div>
      )}

      {/* Scheduled */}
      {upcoming.length > 0 && (
        <>
          <div style={label}>Scheduled</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {upcoming.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{competitionRange(c)}{c.repeats ? " · repeats" : ""} · <span onClick={() => toggleScoring(c)} style={{ cursor: "pointer", textDecoration: "underline dotted" }}>{SCORING_LABEL[c.scored_by ?? "points"]}</span></div>
                </div>
                <button onClick={() => rename(c)} style={small()}>Rename</button>
                <button onClick={() => removeUpcoming(c)} disabled={busy} style={{ ...small(), color: "#ff7b7b" }}>Delete</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Crown queue */}
      <ChampionsPanel />

      {/* Schedule next */}
      <div style={label}>Schedule {current || upcoming.length ? "next" : "a competition"}</div>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {PRESETS.map(k => (
            <button key={k} onClick={() => pickKind(k)} style={small(kind === k)}>{k === "custom" ? "Custom dates" : LENGTH_LABEL[k]}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Name</div>
            <input value={shownName} onChange={e => { setName(e.target.value); setNameTouched(true); }} style={input} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>First day</div>
            <input type="date" value={first} min={today} onChange={e => pickFirst(e.target.value)} style={input} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Last day</div>
            <input type="date" value={last} min={first} disabled={kind !== "custom"}
              onChange={e => setLast(e.target.value)} style={{ ...input, opacity: kind === "custom" ? 1 : 0.7 }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Crowned on</span>
          {(["points", "practice_wins"] as CompetitionScoring[]).map(k => (
            <button key={k} onClick={() => setScoring(k)} style={small(scoring === k)}>{SCORING_LABEL[k]}</button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)", marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={repeats} onChange={e => setRepeats(e.target.checked)} />
          Repeat with the same length when it ends
        </label>
        {latestLastDay && first <= latestLastDay && (
          <div style={{ fontSize: 12, color: "#ff8c42", marginBottom: 10 }}>
            Starts before the last scheduled competition ends ({shortDate(latestLastDay)}). Change that one's last day first, or start after it.
          </div>
        )}
        <button onClick={schedule} disabled={busy}
          style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {busy ? "Saving…" : "Schedule"}
        </button>
      </div>

      {err && <div style={{ fontSize: 12, color: "#ff7b7b", marginTop: 10 }}>{err}</div>}
    </div>
  );
}
