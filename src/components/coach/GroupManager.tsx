// src/components/coach/GroupManager.tsx
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

interface Props {
  workouts: { id: string; title: string; group_id?: string | null; group_name?: string | null }[];
  onChanged: () => void;
}

const STATUS_COLOR: Record<string, { bg: string; color: string; label: string }> = {
  draft:    { bg: "rgba(240,192,64,0.12)",  color: "var(--gold)",  label: "📝 Draft"    },
  active:   { bg: "rgba(40,180,80,0.12)",   color: "#5de098",      label: "🌐 Live"     },
  archived: { bg: "rgba(255,255,255,0.06)", color: "var(--muted)", label: "📦 Archived" },
};

export default function GroupManager({ workouts, onChanged }: Props) {
  const [groups, setGroups]             = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [newName, setNewName]           = useState("");
  const [newDesc, setNewDesc]           = useState("");
  const [saving, setSaving]             = useState(false);
  const [editingGroup, setEditingGroup] = useState<any | null>(null);
  const [editName, setEditName]         = useState("");
  const [editDesc, setEditDesc]         = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("workout_groups").select("*")
      .order("created_at", { ascending: false });
    setGroups(data ?? []);
    setLoading(false);
  }

  async function createGroup() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("workout_groups").insert({
        name: newName.trim(),
        description: newDesc.trim() || null,
        status: "draft",
        created_by: user?.id,
      });
      if (error) throw error;
      setNewName(""); setNewDesc(""); setShowForm(false);
      await load();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  async function publishGroup(groupId: string) {
    if (!window.confirm("Publish this group? All workouts in it will become visible to players immediately.")) return;
    const currentActive = groups.find(g => g.status === "active");
    if (currentActive && currentActive.id !== groupId) {
      await supabase.from("workout_groups").update({ status: "archived" }).eq("id", currentActive.id);
      await supabase.from("workouts").update({ is_active: false }).eq("group_id", currentActive.id);
    }
    await supabase.from("workout_groups").update({ status: "active" }).eq("id", groupId);
    await supabase.from("workouts").update({ is_active: true }).eq("group_id", groupId);
    await load(); onChanged();
  }

  async function archiveGroup(groupId: string) {
    if (!window.confirm("Archive this group? Workouts will be hidden from players but all scores are preserved.")) return;
    await supabase.from("workout_groups").update({ status: "archived" }).eq("id", groupId);
    await supabase.from("workouts").update({ is_active: false }).eq("group_id", groupId);
    await load(); onChanged();
  }

  async function deleteGroup(groupId: string, groupName: string) {
    if (!window.confirm(`Delete group "${groupName}"?\n\nWorkouts will be unlinked but not deleted.`)) return;
    await supabase.from("workouts").update({ group_id: null }).eq("group_id", groupId);
    await supabase.from("workout_groups").delete().eq("id", groupId);
    await load(); onChanged();
  }

  async function saveEdit() {
    if (!editingGroup || !editName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("workout_groups").update({
        name: editName.trim(),
        description: editDesc.trim() || null,
      }).eq("id", editingGroup.id);
      if (error) throw error;
      setEditingGroup(null);
      await load();
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "var(--gold)", letterSpacing: 1 }}>📁 Workout Groups</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Create groups, build workouts in draft, publish when ready</div>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          style={{ background: showForm ? "var(--surface)" : "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {showForm ? "✕ Cancel" : "+ New Group"}
        </button>
      </div>

      {showForm && (
        <div style={{ background: "var(--surface)", border: "1px solid rgba(26,63,168,0.3)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Group name (e.g. Week 3 & 4)"
              style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)"
              style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 10px", background: "rgba(240,192,64,0.06)", borderRadius: 8, border: "1px solid rgba(240,192,64,0.15)" }}>
              📝 Groups start as <strong style={{ color: "var(--gold)" }}>Draft</strong> — invisible to players. Add workouts, then hit <strong style={{ color: "#5de098" }}>Publish</strong> when ready.
            </div>
            <button onClick={createGroup} disabled={saving || !newName.trim()}
              style={{ background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {saving ? "Creating…" : "Create Group"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px 0", fontSize: 13 }}>No groups yet. Create one above to get started.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map(g => {
            const sc = STATUS_COLOR[g.status] ?? STATUS_COLOR.draft;
            const groupWorkouts = workouts.filter(w => (w as any).group_id === g.id);
            return (
              <div key={g.id} style={{ background: "var(--surface)", border: `1px solid ${g.status === "active" ? "rgba(40,180,80,0.3)" : "var(--border)"}`, borderRadius: 10, padding: "12px 14px" }}>
                {editingGroup?.id === g.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input value={editName} onChange={e => setEditName(e.target.value)}
                      style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                    <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description (optional)"
                      style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={saveEdit} disabled={saving}
                        style={{ flex: 1, background: "var(--royal)", color: "#fff", border: "none", borderRadius: 7, padding: "7px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEditingGroup(null)}
                        style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "7px 12px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{g.name}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: sc.bg, color: sc.color }}>{sc.label}</span>
                      </div>
                      {g.description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{g.description}</div>}
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                        {groupWorkouts.length} workout{groupWorkouts.length !== 1 ? "s" : ""}
                        {groupWorkouts.length > 0 && ` · ${groupWorkouts.map(w => w.title).join(", ").slice(0, 60)}${groupWorkouts.map(w => w.title).join(", ").length > 60 ? "…" : ""}`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => { setEditingGroup(g); setEditName(g.name); setEditDesc(g.description ?? ""); }}
                        style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
                        ✏️
                      </button>
                      {g.status === "draft" && (
                        <button onClick={() => publishGroup(g.id)}
                          style={{ background: "rgba(40,180,80,0.12)", border: "1px solid rgba(40,180,80,0.3)", color: "#5de098", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                          🌐 Publish
                        </button>
                      )}
                      {g.status === "active" && (
                        <button onClick={() => archiveGroup(g.id)}
                          style={{ background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.25)", color: "#ff7b7b", borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                          📦 Archive
                        </button>
                      )}
                      {g.status !== "active" && (
                        <button onClick={() => deleteGroup(g.id, g.name)}
                          style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 7, padding: "5px 8px", fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                )}
            );
          })}
        </div>
      )}
    </div>
  );
}

// Export groups loader so WorkoutBuilder can use it
export async function loadGroupsForBuilder() {
  const { data } = await supabase
    .from("workout_groups").select("*")
    .order("created_at", { ascending: false });
  return data ?? [];
}
