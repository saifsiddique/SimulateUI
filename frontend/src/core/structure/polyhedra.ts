/**
 * Coordination polyhedra (context.md M6 task 3): for each atom of a chosen centre element, the
 * convex hull of its bonded neighbours, as triangles for the faces and segments for the edges.
 */
import type { Vec3 } from '../math/vec3';
import { cross, dot, norm, sub } from '../math/vec3';
import type { BondGraph } from './graph';
import type { Appearance } from './styles';
import type { StructureModel } from './model';

/** Neighbour counts above this are not hulled (the brute-force hull is O(n^4)). */
export const MAX_VERTICES = 32;
export const MAX_POLYHEDRA = 20_000;
const PLANE_TOLERANCE = 1e-4;

/**
 * Faces of the convex hull of `points`, each as a loop of point indices that runs
 * counter-clockwise seen from outside, so the outward normal is (p1 - p0) x (p2 - p0). Coplanar
 * points make one polygonal face (a cube face is one square, not two triangles). Fewer than
 * three points give no faces; points that all lie in one plane give that single polygon.
 */
export function convexHullFaces(points: readonly Vec3[]): number[][] {
  const n = points.length;
  const faces: number[][] = [];
  if (n < 3) return faces;
  const seen = new Set<string>();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const normal = cross(sub(points[j], points[i]), sub(points[k], points[i]));
        const len = norm(normal);
        if (len < 1e-9) continue;
        let above = 0;
        let below = 0;
        const on: number[] = [];
        for (let m = 0; m < n; m++) {
          const d = dot(normal, sub(points[m], points[i])) / len;
          if (d > PLANE_TOLERANCE) above++;
          else if (d < -PLANE_TOLERANCE) below++;
          else on.push(m);
          if (above > 0 && below > 0) break;
        }
        if (above > 0 && below > 0) continue; // points on both sides: not a hull face
        const key = on.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        // Outward normal points away from the points that are off the plane.
        const out: Vec3 =
          above > 0
            ? [-normal[0] / len, -normal[1] / len, -normal[2] / len]
            : [normal[0] / len, normal[1] / len, normal[2] / len];
        faces.push(orderCounterClockwise(points, on, out));
      }
  return faces;
}

function orderCounterClockwise(points: readonly Vec3[], idx: number[], normal: Vec3): number[] {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of idx) {
    cx += points[i][0];
    cy += points[i][1];
    cz += points[i][2];
  }
  const c: Vec3 = [cx / idx.length, cy / idx.length, cz / idx.length];
  const u0 = sub(points[idx[0]], c);
  const lu = norm(u0) || 1;
  const u: Vec3 = [u0[0] / lu, u0[1] / lu, u0[2] / lu];
  const v = cross(normal, u);
  return idx
    .map((i) => {
      const r = sub(points[i], c);
      return { i, angle: Math.atan2(dot(r, v), dot(r, u)) };
    })
    .sort((a, b) => a.angle - b.angle)
    .map((e) => e.i);
}

export interface PolyhedraGeometry {
  /** Number of polyhedra drawn. */
  count: number;
  /** Centres skipped because some bonded neighbour is not shown, or the cap was reached. */
  skipped: number;
  /** Triangle vertices, 9 numbers per triangle, Cartesian angstrom, outward-facing. */
  triangles: Float32Array;
  /** sRGB, 9 bytes per triangle (the centre atom's colour at each vertex). */
  triangleColor: Uint8Array;
  /** Edge segments, 6 numbers per edge. */
  edges: Float32Array;
  /** sRGB, 6 bytes per edge: the centre colour, darkened. */
  edgeColor: Uint8Array;
}

export const EMPTY_POLYHEDRA: PolyhedraGeometry = {
  count: 0,
  skipped: 0,
  triangles: new Float32Array(0),
  triangleColor: new Uint8Array(0),
  edges: new Float32Array(0),
  edgeColor: new Uint8Array(0),
};

/**
 * Polyhedra around the shown atoms of the `centres` elements. A polyhedron is drawn only when
 * all the centre's bonded neighbours (as the bond graph of the whole crystal counts them) are
 * shown, so an atom cut by the edge of the range gets none unless "search bonds beyond the range"
 * brings its neighbours in. Bonds hidden by their rule still count: polyhedra are often drawn
 * instead of bonds.
 */
export function buildPolyhedra(
  model: StructureModel,
  appearance: Appearance,
  graph: BondGraph,
  centres: readonly string[],
): PolyhedraGeometry {
  if (centres.length === 0 || model.bonds.length === 0) return EMPTY_POLYHEDRA;
  const n = model.count;
  // Adjacency (CSR) from the displayed bonds.
  const degree = new Uint32Array(n + 1);
  for (let b = 0; b < model.bonds.length; b++) degree[model.bonds[b] + 1]++;
  for (let i = 0; i < n; i++) degree[i + 1] += degree[i];
  const fill = degree.slice(0, n);
  const adj = new Uint32Array(model.bonds.length);
  for (let b = 0; b < model.bonds.length; b += 2) {
    const i = model.bonds[b];
    const j = model.bonds[b + 1];
    adj[fill[i]++] = j;
    adj[fill[j]++] = i;
  }

  const wanted = new Set(centres);
  const tri: number[] = [];
  const triColor: number[] = [];
  const edge: number[] = [];
  const edgeColor: number[] = [];
  let count = 0;
  let skipped = 0;
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    if (!wanted.has(model.elements[model.species[i]]) || !appearance.atomVisible[i]) continue;
    const a = model.placed.atom[i];
    const full = graph.start[a + 1] - graph.start[a];
    const have = degree[i + 1] - degree[i];
    if (have < 3 || have > MAX_VERTICES || have !== full) {
      skipped++;
      continue;
    }
    if (count >= MAX_POLYHEDRA) {
      skipped++;
      continue;
    }
    pts.length = 0;
    for (let q = degree[i]; q < degree[i + 1]; q++) {
      const j = adj[q];
      pts.push([model.cart[3 * j], model.cart[3 * j + 1], model.cart[3 * j + 2]]);
    }
    const faces = convexHullFaces(pts);
    if (faces.length === 0) {
      skipped++;
      continue;
    }
    count++;
    const r = appearance.atomColor[3 * i];
    const g = appearance.atomColor[3 * i + 1];
    const bl = appearance.atomColor[3 * i + 2];
    const done = new Set<number>();
    for (const f of faces) {
      for (let t = 1; t + 1 < f.length; t++) {
        for (const v of [f[0], f[t], f[t + 1]]) {
          tri.push(pts[v][0], pts[v][1], pts[v][2]);
          triColor.push(r, g, bl);
        }
      }
      for (let t = 0; t < f.length; t++) {
        const p = f[t];
        const q = f[(t + 1) % f.length];
        const key = Math.min(p, q) * 64 + Math.max(p, q);
        if (done.has(key)) continue;
        done.add(key);
        edge.push(pts[p][0], pts[p][1], pts[p][2], pts[q][0], pts[q][1], pts[q][2]);
        for (let e = 0; e < 2; e++) edgeColor.push(r * 0.55, g * 0.55, bl * 0.55);
      }
    }
  }
  return {
    count,
    skipped,
    triangles: Float32Array.from(tri),
    triangleColor: Uint8Array.from(triColor),
    edges: Float32Array.from(edge),
    edgeColor: Uint8Array.from(edgeColor),
  };
}
