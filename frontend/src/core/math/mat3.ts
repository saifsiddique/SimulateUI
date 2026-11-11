import { SingularMatrixError } from '../errors';
import type { Vec3 } from './vec3';

/** Row-major 3x3 matrix: `m[row][col]`. */
export type Mat3 = readonly [Vec3, Vec3, Vec3];

export const identity: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const transpose = (m: Mat3): Mat3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const entry = (i: 0 | 1 | 2, j: 0 | 1 | 2) =>
    a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return [
    [entry(0, 0), entry(0, 1), entry(0, 2)],
    [entry(1, 0), entry(1, 1), entry(1, 2)],
    [entry(2, 0), entry(2, 1), entry(2, 2)],
  ];
}

export function det(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/**
 * Inverse by the adjugate. Throws `SingularMatrixError` when the determinant is negligible
 * relative to the size of the entries.
 */
export function inverse(m: Mat3): Mat3 {
  const d = det(m);
  const biggest = Math.max(...m.flat().map(Math.abs));
  if (!Number.isFinite(d) || Math.abs(d) <= 1e-12 * biggest ** 3) {
    throw new SingularMatrixError('Cannot invert a singular 3x3 matrix.');
  }
  const k = 1 / d;
  return [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * k,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * k,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * k,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * k,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * k,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * k,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * k,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * k,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * k,
    ],
  ];
}
