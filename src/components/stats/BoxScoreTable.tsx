// src/components/stats/BoxScoreTable.tsx
// A sortable player box score table. Shows only the columns whose stats
// are present in the rows — so a player whose coach has hidden turnovers
// simply gets no TO column. Tap a header for what the stat means.
import { useMemo, useState, type CSSProperties } from "react";
import { STAT_BY_KEY, formatStat, type BoxStats } from "../../lib/boxScores";

export interface TableRow {
  key: string;
  label: string;
  sub?: string;
  stats: BoxStats;
  /** Extra coach-only columns (estimated minutes etc.), already formatted. */
  extra?: Record<string, number | null>;
  onClick?: () => void;
}

interface Column {
  id: string;
  label: string;
  /** The stat whose description the header shows. */
  info: string;
  needs: string[];
  value: (s: BoxStats) => number | null;
  text: (s: BoxStats) => string;
  calculated?: boolean;
}

const made = (m: string, a: string): Column => ({
  id: m, label: STAT_BY_KEY.get(m)!.short.replace(/M$/, ""), info: m === "fgm" ? "fg_pct" : m === "fgm3" ? "fg3_pct" : m === "fgm2" ? "fg2_pct" : "ft_pct",
  needs: [m, a], value: (s) => s[m] ?? null, text: (s) => `${formatStat(m, s[m])}-${formatStat(a, s[a])}`,
});
const single = (k: string): Column => ({
  id: k, label: STAT_BY_KEY.get(k)!.short, info: k, needs: [k], value: (s) => s[k] ?? null,
  text: (s) => formatStat(k, s[k]), calculated: STAT_BY_KEY.get(k)!.calculated,
});

export const BOX_COLUMNS: Column[] = [
  single("pts"), { ...made("fgm", "fga"), label: "FG" }, single("fg_pct"), { ...made("fgm3", "fga3"), label: "3P" }, single("fg3_pct"),
  { ...made("ftm", "fta"), label: "FT" }, single("ft_pct"), single("oreb"), single("dreb"), single("reb"), single("ast"),
  single("stl"), single("blk"), single("defl"), single("chg"), single("tov"), single("pf"),
  single("disruptions"), single("impact"), single("ts_pct"), single("efg_pct"), single("pps"), single("ast_to"), single("share"),
];

export interface ExtraColumn { id: string; label: string; description: string; format: (v: number | null) => string }

interface Props {
  rows: TableRow[];
  /** A totals row pinned to the bottom. */
  total?: TableRow;
  extraColumns?: ExtraColumn[];
  emptyText?: string;
  initialSort?: string;
}

const th: CSSProperties = { fontSize: 11, color: "var(--muted)", fontWeight: 700, padding: "7px 6px", textAlign: "right", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" };
const td: CSSProperties = { fontSize: 12, padding: "7px 6px", textAlign: "right", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const calcBg = "rgba(147,180,255,0.07)";

export default function BoxScoreTable({ rows, total, extraColumns = [], emptyText = "No box score yet.", initialSort = "pts" }: Props) {
  const [sort, setSort] = useState<{ id: string; desc: boolean }>({ id: initialSort, desc: true });
  const [info, setInfo] = useState<{ title: string; text: string } | null>(null);

  const present = useMemo(() => {
    const keys = new Set<string>();
    rows.forEach((r) => Object.keys(r.stats).forEach((k) => keys.add(k)));
    return BOX_COLUMNS.filter((c) => c.needs.every((k) => keys.has(k)));
  }, [rows]);

  const sorted = useMemo(() => {
    const col = present.find((c) => c.id === sort.id);
    const ex = extraColumns.find((c) => c.id === sort.id);
    const val = (r: TableRow) => (col ? col.value(r.stats) : ex ? r.extra?.[ex.id] ?? null : null);
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return a.label.localeCompare(b.label);
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  }, [rows, sort, present, extraColumns]);

  if (!rows.length) return <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>{emptyText}</div>;

  const headerClick = (id: string, title: string, text: string) => {
    setSort((s) => ({ id, desc: s.id === id ? !s.desc : true }));
    setInfo({ title, text });
  };
  const arrow = (id: string) => (sort.id === id ? (sort.desc ? " ▾" : " ▴") : "");

  const cells = (r: TableRow, bold = false) => (
    <>
      {present.map((c) => (
        <td key={c.id} style={{ ...td, fontWeight: bold || c.id === "impact" ? 700 : 400, background: c.calculated ? calcBg : undefined }}>{c.text(r.stats)}</td>
      ))}
      {extraColumns.map((c) => (
        <td key={c.id} style={{ ...td, background: calcBg, color: "var(--muted)" }}>{c.format(r.extra?.[c.id] ?? null)}</td>
      ))}
    </>
  );

  return (
    <div>
      {info && (
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ flex: 1, fontSize: 12, lineHeight: 1.55, color: "var(--text)" }}><b>{info.title}.</b> {info.text}</div>
          <button onClick={() => setInfo(null)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 120 + present.length * 52 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", cursor: "default" }}>Player</th>
              {present.map((c) => {
                const def = STAT_BY_KEY.get(c.info)!;
                return <th key={c.id} title={def.description} style={{ ...th, background: c.calculated ? calcBg : undefined }}
                  onClick={() => headerClick(c.id, def.label, def.description)}>{c.label}{arrow(c.id)}</th>;
              })}
              {extraColumns.map((c) => (
                <th key={c.id} title={c.description} style={{ ...th, background: calcBg }} onClick={() => headerClick(c.id, c.label, c.description)}>{c.label}{arrow(c.id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} onClick={r.onClick} style={{ cursor: r.onClick ? "pointer" : undefined }}>
                <td style={{ ...td, textAlign: "left" }}>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  {r.sub && <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.sub}</div>}
                </td>
                {cells(r)}
              </tr>
            ))}
            {total && (
              <tr>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{total.label}</td>
                {cells(total, true)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Shaded columns are worked out by the app. Tap a heading to sort and see what it means.</div>
    </div>
  );
}
