// src/components/AnnouncementsBanner.tsx
//
// Coach announcements at the top of every player page. Pinned first, then
// newest. ✕ hides one for this player on all their devices (migration
// 152) -- it stays up for everyone else. New ones always appear.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Announcement { id: string; coach_name: string; message: string; is_pinned: boolean; created_at: string; }

const SHOW = 3;

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AnnouncementsBanner({ playerId }: { playerId: string }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: anns }, { data: hides }] = await Promise.all([
        supabase.from("announcements").select("id,coach_name,message,is_pinned,created_at")
          .order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(20),
        supabase.from("announcement_hides").select("announcement_id").eq("player_id", playerId),
      ]);
      if (cancelled) return;
      const hidden = new Set((hides ?? []).map((h: any) => h.announcement_id));
      setItems(((anns ?? []) as Announcement[]).filter(a => !hidden.has(a.id)));
    })();
    return () => { cancelled = true; };
  }, [playerId]);

  async function hide(id: string) {
    setItems(prev => prev.filter(a => a.id !== id)); // gone straight away
    const { error } = await supabase.from("announcement_hides").insert({ player_id: playerId, announcement_id: id });
    if (error && error.code !== "23505") console.error("Couldn't hide announcement:", error);
  }

  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, SHOW);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
      {visible.map(a => (
        <div key={a.id} style={{
          display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12,
          background: a.is_pinned ? "rgba(240,192,64,0.10)" : "rgba(147,92,255,0.08)",
          border: `1px solid ${a.is_pinned ? "rgba(240,192,64,0.45)" : "rgba(147,92,255,0.35)"}`,
        }}>
          <div style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.3 }}>{a.is_pinned ? "📌" : "📣"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: a.is_pinned ? "var(--gold)" : "#d4b4ff", fontWeight: a.is_pinned ? 600 : 400, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.message}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{a.coach_name} · {ago(a.created_at)}</div>
          </div>
          <button type="button" onClick={() => hide(a.id)} aria-label="Hide this announcement" title="Hide"
            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 16, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>✕</button>
        </div>
      ))}
      {items.length > SHOW && (
        <button type="button" onClick={() => setShowAll(v => !v)}
          style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--muted)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
          {showAll ? "Show fewer" : `Show all (${items.length})`}
        </button>
      )}
    </div>
  );
}
