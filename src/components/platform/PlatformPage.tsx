// src/components/platform/PlatformPage.tsx
// Platform admin pages (migrations 189-190), one per sidebar entry:
//   home          totals, "Needs attention", recent changes
//   schools       schools and their programs (search + filters)
//   trainers      trainers and their program (search + filters)
//   announcements post to chosen programs / schools / trainers / all
//   library       Shared Library: starter pack, "New" offers (migration 194)
//   sandbox       the platform admin's sandbox: its people, View as, reset (198)
// Managing one program opens over whichever page you came from. Only the
// platform admin ever sees these; the database checks every call too.

import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import { switchProgram } from "../../lib/programs";
import { FEATURE_GROUPS, FeatureKey, setFeature } from "../../lib/features";
import {
  PlatformSchool, PlatformProgram, PersonMatch, PlatformHome, OrgKind, loadPlatform, loadHome, searchPeople, setHeadCoach,
  newJoinCode, createProgram, createSchool, createTrainer, updateProgram, updateSchool, uploadLogo, inviteLink,
  saveOrgNotes, programLog, postToPrograms, inviteHeadCoach, setupSteps, InviteResult,
} from "../../lib/platform";
import MessageInbox, { ProgramOption } from "../messages/MessageInbox";
import DownloadProgramDataButton from "../DownloadProgramDataButton";
import {
  KIND_LABEL, LibraryKind, LibraryOverview, LibraryItem, BrowseRow, loadLibrary, setLibraryFlags,
  removeFromLibrary, openInLibrary, browseProgram, addToLibrary,
} from "../../lib/library";
import { SandboxOverview, SandboxPerson, loadSandbox, buildSandbox, resetSandbox } from "../../lib/sandbox";
import { enterViewAs } from "../../lib/viewAs";
import { gradeFromGradYear, gradeColor, GRADE_LABELS } from "../../lib/teamDesigner";

export type PlatformSection = "home" | "schools" | "trainers" | "announcements" | "messages" | "library" | "sandbox";

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
      ) : page === "sandbox" ? (
        <SandboxPage />
      ) : (
        <SharedLibrary orgs={orgs} />
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
          {programs.map(p => <ProgramCard key={p.id} p={p} org={org} onManage={() => onManage(p.id)} />)}
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

function ProgramCard({ p, org, onManage }: { p: PlatformProgram; org: PlatformSchool; onManage: () => void }) {
  const [going, setGoing] = useState(false);
  const steps = setupSteps(p, org);
  const doneSteps = steps.filter(s => s.done).length;
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
        {p.is_active && doneSteps < steps.length && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#93b4ff", background: "rgba(147,180,255,0.12)", padding: "4px 10px", borderRadius: 99 }}>Setup {doneSteps}/{steps.length}</span>
        )}
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
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invLinkOnly, setInvLinkOnly] = useState(false);
  const [invResult, setInvResult] = useState<InviteResult | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const steps = setupSteps(p, org);
  const setupDone = steps.every(s => s.done);

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

      {p.is_active && !setupDone && (
        <section style={{ ...card, border: "1px solid rgba(147,180,255,0.35)", padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...h2, flex: 1 }}>Getting {p.name} set up</span>
            <span style={{ fontSize: 13, color: "#93b4ff", fontWeight: 600 }}>{steps.filter(s => s.done).length} of {steps.length} done</span>
          </div>
          {steps.map(s => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: s.done ? "#1f7a4d" : "transparent", border: s.done ? "none" : "2px solid rgba(176,184,200,0.4)" }}>
                {s.done && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: s.done ? "#a3adc4" : "var(--text)", textDecoration: s.done ? "line-through" : "none" }}>{s.label}</span>
                {!s.done && <span style={{ fontSize: 12, color: "#8b95ae" }}>{s.hint}</span>}
              </span>
            </div>
          ))}
          <span style={muted}>This box goes away once everything is done.</span>
        </section>
      )}

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
                  {!h.last_seen && <span style={{ fontSize: 12, color: "#e8a33d" }}>Invited · hasn't signed in yet</span>}
                </span>
                <button style={{ ...danger, height: 38 }} disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Remove ${h.name} as head coach of ${p.name}? They stay in the program as an assistant coach.`)) return;
                    run(() => setHeadCoach(p.id, h.id, false), `${h.name} is now an assistant coach.`);
                  }}>Remove</button>
              </div>
            ))}
            <div style={{ background: "var(--surface2)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--white)" }}>Invite a head coach by email</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <label style={label}>Their name<input value={invName} onChange={e => setInvName(e.target.value)} placeholder="e.g. Pat Smith" style={input} /></label>
                <label style={label}>Email<input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} placeholder="coach@school.org" style={input} /></label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#a3adc4", cursor: "pointer" }}>
                <input type="checkbox" checked={invLinkOnly} onChange={e => setInvLinkOnly(e.target.checked)} /> Just give me a link to send them myself (no email)
              </label>
              <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy || !invEmail.trim()}
                onClick={() => run(async () => {
                  setInvResult(null); setLinkCopied(false);
                  const r = await inviteHeadCoach(p.id, invEmail.trim(), invName.trim(), invLinkOnly);
                  setInvResult(r); setInvEmail(""); setInvName("");
                }, "Done.")}>{busy ? "Working…" : invLinkOnly ? "Make invite link" : "Send invite"}</button>
              {invResult && (
                <div role="status" style={{ fontSize: 13, lineHeight: 1.5, color: "#c8cfde", display: "flex", flexDirection: "column", gap: 8 }}>
                  {invResult.status === "promoted" && <span style={{ color: "#5de098" }}>{invResult.name} already had an account and is now a head coach of {p.name}.</span>}
                  {invResult.status === "invited" && invResult.emailed && <span style={{ color: "#5de098" }}>Invite emailed to {invResult.name}. They'll set a password and land as head coach of {p.name}.</span>}
                  {invResult.status === "invited" && !invResult.emailed && invResult.link && (
                    <>
                      <span>{invLinkOnly ? "Here's the invite link." : "Supabase couldn't send the email, so here's the invite link instead."} Send it to {invResult.name} by text or email; it works once and they'll set their own password.</span>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input readOnly value={invResult.link} aria-label="Invite link" onFocus={e => e.currentTarget.select()} style={{ ...input, flex: "1 1 240px", width: "auto", fontSize: 12 }} />
                        <button style={ghost} onClick={async () => {
                          try { await navigator.clipboard.writeText(invResult.link!); setLinkCopied(true); } catch { window.prompt("Copy this invite link:", invResult.link!); }
                        }}>{linkCopied ? "Copied!" : "Copy link"}</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <label style={label}>
              Or pick someone who's already signed up
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

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={h2}>Program data</span>
            <span style={muted}>
              One Excel file with a tab each for the roster (with emails), leaderboard, drill scores, drills, Hall of Fame,
              practices and attendance, games, lifting, plays, playbooks and announcements. Test accounts are left out.
              It has players' names and emails, so keep it somewhere private.
            </span>
            <DownloadProgramDataButton programId={p.id} style={{ height: 42, padding: "0 16px", fontSize: 14 }} />
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

// ── Shared Library ────────────────────────────────────────────
const LIB_FILTERS: [string, string, LibraryKind[]][] = [
  ["all", "All", ["drill", "team_drill", "template", "play", "lifting"]],
  ["drill", "Player drills", ["drill"]],
  ["team", "Team drills & templates", ["team_drill", "template"]],
  ["play", "Plays", ["play"]],
  ["lifting", "Lifting", ["lifting"]],
];
const ADD_KINDS: LibraryKind[] = ["drill", "team_drill", "template", "play", "lifting"];

function chip(on: boolean, color: string): CSSProperties {
  return {
    height: 36, padding: "0 12px", borderRadius: 99, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
    ...(on ? { border: `1px solid ${color}`, background: color, color: "#0a0c14" }
           : { border: "1px solid rgba(176,184,200,0.3)", background: "transparent", color: "#a3adc4" }),
  };
}

function SharedLibrary({ orgs }: { orgs: PlatformSchool[] | null }) {
  const [lib, setLib] = useState<LibraryOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    try { setLib(await loadLibrary()); setErr(null); }
    catch (e: any) { setErr(e?.message ?? "Couldn't load the Shared Library."); }
  }
  useEffect(() => { refresh(); }, []);

  const kinds = LIB_FILTERS.find(f => f[0] === filter)?.[2] ?? [];
  const needle = q.trim().toLowerCase();
  const items = (lib?.items ?? []).filter(i => kinds.includes(i.kind) && (!needle || i.title.toLowerCase().includes(needle)));
  const all = lib?.items ?? [];

  async function flip(i: LibraryItem, flags: { starter?: boolean; offered?: boolean }) {
    setBusy(i.id);
    try { await setLibraryFlags(i.id, flags); await refresh(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't save."); }
    setBusy(null);
  }
  async function remove(i: LibraryItem) {
    if (!window.confirm(`Remove "${i.title}" from the Shared Library?\n\nPrograms that already added it keep their copy.`)) return;
    setBusy(i.id);
    try { await removeFromLibrary(i.id); await refresh(); }
    catch (e: any) { setErr(e?.message ?? "Couldn't remove it."); }
    setBusy(null);
  }
  async function edit(kind: LibraryKind) {
    if (!lib?.library_program_id) return;
    try { await openInLibrary(lib.library_program_id, kind); }
    catch (e: any) { setErr(e?.message ?? "Couldn't open the Shared Library."); }
  }

  function uptake(i: LibraryItem): string {
    const parts: string[] = [];
    if (i.offered || i.added > 0) parts.push(`Added by ${i.added} program${i.added === 1 ? "" : "s"}`);
    if (i.dismissed > 0) parts.push(`${i.dismissed} said not now`);
    if (!parts.length) return i.starter ? "Starter pack only" : "Saved here, not shared yet";
    return parts.join(" · ");
  }

  const tile = (n: number, l: string) => (
    <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 26, fontWeight: 600 }}>{n}</span>
      <span style={{ fontSize: 13, color: "#a3adc4" }}>{l}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Title text="Shared Library" action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn} onClick={() => setAdding(a => !a)}>{adding ? "Done adding" : "+ Add from a program"}</button>
          <button style={ghost} disabled={!lib?.library_program_id} onClick={() => edit("drill")}
            title="Switch into the Shared Library to edit items or make new ones">Open Shared Library</button>
        </div>
      } />
      {err && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{err}</div>}

      {adding && <AddFromProgram orgs={orgs} onAdded={refresh} />}

      {!lib && !err && <div style={muted}>Loading…</div>}
      {lib && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {tile(all.length, "In your Shared Library")}
            {tile(all.filter(i => i.starter).length, "In the starter pack, so new programs get these")}
            {tile(all.filter(i => i.offered).length, "Offered to existing programs under \"New\"")}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {LIB_FILTERS.map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ ...chip(filter === k, "#1a3fa8"), ...(filter === k ? { color: "#f5f7fc" } : {}) }}>{l}</button>
            ))}
            {all.length > 6 && (
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search the library" aria-label="Search the library"
                style={{ ...input, width: 220, height: 36 }} />
            )}
          </div>

          {all.length === 0 && (
            <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={h2}>Nothing in the Shared Library yet</span>
              <span style={{ ...muted, fontSize: 13 }}>
                Use <b>+ Add from a program</b> above, or the <b>📚 Add to Shared Library</b> button on a drill, practice template,
                play or lifting program (only you see it). Either one saves a copy here; the original stays where it is.
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map(i => (
              <div key={i.id} style={{ ...card, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, opacity: busy === i.id ? 0.6 : 1 }}>
                <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--gold)" }}>{KIND_LABEL[i.kind]}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--white)" }}>{i.title}</span>
                  <span style={muted}>{[i.meta, i.source.startsWith("Made") ? i.source : `from ${i.source}`, `added ${new Date(i.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}`].filter(Boolean).join(" · ")}</span>
                  <span style={{ fontSize: 12, color: "#93b4ff" }}>{uptake(i)}</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button disabled={busy === i.id} onClick={() => flip(i, { starter: !i.starter })} style={chip(i.starter, "#f0c040")}
                    aria-pressed={i.starter} aria-label={(i.starter ? "Remove from" : "Add to") + " the starter pack"}>
                    {i.starter ? "✓ " : ""}Starter pack
                  </button>
                  <button disabled={busy === i.id} onClick={() => flip(i, { offered: !i.offered })} style={chip(i.offered, "#93b4ff")}
                    aria-pressed={i.offered} aria-label={(i.offered ? "Stop offering" : "Offer") + " to existing programs"}>
                    {i.offered ? "✓ " : ""}Offered
                  </button>
                  <button style={{ ...ghost, height: 36 }} onClick={() => edit(i.kind)}>Edit</button>
                  <button style={{ ...danger, height: 36 }} disabled={busy === i.id} onClick={() => remove(i)}>Remove</button>
                </div>
              </div>
            ))}
            {all.length > 0 && items.length === 0 && <div style={muted}>Nothing here matches.</div>}
          </div>

          <div style={{ ...muted, fontSize: 13 }}>
            <b>Starter pack:</b> a new program gets a copy of these when its first head coach joins. <b>Offered:</b> head coaches
            of existing programs see it under "New in Shared Library" and choose Add or Not now. Every copy is the program's own to
            edit; changing or removing something here never changes theirs. <b>Edit</b> switches you into the Shared Library
            program (use the program switcher to come back).
          </div>
        </>
      )}
    </div>
  );
}

function AddFromProgram({ orgs, onAdded }: { orgs: PlatformSchool[] | null; onAdded: () => void }) {
  const programs = (orgs ?? []).flatMap(o => o.programs.map(p => ({ id: p.id, name: `${o.short_name || o.name} · ${p.name}` })));
  const [programId, setProgramId] = useState<string>("");
  const [kind, setKind] = useState<LibraryKind>("drill");
  const [rows, setRows] = useState<BrowseRow[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { if (!programId && programs.length) setProgramId(programs[0].id); }, [programs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!programId) return;
    let on = true;
    setRows(null);
    browseProgram(programId, kind).then(r => { if (on) setRows(r); }).catch((e: any) => { if (on) { setRows([]); setMsg({ ok: false, text: e?.message ?? "Couldn't load." }); } });
    return () => { on = false; };
  }, [programId, kind]);

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter(r => !needle || r.title.toLowerCase().includes(needle));

  async function add(r: BrowseRow) {
    setBusy(r.id); setMsg(null);
    try {
      const res = await addToLibrary(kind, r.id);
      setRows(list => (list ?? []).map(x => x.id === r.id ? { ...x, in_library: true } : x));
      setMsg({ ok: true, text: res.status === "already" ? `"${res.title}" was already in the Shared Library.` : `Added "${res.title}".` });
      onAdded();
    } catch (e: any) { setMsg({ ok: false, text: e?.message ?? "Couldn't add it." }); }
    setBusy(null);
  }

  return (
    <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={h2}>Add from a program</span>
      <span style={muted}>Pick what to copy. The program keeps its original; the Shared Library gets its own copy.</span>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ ...label, flex: "1 1 220px" }}>Program
          <select value={programId} onChange={e => setProgramId(e.target.value)} style={input}>
            {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ ...label, flex: "1 1 220px" }}>Search
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find by name" style={input} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ADD_KINDS.map(k => (
          <button key={k} onClick={() => setKind(k)} style={{ ...chip(kind === k, "#1a3fa8"), ...(kind === k ? { color: "#f5f7fc" } : {}) }}>{KIND_LABEL[k]}s</button>
        ))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: msg.ok ? "#5de098" : "#ff8a8a" }}>{msg.text}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
        {rows === null && <span style={muted}>Loading…</span>}
        {rows !== null && shown.length === 0 && <span style={muted}>Nothing to add here.</span>}
        {shown.map(r => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface2)", borderRadius: 10, padding: "8px 12px", minHeight: 44 }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 14, color: "var(--text)" }}>{r.title}</span>
              {r.meta && <span style={{ fontSize: 11, color: "#8b95ae" }}>{r.meta}</span>}
            </span>
            {r.in_library
              ? <span style={{ fontSize: 12, color: "#5de098", fontWeight: 600 }}>✓ In library</span>
              : <button style={{ ...btn, height: 34, padding: "0 12px", fontSize: 13 }} disabled={busy === r.id} onClick={() => add(r)}>{busy === r.id ? "Adding…" : "Add"}</button>}
          </div>
        ))}
      </div>
    </section>
  );
}


// ── Sandbox (migration 198) ───────────────────────────────────
// A walled-off program with made-up people: 36 players (12 each on
// Varsity, JV and Freshman) and 3 coaches. Go in, view as anyone, try
// anything; Reset wipes what was made there.
function SandboxPage() {
  const [data, setData] = useState<SandboxOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState<string>("all");
  const [showReset, setShowReset] = useState(false);
  const [rebuild, setRebuild] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    try { setData(await loadSandbox()); setError(null); }
    catch (e: any) {
      setError(/sandbox_overview/.test(e?.message ?? "") ? "Run migration 198 first, then come back." : (e?.message ?? "Couldn't load the sandbox."));
    }
  }
  useEffect(() => { load(); }, []);

  async function setUp() {
    setBusy("build"); setNote(null);
    try { const n = await buildSandbox(false); setNote(n ? `Added ${n} ${n === 1 ? "person" : "people"}.` : "Everyone's already there."); await load(); }
    catch (e: any) { setError(e?.message ?? "Couldn't set up the sandbox."); }
    setBusy(null);
  }

  async function doReset() {
    setBusy("reset"); setNote(null);
    try {
      const r = await resetSandbox();
      let msg = `Cleared ${r.cleared} item${r.cleared === 1 ? "" : "s"}${r.starter_items ? ` and put back ${r.starter_items} starter-pack item${r.starter_items === 1 ? "" : "s"}` : ""}.`;
      if (rebuild) { await buildSandbox(true); msg += " Players, coaches and rosters rebuilt."; }
      setNote(msg); setShowReset(false); setRebuild(false);
      await load();
    } catch (e: any) { setError(e?.message ?? "Couldn't reset the sandbox."); }
    setBusy(null);
  }

  async function viewAs(p: SandboxPerson) {
    setBusy(p.user_id);
    try { await enterViewAs({ user_id: p.user_id, role: p.role, name: p.name }, "Sandbox"); }
    catch (e: any) { setError(e?.message ?? "Couldn't open that account."); setBusy(null); }
  }

  const coaches = (data?.people ?? []).filter(p => p.role !== "player");
  const players = (data?.people ?? []).filter(p => p.role === "player");
  const shown = rosterFilter === "all" ? players : players.filter(p => p.roster_id === rosterFilter);
  const c = data?.content;
  const empty = !!data && data.people.length === 0;
  const viewBtn = (p: SandboxPerson) => (
    <button style={{ ...ghost, height: 34, padding: "0 12px", fontSize: 13 }} disabled={!!busy} onClick={() => viewAs(p)}>
      {busy === p.user_id ? "Opening…" : "View as"}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Title text="🧪 Sandbox" action={data?.program_id && !empty ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "var(--gold)", color: "#14110a" }} disabled={!!busy}
            onClick={async () => { setBusy("open"); try { await switchProgram(data.program_id!); } catch (e: any) { setError(e?.message ?? "Couldn't open it."); setBusy(null); } }}>
            {busy === "open" ? "Opening…" : "Open sandbox"}
          </button>
          <button style={danger} disabled={!!busy} onClick={() => setShowReset(v => !v)}>Reset…</button>
        </div>
      ) : undefined} />
      <div style={muted}>
        Your private practice program. Nothing done here reaches a real program, and it's left out of your counts, exports,
        people search and announcements to every program. Use <b>Open sandbox</b> to work in it as yourself, or <b>View as</b> anyone below.
      </div>
      {error && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{error}</div>}
      {note && <div style={{ color: "#5de098", fontSize: 13 }}>{note}</div>}
      {!data && !error && <div style={muted}>Loading…</div>}

      {empty && (
        <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <span style={h2}>Set up the sandbox</span>
          <span style={muted}>Makes 3 coaches (a head coach and two assistants), Varsity, JV and Freshman rosters, and 12 made-up players on each. Takes about a minute.</span>
          <button style={btn} disabled={!!busy} onClick={setUp}>{busy === "build" ? "Setting up… (about a minute)" : "Set up the sandbox"}</button>
        </div>
      )}

      {showReset && data && (
        <div style={{ ...card, padding: 18, border: "1px solid rgba(255,140,140,0.35)", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ ...h2, color: "#ff9a9a" }}>Reset the sandbox</span>
          <span style={muted}>
            Wipes everything made in the sandbox: practices, games, plays, playbooks, quizzes, scout sheets, announcements,
            scores, streaks, XP and attendance. Seasons and settings stay, and the Shared Library starter pack is put back.
          </span>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--text)", cursor: "pointer" }}>
            <input type="checkbox" checked={rebuild} onChange={e => setRebuild(e.target.checked)} />
            Also rebuild the 36 players, 3 coaches and rosters from scratch
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#c0392b" }} disabled={!!busy} onClick={doReset}>
              {busy === "reset" ? (rebuild ? "Resetting and rebuilding… (about a minute)" : "Resetting…") : "Reset now"}
            </button>
            <button style={ghost} disabled={!!busy} onClick={() => setShowReset(false)}>Cancel</button>
          </div>
        </div>
      )}

      {data && !empty && (
        <>
          <div style={muted}>
            {players.length} players · {coaches.length} coaches · {data.rosters.length} rosters
            {c && ` · ${c.practices} practices, ${c.games} games, ${c.plays} plays, ${c.quizzes} quizzes, ${c.scores} scores logged`}
            {(players.length < 36 || coaches.length < 3) && (
              <button style={{ ...ghost, height: 30, padding: "0 10px", fontSize: 12, marginLeft: 10 }} disabled={!!busy} onClick={setUp}>
                {busy === "build" ? "Adding…" : "Add anyone missing"}
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
            <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={h2}>Coaches</span>
              {coaches.map(p => (
                <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--surface2)", borderRadius: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: "50%", background: p.role === "head_coach" ? "#4a3a10" : "#1d2a52", color: p.role === "head_coach" ? "#f0c040" : "#93b4ff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials(p.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{p.name}<div style={{ fontSize: 12, color: "#a3adc4" }}>{p.role === "head_coach" ? "Head coach" : "Assistant coach"}</div></span>
                  {viewBtn(p)}
                </div>
              ))}
            </div>
            <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={h2}>Players</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[{ id: "all", name: `All ${players.length}` }, ...data.rosters.map(r => ({ id: r.id, name: `${r.name} ${players.filter(p => p.roster_id === r.id).length}` }))].map(f => (
                  <button key={f.id} onClick={() => setRosterFilter(f.id)}
                    style={{ height: 32, padding: "0 12px", borderRadius: 99, fontFamily: "inherit", fontSize: 13, cursor: "pointer",
                      border: `1px solid ${rosterFilter === f.id ? "var(--gold)" : "rgba(176,184,200,0.3)"}`,
                      background: rosterFilter === f.id ? "rgba(240,192,64,0.12)" : "transparent",
                      color: rosterFilter === f.id ? "var(--gold)" : "#c3d0ff" }}>{f.name}</button>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto" }}>
                {shown.map(p => {
                  const g = gradeFromGradYear(p.graduation_year);
                  return (
                    <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "var(--surface2)", borderRadius: 10 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: gradeColor(p.graduation_year), flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{p.name}
                        <span style={{ fontSize: 12, color: "#a3adc4" }}> · {g != null ? GRADE_LABELS[g] ?? `Gr ${g}` : "—"}{p.roster ? ` · ${p.roster}` : ""}</span>
                      </span>
                      {viewBtn(p)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
