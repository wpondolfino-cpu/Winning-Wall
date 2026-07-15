// src/components/plays/courtGeometry.ts
// Court markings as polylines in the same 600x420 coordinate space used by
// PlayCanvas (2D). Play3DViewer converts these into 3D floor lines. The
// numbers here (arc centers/radii, corner offsets) are intentionally the
// same ones used in PlayCanvas.tsx's courtBackground() — if one changes,
// check the other so the 2D and 3D courts stay the same shape.

import type { CourtTemplate } from "../../lib/plays";

export interface Pt { x: number; y: number }

function arcPoints(cx: number, cy: number, r: number, a1Deg: number, a2Deg: number, n = 24): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (a1Deg + (a2Deg - a1Deg) * t) * (Math.PI / 180);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function circlePoints(cx: number, cy: number, r: number, n = 32): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function rectPoints(x: number, y: number, w: number, h: number): Pt[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
}

function halfCourtLines(): Pt[][] {
  const arc: Pt[] = [
    { x: 45, y: 4 }, { x: 45, y: 150 },
    ...arcPoints(300, -60.9, 331, 140.5, 39.5),
    { x: 555, y: 4 },
  ];
  return [
    rectPoints(4, 4, 592, 412),
    rectPoints(220, 4, 160, 190),
    circlePoints(300, 194, 45),
    arc,
    circlePoints(300, 40, 7),
  ];
}

export function courtLines(template: CourtTemplate): Pt[][] {
  if (template === "full") {
    const leftArc: Pt[] = [
      { x: 4, y: 36 }, { x: 108, y: 36 },
      ...arcPoints(-25.03, 210, 219.03, -52.6, 52.6),
      { x: 108, y: 384 }, { x: 4, y: 384 },
    ];
    const rightArc: Pt[] = leftArc.map((p) => ({ x: 600 - p.x, y: p.y }));
    return [
      rectPoints(4, 4, 592, 412),
      [{ x: 300, y: 4 }, { x: 300, y: 416 }],
      circlePoints(300, 210, 35),
      rectPoints(4, 135, 80, 150),
      circlePoints(84, 210, 45),
      circlePoints(20, 210, 7),
      leftArc,
      rectPoints(516, 135, 80, 150),
      circlePoints(516, 210, 45),
      circlePoints(580, 210, 7),
      rightArc,
    ];
  }
  // half, baseline_oob, and sideline_oob all share the same half-court markings.
  return halfCourtLines();
}

/** Hoop marker position(s) in the same 600x420 space, for placing a 3D rim. */
export function hoopPositions(template: CourtTemplate): Pt[] {
  if (template === "full") return [{ x: 20, y: 210 }, { x: 580, y: 210 }];
  return [{ x: 300, y: 40 }];
}
