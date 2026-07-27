// src/components/plays/TemplatePreview.tsx
// A tiny read-only court snapshot for one template — draws whichever
// side's positions the template stores (offense players or defense
// X's) at the same 600x420 coordinate space PlayCanvas uses, just
// scaled down to card size via the SVG viewBox.

import { Formation } from "../../lib/plays";

export default function TemplatePreview({ data, side }: { data: Formation["data"]; side: Formation["side"] }) {
  const isPlayerBased = side !== "defense";
  return (
    <svg viewBox="0 0 600 420" style={{ width: "100%", height: "auto", display: "block", background: "#3a2a17", borderRadius: 8 }}>
      {/* Simplified half-court markings so the snapshot reads as a court, not just floating dots */}
      <rect x="4" y="4" width="592" height="412" fill="none" stroke="#6b5637" strokeWidth="3" />
      <circle cx="300" cy="130" r="55" fill="none" stroke="#6b5637" strokeWidth="3" />
      <rect x="220" y="4" width="160" height="180" fill="none" stroke="#6b5637" strokeWidth="3" />
      <circle cx="300" cy="380" r="10" fill="none" stroke="#6b5637" strokeWidth="3" />

      {isPlayerBased && (data.players ?? []).map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={22} fill="#EF9F27" stroke="#854F0B" strokeWidth={2.5} />
          <text x={p.x} y={p.y + 8} textAnchor="middle" fontSize={22} fontWeight={700} fill="#1a1206">{p.num}</text>
        </g>
      ))}
      {side === "defense" && (data.defenders ?? []).map((d, i) => (
        <g key={i}>
          <line x1={d.x - 15} y1={d.y - 15} x2={d.x + 15} y2={d.y + 15} stroke="#993C1D" strokeWidth={5} strokeLinecap="round" />
          <line x1={d.x - 15} y1={d.y + 15} x2={d.x + 15} y2={d.y - 15} stroke="#993C1D" strokeWidth={5} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}
