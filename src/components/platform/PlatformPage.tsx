// src/components/platform/PlatformPage.tsx
// Platform admin page (migration 189): schools and their programs, each
// program's head coaches, features, team code, logo/colors and pause;
// adding schools and programs; posting to every program. Reached from
// the "Platform" row at the top of the program switcher; only the
// platform admin ever sees it (the database checks every call too).

import { CSSProperties, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { switchProgram } from "../../lib/programs";
import { FEATURE_GROUPS, FeatureKey, setFeature } from "../../lib/features";
import {
  PlatformSchool, PlatformProgram, PersonMatch, loadPlatform, searchPeople, setHeadCoach,
  newJoinCode, createProgram, createSchool, updateProgram, updateSchool, uploadLogo, inviteLink,
} from "../../lib/platform";

type Section = "programs" | "library" | "broadcast";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16 };
const btn: CSSProperties = { height: 42, padding: "0 16px", borderRadius: 10, border: 0, background: "var(--royal)", color: "var(--white)", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghost: CSSProperties = { ...btn, background: "transparent", border: "1px solid rgba(176,184,200,0.3)", color: "#c3d0ff" };
const danger: CSSProperties = { ...btn, background: "transparent", border: "1px solid rgba(255,140,140,0.35)", color: "#ff9a9a" };
const input: CSSProperties = { height: 44, boxSizing: "border-box", padding: "0 12px", borderRadius: 10, border: "1px solid rgba(176,184,200,0.25)", background: "var(--surface2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14, width: "100%" };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#a3adc4" };
const muted: CSSProperties = { fontSize: 12, color: "#8b95ae", lineHeight: 1.5 };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 3).toUpperCase();
}

function Logo({ url, text, bg, fg, size }: { url: string | null; text: string; bg: string; fg: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) return <img src={url} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: 10, objectFit: "contain", flexShrink: 0 }} />;
  return (
    <span style={{ width: size, height: size, borderRadius: 10, background: bg, color: fg, fontFamily: "'Bebas Neue', sans-serif", fontSize: size * 0.4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{text}</span>
  );
}

export default function PlatformPage() {
  const [section, setSection] = useState<Section>("programs");
  const [schools, setSchools] = useState<PlatformSchool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSchools, setOpenSchools] = useState<Record<string, boolean>>({});
  const [managing, setManaging] = useState<string | null>(null);   // program id
  const [addingSchool, setAddingSchool] = useState(false);

  async function refresh() {
    try {
      const s = await loadPlatform();
      setSchools(s);
      setOpenSchools(prev => {
        const next = { ...prev };
        s.forEach((x, i) => { if (next[x.id] === undefined) next[x.id] = i === 0; });
        return next;
      });
    } catch (e: any) { setError(e?.message ?? "Couldn't load the platform."); }
  }
  useEffect(() => { refresh(); }, []);

  const managed = schools?.flatMap(s => s.programs.map(p => ({ school: s, program: p }))).find(x => x.program.id === managing) ?? null;

  return (
    <div className="panel active" style={{ maxWidth: 1180, margin: "0 auto" }}>
      {managed ? (
        <ProgramManage school={managed.school} program={managed.program} onBack={() => setManaging(null)} onChanged={refresh} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 280px" }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: "var(--gold)", textTransform: "uppercase" }}>Platform</span>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 36, letterSpacing: 1, color: "var(--white)", lineHeight: 1 }}>
                {section === "programs" ? "Schools & programs" : section === "library" ? "Winning Wall library" : "Post to every program"}
              </span>
            </div>
            {section === "programs" && <button style={btn} onClick={() => setAddingSchool(a => !a)}>{addingSchool ? "Cancel" : "+ Add school"}</button>}
          </div>

          <nav aria-label="Platform sections" style={{ display: "flex", flexWrap: "wrap", gap: 4, background: "var(--surface)", borderRadius: 12, padding: 4, alignSelf: "flex-start" }}>
            {([["programs", "Schools & programs"], ["library", "Winning Wall library"], ["broadcast", "Post to every program"]] as [Section, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setSection(k)} style={{ padding: "10px 16px", borderRadius: 9, border: 0, background: section === k ? "var(--royal)" : "transparent", color: section === k ? "var(--white)" : "#a3adc4", fontFamily: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{l}</button>
            ))}
          </nav>

          {error && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{error}</div>}

          {section === "programs" && (
            <>
              {addingSchool && <AddSchool onDone={() => { setAddingSchool(false); refresh(); }} />}
              {schools === null && !error && <div style={muted}>Loading…</div>}
              {(schools ?? []).map(s => (
                <SchoolBlock key={s.id} school={s} open={!!openSchools[s.id]}
                  onToggle={() => setOpenSchools(o => ({ ...o, [s.id]: !o[s.id] }))}
                  onManage={setManaging} onChanged={refresh} />
              ))}
            </>
          )}

          {section === "library" && (
            <div style={{ ...card, padding: 20, ...muted, fontSize: 14 }}>
              The Winning Wall library (starter pack and "New from Winning Wall") comes in the next update.
            </div>
          )}

          {section === "broadcast" && <Broadcast />}
        </div>
      )}
    </div>
  );
}

// ── A school and its programs ─────────────────────────────────
function SchoolBlock({ school, open, onToggle, onManage, onChanged }: {
  school: PlatformSchool; open: boolean; onToggle: () => void; onManage: (id: string) => void; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const short = school.short_name || initials(school.name);
  return (
    <section style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "16px 18px", borderBottom: open ? "1px solid rgba(176,184,200,0.12)" : "none" }}>
        <button onClick={onToggle} aria-expanded={open} aria-label={open ? `Collapse ${school.name}` : `Expand ${school.name}`}
          style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 260px", background: "transparent", border: 0, padding: 0, color: "inherit", fontFamily: "inherit", textAlign: "left", cursor: "pointer", minHeight: 44 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a3adc4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
          <Logo url={school.logo_url} text={short} bg={school.primary_color ?? "#1a3fa8"} fg={school.accent_color ?? "#f0c040"} size={44} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--white)" }}>{school.name}</span>
            <span style={{ fontSize: 13, color: "#a3adc4" }}>{school.programs.length} program{school.programs.length === 1 ? "" : "s"}</span>
          </span>
        </button>
        <span style={{ display: "flex", gap: 6 }} aria-label="School colors">
          {[school.primary_color, school.secondary_color, school.accent_color].map((c, i) => (
            <span key={i} style={{ width: 22, height: 22, borderRadius: 6, background: c ?? "transparent", border: "1px solid rgba(255,255,255,0.2)" }} />
          ))}
        </span>
        <button style={ghost} onClick={() => setEditing(e => !e)}>{editing ? "Done" : "Edit school"}</button>
      </div>

      {editing && <EditSchool school={school} onSaved={onChanged} />}

      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, padding: 18 }}>
          {school.programs.map(p => <ProgramCard key={p.id} p={p} onManage={() => onManage(p.id)} />)}
          {adding ? (
            <AddProgram school={school} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
          ) : (
            <button onClick={() => setAdding(true)}
              style={{ minHeight: 180, borderRadius: 14, border: "2px dashed rgba(176,184,200,0.25)", background: "transparent", color: "#a3adc4", fontFamily: "inherit", fontSize: 14, fontWeight: 600, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add a program to {school.short_name || school.name}
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#a3adc4" }}>
        Team code <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 2, color: "var(--white)" }}>{p.join_code ?? "—"}</span>
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
function ProgramManage({ school, program: p, onBack, onChanged }: {
  school: PlatformSchool; program: PlatformProgram; onBack: () => void; onChanged: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<PersonMatch[]>([]);
  const [colors, setColors] = useState({ primary_color: p.primary_color ?? school.primary_color ?? "#1a3fa8", secondary_color: p.secondary_color ?? school.secondary_color ?? "#b0b8c8", accent_color: p.accent_color ?? school.accent_color ?? "#f0c040" });
  const [name, setName] = useState(p.name);
  const [copied, setCopied] = useState(false);

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
  const short = school.short_name || initials(school.name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <button onClick={onBack} style={{ alignSelf: "flex-start", background: "transparent", border: 0, color: "#a3adc4", fontFamily: "inherit", fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", minHeight: 44, padding: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        Schools &amp; programs
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        <Logo url={p.logo_url ?? school.logo_url} text={short} bg={colors.primary_color} fg={colors.accent_color} size={52} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 240px" }}>
          <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: 1, color: "var(--white)", lineHeight: 1 }}>{p.name}</span>
          <span style={{ fontSize: 13, color: "#a3adc4" }}>{school.name}{p.is_active ? "" : " · Paused"}</span>
        </div>
        {p.is_active && <button style={ghost} onClick={() => switchProgram(p.id)}>Go to program</button>}
      </div>

      {(msg || err) && <div role="status" style={{ fontSize: 13, color: err ? "#ff8a8a" : "#5de098" }}>{err ?? msg}</div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>

          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--white)", flex: 1 }}>Head coaches</span>
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
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--white)", flex: 1 }}>Features</span>
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
        </div>

        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--white)" }}>Team code</span>
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
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--white)" }}>Name, logo &amp; colors</span>
            <label style={label}>Program name<input value={name} onChange={e => setName(e.target.value)} style={input} /></label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Logo url={p.logo_url ?? school.logo_url} text={short} bg={colors.primary_color} fg={colors.accent_color} size={56} />
              <label style={{ ...ghost, display: "flex", alignItems: "center", cursor: busy ? "wait" : "pointer" }}>
                Upload logo
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: "none" }}
                  onChange={e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    run(async () => { const url = await uploadLogo("program", p.id, f); await updateProgram(p.id, { logo_url: url }); }, "Logo saved.");
                  }} />
              </label>
              {p.logo_url && <button style={{ ...ghost, height: 38 }} onClick={() => run(() => updateProgram(p.id, { logo_url: null }), "Using the school's logo.")}>Use school's</button>}
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

// ── Add / edit schools, add programs ──────────────────────────
function AddSchool({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", short_name: "", primary_color: "#1a3fa8", secondary_color: "#b0b8c8", accent_color: "#f0c040" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: "var(--white)" }}>New school</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label style={label}>School name<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Mansfield High School" style={input} /></label>
        <label style={label}>Short name (badge letters)<input value={f.short_name} maxLength={4} onChange={e => setF({ ...f, short_name: e.target.value.toUpperCase() })} placeholder="e.g. MHS" style={input} /></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, maxWidth: 420 }}>
        {([["primary_color", "Primary"], ["secondary_color", "Secondary"], ["accent_color", "Accent"]] as const).map(([k, l]) => (
          <label key={k} style={label}>{l}<input type="color" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} style={{ width: "100%", height: 40, border: "1px solid rgba(176,184,200,0.25)", borderRadius: 8, background: "transparent", padding: 2 }} /></label>
        ))}
      </div>
      {err && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{err}</div>}
      <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy || !f.name.trim()}
        onClick={async () => {
          setBusy(true); setErr(null);
          try { await createSchool({ ...f, name: f.name.trim(), short_name: (f.short_name || initials(f.name)).trim() }); onDone(); }
          catch (e: any) { setErr(e?.message ?? "Couldn't add the school."); setBusy(false); }
        }}>Add school</button>
    </section>
  );
}

function EditSchool({ school, onSaved }: { school: PlatformSchool; onSaved: () => void }) {
  const [f, setF] = useState({ name: school.name, short_name: school.short_name ?? "", primary_color: school.primary_color ?? "#1a3fa8", secondary_color: school.secondary_color ?? "#b0b8c8", accent_color: school.accent_color ?? "#f0c040" });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (patch: any, ok: string) => {
    setBusy(true); setNote(null);
    try { await updateSchool(school.id, patch); setNote(ok); onSaved(); } catch (e: any) { setNote(e?.message ?? "Couldn't save."); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ padding: 18, borderBottom: "1px solid rgba(176,184,200,0.12)", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <label style={label}>School name<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={input} /></label>
        <label style={label}>Short name<input value={f.short_name} maxLength={4} onChange={e => setF({ ...f, short_name: e.target.value.toUpperCase() })} style={input} /></label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
        {([["primary_color", "Primary"], ["secondary_color", "Secondary"], ["accent_color", "Accent"]] as const).map(([k, l]) => (
          <label key={k} style={{ ...label, width: 110 }}>{l}<input type="color" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} style={{ width: "100%", height: 40, border: "1px solid rgba(176,184,200,0.25)", borderRadius: 8, background: "transparent", padding: 2 }} /></label>
        ))}
        <label style={{ ...ghost, display: "flex", alignItems: "center", cursor: "pointer" }}>
          Upload school logo
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: "none" }}
            onChange={async e => {
              const file = e.target.files?.[0]; if (!file) return;
              setBusy(true);
              try { const url = await uploadLogo("school", school.id, file); await save({ logo_url: url }, "Logo saved."); }
              catch (er: any) { setNote(er?.message ?? "Couldn't upload."); setBusy(false); }
            }} />
        </label>
        <button style={btn} disabled={busy || !f.name.trim()} onClick={() => save({ ...f, name: f.name.trim() }, "Saved.")}>Save school</button>
      </div>
      {note && <span style={{ fontSize: 13, color: "#a3adc4" }}>{note}</span>}
      <span style={muted}>Programs without their own logo or colors use the school's.</span>
    </div>
  );
}

function AddProgram({ school, onDone, onCancel }: { school: PlatformSchool; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ background: "var(--surface2)", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--white)" }}>New program at {school.short_name || school.name}</span>
      <label style={label}>Program name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Girls Basketball" style={input} autoFocus /></label>
      <span style={muted}>It starts with a current season, a team code, the school's colors, and the same settings, XP settings and badges as AHS Boys. Then add a head coach.</span>
      {err && <div style={{ color: "#ff8a8a", fontSize: 13 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...btn, flex: 1 }} disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true); setErr(null);
            try { await createProgram(school.id, name.trim()); onDone(); }
            catch (e: any) { setErr(e?.message ?? "Couldn't add the program."); setBusy(false); }
          }}>{busy ? "Adding…" : "Add program"}</button>
        <button style={ghost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Post to every program ─────────────────────────────────────
function Broadcast() {
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <span style={muted}>Goes into every program's announcements and pushes to everyone in every program. Each program can pin or remove its own copy; you can remove it everywhere from any program's Announcements.</span>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Write the announcement…"
        style={{ ...input, height: "auto", padding: "10px 12px", resize: "vertical" }} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#a3adc4", cursor: "pointer" }}>
        <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin to the top
      </label>
      {status && <div role="status" style={{ fontSize: 13, color: status.startsWith("Posted to") ? "#5de098" : "#ff8c42" }}>{status}</div>}
      <button style={{ ...btn, alignSelf: "flex-start" }} disabled={busy || !text.trim()}
        onClick={async () => {
          setBusy(true); setStatus(null);
          const { data: n, error } = await supabase.rpc("post_announcement_everywhere", { p_message: text.trim(), p_pinned: pinned });
          if (error) { setStatus(`Not posted: ${error.message}`); setBusy(false); return; }
          const { data, error: pushErr } = await supabase.functions.invoke("send-push", {
            body: { title: pinned ? "📌 New pinned announcement" : "📢 New announcement", message: text.trim(), allPrograms: true },
          });
          const where = `Posted to ${n} program${n === 1 ? "" : "s"}`;
          setStatus(pushErr ? `${where}, but the notification didn't send.`
            : (data as any)?.sent === false ? `${where}; nobody was notified: ${(data as any).reason}.`
            : `${where} and sent.`);
          setText(""); setPinned(false); setBusy(false);
        }}>{busy ? "Posting…" : "Post to every program"}</button>
    </section>
  );
}
