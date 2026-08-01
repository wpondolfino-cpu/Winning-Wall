// src/components/gameday/GameDaySheetPrintView.tsx
import { useState, useLayoutEffect, useRef } from "react";
import { GameDaySheet, GameDayCall, GAMEDAY_SECTIONS, GameDaySection } from "../../lib/gameDaySheets";

interface Props {
  sheet: GameDaySheet;
  calls: GameDayCall[];
}

// Approximate usable content area for one landscape US-letter page at
// 96 CSS px/inch, minus margins -- a budget to drive the move-to-
// page-2 decision, not a pixel-perfect print guarantee (actual print
// scaling varies by browser/printer). Good enough to decide "does
// this fit," which is all the priority logic actually needs.
const PAGE_WIDTH_PX = 960;
const PAGE_HEIGHT_PX = 700;

type Assignment = "all-fit" | "specials-moved" | "defense-and-specials-moved";

function callsFor(calls: GameDayCall[], section: GameDaySection) {
  return calls.filter(c => c.section === section).sort((a, b) => a.sort_order - b.sort_order);
}

function SectionBlock({ calls, section, label }: { calls: GameDayCall[]; section: GameDaySection; label: string }) {
  const rows = callsFor(calls, section);
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontWeight: 600, fontSize: 11 }}>{label}</div>
      {rows.map(c => <div key={c.id} style={{ fontSize: 11 }}>{c.call_name}</div>)}
    </div>
  );
}

function OffenseBlobsColumn({ calls }: { calls: GameDayCall[] }) {
  return (
    <div>
      <div style={{ background: "#e6f1fb", color: "#0c447c", fontWeight: 600, padding: "4px 8px", marginBottom: 6 }}>OFFENSE</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 10px" }}>
        {GAMEDAY_SECTIONS.filter(s => s.group === "offense").map(s => <SectionBlock key={s.key} calls={calls} section={s.key} label={s.label} />)}
      </div>
      <div style={{ background: "#eaf3de", color: "#27500a", fontWeight: 600, padding: "4px 8px", margin: "10px 0 6px" }}>BLOBS &amp; SLOBS</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
        {GAMEDAY_SECTIONS.filter(s => s.group === "blobsSlobs").map(s => <SectionBlock key={s.key} calls={calls} section={s.key} label={s.label} />)}
      </div>
    </div>
  );
}

function DefenseBlock({ calls }: { calls: GameDayCall[] }) {
  return (
    <div>
      <div style={{ background: "#fcebeb", color: "#791f1f", fontWeight: 600, padding: "4px 8px", marginBottom: 6 }}>DEFENSE</div>
      {GAMEDAY_SECTIONS.filter(s => s.group === "defense").map(s => <SectionBlock key={s.key} calls={calls} section={s.key} label={s.label} />)}
    </div>
  );
}

function SpecialsBlock({ calls }: { calls: GameDayCall[] }) {
  return (
    <div>
      <div style={{ background: "#faeeda", color: "#633806", fontWeight: 600, padding: "4px 8px", marginBottom: 6 }}>SPECIALS</div>
      {GAMEDAY_SECTIONS.filter(s => s.group === "specials").map(s => <SectionBlock key={s.key} calls={calls} section={s.key} label={s.label} />)}
    </div>
  );
}

function PageShell({ children, name }: { children: React.ReactNode; name: string }) {
  return (
    <div className="print-page" style={{ background: "#fff", color: "#111", padding: 16, borderRadius: 8, marginBottom: 24, minWidth: PAGE_WIDTH_PX, maxWidth: PAGE_WIDTH_PX }}>
      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #111", paddingBottom: 6, marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>{name}</strong>
      </div>
      {children}
    </div>
  );
}

export default function GameDaySheetPrintView({ sheet, calls }: Props) {
  const [assignment, setAssignment] = useState<Assignment>("all-fit");
  const [resolved, setResolved] = useState(false);
  const measureRef = useRef<HTMLDivElement>(null);

  // Re-measure every time the candidate assignment changes, escalating
  // (all-fit -> specials-moved -> defense-and-specials-moved) until the
  // candidate page 1 fits the page budget or we run out of options.
  useLayoutEffect(() => {
    if (resolved || !measureRef.current) return;
    const height = measureRef.current.scrollHeight;
    if (height <= PAGE_HEIGHT_PX) {
      setResolved(true);
    } else if (assignment === "all-fit") {
      setAssignment("specials-moved");
    } else if (assignment === "specials-moved") {
      setAssignment("defense-and-specials-moved");
    } else {
      setResolved(true); // even Offense + Blobs & Slobs alone overflow -- nothing left to move
    }
  }, [assignment, resolved]);

  const page1IncludesDefense = assignment !== "defense-and-specials-moved";
  const page1IncludesSpecials = assignment === "all-fit";
  const overflowsEvenAlone = resolved && assignment === "defense-and-specials-moved" && measureRef.current && measureRef.current.scrollHeight > PAGE_HEIGHT_PX;

  return (
    <div>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button onClick={() => window.print()} style={{ padding: "8px 14px", background: "var(--royal)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          🖨️ Print / Save as PDF
        </button>
        {resolved && assignment !== "all-fit" && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Doesn't fit one page — {assignment === "specials-moved" ? "Specials moved to page 2" : "Specials and Defense moved to page 2"}
          </span>
        )}
        {overflowsEvenAlone && (
          <span style={{ fontSize: 12, color: "#ff7b7b" }}>Offense + Blobs &amp; Slobs alone still run past one page — trim a section to fit fully.</span>
        )}
      </div>

      {/* Hidden measuring pass — same content as the real page 1 candidate, off-screen, remeasured each time `assignment` changes */}
      {!resolved && (
        <div ref={measureRef} style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", width: PAGE_WIDTH_PX }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
            <OffenseBlobsColumn calls={calls} />
            <div>
              {page1IncludesDefense && <DefenseBlock calls={calls} />}
              {page1IncludesSpecials && <div style={{ marginTop: page1IncludesDefense ? 10 : 0 }}><SpecialsBlock calls={calls} /></div>}
            </div>
          </div>
        </div>
      )}

      {resolved && (
        <>
          <PageShell name={sheet.name}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
              <OffenseBlobsColumn calls={calls} />
              <div>
                {page1IncludesDefense && <DefenseBlock calls={calls} />}
                {page1IncludesSpecials && <div style={{ marginTop: page1IncludesDefense ? 10 : 0 }}><SpecialsBlock calls={calls} /></div>}
              </div>
            </div>
          </PageShell>

          {assignment === "specials-moved" && (
            <PageShell name={`${sheet.name} — continued`}>
              <SpecialsBlock calls={calls} />
            </PageShell>
          )}

          {assignment === "defense-and-specials-moved" && (
            <PageShell name={`${sheet.name} — continued`}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <DefenseBlock calls={calls} />
                <SpecialsBlock calls={calls} />
              </div>
            </PageShell>
          )}
        </>
      )}
    </div>
  );
}
