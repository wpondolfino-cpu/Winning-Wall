// src/components/NavReorderModal.tsx
// Lets a coach/admin drag their sidebar nav items into whatever order
// they like, AND drag items freely between the IN-SEASON, OFFSEASON,
// and always-visible zones to re-categorize them. Native HTML5
// drag-and-drop, no extra library.

import { useState } from "react";
import { supabase } from "../lib/supabase";

export type NavSection = "inseason" | "offseason" | "always";

export interface NavItemConfig {
  key: string;
  icon: string;
  label: string;
  section: NavSection; // default/starting section — can be overridden per-user
}

interface Props {
  userId: string;
  items: NavItemConfig[]; // full config, each already carrying its CURRENT (possibly overridden) section
  onSaved: (newOrder: string[], newSections: Record<string, NavSection>) => void;
  onClose: () => void;
}

const ZONE_LABELS: Record<NavSection, string> = {
  inseason: "IN-SEASON",
  offseason: "OFFSEASON",
  always: "ALWAYS VISIBLE",
};

function groupBySection(items: NavItemConfig[]): Record<NavSection, NavItemConfig[]> {
  return {
    inseason: items.filter(i => i.section === "inseason"),
    offseason: items.filter(i => i.section === "offseason"),
    always: items.filter(i => i.section === "always"),
  };
}

export default function NavReorderModal({ userId, items, onSaved, onClose }: Props) {
  const [zones, setZones] = useState<Record<NavSection, NavItemConfig[]>>(() => groupBySection(items));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function findDragItem(): { section: NavSection; index: number; item: NavItemConfig } | null {
    if (!dragKey) return null;
    for (const section of ["inseason", "offseason", "always"] as NavSection[]) {
      const index = zones[section].findIndex(i => i.key === dragKey);
      if (index !== -1) return { section, index, item: zones[section][index] };
    }
    return null;
  }

  function moveDragItemTo(targetSection: NavSection, targetIndex: number) {
    const found = findDragItem();
    if (!found) return;
    if (found.section === targetSection && found.index === targetIndex) return;

    setZones(prev => {
      const next: Record<NavSection, NavItemConfig[]> = {
        inseason: [...prev.inseason], offseason: [...prev.offseason], always: [...prev.always],
      };
      next[found.section].splice(found.index, 1);
      const updatedItem = { ...found.item, section: targetSection };
      const insertAt = found.section === targetSection && found.index < targetIndex ? targetIndex - 1 : targetIndex;
      next[targetSection].splice(Math.max(0, insertAt), 0, updatedItem);
      return next;
    });
  }

  function handleDragOverItem(section: NavSection, index: number, e: React.DragEvent) {
    e.preventDefault();
    moveDragItemTo(section, index);
  }

  function handleDragOverZoneEnd(section: NavSection, e: React.DragEvent) {
    e.preventDefault();
    moveDragItemTo(section, zones[section].length);
  }

  async function handleSave() {
    setSaving(true);
    const order = [...zones.inseason, ...zones.offseason, ...zones.always].map(i => i.key);
    const sections: Record<string, NavSection> = {};
    (["inseason", "offseason", "always"] as NavSection[]).forEach(sec => {
      zones[sec].forEach(i => { sections[i.key] = sec; });
    });
    try {
      await supabase.from("profiles").update({ nav_order: order, nav_sections: sections }).eq("id", userId);
      onSaved(order, sections);
      onClose();
    } catch (e) {
      console.error("Failed to save nav layout:", e);
      alert("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  function Zone({ section }: { section: NavSection }) {
    const list = zones[section];
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: 0.5, marginBottom: 6 }}>{ZONE_LABELS[section]}</div>
        <div
          onDragOver={(e) => handleDragOverZoneEnd(section, e)}
          style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 40, background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: list.length === 0 ? 10 : 0 }}
        >
          {list.map((item, i) => (
            <div
              key={item.key}
              draggable
              onDragStart={() => setDragKey(item.key)}
              onDragOver={(e) => handleDragOverItem(section, i, e)}
              onDragEnd={() => setDragKey(null)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: dragKey === item.key ? "var(--royal)" : "var(--surface2)",
                border: "1px solid var(--border)", borderRadius: 10,
                padding: "9px 12px", cursor: "grab", userSelect: "none",
                transition: "background 0.15s",
              }}
            >
              <span style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1 }}>☰</span>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: dragKey === item.key ? "#fff" : "var(--text)" }}>{item.label}</span>
            </div>
          ))}
          {list.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>Drag an item here</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 3001, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, pointerEvents: "none" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, width: "min(420px, 94vw)", maxHeight: "88vh", overflowY: "auto", padding: "22px 20px", pointerEvents: "all" }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: "var(--text)", letterSpacing: 1, marginBottom: 4 }}>🔀 Customize Sidebar</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>Drag items to reorder — drag across sections to move an item between IN-SEASON, OFFSEASON, or always-visible.</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Zone section="inseason" />
            <Zone section="offseason" />
            <Zone section="always" />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button onClick={onClose} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 10, padding: "10px", color: "var(--muted)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, background: "var(--royal)", border: "none", borderRadius: 10, padding: "10px", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Saving…" : "Save Layout"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
