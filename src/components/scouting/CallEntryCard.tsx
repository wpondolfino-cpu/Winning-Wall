// src/components/scouting/CallEntryCard.tsx
import RichTextEditor from "../shared/RichTextEditor";
import { Play } from "../../lib/plays";

export interface CallEntryLike {
  id: string;
  call_name: string;
  description: string | null;
  plan_to_defend: string | null;
  video_url: string | null;
  play_id: string | null;
}

interface Props {
  entry: CallEntryLike;
  myPlays: Play[];
  canManage: boolean;
  onPatch: (id: string, patch: Partial<CallEntryLike>) => void;
  onRemove: (id: string) => void;
}

export default function CallEntryCard({ entry, myPlays, canManage, onPatch, onRemove }: Props) {
  return (
    <div style={{ background: "var(--surface2)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        {canManage ? (
          <input value={entry.call_name} onChange={e => onPatch(entry.id, { call_name: e.target.value })}
            style={{ fontSize: 14, fontWeight: 600, background: "none", border: "none", color: "var(--text)", flex: 1 }} />
        ) : <span style={{ fontSize: 14, fontWeight: 600 }}>{entry.call_name}</span>}
        {canManage && <button type="button" onClick={() => onRemove(entry.id)} style={{ background: "none", border: "none", color: "#ff7b7b", cursor: "pointer", fontSize: 12 }}>Remove</button>}
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Description</div>
      <RichTextEditor value={entry.description ?? ""} onChange={v => onPatch(entry.id, { description: v })} disabled={!canManage} placeholder="What it looks like, how it's run…" />

      <div style={{ fontSize: 11, color: "var(--muted)", margin: "10px 0 4px" }}>Plan to Defend</div>
      <RichTextEditor value={entry.plan_to_defend ?? ""} onChange={v => onPatch(entry.id, { plan_to_defend: v })} disabled={!canManage} placeholder="How we're guarding it…" />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {canManage ? (
          <input value={entry.video_url ?? ""} onChange={e => onPatch(entry.id, { video_url: e.target.value })} placeholder="Video URL" style={{ flex: 1, fontSize: 12 }} />
        ) : entry.video_url ? <a href={entry.video_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--royal-light)" }}>▶ Video</a> : null}
        {canManage ? (
          <select value={entry.play_id ?? ""} onChange={e => onPatch(entry.id, { play_id: e.target.value || null })} style={{ flex: 1, fontSize: 12 }}>
            <option value="">— Link a play design —</option>
            {myPlays.map(pl => <option key={pl.id} value={pl.id}>{pl.title}</option>)}
          </select>
        ) : entry.play_id ? <span style={{ fontSize: 12, color: "var(--royal-light)" }}>🏀 {myPlays.find(pl => pl.id === entry.play_id)?.title ?? "Play linked"}</span> : null}
      </div>
    </div>
  );
}
