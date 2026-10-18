// src/components/platform/PlatformPage.tsx
// Platform admin pages (migrations 189-190), one per sidebar entry:
//   home          totals, "Needs attention", recent changes
//   schools       schools and their programs (search + filters)
//   trainers      trainers and their program (search + filters)
//   announcements post to chosen programs / schools / trainers / all
//   library       Winning Wall library (next update)
// Managing one program opens over whichever page you came from. Only the
// platform admin ever sees these; the database checks every call too.

import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import { switchProgram } from "../../lib/programs";
import { FEATURE_GROUPS, FeatureKey, setFeature } from "../../lib/features";
import {
  PlatformSchool, PlatformProgram, PersonMatch, PlatformHome, OrgKind, loadPlatform, loadHome, searchPeople, setHeadCoach,
  newJoinCode, createProgram, createSchool, createTrainer, updateProgram, updateSchool, uploadLogo, inviteLink,
  saveOrgNotes, programLog, postToPrograms,
} from "../../lib/platform";
import MessageInbox, { ProgramOption } from "../messages/MessageInbox";

export type PlatformSection = "home" | "schools" | "trainers" | "announcements" | "messages" | "library";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16 };
const btn: CSSProperties = { height: 42, padding: "0 16px", borderRadius: 10, border: 0, background: "var(--royal)", color: "var(--white)", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghost: CSSProperties = { ...btn, background: "transparent", border: "1px solid rgba(176,184,200,0.3)", color: "#c3d0ff" };
const danger: CSSProperties = { ...btn, background: "transparent", border: "1px solid rgba(255,140,140,0.35)", color: "#ff9a9a" };
const input: CSSProperties = { height: 44, boxSizing: "border-box", padding: "0 12px", borderRadius: 10, border: "1px solid rgba(176,184,200,0.25)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14, width: "100%" };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#a3adc4" };
const muted: CSSProperties = { fontSize: 12, color: "#8b95ae", lineHeight: 1.5 };
const h2: CSSProperties = { fontSize: 17, fontWeight: 700, color: "var(--white)" };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 3).toUpperCase();
}
function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
function when(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Logo({ url, text, bg, fg, size }: { url: string | null; text: string; bg: string; fg: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) return <img src={url} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: 10, objectFit: "contain", flexShrink: 0 }} />;
  return (
    <span style={{ width: size, height: size, borderRadius: 10, background: bg, color: fg, fontFamily: "'Bebas Neue', sans-serif", fontSize: size * 0.4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{text}</span>
  );
}

function Title({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 260px" }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase" }}>Platform</span>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, letterSpacing: 1, color: "var(--white)", lineHeight: 1 }}>{text}</span>
      </div>
      {action}
    </div>
  );
}

export default function PlatformPage({ page, onGoTo, onMessagesRead }: { page: PlatformSection; onGoTo: (p: PlatformSection) => void; onMessagesRead?: () => void }) {
  const [orgs, setOrgs] = useState<PlatformSchool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<string | null>(null);

  async function refresh() {
    try { setOrgs(await loadPlatform()); }
    catch (e: any) { setError(e?.message ?? "Couldn't load the platform."); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { setManaging(null); }, [page]);

  const managed = orgs?.flatMap(o => o.programs.map(p => ({ org: o, program: p }))).find(x => x.program.id === managing) ?? null;

  return (
    <div className="panel active" style={{ maxWidth: 1180, margin: "0 auto" }}>
      {error && <div style={{ color: "#ff8a8a", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {managed ? (
        <ProgramManage org={managed.org} program={managed.program} onBack={() => setManaging(null)} onChanged={refresh} />
      ) : page === "home" ? (
        <Home onManage={setManaging} onGoTo={onGoTo} />
      ) : page === "schools" || page === "trainers" ? (
        <OrgsPage kind={page === "schools" ? "school" : "trainer"} orgs={orgs} onManage={setManaging} onChanged={refresh} />
      ) : page === "announcements" ? (
        <Announcements orgs={orgs} />
      ) : page === "messages" ? (
        <Messages orgs={orgs} onRead={onMessagesRead} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Title text="Winning Wall library" />
          <div style={{ ...card, padding: 20, ...muted, fontSize: 14 }}>
            The Winning Wall library (starter pack and "New from Winning Wall") comes in a later update.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────
function Home({ onManage, onGoTo }: { onManage: (id: string) => void; onGoTo: (p: PlatformSection) => void }) {
  const [h, setH] = useState<PlatformHome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadHome().then(setH).catch((e: any) => setErr(e?.message ?? "Couldn't load.")); }, []);

  const tile = (n: number | string, l: string, onClick?: () => void) => (
    <button onClick={onClick} disabled={!onClick}
      style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 4, textAlign: "left", fontFamily: "inherit", color: "var(--text)", cursor: onClick ? "pointer" : "default" }}>
      <span style={{ fontSize: 26, fontWeight: 600 }}>{n}</span>
      <span style={{ fontSize: 13, color: "#a3adc4" }}>{l}</span>
    </button>
  );
  const row = (key: string, main: string, sub: string, programId: string) => (
    <button key={key} onClick={() => onManage(programId)}
      style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface2)", borderRadius: 12, padding: "12px 14px", border: 0, color: "var(--text)", fontFamily: "inherit", textAlign: "left", cursor: "pointer", minHeight: 52 }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{main}</span>
        <span style={{ fontSize: 12, color: "#a3adc4" }}>{sub}</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3adc4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  );

  const unread = h?.unread_messages ?? 0;
  const attention = h ? h.no_head_coach.length + h.waiting.length + h.quiet.length + (unread ? 1 : 0) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Title text="Home" />
      {err && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{err}</div>}
      {!h && !err && <div style={muted}>Loading…</div>}
      {h && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {tile(h.schools, "Schools", () => onGoTo("schools"))}
            {tile(h.trainers, "Trainers", () => onGoTo("trainers"))}
            {tile(h.programs, h.paused ? `Programs (${h.paused} paused)` : "Programs")}
            {tile(h.players, "Players")}
            {tile(h.active_week, "Players active this week")}
          </div>

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={h2}>Needs attention</span>
            {attention === 0 && <span style={{ fontSize: 14, color: "#5de098" }}>Nothing right now.</span>}
            {unread > 0 && (
              <button onClick={() => onGoTo("messages")}
                style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(229,57,53,0.12)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(229,57,53,0.35)", color: "var(--text)", fontFamily: "inherit", textAlign: "left", cursor: "pointer", minHeight: 52 }}>
                <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{unread} unread message{unread === 1 ? "" : "s"} from head coaches</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3adc4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            )}
            {h.no_head_coach.length > 0 && <span style={{ ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>No head coach</span>}
            {h.no_head_coach.map(r => row("n" + r.program_id, r.program, r.org, r.program_id))}
            {h.waiting.length > 0 && <span style={{ ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Signups waiting 3+ days</span>}
            {h.waiting.map(r => row("w" + r.program_id, r.program, `${r.org} · ${r.count} waiting · oldest ${ago(r.oldest)}`, r.program_id))}
            {h.quiet.length > 0 && <span style={{ ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Quiet for 2+ weeks</span>}
            {h.quiet.map(r => row("q" + r.program_id, r.program, `${r.org} · last active ${ago(r.last_active)}`, r.program_id))}
          </section>

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={h2}>Recent changes</span>
            {h.recent.length === 0 && <span style={muted}>Nothing yet. Changes you make on these pages are listed here.</span>}
            {h.recent.map((r, i) => (
              <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 13, padding: "6px 0", borderBottom: "1px solid rgba(176,184,200,0.08)" }}>
                <span style={{ color: "#8b95ae", minWidth: 120 }}>{when(r.at)}</span>
                <span style={{ fontWeight: 600 }}>{r.action}</span>
                <span style={{ color: "#a3adc4", flex: "1 1 200px" }}>{[r.detail, r.program && r.program !== r.detail ? r.program : null, r.org].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

// ── Schools / Trainers ────────────────────────────────────────
type Filter = "all" | "nohc" | "waiting" | "paused";

function OrgsPage({ kind, orgs, onManage, onChanged }: { kind: OrgKind; orgs: PlatformSchool[] | null; onManage: (id: string) => void; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const noun = kind === "school" ? "school" : "trainer";

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const progOk = (p: PlatformProgram) =>
      filter === "all" ? true
      : filter === "nohc" ? p.is_active && p.head_coaches.length === 0
      : filter === "waiting" ? p.pending > 0
      : !p.is_active;
    return (orgs ?? []).filter(o => o.kind === kind).map(o => {
      const orgHit = !needle || o.name.toLowerCase().includes(needle) || (o.short_name ?? "").toLowerCase().includes(needle);
      const programs = o.programs.filter(p => progOk(p) && (orgHit || p.name.toLowerCase().includes(needle)
        || p.head_coaches.some(h => h.name.toLowerCase().includes(needle) || (h.email ?? "").toLowerCase().includes(needle))));
      return { org: o, programs, visible: filter === "all" ? (orgHit || programs.length > 0) : programs.length > 0 };
    }).filter(x => x.visible);
  }, [orgs, kind, q, filter]);

  const searching = q.trim() !== "" || filter !== "all";
  const chip = (k: Filter, l: string) => (
    <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
      style={{ height: 38, padding: "0 14px", borderRadius: 99, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
        border: filter === k ? 0 : "1px solid rgba(176,184,200,0.3)", background: filter === k ? "var(--royal)" : "transparent", color: filter === k ? "var(--white)" : "#a3adc4" }}>{l}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Title text={kind === "school" ? "Schools" : "Trainers"}
        action={<button style={btn} onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : `+ Add ${noun}`}</button>} />

      {adding && (kind === "school"
        ? <AddOrg kind="school" onDone={() => { setAdding(false); onChanged(); }} />
        : <AddOrg kind="trainer" onDone={() => { setAdding(false); onChanged(); }} />)}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} aria-label={`Search ${noun}s`}
          placeholder={kind === "school" ? "Search schools, programs, head coaches" : "Search trainers or coaches"} style={{ ...input, flex: "1 1 260px", width: "auto" }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chip("all", "All")}{chip("nohc", "Needs a head coach")}{chip("waiting", "Waiting approval")}{chip("paused", "Paused")}
        </div>
      </div>

      {orgs === null && <div style={muted}>Loading…</div>}
      {orgs !== null && shown.length === 0 && (
        <div style={{ ...card, padding: 20, ...muted, fontSize: 14 }}>
          {searching ? "Nothing matches." : kind === "school" ? "No schools yet." : "No trainers yet. Add one to give a trainer their own program."}
        </div>
      )}
      {shown.map(({ org, programs }, i) => (
        <OrgBlock key={org.id} org={org} programs={programs}
          open={searching || (open[org.id] ?? i === 0)} onToggle={() => setOpen(o => ({ ...o, [org.id]: !(o[org.id] ?? i === 0) }))}
          onManage={onManage} onChanged={onChanged} />
      ))}
    </div>
  );
}

function OrgBlock({ org, programs, open, onToggle, onManage, onChanged }: {
  org: PlatformSchool; programs: PlatformProgram[]; open: boolean; onToggle: () => void; onManage: (id: string) => void; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const short = org.short_name || initials(org.name);
  const isTrainer = org.kind === "trainer";
  return (
    <section style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: open || editing ? "1px solid rgba(176,184,200,0.12)" : "none" }}>
        <button onClick={onToggle} aria-expanded={open} aria-label={open ? `Collapse ${org.name}` : `Expand ${org.name}`}
          style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 260px", background: "transparent", border: 0, padding: 0, color: "inherit", fontFamily: "inherit", textAlign: "left", cursor: "pointer", minHeight: 44 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a3adc4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
          <Logo url={org.logo_url} text={short} bg={org.primary_color ?? "#1a3fa8"} fg={org.accent_color ?? "#f0c040"} size={44} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--white)" }}>{org.name}</span>
            <span style={{ fontSize: 13, color: "#a3adc4" }}>
              {isTrainer ? "Trainer" : `${org.programs.length} program${org.programs.length === 1 ? "" : "s"}`}{org.plan ? ` · ${org.plan}` : ""}
            </span>
          </span>
        </button>
        <button style={ghost} onClick={() => setEditing(e => !e)}>{editing ? "Done" : isTrainer ? "Edit trainer" : "Edit school"}</button>
      </div>

      {editing && <EditOrg org={org} onSaved={onChanged} />}

      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, padding: 18 }}>
          {programs.map(p => <ProgramCard key={p.id} p={p} onManage={() => onManage(p.id)} />)}
          {adding ? (
            <AddProgram org={org} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
          ) : !isTrainer && (
            <button onClick={() => setAdding(true)}
              style={{ minHeight: 160, borderRadius: 14, border: "2px dashed rgba(176,184,200,0.25)", background: "transparent", color: "#a3adc4", fontFamily: "inherit", fontSize: 14, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add a program to {org.short_name || org.name}
              <span style={{ fontSize: 12, fontWeight: 400, color: "#8b95ae" }}>e.g. JV, a summer team, another sport</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ProgramCard({ p, onManage }: { p: PlatformProgram; onManage: () => void }) {
  const [going, setGoing] = useState(false);
  const off = p.features_off.length;
  const stat = (n: number, l: string) => (
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 20, fontWeight: 600 }}>{n}</span><span style={{ fontSize: 12, color: "#a3adc4" }}>{l}</span>
    </div>
  );
  return (
    <div style={{ background: "var(--surface2)", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 14, opacity: p.is_active ? 1 : 0.7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--white)", flex: 1 }}>{p.name}</span>
        {!p.is_active ? (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#ff9a9a", background: "rgba(255,140,140,0.12)", padding: "4px 10px", borderRadius: 99 }}>Paused</span>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: off ? "#e8a33d" : "#5de098", background: off ? "rgba(232,163,61,0.12)" : "rgba(93,224,152,0.12)", padding: "4px 10px", borderRadius: 99 }}>
            {off ? `${off} feature group${off === 1 ? "" : "s"} off` : "All features on"}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {stat(p.players, "Players")}{stat(p.coaches, "Coaches")}{stat(p.pending, "Waiting approval")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#a3adc4" }}>Head coach{p.head_coaches.length === 1 ? "" : "es"}</span>
        <span style={{ fontSize: 14, color: p.head_coaches.length ? "var(--text)" : "#e8a33d" }}>
          {p.head_coaches.length ? p.head_coaches.map(h => h.name).join(" · ") : "None yet"}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 16px", fontSize: 13, color: "#a3adc4" }}>
        <span>Team code <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2, color: "var(--white)" }}>{p.join_code ?? "—"}</span></span>
        <span>Last active {ago(p.last_active)}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={{ ...btn, flex: 1, minWidth: 120 }} onClick={onManage}>Manage</button>
        <button style={{ ...ghost, flex: 1, minWidth: 120 }} disabled={going || !p.is_active}
          onClick={async () => { setGoing(true); try { await switchProgram(p.id); } catch { setGoing(false); } }}>
          {going ? "Switching…" : "Go to program"}
        </button>
      </div>
    </div>
  );
}

// ── One program's settings ────────────────────────────────────
function ProgramManage({ org, program: p, onBack, onChanged }: {
  org: PlatformSchool; program: PlatformProgram; onBack: () => void; onChanged: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<PersonMatch[]>([]);
  const [colors, setColors] = useState({ primary_color: p.primary_color ?? org.primary_color ?? "#1a3fa8", secondary_color: p.secondary_color ?? org.secondary_color ?? "#b0b8c8", accent_color: p.accent_color ?? org.accent_color ?? "#f0c040" });
  const [name, setName] = useState(p.name);
  const [copied, setCopied] = useState(false);
  const [log, setLog] = useState<{ at: string; action: string; detail: string | null }[] | null>(null);

  useEffect(() => { programLog(p.id).then(setLog).catch(() => setLog([])); }, [p.id, p.features_off.join(), p.is_active, p.join_code, p.head_coaches.length]);
  useEffect(() => {
    if (q.trim().length < 2) { setMatches([]); return; }
    const t = setTimeout(() => { searchPeople(q).then(setMatches).catch(() => setMatches([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); onChanged(); }
    catch (e: any) { setErr(e?.message ?? "Something went wrong."); }
    finally { setBusy(false); }
  }

  const off = new Set(p.features_off);
  const short = org.short_name || initials(org.name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <button onClick={onBack} style={{ alignSelf: "flex-start", background: "transparent", border: 0, color: "#a3adc4", fontFamily: "inherit", fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", minHeight: 44, padding: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        Back
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        <Logo url={p.logo_url ?? org.logo_url} text={short} bg={colors.primary_color} fg={colors.accent_color} size={52} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 240px" }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: 1, color: "var(--white)", lineHeight: 1 }}>{p.name}</span>
          <span style={{ fontSize: 13, color: "#a3adc4" }}>{org.kind === "trainer" ? "Trainer" : org.name}{p.is_active ? "" : " · Paused"}</span>
        </div>
        {p.is_active && <button style={ghost} onClick={() => switchProgram(p.id)}>Go to program</button>}
      </div>

      {(msg || err) && <div role="status" style={{ fontSize: 13, color: err ? "#ff8a8a" : "#5de098" }}>{err ?? msg}</div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ ...h2, flex: 1 }}>Head coaches</span>
              <span style={muted}>Only you can change these</span>
            </div>
            {p.head_coaches.length === 0 && <span style={{ fontSize: 13, color: "#e8a33d" }}>No head coach yet.</span>}
            {p.head_coaches.map(h => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface2)", borderRadius: 12, padding: "12px 14px", flexWrap: "wrap" }}>
                <span style={{ width: 36, height: 36, borderRadius: "50%", background: "#2a3550", color: "#c3d0ff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(h.name)}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 160 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{h.name}</span>
                  <span style={{ fontSize: 12, color: "#a3adc4" }}>{h.email ?? ""}</span>
                </span>
                <button style={{ ...danger, height: 38 }} disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Remove ${h.name} as head coach of ${p.name}? They stay in the program as an assistant coach.`)) return;
                    run(() => setHeadCoach(p.id, h.id, false), `${h.name} is now an assistant coach.`);
                  }}>Remove</button>
              </div>
            ))}
            <label style={label}>
              Add a head coach (someone already signed up)
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email" style={input} />
            </label>
            {matches.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {matches.map(m => {
                  const already = p.head_coaches.some(h => h.id === m.id);
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface2)", borderRadius: 10, padding: "10px 12px", flexWrap: "wrap" }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 180 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</span>
                        <span style={{ fontSize: 12, color: "#a3adc4" }}>{[m.email, m.programs].filter(Boolean).join(" · ") || "Not in a program yet"}</span>
                      </span>
                      <button style={{ ...btn, height: 38 }} disabled={busy || already}
                        onClick={() => run(async () => { await setHeadCoach(p.id, m.id, true); setQ(""); }, `${m.name} is now a head coach of ${p.name}.`)}>
                        {already ? "Already head coach" : "Make head coach"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <span style={muted}>Assistant coaches and players are approved by the program's head coaches.</span>
          </section>

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ ...h2, flex: 1 }}>Features</span>
              <span style={muted}>Off = hidden from everyone in this program. Their data stays.</span>
            </div>
            {FEATURE_GROUPS.map(g => {
              const on = g.locked || !off.has(g.key as FeatureKey);
              return (
                <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface2)", borderRadius: 12, padding: "14px 16px" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--white)" }}>{g.name}</span>
                    <span style={{ fontSize: 12, color: "#a3adc4", lineHeight: 1.5 }}>{g.items}</span>
                  </span>
                  {g.locked ? (
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#8b95ae", background: "var(--surface)", padding: "6px 10px", borderRadius: 99, whiteSpace: "nowrap" }}>Always on</span>
                  ) : (
                    <button role="switch" aria-checked={on} aria-label={`${g.name} ${on ? "on" : "off"}`} disabled={busy}
                      onClick={() => run(() => setFeature(p.id, g.key as FeatureKey, !on), `${g.name} turned ${on ? "off" : "on"} for ${p.name}.`)}
                      style={{ width: 52, height: 30, flexShrink: 0, borderRadius: 99, border: 0, padding: 3, display: "flex", justifyContent: on ? "flex-end" : "flex-start", background: on ? "var(--royal)" : "#3a4560", cursor: "pointer" }}>
                      <span style={{ width: 24, height: 24, borderRadius: "50%", background: on ? "var(--gold)" : "#a3adc4" }} />
                    </button>
                  )}
                </div>
              );
            })}
          </section>

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={h2}>Recent changes</span>
            {log === null && <span style={muted}>Loading…</span>}
            {log !== null && log.length === 0 && <span style={muted}>No platform changes to this program yet.</span>}
            {(log ?? []).map((r, i) => (
              <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 13, padding: "6px 0", borderBottom: "1px solid rgba(176,184,200,0.08)" }}>
                <span style={{ color: "#8b95ae", minWidth: 120 }}>{when(r.at)}</span>
                <span style={{ fontWeight: 600 }}>{r.action}</span>
                <span style={{ color: "#a3adc4" }}>{r.detail ?? ""}</span>
              </div>
            ))}
          </section>
        </div>

        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={h2}>Team code</span>
            <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 4, color: "var(--white)" }}>{p.join_code ?? "—"}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={{ ...ghost, flex: 1 }} disabled={!p.join_code}
                onClick={async () => {
                  const link = inviteLink(p.join_code!);
                  try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); }
                  catch { window.prompt("Copy this invite link:", link); }
                }}>{copied ? "Copied!" : "Copy invite link"}</button>
              <button style={{ ...ghost, flex: 1 }} disabled={busy}
                onClick={() => {
                  if (!window.confirm("Make a new team code? The old code and invite links stop working right away.")) return;
                  run(() => newJoinCode(p.id), "New team code made.");
                }}>New code</button>
            </div>
          </section>

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={h2}>Name, logo &amp; colors</span>
            <label style={label}>Program name<input value={name} onChange={e => setName(e.target.value)} style={input} /></label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Logo url={p.logo_url ?? org.logo_url} text={short} bg={colors.primary_color} fg={colors.accent_color} size={56} />
              <label style={{ ...ghost, display: "flex", alignItems: "center", cursor: busy ? "wait" : "pointer" }}>
                Upload logo
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: "none" }}
                  onChange={e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    run(async () => { const url = await uploadLogo("program", p.id, f); await updateProgram(p.id, { logo_url: url }); }, "Logo saved.");
                  }} />
              </label>
              {p.logo_url && <button style={{ ...ghost, height: 38 }} onClick={() => run(() => updateProgram(p.id, { logo_url: null }), "Using the school's logo.")}>Use {org.kind === "trainer" ? "trainer's" : "school's"}</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {([["primary_color", "Primary"], ["secondary_color", "Secondary"], ["accent_color", "Accent"]] as const).map(([k, l]) => (
                <label key={k} style={label}>
                  {l}
                  <input type="color" value={colors[k]} onChange={e => setColors(c => ({ ...c, [k]: e.target.value }))}
                    style={{ width: "100%", height: 40, border: "1px solid rgba(176,184,200,0.25)", borderRadius: 8, background: "transparent", padding: 2 }} />
                </label>
              ))}
            </div>
            <button style={btn} disabled={busy || !name.trim()}
              onClick={() => run(() => updateProgram(p.id, { name: name.trim(), ...colors }), "Saved.")}>Save</button>
          </section>

          <section style={{ ...card, border: "1px solid rgba(255,140,140,0.25)", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#ff9a9a" }}>{p.is_active ? "Pause program" : "Paused"}</span>
            <span style={{ fontSize: 12, color: "#a3adc4", lineHeight: 1.5 }}>
              {p.is_active ? "Members can't use it and the team code stops working. Nothing is deleted." : "Nobody but you can use this program until it's resumed."}
            </span>
            {p.is_active ? (
              <button style={danger} disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Pause ${p.name}? Its coaches and players won't be able to use it until you resume it.`)) return;
                  run(() => updateProgram(p.id, { is_active: false }), `${p.name} is paused.`);
                }}>Pause {p.name}</button>
            ) : (
              <button style={btn} disabled={busy} onClick={() => run(() => updateProgram(p.id, { is_active: true }), `${p.name} is running again.`)}>Resume {p.name}</button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Add / edit schools and trainers, add programs ─────────────
function AddOrg({ kind, onDone }: { kind: OrgKind; onDone: () => void }) {
  const [f, setF] = useState({ name: "", short_name: "", primary_color: "#1a3fa8", secondary_color: "#b0b8c8", accent_color: "#f0c040" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isTrainer = kind === "trainer";
  return (
    <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={h2}>{isTrainer ? "New trainer" : "New school"}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label style={label}>{isTrainer ? "Trainer or business name" : "School name"}
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder={isTrainer ? "e.g. Elite Skills Training" : "e.g. Mansfield High School"} style={input} /></label>
        <label style={label}>Short name (badge letters)<input value={f.short_name} maxLength={4} onChange={e => setF({ ...f, short_name: e.target.value.toUpperCase() })} placeholder={isTrainer ? "e.g. EST" : "e.g. MHS"} style={input} /></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, maxWidth: 420 }}>
        {([["primary_color", "Primary"], ["secondary_color", "Secondary"], ["accent_color", "Accent"]] as const).map(([k, l]) => (
          <label key={k} style={label}>{l}<input type="color" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} style={{ width: "100%", height: 40, border: "1px solid rgba(176,184,200,0.25)", borderRadius: 8, background: "transparent", padding: 2 }} /></label>
        ))}
      </div>
      {isTrainer && <span style={muted}>Creates the trainer and their program in one step, with Offseason training and Lifting on, and In-season coaching, Playbook and Quizzes off. Change any of that on the program's page.</span>}
      {err && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{err}</div>}
      <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy || !f.name.trim()}
        onClick={async () => {
          setBusy(true); setErr(null);
          const payload = { ...f, name: f.name.trim(), short_name: (f.short_name || initials(f.name)).trim() };
          try { if (isTrainer) await createTrainer(payload); else await createSchool(payload); onDone(); }
          catch (e: any) { setErr(e?.message ?? `Couldn't add the ${kind}.`); setBusy(false); }
        }}>{busy ? "Adding…" : isTrainer ? "Add trainer" : "Add school"}</button>
    </section>
  );
}

function EditOrg({ org, onSaved }: { org: PlatformSchool; onSaved: () => void }) {
  const [f, setF] = useState({ name: org.name, short_name: org.short_name ?? "", primary_color: org.primary_color ?? "#1a3fa8", secondary_color: org.secondary_color ?? "#b0b8c8", accent_color: org.accent_color ?? "#f0c040" });
  const [notes, setNotes] = useState(org.notes ?? "");
  const [plan, setPlan] = useState(org.plan ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noun = org.kind === "trainer" ? "trainer" : "school";
  const save = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setNote(null);
    try { await fn(); setNote(ok); onSaved(); } catch (e: any) { setNote(e?.message ?? "Couldn't save."); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ padding: 18, borderBottom: "1px solid rgba(176,184,200,0.12)", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label style={label}>Name<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={input} /></label>
        <label style={label}>Short name<input value={f.short_name} maxLength={4} onChange={e => setF({ ...f, short_name: e.target.value.toUpperCase() })} style={input} /></label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        {([["primary_color", "Primary"], ["secondary_color", "Secondary"], ["accent_color", "Accent"]] as const).map(([k, l]) => (
          <label key={k} style={{ ...label, width: 110 }}>{l}<input type="color" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} style={{ width: "100%", height: 40, border: "1px solid rgba(176,184,200,0.25)", borderRadius: 8, background: "transparent", padding: 2 }} /></label>
        ))}
        <label style={{ ...ghost, display: "flex", alignItems: "center", cursor: "pointer" }}>
          Upload logo
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: "none" }}
            onChange={e => {
              const file = e.target.files?.[0]; if (!file) return;
              save(async () => { const url = await uploadLogo("school", org.id, file); await updateSchool(org.id, { logo_url: url }); }, "Logo saved.");
            }} />
        </label>
        <button style={btn} disabled={busy || !f.name.trim()} onClick={() => save(() => updateSchool(org.id, { ...f, name: f.name.trim() }), "Saved.")}>Save {noun}</button>
      </div>
      <span style={muted}>Programs without their own logo or colors use the {noun}'s.</span>

      <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--white)" }}>Private notes <span style={{ fontWeight: 400, color: "#8b95ae" }}>· only you see these</span></span>
        <label style={label}>Plan<input value={plan} onChange={e => setPlan(e.target.value)} placeholder="e.g. Full · Offseason only · Trial until Dec" style={input} /></label>
        <label style={label}>Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="e.g. Met with the AD 10/20; renews in August"
          style={{ ...input, height: "auto", padding: "10px 12px", resize: "vertical" }} /></label>
        <button style={{ ...ghost, alignSelf: "flex-start" }} disabled={busy} onClick={() => save(() => saveOrgNotes(org.id, notes.trim(), plan.trim()), "Notes saved.")}>Save notes</button>
      </div>
      {note && <span style={{ fontSize: 13, color: "#a3adc4" }}>{note}</span>}
    </div>
  );
}

function AddProgram({ org, onDone, onCancel }: { org: PlatformSchool; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ background: "var(--surface2)", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--white)" }}>New program at {org.short_name || org.name}</span>
      <label style={label}>Program name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Girls Basketball" style={input} autoFocus /></label>
      <span style={muted}>It starts with a current season, a team code, the school's colors, and the same settings, XP settings and badges as AHS Boys. Then add a head coach.</span>
      {err && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...btn, flex: 1 }} disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true); setErr(null);
            try { await createProgram(org.id, name.trim()); onDone(); }
            catch (e: any) { setErr(e?.message ?? "Couldn't add the program."); setBusy(false); }
          }}>{busy ? "Adding…" : "Add program"}</button>
        <button style={ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Announcements to chosen programs ──────────────────────────
function Announcements({ orgs }: { orgs: PlatformSchool[] | null }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");

  const live = (orgs ?? []).map(o => ({ ...o, programs: o.programs.filter(p => p.is_active) })).filter(o => o.programs.length > 0);
  const allIds = live.flatMap(o => o.programs.map(p => p.id));
  const allOn = allIds.length > 0 && allIds.every(id => picked.has(id));
  const needle = q.trim().toLowerCase();
  const visible = live.filter(o => !needle || o.name.toLowerCase().includes(needle) || o.programs.some(p => p.name.toLowerCase().includes(needle)));

  const toggle = (ids: string[], on: boolean) => setPicked(prev => {
    const n = new Set(prev); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n;
  });

  const group = (kind: OrgKind, title: string) => {
    const list = visible.filter(o => o.kind === kind);
    if (!list.length) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{title}</span>
        {list.map(o => {
          const ids = o.programs.map(p => p.id);
          const all = ids.every(id => picked.has(id));
          const some = !all && ids.some(id => picked.has(id));
          return (
            <div key={o.id} style={{ background: "var(--surface2)", borderRadius: 12, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", minHeight: 36 }}>
                <input type="checkbox" checked={all} ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = some; }} onChange={e => toggle(ids, e.target.checked)} />
                {o.name}{o.kind === "school" ? <span style={{ fontWeight: 400, color: "#8b95ae", fontSize: 13 }}> · all {ids.length} program{ids.length === 1 ? "" : "s"}</span> : null}
              </label>
              {o.kind === "school" && o.programs.map(p => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "#c8cfde", paddingLeft: 28, cursor: "pointer", minHeight: 32 }}>
                  <input type="checkbox" checked={picked.has(p.id)} onChange={e => toggle([p.id], e.target.checked)} />
                  {p.name} <span style={{ color: "#8b95ae", fontSize: 12 }}>· {p.players} players</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Title text="Announcements" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12, flex: "1 1 340px", minWidth: 0 }}>
          <span style={h2}>Send to</span>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 700, cursor: "pointer", minHeight: 40 }}>
            <input type="checkbox" checked={allOn} onChange={e => toggle(allIds, e.target.checked)} />
            Every program ({allIds.length})
          </label>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a school, trainer or program" aria-label="Find a school, trainer or program" style={input} />
          {orgs === null && <span style={muted}>Loading…</span>}
          {group("school", "Schools")}
          {group("trainer", "Trainers")}
        </section>

        <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12, flex: "999 1 420px", minWidth: 0 }}>
          <span style={h2}>Message</span>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} placeholder="Write the announcement…"
            style={{ ...input, height: "auto", padding: "10px 12px", resize: "vertical" }} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#a3adc4", cursor: "pointer" }}>
            <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin to the top
          </label>
          <span style={muted}>Each chosen program gets its own copy in Announcements (they can pin or remove theirs) and everyone in those programs gets a push. You can remove it from all of them at once from any program's Announcements.</span>
          {status && <div role="status" style={{ fontSize: 13, color: status.ok ? "#5de098" : "#ff8c42" }}>{status.text}</div>}
          <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy || !text.trim() || picked.size === 0}
            onClick={async () => {
              setBusy(true); setStatus(null);
              try {
                const r = await postToPrograms([...picked], text.trim(), pinned);
                setStatus({ ok: r.push === "sent", text: `Posted to ${r.count} program${r.count === 1 ? "" : "s"}; ${r.push}.` });
                setText(""); setPinned(false);
              } catch (e: any) { setStatus({ ok: false, text: `Not posted: ${e?.message ?? e}` }); }
              setBusy(false);
            }}>{busy ? "Posting…" : picked.size === 0 ? "Pick who it goes to" : `Post to ${picked.size} program${picked.size === 1 ? "" : "s"}`}</button>
        </section>
      </div>
    </div>
  );
}

// ── Messages with head coaches ────────────────────────────────
function Messages({ orgs, onRead }: { orgs: PlatformSchool[] | null; onRead?: () => void }) {
  const programs: ProgramOption[] = (orgs ?? []).flatMap(o => o.programs.map(p => ({ id: p.id, name: p.name, org: o.name, hasHeadCoach: p.head_coaches.length > 0 })));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Title text="Messages" />
      <MessageInbox asPlatform programs={programs} onActivity={onRead} />
    </div>
  );
}
