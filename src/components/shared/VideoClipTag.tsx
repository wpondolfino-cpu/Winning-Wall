// src/components/shared/VideoClipTag.tsx
// "Clip 2:50–3:40" under a video that has start/stop times. Nothing otherwise.
import { videoClipLabel } from "../../lib/youtube";

export default function VideoClipTag({ url }: { url?: string | null }) {
  const label = videoClipLabel(url);
  if (!label) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "rgba(147,180,255,0.15)", color: "var(--info-text, #93b4ff)" }}>{label}</span>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>Cued up — tap play</span>
    </div>
  );
}
