// src/components/coach/ManageDrillTaxonomy.tsx
// The Drill Library's "Manage categories & tags" tab. Team drills and
// player drills keep separate lists (player categories drive the
// leaderboards), so a switch picks which one you're cleaning up.
//
// Every row shows how many drills use it. Rename carries to every drill;
// Merge moves one's drills into another and removes it (how duplicates
// like "Transition" in both lists get folded together); Delete says how
// many drills it affects before it happens. Categories can be reordered,
// which is the order their chips and dropdowns use.

import { useCallback, useEffect, useState } from "react";
import { DrillKind, TaxoItem, TaxoWhat, loadTaxonomy, renameTaxo, mergeTaxo, deleteTaxo, reorderCategories, addTaxo } from "../../lib/drillTaxonomy";

interface Props {
  showTeam: boolean;
  showPlayer: boolean;
}

const btn: React.CSSProperties = { fontSize: 11.5, padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" };
const input: React.CSSProperties = { background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };

export default function ManageDrillTaxonomy({ showTeam, showPlayer }: Props) {
  const [kind, setKind] = useState<DrillKind>(showTeam ? "team" : "player");
  const [cats, setCats] = useState<TaxoItem[]>([]);
  const [tags, setTags] = useState<TaxoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const t = await loadTaxonomy(kind);
    setCats(t.categories); setTags(t.tags);
    setLoading(false);
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  async function run(p: Promise<{ error: string | null }>, done: string) {
    setBusy(true); setMsg(null);
    const { error } = await p;
    setBusy(false);
    if (error) { alert(error); return false; }
    setMsg(done);
    await load();
    return true;
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= cats.length) return;
    const next = [...cats];
    [next[i], next[j]] = [next[j], next[i]];
    setCats(next);                                   // show it straight away
    const { error } = await reorderCategories(kind, next.map(c => c.name));
    if (error) { alert(error); load(); }
  }

  return (
    <div>
      {showTeam && showPlayer && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {(["team", "player"] as const).map(k => (
            <button key={k} onClick={() => setKind(k)}
              style={{ ...btn, fontSize: 13, padding: "6px 14px", borderRadius: 999,
                ...(kind === k ? { background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" } : {}) }}>
              {k === "team" ? "Team drills" : "Player drills"}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
        {kind === "team"
          ? "Team drill categories (one per drill, for filtering) and tags (as many as you like, counted in Where the time went)."
          : "Player drill categories (one per drill; they group the leaderboards) and tags."}
        {" "}Team and player drills keep separate lists.
      </div>
      {msg && <div style={{ fontSize: 12, color: "var(--green, #2d9b5a)", marginBottom: 10 }}>✓ {msg}</div>}

      {loading ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div> : (
        <>
          <Section title="Categories" what="category" kind={kind} items={cats} busy={busy} run={run}
            onMove={move} nextOrder={cats.length} />
          <div style={{ height: 18 }} />
          <Section title="Tags" what="tag" kind={kind} items={tags} busy={busy} run={run} nextOrder={0} />
        </>
      )}
    </div>
  );
}

function Section({ title, what, kind, items, busy, run, onMove, nextOrder }: {
  title: string; what: TaxoWhat; kind: DrillKind; items: TaxoItem[]; busy: boolean;
  run: (p: Promise<{ error: string | null }>, done: string) => Promise<boolean>;
  onMove?: (i: number, dir: -1 | 1) => void; nextOrder: number;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [adding, setAdding] = useState("");
  const names = items.map(i => i.name);
  const word = what === "category" ? "category" : "tag";
  const canAdd = !(kind === "player" && what === "tag");

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "9px 12px", background: "var(--surface2)", fontSize: 13, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span><span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>{items.length}</span>
      </div>
      {items.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--muted)" }}>None yet.</div>}
      {items.map((it, i) => (
        <div key={it.name} style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {onMove && (
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
                <button disabled={busy || i === 0} onClick={() => onMove(i, -1)} title="Move up" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11, padding: 0 }}>▲</button>
                <button disabled={busy || i === items.length - 1} onClick={() => onMove(i, 1)} title="Move down" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11, padding: 0 }}>▼</button>
              </span>
            )}
            <span style={{ flex: 1, minWidth: 120, fontSize: 13.5, color: "var(--text)" }}>{it.name}</span>
            <span style={{ fontSize: 12, color: it.count ? "var(--muted)" : "var(--gold-text)", minWidth: 70 }}>
              {it.count} drill{it.count === 1 ? "" : "s"}
            </span>
            <button disabled={busy} style={btn} onClick={() => { setRenaming(it.name); setRenameTo(it.name); setMerging(null); }}>Rename</button>
            <button disabled={busy || items.length < 2} style={btn} onClick={() => { setMerging(it.name); setMergeInto(""); setRenaming(null); }}>Merge</button>
            <button disabled={busy} style={{ ...btn, color: "var(--tx-ff9b9b, #d9534f)" }}
              onClick={() => {
                if (kind === "player" && what === "category" && it.count > 0) {
                  alert("Player drills always need a category. Merge this one into another instead.");
                  return;
                }
                const effect = it.count === 0 ? "No drills use it."
                  : what === "category" ? `${it.count} drill${it.count === 1 ? "" : "s"} will go back to no category.`
                  : `It comes off ${it.count} drill${it.count === 1 ? "" : "s"}.`;
                if (confirm(`Delete the ${word} "${it.name}"? ${effect}`)) {
                  void run(deleteTaxo(kind, what, it.name, it.count), `Deleted "${it.name}".`);
                }
              }}>Delete</button>
          </div>
          {renaming === it.name && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <input autoFocus value={renameTo} onChange={e => setRenameTo(e.target.value)} style={{ ...input, flex: 1, minWidth: 160 }} />
              <button disabled={busy} style={{ ...btn, background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" }}
                onClick={async () => { if (await run(renameTaxo(kind, what, it.name, renameTo, names), `Renamed to "${renameTo.trim()}" on ${it.count} drill${it.count === 1 ? "" : "s"}.`)) setRenaming(null); }}>
                Save
              </button>
              <button style={btn} onClick={() => setRenaming(null)}>Cancel</button>
            </div>
          )}
          {merging === it.name && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Move its {it.count} drill{it.count === 1 ? "" : "s"} into</span>
              <select value={mergeInto} onChange={e => setMergeInto(e.target.value)} style={{ ...input, flex: 1, minWidth: 140 }}>
                <option value="">Pick a {word}…</option>
                {names.filter(n => n !== it.name).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button disabled={busy || !mergeInto} style={{ ...btn, background: "var(--royal)", color: "#fff", border: "1px solid var(--royal)" }}
                onClick={async () => {
                  if (!confirm(`Merge "${it.name}" into "${mergeInto}"? Its drills become "${mergeInto}" and "${it.name}" is removed.`)) return;
                  if (await run(mergeTaxo(kind, what, it.name, mergeInto), `Merged "${it.name}" into "${mergeInto}".`)) setMerging(null);
                }}>
                Merge
              </button>
              <button style={btn} onClick={() => setMerging(null)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
      {canAdd ? (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <input value={adding} onChange={e => setAdding(e.target.value)} placeholder={`New ${word}`} style={{ ...input, flex: 1 }} />
          <button disabled={busy || !adding.trim()} style={btn}
            onClick={async () => { if (await run(addTaxo(kind, what, adding, names, nextOrder), `Added "${adding.trim()}".`)) setAdding(""); }}>
            + Add
          </button>
        </div>
      ) : (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--muted)" }}>
          Player drill tags are added on the drill itself, in its editor.
        </div>
      )}
    </div>
  );
}
