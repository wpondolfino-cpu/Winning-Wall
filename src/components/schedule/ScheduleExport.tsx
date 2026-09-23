// src/components/schedule/ScheduleExport.tsx
//
// The schedule, shaped for the Sunday email to parents and athletes.
//
// "Copy for email" is the main action, deliberately ahead of print. It
// puts a real HTML table on the clipboard, so it pastes into Gmail or
// Outlook as a table that reads on a phone and never gets blocked. An
// image would be worse on all three counts — many clients hide images by
// default, it has to be pinched to read, and a parent can't copy a time
// out of it — which is why there's no image option.
//
// Drafts are included. A draft is a practice whose plan isn't built, not
// one whose time is unknown, and the time is what a parent needs.

import { useState, useMemo } from "react";
import { ScheduleItem, getPracticeEndTimes, teamLabelFor } from "../../lib/schedule";

interface RosterLite { id: string; name: string; color?: string; }

export default function ScheduleExport({ items, rosters, defaultRosterId, onClose }: {
  items: ScheduleItem[];
  rosters: RosterLite[];
  defaultRosterId?: string | null;
  onClose: () => void;
}) {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  const [from, setFrom] = useState(iso(today));
  const [to, setTo] = useState(iso(plus(today, 13)));
  const [rosterId, setRosterId] = useState<string>(defaultRosterId ?? "");
  const [kinds, setKinds] = useState({ practice: true, game: true, event: true });
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const chosen = useMemo(() => items
    .filter(i => i.date >= from && i.date <= to)
    .filter(i => kinds[i.kind])
    // An item with no team recorded goes to everyone rather than no one —
    // a missing roster is a data gap, not a sign it's private.
    .filter(i => !rosterId || !(i.rosterIds ?? []).length || (i.rosterIds ?? []).includes(rosterId))
    .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))),
    [items, from, to, rosterId, kinds]);

  const teamName = rosters.find(r => r.id === rosterId)?.name ?? "All teams";

  const t12 = (t: string | null | undefined) => {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const dayLabel = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const weekOf = (d: string) => {
    // Sunday–Saturday, matching how practice weeks run.
    const x = new Date(d + "T12:00:00");
    x.setDate(x.getDate() - x.getDay());
    return iso(x);
  };
  const rangeLabel = `${dayLabel(from).replace(/^\w+, /, "")} to ${dayLabel(to).replace(/^\w+, /, "")}`;

  /** One row's time column. A practice with an end shows the range. */
  function when(i: ScheduleItem, ends: Record<string, string>) {
    if (!i.time) return "TBA";
    const end = i.kind === "practice" ? ends[i.id] : undefined;
    return end ? `${t12(i.time).replace(/ (AM|PM)$/, "")}–${t12(end)}` : t12(i.time);
  }

  /** What happens, and for an away game, the bus — the time a parent
   *  actually has to act on. */
  function what(i: ScheduleItem): { text: string; bold: boolean; extra: string } {
    if (i.kind === "game") {
      const extra = i.homeAway === "away" && i.busTime ? `bus ${t12(i.busTime)}`
        : i.homeAway === "home" ? "home" : "";
      return { text: i.title, bold: true, extra };
    }
    return { text: i.title, bold: false, extra: i.subtitle ?? "" };
  }

  function groupByWeek() {
    const weeks = new Map<string, ScheduleItem[]>();
    for (const i of chosen) {
      const k = weekOf(i.date);
      if (!weeks.has(k)) weeks.set(k, []);
      weeks.get(k)!.push(i);
    }
    return [...weeks.entries()];
  }

  /**
   * The team column, shown only when rows differ — the whole program on
   * one sheet. On a single team's sheet every row would say the same thing.
   *
   * The NAME is what does the work: plenty of printers are black and white.
   * The swatch is a bonus, and is a filled cell rather than a background
   * colour on the row, because browsers drop background colours when
   * printing unless told otherwise — see the print-colour rule in printIt.
   */
  const teamCol = (i: ScheduleItem) => teamLabelFor(i.rosterIds, rosters, rosterId || null);
  const showTeams = chosen.some(i => teamCol(i));

  function swatches(i: ScheduleItem): string {
    const cs = (i.rosterIds ?? []).map(id => rosters.find(r => r.id === id)?.color).filter(Boolean) as string[];
    return cs.map(c => `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c};margin-right:3px;vertical-align:middle;border:1px solid rgba(0,0,0,0.2);"></span>`).join("");
  }

  function buildHtml(ends: Record<string, string>) {
    const cell = "padding:6px 8px;border-bottom:1px solid #e5e5e5;";
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const cols = showTeams ? 4 : 3;
    let rows = "";
    for (const [wk, list] of groupByWeek()) {
      rows += `<tr style="background:#f2f2f2;"><td colspan="${cols}" style="padding:6px 8px;font-weight:bold;">Week of ${esc(dayLabel(wk).replace(/^\w+, /, ""))}</td></tr>`;
      for (const i of list) {
        const w = what(i);
        rows += `<tr><td style="${cell}width:${showTeams ? 22 : 28}%;">${esc(dayLabel(i.date))}</td>`
          + `<td style="${cell}width:${showTeams ? 20 : 24}%;">${esc(when(i, ends))}</td>`
          + (showTeams ? `<td style="${cell}width:20%;white-space:nowrap;">${swatches(i)}${esc(teamCol(i))}</td>` : "")
          + `<td style="${cell}">${w.bold ? `<b>${esc(w.text)}</b>` : esc(w.text)}${w.extra ? ` · ${esc(w.extra)}` : ""}</td></tr>`;
      }
    }
    const hasPracticeEnds = chosen.some(i => i.kind === "practice" && ends[i.id]);
    return `<div style="font-family:Arial,sans-serif;color:#1a1a1a;">`
      + `<div style="font-size:16px;font-weight:bold;margin-bottom:2px;">${esc(teamName)} — ${esc(rangeLabel)}</div>`
      + (note.trim() ? `<div style="font-size:13px;color:#555;margin-bottom:12px;">${esc(note.trim())}</div>` : "")
      + `<table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>`
      + (hasPracticeEnds ? `<div style="font-size:11px;color:#777;margin-top:8px;">Practice end times are expected.</div>` : "")
      + `</div>`;
  }

  /** The same, as plain text — what pastes when rich text isn't accepted. */
  function buildText(ends: Record<string, string>) {
    const lines = [`${teamName} — ${rangeLabel}`];
    if (note.trim()) lines.push(note.trim());
    for (const [wk, list] of groupByWeek()) {
      lines.push("", `Week of ${dayLabel(wk).replace(/^\w+, /, "")}`);
      for (const i of list) {
        const w = what(i);
        const t = teamCol(i);
        lines.push(`  ${dayLabel(i.date)}  ${when(i, ends)}  ${t ? `[${t}] ` : ""}${w.text}${w.extra ? ` · ${w.extra}` : ""}`);
      }
    }
    if (chosen.some(i => i.kind === "practice" && ends[i.id])) lines.push("", "Practice end times are expected.");
    return lines.join("\n");
  }

  async function copyForEmail() {
    setStatus("Working…");
    const ends = await getPracticeEndTimes(chosen);
    const html = buildHtml(ends), text = buildText(ends);
    try {
      // Both at once, so the email client picks whichever it can use.
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      setStatus("Copied — paste it into your email.");
    } catch {
      // Older browsers only take plain text.
      await navigator.clipboard.writeText(text);
      setStatus("Copied as plain text — this browser can't copy the table.");
    }
    setTimeout(() => setStatus(null), 3500);
  }

  async function printIt() {
    const ends = await getPracticeEndTimes(chosen);
    const w = window.open("", "_blank");
    if (!w) { alert("Your browser blocked the print window — allow pop-ups for this site."); return; }
    w.document.write(`<!doctype html><html><head><title>${teamName} schedule</title>`
      + `<style>body{margin:32px;} *{-webkit-print-color-adjust:exact;print-color-adjust:exact;} @media print{body{margin:0.5in;}}</style></head><body>`
      + buildHtml(ends) + `</body></html>`);
    w.document.close();
    w.focus();
    // "Save as PDF" is the print dialog's own destination, so print covers both.
    setTimeout(() => w.print(), 250);
  }

  const field: React.CSSProperties = {
    background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8,
    padding: "7px 9px", color: "var(--text)", fontFamily: "inherit", fontSize: 13,
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: 16, width: "min(560px, 96vw)", maxHeight: "90vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>Print or email the schedule</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>From<br />
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={field} /></label>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>To<br />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={field} /></label>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>Team<br />
            <select value={rosterId} onChange={e => setRosterId(e.target.value)} style={field}>
              <option value="">All teams</option>
              {rosters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12, fontSize: 13, color: "var(--text)" }}>
          {(["practice", "game", "event"] as const).map(k => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" checked={kinds[k]} onChange={e => setKinds(p => ({ ...p, [k]: e.target.checked }))} />
              {k === "practice" ? "Practices" : k === "game" ? "Games" : "Other events"}
            </label>
          ))}
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>A note at the top (optional)</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Picture day is the 29th — white jerseys."
          style={{ ...field, width: "100%", marginBottom: 14, boxSizing: "border-box" }} />

        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          {chosen.length === 0
            ? "Nothing on the schedule in that range."
            : `${chosen.length} item${chosen.length === 1 ? "" : "s"}, including drafts.`}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={copyForEmail} disabled={chosen.length === 0}
            style={{ flex: 1, background: "var(--gold)", border: "none", borderRadius: 10, padding: 10, color: "#1a1a1a", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: chosen.length === 0 ? 0.5 : 1 }}>
            Copy for email
          </button>
          <button onClick={printIt} disabled={chosen.length === 0}
            style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 10, padding: 10, color: "var(--text)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: chosen.length === 0 ? 0.5 : 1 }}>
            Print / save as PDF
          </button>
        </div>
        {status && <div style={{ fontSize: 12, color: "#5de098", marginTop: 10, textAlign: "center" }}>{status}</div>}
      </div>
    </div>
  );
}
