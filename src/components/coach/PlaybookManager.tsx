// src/components/coach/PlaybookManager.tsx
// Coach-facing playbook manager. Mirrors GroupManager.tsx's draft/active/
// archived pattern and visual style, applied to Playbooks instead of
// Workout Groups.

import { useState, useEffect } from "react";
import {
  Playbook, Play, RosterPlayer,
  getPlaybooks, createPlaybook, updatePlaybook, setPlaybookStatus, deletePlaybook,
  getPlaybookPlays, addPlayToPlaybook, removePlayFromPlaybook,
  getPlaybookShares, publishPlaybookTo, unassignPlaybookFrom,
  getMyPlays, getRoster,
} from "../../lib/plays";

const STATUS_COLOR: Record<string, { bg: string; color: string; label: string }> = {
  draft:    { bg: "rgba(240,192,64,0.12)",  color: "var(--gold)",  label: "📝 Draft"    },
  active:   { bg: "rgba(40,180,80,0.12)",   color: "#5de098",      label: "🌐 Live"     },
  archived: { bg: "rgba(255,255,255,0.06)", color: "var(--muted)", label: "📦 Archived" },
};

const inputStyle = { width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const };

export default function PlaybookManager() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { load(); }, []);
  async function load() { setLoading(true); setPlaybooks(await getPlaybooks()); setLoading(false); }

  async function createNew() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await createPlaybook(newName.trim(), newDesc.trim() || undefined);
      setNewName(""); setNewDesc(""); setShowForm(false);
      await load();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  async function publish(id: string) {
    if (!window.confirm("Publish this playbook? It'll become visible to whoever it's assigned to.")) return;
    await setPlaybookStatus(id, "active");
    await load();
  }
  async function archive(id: string) {
    if (!window.confirm("Archive this playbook? It'll be hidden from assigned players but not deleted.")) return;
    await setPlaybookStatus(id, "archived");
    await load();
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete playbook "${name}"? This can't be undone.`)) return;
    await deletePlaybook(id);
    await load();
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>📋 Playbooks</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Bundle plays into a playbook, then publish it to specific players</div>
        </div>
        <button onClick={() => setShowForm((s) => !s)}
          style={{ background: showForm ? "var(--surface)" : "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {showForm ? "✕ Cancel" : "+ New Playbook"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "var(--surface)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Playbook name (e.g. Baseline out-of-bounds sets)" style={inputStyle} />
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)" style={inputStyle} />
            <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 10px", background: "rgba(240,192,64,0.06)", borderRadius: 8, border: "1px solid rgba(240,192,64,0.15)" }}>
              📝 Playbooks start as <strong style={{ color: "var(--gold)" }}>Draft</strong> — add plays and assign players, then hit <strong style={{ color: "#5de098" }}>Publish</strong>.
            </div>
            <button onClick={createNew} disabled={saving || !newName.trim()}
              style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {saving ? "Creating…" : "Create Playbook"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>Loading…</div>
      ) : playbooks.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>No playbooks yet. Create one above to get started.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {playbooks.map((pb) => {
            const sc = STATUS_COLOR[pb.status] ?? STATUS_COLOR.draft;
            const isOpen = expanded === pb.id;
            return (
              <div key={pb.id} style={{ background: "var(--surface)", border: `1px solid ${pb.status === "active" ? "rgba(40,180,80,0.3)" : "var(--border)"}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : pb.id)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{pb.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: sc.bg, color: sc.color }}>{sc.label}</span>
                    </div>
                    {pb.description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{pb.description}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {pb.status === "draft" && (
                      <button onClick={() => publish(pb.id)}
                        style={{ background: "rgba(40,180,80,0.12)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                        🌐 Publish
                      </button>
                    )}
                    {pb.status === "active" && (
                      <button onClick={() => archive(pb.id)}
                        style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.25)", color: "#ff7b7b", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                        📦 Archive
                      </button>
                    )}
                    {pb.status !== "active" && (
                      <button onClick={() => remove(pb.id, pb.name)}
                        style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && <PlaybookDetail playbook={pb} onChanged={load} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlaybookDetail({ playbook, onChanged }: { playbook: Playbook; onChanged: () => void }) {
  const [plays, setPlays] = useState<Play[]>([]);
  const [myPlays, setMyPlays] = useState<Play[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [shares, setShares] = useState<any[]>([]);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => { refresh(); }, [playbook.id]);

  async function refresh() {
    const [pp, mp, sh, r] = await Promise.all([
      getPlaybookPlays(playbook.id), getMyPlays(), getPlaybookShares(playbook.id), getRoster(),
    ]);
    setPlays(pp); setMyPlays(mp); setShares(sh); setRoster(r);
    setPicked(new Set(sh.map((s: any) => s.shared_with)));
  }

  async function addPlay(playId: string) {
    await addPlayToPlaybook(playbook.id, playId, plays.length);
    setShowAdd(false);
    refresh();
  }
  async function removePlay(playId: string) {
    await removePlayFromPlaybook(playbook.id, playId);
    refresh();
  }

  function togglePick(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function saveAssignments() {
    const currentIds = new Set(shares.map((s: any) => s.shared_with));
    const toAdd = [...picked].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !picked.has(id));
    if (toAdd.length) await publishPlaybookTo(playbook.id, toAdd);
    for (const id of toRemove) await unassignPlaybookFrom(playbook.id, id);
    setShowAssign(false);
    refresh();
    onChanged();
  }

  const availablePlays = myPlays.filter((p) => !plays.some((pp) => pp.id === p.id));

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Plays in this playbook</div>
      {plays.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13, color: "var(--text)" }}>
          <span>{p.title}</span>
          <button onClick={() => removePlay(p.id)} style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>Remove</button>
        </div>
      ))}
      {plays.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No plays added yet.</div>}

      <button onClick={() => setShowAdd((v) => !v)} style={{ marginTop: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
        {showAdd ? "✕ Cancel" : "+ Add a play"}
      </button>
      {showAdd && (
        <div style={{ marginTop: 6 }}>
          {availablePlays.map((p) => (
            <button key={p.id} onClick={() => addPlay(p.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", marginBottom: 4, cursor: "pointer" }}>
              {p.title}
            </button>
          ))}
          {availablePlays.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No more of your plays to add.</div>}
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", margin: "14px 0 6px" }}>Assigned to</div>
      {shares.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>Not assigned to anyone yet.</div>}
      {shares.map((s: any) => (
        <div key={s.id} style={{ fontSize: 12, color: "var(--text)", padding: "3px 0" }}>
          {s.profiles?.name ?? "Player"} {s.viewed_at ? "· viewed" : "· not viewed yet"}
        </div>
      ))}
      <button onClick={() => setShowAssign((v) => !v)} style={{ marginTop: 8, background: "none", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 7, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
        {showAssign ? "✕ Cancel" : "Manage assignments"}
      </button>
      {showAssign && (
        <div style={{ marginTop: 6 }}>
          {roster.map((r) => (
            <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12, color: "var(--text)" }}>
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} />
              {r.name}{r.jersey != null ? ` (#${r.jersey})` : ""}
            </label>
          ))}
          <button onClick={saveAssignments} style={{ marginTop: 8, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Save assignments
          </button>
        </div>
      )}
    </div>
  );
}
