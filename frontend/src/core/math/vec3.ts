import { radToDeg } from './trig';

export type Vec3 = readonly [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Unit vector, or `null` for the zero vector (callers decide whether that is an error). */
export function normalize(a: Vec3): Vec3 | null {
  const n = norm(a);
  return n === 0 ? null : scale(a, 1 / n);
}

/**
 * Angle between two vectors in degrees, in [0, 180]. Uses atan2(|a x b|, a . b) rather than
 * acos(cos): acos is ill-conditioned near 0 and 180 degrees (one ulp of rounding in the cosine
 * becomes ~1e-6 degrees), which would blur "exactly parallel" for the zone-axis readout.
 * Throws for a zero vector.
 */
export function angleBetween(a: Vec3, b: Vec3): number {
  if (norm(a) === 0 || norm(b) === 0) throw new RangeError('angleBetween: zero-length vector');
  return radToDeg(Math.atan2(norm(cross(a, b)), dot(a, b)));
}
