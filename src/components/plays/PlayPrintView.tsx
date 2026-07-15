// src/components/plays/PlayPrintView.tsx
// "Print / Export PDF" — renders a clean, chrome-free page per play (all
// its beats stacked) and lets the browser's print dialog do the PDF export
// (Save as PDF), rather than pulling in a PDF-generation library. Works
// for a single play or a whole playbook (one page per play).

import PlayCanvas from "./PlayCanvas";
import { Play, RosterPlayer, COURT_TEMPLATE_LABELS } from "../../lib/plays";

interface Props {
  plays: Play[];
  playbookName?: string;
  roster?: Record<string, RosterPlayer>;
  onBack: () => void;
}

export default function PlayPrintView({ plays, playbookName, roster = {}, onBack }: Props) {
  return (
    <div>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={onBack} style={{ padding: "8px 14px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer" }}>← Back</button>
        <button onClick={() => window.print()} style={{ padding: "8px 14px", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          🖨️ Print / Save as PDF
        </button>
      </div>

      {plays.map((play) => (
        <div
          key={play.id}
          className="print-page"
          style={{
            background: "#fff", color: "#111", padding: 24, borderRadius: 12, marginBottom: 24,
            // PlayCanvas draws with the app's dark-theme tokens (near-white
            // lines/text) — override them here so the diagram is legible
            // on a white printed page instead of nearly invisible.
            ["--text" as any]: "#111",
            ["--muted" as any]: "#555",
            ["--silver" as any]: "#555",
            ["--border" as any]: "rgba(0,0,0,0.15)",
            ["--surface" as any]: "#fff",
            ["--surface2" as any]: "#fff",
          }}
        >
          {playbookName && <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{playbookName}</div>}
          <h2 style={{ fontSize: 20, margin: "0 0 4px", color: "#111" }}>{play.title}</h2>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
            {COURT_TEMPLATE_LABELS[play.court_template]}
            {play.tags.length > 0 && ` · ${play.tags.join(", ")}`}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: play.data.frames.length > 1 ? "1fr 1fr" : "1fr", gap: 16 }}>
            {play.data.frames.map((frame, i) => (
              <div key={i}>
                {play.data.frames.length > 1 && (
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#333" }}>
                    Beat {i + 1}{frame.label ? ` — ${frame.label}` : ""}
                  </div>
                )}
                <div style={{ border: "1px solid #ddd", borderRadius: 8 }}>
                  <PlayCanvas
                    frame={frame}
                    courtTemplate={play.court_template}
                    avatarsDefault={false}
                    roster={roster}
                    edit={false}
                    courtBg="#f3e4c8"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
