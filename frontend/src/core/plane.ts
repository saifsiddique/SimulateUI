/**
 * Pure helpers for the 2D views of the Simulation tab (context.md §7.MU step U4): the map between
 * plane coordinates (Å, mrad or 1/Å) and screen pixels with zoom and pan, the scale bar, the scan
 * grid and the detector presets. No DOM.
 *
 * All the planes are drawn the way the specimen is seen down the beam (context.md §7.M3): +y up
 * the screen and +x to the LEFT (`flipX`). The diffraction plane uses the same orientation, so a
 * direction in the pattern and in the real-space view point the same way.
 */

/** The visible part of a plane: its centre (plane units) and the screen pixels per unit. */
export interface PlaneView {
  cu: number;
  cv: number;
  scale: number;
}

export interface Bounds {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Fit `b` into a w x h pixel stage with a margin (fraction of the smaller side) on each side. */
export function fitView(b: Bounds, w: number, h: number, margin = 0.06): PlaneView {
  const du = Math.max(b.u1 - b.u0, 1e-9);
  const dv = Math.max(b.v1 - b.v0, 1e-9);
  const pad = 2 * margin * Math.min(w, h);
  const scale = Math.max(1e-9, Math.min((w - pad) / du, (h - pad) / dv));
  return { cu: (b.u0 + b.u1) / 2, cv: (b.v0 + b.v1) / 2, scale };
}

export interface Stage {
  w: number;
  h: number;
  flipX: boolean;
}

export function toScreen(v: PlaneView, s: Stage, u: number, p: number): { x: number; y: number } {
  const sx = s.flipX ? -1 : 1;
  return { x: s.w / 2 + sx * (u - v.cu) * v.scale, y: s.h / 2 - (p - v.cv) * v.scale };
}

export function fromScreen(v: PlaneView, s: Stage, x: number, y: number): { u: number; v: number } {
  const sx = s.flipX ? -1 : 1;
  return { u: v.cu + (sx * (x - s.w / 2)) / v.scale, v: v.cv - (y - s.h / 2) / v.scale };
}

/** Screen pixel displacement -> plane displacement. */
export function deltaToPlane(v: PlaneView, s: Stage, dx: number, dy: number): [number, number] {
  return [((s.flipX ? -1 : 1) * dx) / v.scale, -dy / v.scale];
}

/** Zoom by `factor` keeping the plane point under the screen pixel (x, y) where it is. */
export function zoomAt(v: PlaneView, s: Stage, x: number, y: number, factor: number): PlaneView {
  const at = fromScreen(v, s, x, y);
  const scale = v.scale * factor;
  const sx = s.flipX ? -1 : 1;
  return {
    scale,
    cu: at.u - (sx * (x - s.w / 2)) / scale,
    cv: at.v + (y - s.h / 2) / scale,
  };
}

/** Pan by a screen displacement (the plane follows the pointer). */
export function panBy(v: PlaneView, s: Stage, dx: number, dy: number): PlaneView {
  const [du, dv] = deltaToPlane(v, s, dx, dy);
  return { ...v, cu: v.cu - du, cv: v.cv - dv };
}

/**
 * A scale bar of a round length (1, 2 or 5 x 10^n) whose length on screen is close to `target`
 * pixels and never more than 1.6 x target.
 */
export function scaleBar(pxPerUnit: number, target = 90): { value: number; px: number } {
  if (!(pxPerUnit > 0)) return { value: 0, px: 0 };
  const raw = target / pxPerUnit;
  const p = 10 ** Math.floor(Math.log10(raw));
  const value = [1, 2, 5, 10]
    .map((m) => m * p)
    .reduce((best, c) => (Math.abs(Math.log(c / raw)) < Math.abs(Math.log(best / raw)) ? c : best));
  return { value, px: value * pxPerUnit };
}

/** A number for a scale bar label: no trailing zeros, at most 3 significant figures. */
export function formatLength(x: number): string {
  if (x === 0) return '0';
  return String(Number(x.toPrecision(3)));
}

/**
 * Scan positions of a rectangle at a step, as abTEM's GridScan places them (the first at the
 * corner, `floor(w / step)` along each side). Above `maxDots` only every k-th position along each
 * side is returned (`stride` = k), so a picture stays cheap; `count` is always the full number.
 */
export function scanGrid(
  fov: { x0: number; y0: number; w: number; h: number },
  step: number,
  maxDots = 2500,
): { points: [number, number][]; count: number; nx: number; ny: number; stride: number } {
  if (!(step > 0)) return { points: [], count: 0, nx: 0, ny: 0, stride: 1 };
  const nx = Math.max(1, Math.floor(fov.w / step));
  const ny = Math.max(1, Math.floor(fov.h / step));
  const count = nx * ny;
  const stride = Math.max(1, Math.ceil(Math.sqrt(count / maxDots)));
  const points: [number, number][] = [];
  for (let i = 0; i < nx; i += stride)
    for (let j = 0; j < ny; j += stride) points.push([fov.x0 + i * step, fov.y0 + j * step]);
  return { points, count, nx, ny, stride };
}

// ---- detectors (STEM) ---------------------------------------------------------------------------

export interface Detector {
  name: string;
  inner: number;
  outer: number;
}

export type DetectorPreset = 'BF' | 'ABF' | 'ADF' | 'HAADF';

/** Usual annular ranges in mrad for a convergence semi-angle α (mrad). */
export function detectorPreset(p: DetectorPreset, alpha: number): Detector {
  switch (p) {
    case 'BF':
      return { name: 'BF', inner: 0, outer: alpha };
    case 'ABF':
      return { name: 'ABF', inner: alpha / 2, outer: alpha };
    case 'ADF':
      return { name: 'ADF', inner: Math.max(alpha + 5, 30), outer: Math.max(alpha + 25, 70) };
    case 'HAADF':
      return { name: 'HAADF', inner: Math.max(2.5 * alpha, 50), outer: 150 };
  }
}

/** Keep 0 <= inner < outer, with a 0.5 mrad gap at least. */
export function clampDetector(d: Detector): Detector {
  const inner = Math.max(0, d.inner);
  return { ...d, inner, outer: Math.max(inner + 0.5, d.outer) };
}
