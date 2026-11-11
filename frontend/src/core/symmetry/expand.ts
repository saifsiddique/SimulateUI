/**
 * Expanding asymmetric-unit atoms to the full unit cell, with periodic de-duplication.
 *
 * Images of one atom that land on the same spot (an atom on a special position is generated once
 * per symmetry operation that fixes it) are merged. Two *different* atoms that land on the same
 * spot are kept, since that is how a mixed-occupancy site is written, and reported as an overlap.
 */
import type { Lattice } from '../lattice';
import { fracToCart } from '../lattice';
import { norm, type Vec3 } from '../math/vec3';
import { applyOp, type SymOp } from './symop';

/** Positions closer than this (angstrom, minimum image) are the same position. */
export const SAME_POSITION_TOLERANCE = 0.01;

/** Reduce fractional coordinates to [0, 1), treating 0.9999995 as 0 and never returning -0. */
export function wrapFrac(f: Vec3): Vec3 {
  const w = (x: number): number => Math.max(0, x - Math.floor(x + 1e-6)) + 0;
  return [w(f[0]), w(f[1]), w(f[2])];
}

/** Minimum-image distance in angstrom between two fractional positions. */
export function periodicDistance(lat: Lattice, a: Vec3, b: Vec3): number {
  const d: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return norm(
    fracToCart(lat, [d[0] - Math.round(d[0]), d[1] - Math.round(d[1]), d[2] - Math.round(d[2])]),
  );
}

/** Spatial hash over the unit cell with periodic wrap, for near-neighbour queries. */
export class PeriodicIndex {
  private readonly bins: [number, number, number];
  private readonly cells = new Map<number, number[]>();
  readonly points: Vec3[] = [];

  constructor(
    private readonly lat: Lattice,
    private readonly tolerance = SAME_POSITION_TOLERANCE,
  ) {
    // Cell heights (perpendicular plane spacings) divided into bins of at least 0.5 angstrom, so a
    // neighbour within `tolerance` always sits in the same or an adjacent bin.
    const heights = [0, 1, 2].map((i) => 1 / norm([lat.B[0][i], lat.B[1][i], lat.B[2][i]]));
    this.bins = heights.map((h) => Math.min(64, Math.max(1, Math.floor(h / 0.5)))) as [
      number,
      number,
      number,
    ];
  }

  private binOf(f: Vec3): [number, number, number] {
    return f.map((x, i) => Math.min(this.bins[i] - 1, Math.floor(x * this.bins[i]))) as [
      number,
      number,
      number,
    ];
  }

  private key(i: number, j: number, k: number): number {
    return (i * this.bins[1] + j) * this.bins[2] + k;
  }

  /** Indices of stored points within the tolerance of `f` (which must be wrapped). */
  near(f: Vec3): number[] {
    const [bi, bj, bk] = this.binOf(f);
    const found: number[] = [];
    const seen = new Set<number>();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          const key = this.key(
            (bi + di + this.bins[0]) % this.bins[0],
            (bj + dj + this.bins[1]) % this.bins[1],
            (bk + dk + this.bins[2]) % this.bins[2],
          );
          if (seen.has(key)) continue;
          seen.add(key);
          for (const idx of this.cells.get(key) ?? []) {
            if (periodicDistance(this.lat, f, this.points[idx]) < this.tolerance) found.push(idx);
          }
        }
      }
    }
    return found;
  }

  add(f: Vec3): number {
    const idx = this.points.length;
    this.points.push(f);
    const [i, j, k] = this.binOf(f);
    const key = this.key(i, j, k);
    const list = this.cells.get(key);
    if (list) list.push(idx);
    else this.cells.set(key, [idx]);
    return idx;
  }
}

/** All distinct images of `frac` under `ops`, wrapped into the cell. */
export function orbit(lat: Lattice, ops: readonly SymOp[], frac: Vec3): Vec3[] {
  const index = new PeriodicIndex(lat);
  for (const op of ops) {
    const f = wrapFrac(applyOp(op, frac));
    if (index.near(f).length === 0) index.add(f);
  }
  return index.points;
}
