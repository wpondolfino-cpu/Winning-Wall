// src/components/coach/PracticeTimePanel.tsx
//
// Where practice time actually went, by drill tag.
//
// Tags rather than category, because a five-minute drill is often two
// skills at once — dribbling AND finishing — and one category can't say
// so. The trade is that tag minutes don't add up to the length of your
// practices: that drill gives five minutes to both tags. So a percentage
// here means "this share of practice time touched that tag", measured
// against real practice minutes, and it isn't expected to reach 100. The
// panel says so rather than leaving you to work it out from a column that
// sums to 140%.
//
// The untagged row is the one that can be acted on, so it's a button:
// open it and every drill behind those minutes is there to be tagged on
// the spot.

import { useState, useEffect } from "react";
import {
  getPracticeTimeReport, getDrillsByIds, setDrillTags, getAllDrillTags,
  PracticeTimeReport, Season, Roster,
} from "../../lib/practicePlanner";
import { inputStyle } from "../../lib/inputStyle";

export default function PracticeTimePanel({ seasons, selectedSeasonId, rosters }: {
  seasons: Season[];
  selectedSeasonId: string | null;
  rosters: Roster[];
}) {
  const [scope, setScope] = useState<"season" | "all">("season");
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [report, setReport] = useState<PracticeTimeReport | null>(null);
  const [open, setOpen] = useState(false);

  // The untagged drill list, opened from the red row.
  const [tagging, setTagging] = useState<{ id: string; title: string; tags: string[] }[] | null>(null);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const seasonName = seasons.find(s => s.id === selectedSeasonId)?.name ?? "this season";

  async function refresh() {
    setReport(null);
    try {
      setReport(await getPracticeTimeReport(scope === "all" ? null : selectedSeasonId, rosterId));
    } catch (err) {
      console.error(err);
      setReport({ totalMinutes: 0, practiceCount: 0, rows: [] });
    }
  }

  useEffect(() => { if (open) void refresh(); }, [open, scope, selectedSeasonId, rosterId]);

  async function openTagging(drillIds: string[]) {
    const [drills, tags] = await Promise.all([getDrillsByIds(drillIds), getAllDrillTags()]);
    setKnownTags(tags);
    setDraft(Object.fromEntries(drills.map(d => [d.id, d.tags.join(", ")])));
    setTagging(drills);
  }

  async function saveTags(id: string) {
    setSavingId(id);
    const { error } = await setDrillTags(id, (draft[id] ?? "").split(",").map(t => t.trim()));
    setSavingId(null);
    if (error) { alert("Couldn't save the tags: " + error); return; }
    setTagging(prev => prev?.filter(d => d.id !== id) ?? null);
    await refresh();
  }

  const hours = (m: number) => m >= 120 ? `${Math.round(m / 60)} hr` : `${m} min`;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: "var(--gold)", letterSpacing: 0.4 }}>
          {open ? "▾" : "▸"} Where the time went
        </span>
        {report && open && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {report.practiceCount} practice{report.practiceCount === 1 ? "" : "s"} · {hours(report.totalMinutes)}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ display: "flex", gap: 5, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 3, margin: "10px 0 8px" }}>
            {(["season", "all"] as const).map(v => (
              <button key={v} onClick={() => setScope(v)}
                style={{
                  flex: 1, textAlign: "center", fontSize: 11.5, padding: 6, borderRadius: 6, cursor: "pointer",
                  fontFamily: "inherit", border: "none", fontWeight: 600,
                  background: scope === v ? "var(--royal)" : "transparent",
                  color: scope === v ? "#fff" : "var(--muted)",
                }}>
                {v === "season" ? seasonName : "All time"}
              </button>
            ))}
          </div>

          {/* Varsity and JV minutes pooled together answered nobody's
              question. */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
            {[{ id: null, name: "All teams" }, ...rosters.map(r => ({ id: r.id as string | null, name: r.name }))].map(r => (
              <button key={r.id ?? "all"} onClick={() => setRosterId(r.id)}
                style={{
                  fontSize: 11, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${rosterId === r.id ? "var(--gold)" : "var(--border)"}`,
                  background: rosterId === r.id ? "rgba(240,192,64,0.12)" : "transparent",
                  color: rosterId === r.id ? "var(--gold)" : "var(--muted)",
                }}>
                {r.name}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Clock minutes from published practices — a 5-minute block of three stations counts as 5.
            A drill tagged twice gives its minutes to both, so these don&rsquo;t add up to 100%.
          </div>

          {report === null && <div style={{ fontSize: 12, color: "var(--muted)" }}>Adding it up…</div>}
          {report?.rows.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              No published practices {scope === "all" ? "yet" : `in ${seasonName}`}
              {rosterId ? " for that team" : ""}.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {report?.rows.map(r => {
              const pct = report.totalMinutes ? (r.minutes / report.totalMinutes) * 100 : 0;
              const untagged = r.tag === null;
              const body = (
                <>
                  <div style={{
                    position: "absolute", inset: 0, width: `${Math.max(Math.min(pct, 100), 2)}%`, borderRadius: 6,
                    background: untagged ? "rgba(255,107,107,0.12)" : `rgba(240,192,64,${0.06 + (Math.min(pct, 100) / 100) * 0.12})`,
                  }} />
                  <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                    <span style={{ color: untagged ? "#ff9b9b" : "var(--text)" }}>
                      {r.tag ?? "Untagged"}
                    </span>
                    <span style={{ color: untagged ? "#ff9b9b" : "var(--text)", whiteSpace: "nowrap" }}>
                      {r.minutes} min
                      <span style={{ color: untagged ? "#c47a7a" : "var(--muted)", fontSize: 11 }}>
                        {" · "}{Math.round(pct)}%
                        {untagged
                          ? (r.drillIds.length ? " · tag these drills →" : " · blocks with no drills")
                          : ` · ${r.practiceCount} practice${r.practiceCount === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </div>
                </>
              );

              // Only the untagged row leads anywhere, so only it is a button.
              return untagged && r.drillIds.length > 0 ? (
                <button key="__untagged" onClick={() => openTagging(r.drillIds)}
                  style={{ position: "relative", padding: "8px 10px", borderRadius: 6, overflow: "hidden", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}>
                  {body}
                </button>
              ) : (
                <div key={r.tag ?? "__none"} style={{ position: "relative", padding: "8px 10px", borderRadius: 6, overflow: "hidden" }}>
                  {body}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tagging && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setTagging(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--surface)", borderRadius: 16, width: "min(560px, 96vw)", maxHeight: "88vh", overflowY: "auto", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--gold)" }}>Tag these drills</div>
              <button onClick={() => setTagging(null)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
              Comma separated. Tagging one here fixes every practice it&rsquo;s ever been in, because the tags live on the library drill.
            </div>

            {knownTags.length > 0 && (
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 12 }}>
                Already in use: {knownTags.join(", ")}
              </div>
            )}

            {tagging.length === 0 && (
              <div style={{ fontSize: 12, color: "#5de098" }}>All tagged. Nothing left here.</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tagging.map(d => (
                <div key={d.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 9, padding: 10 }}>
                  <div style={{ fontSize: 12.5, color: "var(--text)", marginBottom: 6 }}>{d.title}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={draft[d.id] ?? ""} onChange={e => setDraft(p => ({ ...p, [d.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") void saveTags(d.id); }}
                      placeholder="dribbling, finishing"
                      style={{ ...inputStyle, flex: 1, fontSize: 12, padding: "6px 9px" }} />
                    <button onClick={() => saveTags(d.id)} disabled={savingId === d.id || !(draft[d.id] ?? "").trim()}
                      style={{ background: "var(--gold)", border: "none", borderRadius: 7, padding: "6px 12px", color: "#1a1a1a", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: savingId === d.id || !(draft[d.id] ?? "").trim() ? 0.5 : 1 }}>
                      {savingId === d.id ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
