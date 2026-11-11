import { describe, expect, it } from 'vitest';
import { SingularMatrixError } from '../../src/core/errors';
import { canonicalSign, gcd, reduceIndices } from '../../src/core/math/integers';
import {
  det,
  identity,
  inverse,
  mul,
  mulVec,
  transpose,
  type Mat3,
} from '../../src/core/math/mat3';
import { cosDeg, sinDeg } from '../../src/core/math/trig';
import { angleBetween, cross, dot, norm, normalize, type Vec3 } from '../../src/core/math/vec3';

function expectMatrixClose(actual: Mat3, expected: Mat3, digits = 12) {
  actual.forEach((row, i) =>
    row.forEach((v, j) => expect(v, `[${i}][${j}]`).toBeCloseTo(expected[i][j], digits)),
  );
}

describe('trig in degrees', () => {
  it('is exact at the angles crystallography uses (no 6e-17 noise)', () => {
    expect(cosDeg(90)).toBe(0);
    expect(cosDeg(270)).toBe(0);
    expect(cosDeg(-90)).toBe(0);
    expect(cosDeg(0)).toBe(1);
    expect(cosDeg(180)).toBe(-1);
    expect(cosDeg(60)).toBe(0.5);
    expect(cosDeg(120)).toBe(-0.5);
    expect(sinDeg(0)).toBe(0);
    expect(sinDeg(180)).toBe(0);
    expect(sinDeg(90)).toBe(1);
    expect(sinDeg(30)).toBe(0.5);
    expect(sinDeg(-90)).toBe(-1);
  });

  it('falls back to Math.cos / Math.sin elsewhere', () => {
    expect(cosDeg(120.5)).toBeCloseTo(Math.cos((120.5 * Math.PI) / 180), 15);
    expect(sinDeg(120)).toBeCloseTo(Math.sqrt(3) / 2, 15);
    expect(sinDeg(87.7)).toBeCloseTo(Math.sin((87.7 * Math.PI) / 180), 15);
  });
});

describe('integer helpers', () => {
  it('gcd', () => {
    expect(gcd(12, 18)).toBe(6);
    expect(gcd(0, 5)).toBe(5);
    expect(gcd(-4, 6)).toBe(2);
    expect(gcd(0, 0)).toBe(0);
  });

  it('reduceIndices divides by the common factor and leaves coprime / zero triples alone', () => {
    expect(reduceIndices([2, 4, 6])).toEqual([1, 2, 3]);
    expect(reduceIndices([0, -4, 2])).toEqual([0, -2, 1]);
    expect(reduceIndices([3, 0, 0])).toEqual([1, 0, 0]);
    expect(reduceIndices([1, 2, 3])).toEqual([1, 2, 3]);
    expect(reduceIndices([0, 0, 0])).toEqual([0, 0, 0]);
    expect(() => reduceIndices([0.5, 1, 1])).toThrow(RangeError);
  });

  it('never returns negative zero', () => {
    for (const v of [
      reduceIndices([0, -4, 2]),
      canonicalSign([-1, 0, 0]),
      canonicalSign([0, -1, 0]),
    ]) {
      v.forEach((x) => expect(Object.is(x, -0)).toBe(false));
    }
  });

  it('canonicalSign makes the first non-zero index positive', () => {
    expect(canonicalSign([0, -1, 2])).toEqual([0, 1, -2]);
    expect(canonicalSign([-1, 0, 0])).toEqual([1, 0, 0]);
    expect(canonicalSign([1, -2, 3])).toEqual([1, -2, 3]);
    expect(canonicalSign([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('vec3', () => {
  it('cross and dot', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(dot([1, 2, 3], [4, -5, 6])).toBe(12);
    const a: Vec3 = [1.5, -2, 0.3];
    const b: Vec3 = [0.2, 4, -1];
    const c = cross(a, b);
    expect(dot(c, a)).toBeCloseTo(0, 12);
    expect(dot(c, b)).toBeCloseTo(0, 12);
  });

  it('normalize returns null for the zero vector', () => {
    expect(normalize([0, 0, 0])).toBeNull();
    expect(norm(normalize([3, 0, 4])!)).toBeCloseTo(1, 15);
  });

  it('angleBetween is accurate to ~1e-12 degrees near 0 and 180 (atan2, not acos)', () => {
    const v: Vec3 = [0.1, 0.2, 0.3];
    expect(angleBetween(v, [0.3, 0.6, 0.9])).toBeCloseTo(0, 12);
    expect(angleBetween(v, [-0.1, -0.2, -0.3])).toBeCloseTo(180, 12);
    // acos(cos) cannot resolve 1e-4 degrees here: the cosine rounds to exactly 1.
    const tiny = (1e-4 * Math.PI) / 180;
    expect(angleBetween([1, 0, 0], [Math.cos(tiny), Math.sin(tiny), 0])).toBeCloseTo(1e-4, 12);
    expect(angleBetween([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 12);
    expect(() => angleBetween([0, 0, 0], v)).toThrow(RangeError);
  });
});

describe('mat3', () => {
  const m: Mat3 = [
    [2, -1, 0.5],
    [0.3, 4, -2],
    [1, 0, 3],
  ];

  it('determinant, transpose, product', () => {
    expect(det(identity)).toBe(1);
    expect(det(m)).toBeCloseTo(2 * (12 - 0) - -1 * (0.9 - -2) + 0.5 * (0 - 4), 12);
    expect(transpose(transpose(m))).toEqual(m);
    expect(mul(identity, m)).toEqual(m);
    expect(mulVec(m, [1, 2, 3])).toEqual([2 - 2 + 1.5, 0.3 + 8 - 6, 1 + 9]);
  });

  it('inverse satisfies M M^-1 = I', () => {
    expectMatrixClose(mul(m, inverse(m)), identity);
    expectMatrixClose(mul(inverse(m), m), identity);
  });

  it('inverse of a triclinic-like upper-triangular matrix', () => {
    const upper: Mat3 = [
      [8.2, -3.1, -3.2],
      [0, 12.5, 0.9],
      [0, 0, 6.4],
    ];
    expectMatrixClose(mul(upper, inverse(upper)), identity);
  });

  it('throws SingularMatrixError for a singular matrix', () => {
    const singular: Mat3 = [
      [1, 2, 3],
      [2, 4, 6],
      [0, 1, 1],
    ];
    expect(() => inverse(singular)).toThrow(SingularMatrixError);
    expect(() =>
      inverse([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toThrow(SingularMatrixError);
  });
});
