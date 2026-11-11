/**
 * Pure helpers for the specimen step (context.md M3): overlay geometry for the crystal view, the
 * scan field of view and the mapping between the specimen frame and screen pixels. No DOM.
 */
import type { Vec3 } from './math/vec3';

/** Box corners as the backend lists them: index = 4 cx + 2 cy + cz (cx, cy, cz in {0, 1}). */
const EDGES: [number, number][] = [
  [0, 4],
  [2, 6],
  [1, 5],
  [3, 7], // along x
  [0, 2],
  [4, 6],
  [1, 3],
  [5, 7], // along y
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7], // along z
];

/** The 12 edges of the specimen box as line-segment pairs (crystal Cartesian frame). */
export function boxEdges(corners: readonly Vec3[]): Float32Array {
  if (corners.length !== 8) throw new Error('A box has 8 corners.');
  const out = new Float32Array(EDGES.length * 6);
  EDGES.forEach(([a, b], i) => {
    out.set(corners[a], 6 * i);
    out.set(corners[b], 6 * i + 3);
  });
  return out;
}

/**
 * A beam arrow along `beam` (unit) through `centre`: a shaft from `length` before the centre to
 * `length` after it, and a four-line head at the exit end.
 */
export function beamArrow(centre: Vec3, beam: Vec3, length: number): Float32Array {
  const n = Math.hypot(...beam);
  const b: Vec3 = [beam[0] / n, beam[1] / n, beam[2] / n];
  const at = (s: number): Vec3 => [
    centre[0] + s * b[0],
    centre[1] + s * b[1],
    centre[2] + s * b[2],
  ];
  const start = at(-length);
  const tip = at(length);
  // two directions perpendicular to the beam for the head
  const t: Vec3 = Math.abs(b[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const p1 = normalize(cross(b, t));
  const p2 = cross(b, p1);
  const head = 0.12 * length;
  const back = at(length - 2 * head);
  const segs: number[] = [...start, ...tip];
  for (const p of [p1, p2]) {
    for (const s of [1, -1]) {
      segs.push(
        ...tip,
        back[0] + s * head * p[0],
        back[1] + s * head * p[1],
        back[2] + s * head * p[2],
      );
    }
  }
  return new Float32Array(segs);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
}

export function concatSegments(...parts: (Float32Array | null)[]): Float32Array {
  const len = parts.reduce((s, p) => s + (p ? p.length : 0), 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) {
    if (!p) continue;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The periodic cell and the beam, drawn on the crystal in its own frame. */
export function crystalOverlay(r: {
  box_corners_crystal: number[][];
  repeats: number[];
  centre_point_crystal: number[];
  repeat_cell: number[];
  beam_crystal: number[];
}): Float32Array {
  const c = r.box_corners_crystal;
  const [nx, ny, nz] = r.repeats;
  const centre: Vec3 = [
    r.centre_point_crystal[0],
    r.centre_point_crystal[1],
    r.centre_point_crystal[2],
  ];
  const beam: Vec3 = [r.beam_crystal[0], r.beam_crystal[1], r.beam_crystal[2]];
  const edge = (to: number[], n: number): Vec3 => [
    (to[0] - c[0][0]) / n,
    (to[1] - c[0][1]) / n,
    (to[2] - c[0][2]) / n,
  ];
  const ex = edge(c[4], nx);
  const ey = edge(c[2], ny);
  const ez = edge(c[1], nz);
  const corners: Vec3[] = [];
  const at = (i: number, j: number, k: number, d: number) =>
    centre[d] + i * ex[d] + j * ey[d] + k * ez[d];
  for (const i of [-0.5, 0.5])
    for (const j of [-0.5, 0.5])
      for (const k of [-0.5, 0.5]) corners.push([at(i, j, k, 0), at(i, j, k, 1), at(i, j, k, 2)]);
  return concatSegments(boxEdges(corners), beamArrow(centre, beam, 1.5 * r.repeat_cell[2] + 4));
}

// ---- scan field of view (specimen frame, angstrom) ---------------------------------------------

export interface Fov {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export const MIN_FOV = 0.5;

/** Keep the rectangle inside the box [0, Lx] x [0, Ly] with at least MIN_FOV per side. */
export function clampFov(f: Fov, box: [number, number]): Fov {
  const w = Math.min(Math.max(f.w, MIN_FOV), box[0]);
  const h = Math.min(Math.max(f.h, MIN_FOV), box[1]);
  const x0 = Math.min(Math.max(f.x0, 0), box[0] - w);
  const y0 = Math.min(Math.max(f.y0, 0), box[1] - h);
  return { x0, y0, w, h };
}

export type FovPreset = 'whole' | 'centre50' | 'repeat';

export function fovPreset(p: FovPreset, box: [number, number], repeat: [number, number]): Fov {
  if (p === 'whole') return { x0: 0, y0: 0, w: box[0], h: box[1] };
  if (p === 'centre50') return { x0: box[0] / 4, y0: box[1] / 4, w: box[0] / 2, h: box[1] / 2 };
  const w = Math.min(repeat[0], box[0]);
  const h = Math.min(repeat[1], box[1]);
  return { x0: (box[0] - w) / 2, y0: (box[1] - h) / 2, w, h };
}

/**
 * A window of `n` whole repeat cells in each direction (at most as many as fit in the box), placed
 * on a cell origin (the box starts at one) as close to the centre as possible. Its width is a whole
 * number of cells, so the scanned image tiles into a larger one without a seam.
 */
export function fovCells(
  box: [number, number],
  repeat: [number, number],
  n: [number, number],
): Fov {
  const fit = (L: number, a: number, k: number) => {
    const m = Math.max(1, Math.min(Math.floor(k), Math.floor(L / a + 1e-6)));
    const w = m * a;
    const x0 = Math.max(0, Math.min(Math.round((L - w) / 2 / a) * a, L - w));
    return [x0, w] as const;
  };
  const [x0, w] = fit(box[0], repeat[0], n[0]);
  const [y0, h] = fit(box[1], repeat[1], n[1]);
  return { x0, y0, w, h };
}

/** Smallest distance from the scan area to the box edge (periodic images start there). */
export function fovMargin(f: Fov, box: [number, number]): number {
  return Math.min(f.x0, f.y0, box[0] - f.x0 - f.w, box[1] - f.y0 - f.h);
}

/** Drag operations on the rectangle: move it, or move one edge/corner. */
export type FovHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function dragFov(
  start: Fov,
  handle: FovHandle,
  dx: number,
  dy: number,
  box: [number, number],
): Fov {
  if (handle === 'move') return clampFov({ ...start, x0: start.x0 + dx, y0: start.y0 + dy }, box);
  let { x0, y0, w, h } = start;
  if (handle.includes('e')) w = start.w + dx;
  if (handle.includes('w')) {
    x0 = start.x0 + dx;
    w = start.w - dx;
  }
  if (handle.includes('n')) h = start.h + dy; // +y is up in the specimen frame
  if (handle.includes('s')) {
    y0 = start.y0 + dy;
    h = start.h - dy;
  }
  if (w < MIN_FOV) {
    if (handle.includes('w')) x0 = start.x0 + start.w - MIN_FOV;
    w = MIN_FOV;
  }
  if (h < MIN_FOV) {
    if (handle.includes('s')) y0 = start.y0 + start.h - MIN_FOV;
    h = MIN_FOV;
  }
  return clampFov({ x0, y0, w, h }, box);
}

// ---- screen mapping ------------------------------------------------------------------------------

/** Affine map specimen (x, y) -> screen (px, py) from the projections of three points. */
export interface Affine2 {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function affineFrom(
  o: { x: number; y: number },
  ex: { x: number; y: number },
  ey: { x: number; y: number },
): Affine2 {
  // screen = o + x (ex - o) + y (ey - o)
  return { a: ex.x - o.x, b: ey.x - o.x, c: ex.y - o.y, d: ey.y - o.y, e: o.x, f: o.y };
}

export const applyAffine = (m: Affine2, x: number, y: number) => ({
  x: m.a * x + m.b * y + m.e,
  y: m.c * x + m.d * y + m.f,
});

/** Screen pixel displacement -> specimen displacement (inverse of the linear part). */
export function screenDeltaToSpecimen(m: Affine2, dpx: number, dpy: number): [number, number] {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return [0, 0];
  return [(m.d * dpx - m.b * dpy) / det, (-m.c * dpx + m.a * dpy) / det];
}
