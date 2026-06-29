// src/components/coach/AnnouncementPanel.tsx
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";

interface Props {
  isAdmin: boolean;
  coachId: string | null;
  coachName: string;
}

export default function AnnouncementPanel({ isAdmin, coachId, coachName }: Props) {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showForm, setShowForm]           = useState(false);
  const [newMsg, setNewMsg]               = useState("");
  const [isPinned, setIsPinned]           = useState(false);
  const [posting, setPosting]             = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from("announcements").select("*")
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }).limit(20);
    setAnnouncements(data ?? []);
  }

  async function post() {
    if (!newMsg.trim()) return;
    setPosting(true);
    await supabase.from("announcements").insert({
      coach_id: coachId, coach_name: coachName,
      message: newMsg.trim(), is_pinned: isPinned,
    });
    setNewMsg(""); setIsPinned(false); setShowForm(false);
    await load();
    setPosting(false);
  }

  async function del(id: string) {
    await supabase.from("announcements").delete().eq("id", id);
    load();
  }

  async function togglePin(ann: any) {
    await supabase.from("announcements").update({ is_pinned: !ann.is_pinned }).eq("id", ann.id);
    load();
  }

  const canEdit = (ann: any) => isAdmin || ann.coach_id === coachId;

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, color: "#93b4ff", letterSpacing: 1 }}>📢 Announcements</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Post messages players see when they open the app</div>
        </div>
        <button onClick={() => setShowForm(s => !s)}
          style={{ background: showForm ? "var(--surface)" : "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
          {showForm ? "✕ Cancel" : "+ Post"}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: 16, padding: 14, background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
          <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Write your announcement here..." rows={3}
            style={{ width: "100%", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} />
              📌 Pin to top
            </label>
            <button onClick={post} disabled={posting || !newMsg.trim()}
              style={{ marginLeft: "auto", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
              {posting ? "Posting…" : "Post Announcement"}
            </button>
          </div>
        </div>
      )}

      {announcements.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>No announcements yet</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {announcements.map(ann => (
            <div key={ann.id} style={{ padding: "12px 14px", background: ann.is_pinned ? "rgba(240,192,64,0.08)" : "var(--surface)", borderRadius: 10, border: `1px solid ${ann.is_pinned ? "rgba(240,192,64,0.25)" : "var(--border)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  {ann.is_pinned && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--gold)", marginRight: 6 }}>📌 PINNED</span>}
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{ann.message}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{ann.coach_name} · {new Date(ann.created_at).toLocaleDateString()}</div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {canEdit(ann) && <button onClick={() => togglePin(ann)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: ann.is_pinned ? "var(--gold)" : "var(--muted)" }}>📌</button>}
                  {canEdit(ann) && <button onClick={() => del(ann.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#ff7b7b" }}>🗑</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
