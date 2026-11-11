import type { Vec3 } from './vec3';

/** Greatest common divisor of two integers (always >= 0; gcd(0, 0) = 0). */
export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/** Divides integer Miller indices by their common factor: (2,4,6) -> (1,2,3). (0,0,0) is unchanged. */
export function reduceIndices(v: Vec3): Vec3 {
  if (!v.every(Number.isInteger)) throw new RangeError('reduceIndices needs integer indices');
  const g = gcd(gcd(v[0], v[1]), v[2]);
  // `+ 0` turns -0 (from -0 / g) into 0 so results compare equal with toEqual / Object.is.
  return g <= 1 ? v : [v[0] / g + 0, v[1] / g + 0, v[2] / g + 0];
}

/** Flips the sign so that the first non-zero index is positive: (0,-1,2) -> (0,1,-2). */
export function canonicalSign(v: Vec3): Vec3 {
  const first = v.find((x) => x !== 0);
  return first !== undefined && first < 0 ? [-v[0] + 0, -v[1] + 0, -v[2] + 0] : v;
}
