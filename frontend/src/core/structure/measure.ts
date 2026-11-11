/** Distances, angles and torsions between picked atoms (Cartesian, angstrom and degrees). */
import { cross, dot, norm, sub, type Vec3 } from '../math/vec3';
import { radToDeg } from '../math/trig';

export const distance = (a: Vec3, b: Vec3): number => norm(sub(a, b));

/** Angle a-b-c at the vertex b, 0 to 180 degrees. NaN when a point coincides with b. */
export function angle(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const nu = norm(u);
  const nv = norm(v);
  if (nu === 0 || nv === 0) return NaN;
  return radToDeg(Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (nu * nv)))));
}

/**
 * Torsion (dihedral) angle a-b-c-d in degrees, -180 to 180 (IUPAC sign: looking from b to c, a
 * positive angle turns the near bond a-b clockwise onto d-c). NaN if three points are collinear.
 */
export function torsion(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b1 = sub(b, a);
  const b2 = sub(c, b);
  const b3 = sub(d, c);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const len2 = norm(b2);
  if (norm(n1) === 0 || norm(n2) === 0 || len2 === 0) return NaN;
  const m1 = cross(n1, [b2[0] / len2, b2[1] / len2, b2[2] / len2]);
  return radToDeg(Math.atan2(dot(m1, n2), dot(n1, n2)));
}

export interface Measurement {
  kind: 'distance' | 'angle' | 'torsion';
  value: number;
  unit: 'Å' | '°';
  /** Where to put the label, Cartesian. */
  anchor: Vec3;
  /** Positions in the picked list that the measurement uses. */
  from: number[];
}

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * What to show for an ordered list of picked positions: 2 atoms give the distance; 3 give the two
 * bond lengths and the angle at the middle atom; 4 give the three lengths and the torsion.
 */
export function measure(points: readonly Vec3[]): Measurement[] {
  const out: Measurement[] = [];
  const n = Math.min(points.length, 4);
  for (let i = 0; i + 1 < n; i++) {
    out.push({
      kind: 'distance',
      value: distance(points[i], points[i + 1]),
      unit: 'Å',
      anchor: mid(points[i], points[i + 1]),
      from: [i, i + 1],
    });
  }
  if (n === 3) {
    out.push({
      kind: 'angle',
      value: angle(points[0], points[1], points[2]),
      unit: '°',
      anchor: points[1],
      from: [0, 1, 2],
    });
  } else if (n === 4) {
    out.push({
      kind: 'torsion',
      value: torsion(points[0], points[1], points[2], points[3]),
      unit: '°',
      anchor: mid(points[1], points[2]),
      from: [0, 1, 2, 3],
    });
  }
  return out;
}
