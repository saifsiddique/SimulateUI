import { describe, expect, it } from 'vitest';
import type { Cell } from '../../src/core/crystal';
import { LatticeError } from '../../src/core/errors';
import {
  angleBetweenDirections,
  angleBetweenPlanes,
  angleDirectionToPlaneNormal,
  buildLattice,
  canonicalSign,
  cartToFrac,
  cartesianToNearestHkl,
  cartesianToNearestUvw,
  cellToMatrix,
  directionLength,
  dSpacing,
  fracToCart,
  hklToCart,
  hklToUvw,
  metric,
  reciprocal,
  reduceIndices,
  uvwToCart,
  uvwToHkl,
  volume,
  zoneNumber,
} from '../../src/core/lattice';
import { identity, mul, type Mat3 } from '../../src/core/math/mat3';
import { cross, norm, type Vec3 } from '../../src/core/math/vec3';
import { fixtures, names } from './helpers/fixtures';

function expectMatrixClose(
  actual: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
  digits = 7,
) {
  actual.forEach((row, i) =>
    row.forEach((v, j) => expect(v, `[${i}][${j}]`).toBeCloseTo(expected[i][j], digits)),
  );
}

/** Parallel (or antiparallel) vectors have a zero cross product. */
const expectParallel = (a: Vec3, b: Vec3) =>
  expect(norm(cross(a, b)) / (norm(a) * norm(b))).toBeCloseTo(0, 12);

/** What legacy v6 computed: `Math.sin(gamma)` with gamma in DEGREES (context.md section 6, bug 1). */
function v6Matrix({ a, b, c, alpha, beta, gamma }: Cell): Mat3 {
  const rad = (d: number) => (d * Math.PI) / 180;
  const cx = c * Math.cos(rad(beta));
  const cy =
    (c * (Math.cos(rad(alpha)) - Math.cos(rad(beta)) * Math.cos(rad(gamma)))) / Math.sin(gamma);
  const cz = Math.sqrt(c * c - cx * cx - cy * cy);
  return [
    [a, b * Math.cos(rad(gamma)), cx],
    [0, b * Math.sin(rad(gamma)), cy],
    [0, 0, cz],
  ];
}

describe.each(names)('against the pymatgen fixture: %s', (name) => {
  const f = fixtures[name];
  const lat = buildLattice(f.cell);

  it('M, B, G, G* and the volume match the fixture', () => {
    expectMatrixClose(lat.M, f.matrix_standard);
    expectMatrixClose(lat.B, f.recip_matrix_standard);
    expectMatrixClose(lat.G, f.metric);
    expectMatrixClose(lat.Gstar, f.recip_metric, 8);
    expect(lat.volume).toBeCloseTo(f.volume, 6);
  });

  it('exposes the same results through the primitive functions', () => {
    const M = cellToMatrix(f.cell);
    expect(M).toEqual(lat.M);
    expect(reciprocal(M)).toEqual(lat.B);
    expect(metric(M)).toEqual(lat.G);
    expect(volume(M)).toBe(lat.volume);
  });

  it('puts a along x and b in the xy-plane with exact zeros (context.md 5.2)', () => {
    expect(lat.M[1][0]).toBe(0);
    expect(lat.M[2][0]).toBe(0);
    expect(lat.M[2][1]).toBe(0);
    expect(lat.M[0][0]).toBe(f.cell.a);
    expect(lat.M[2][2]).toBeGreaterThan(0); // right-handed
  });

  it('satisfies a*_i . a_j = delta_ij, M Minv = I and G G* = I', () => {
    expectMatrixClose(mul(lat.M, lat.Minv), identity, 12);
    expectMatrixClose(mul(lat.G, lat.Gstar), identity, 12);
    const BtM = mul(
      [
        [lat.B[0][0], lat.B[1][0], lat.B[2][0]],
        [lat.B[0][1], lat.B[1][1], lat.B[2][1]],
        [lat.B[0][2], lat.B[1][2], lat.B[2][2]],
      ],
      lat.M,
    );
    expectMatrixClose(BtM, identity, 12);
  });

  it('dSpacing matches all 342 reflections', () => {
    for (const [h, k, l, d] of f.reflections.rows) {
      expect(dSpacing(lat, [h, k, l]), `${h} ${k} ${l}`).toBeCloseTo(d, 7);
    }
  });

  it('zoneNumber reproduces the Weiss zone lists exactly', () => {
    for (const [axis, members] of Object.entries(f.zones)) {
      const uvw = axis.split(' ').map(Number) as unknown as Vec3;
      const found = f.reflections.rows
        .filter(([h, k, l]) => zoneNumber(uvw, [h, k, l]) === 0)
        .map(([h, k, l]) => `${h} ${k} ${l}`);
      expect(found, `[${axis}]`).toEqual(members);
    }
  });

  it('fractional <-> Cartesian round trip, and (1,1,1) is a + b + c', () => {
    for (const frac of [
      [0.25, 0.5, 0.75],
      [0, 0, 0],
      [1, 1, 1],
      [-0.3, 1.2, 0.05],
    ] as Vec3[]) {
      const back = cartToFrac(lat, fracToCart(lat, frac));
      back.forEach((x, i) => expect(x).toBeCloseTo(frac[i], 12));
    }
    const corner = fracToCart(lat, [1, 1, 1]);
    corner.forEach((x, i) => expect(x).toBeCloseTo(lat.M[i][0] + lat.M[i][1] + lat.M[i][2], 12));
  });

  it('nearest [uvw] and (hkl) recover every coprime triple up to 6 exactly, with the right sign', () => {
    const queries: Vec3[] = [];
    for (let h = -6; h <= 6; h++) {
      for (let k = -6; k <= 6; k++) {
        for (let l = -6; l <= 6; l++) {
          if (h === 0 && k === 0 && l === 0) continue;
          if (reduceIndices([h, k, l]).some((x, i) => x !== [h, k, l][i])) continue;
          queries.push([h, k, l]);
        }
      }
    }
    expect(queries.length).toBeGreaterThan(1500);
    for (const q of queries) {
      const u = cartesianToNearestUvw(lat, uvwToCart(lat, q), 6);
      expect(u.indices, `uvw ${q}`).toEqual(q);
      expect(u.angleDeg).toBeLessThan(1e-9);
      const p = cartesianToNearestHkl(lat, hklToCart(lat, q), 6);
      expect(p.indices, `hkl ${q}`).toEqual(q);
      expect(p.angleDeg).toBeLessThan(1e-9);
    }
  });

  it('uvwToHkl and hklToUvw are inverse maps up to the metric', () => {
    const uvw: Vec3 = [1, 2, -3];
    const back = hklToUvw(lat, uvwToHkl(lat, uvw));
    back.forEach((x, i) => expect(x).toBeCloseTo(uvw[i], 9));
    expectParallel(uvwToCart(lat, uvw), hklToCart(lat, uvwToHkl(lat, uvw)));
  });
});

describe('known geometry', () => {
  it('cubic Si: classic angles and d(111)', () => {
    const si = buildLattice(fixtures.Si.cell);
    expect(angleBetweenDirections(si, [1, 0, 0], [1, 1, 1])).toBeCloseTo(54.7356103, 6);
    expect(angleBetweenPlanes(si, [1, 0, 0], [1, 1, 0])).toBeCloseTo(45, 10);
    expect(dSpacing(si, [1, 1, 1])).toBeCloseTo(5.4307 / Math.sqrt(3), 9);
    // In a cubic cell every [uvw] is the normal of (uvw).
    expect(angleDirectionToPlaneNormal(si, [1, 2, 3], [1, 2, 3])).toBeCloseTo(0, 9);
  });

  it('hexagonal graphite: [110] IS the normal of (110), but [100] is not the normal of (100)', () => {
    const g = buildLattice(fixtures.graphite.cell);
    expect(angleDirectionToPlaneNormal(g, [1, 1, 0], [1, 1, 0])).toBeCloseTo(0, 6);
    expect(angleDirectionToPlaneNormal(g, [1, 0, 0], [1, 0, 0])).toBeCloseTo(30, 10);
    // The normal of (2 -1 0), i.e. (2 -1 0) in 3-index form, is the direction [100].
    expect(angleDirectionToPlaneNormal(g, [1, 0, 0], [2, -1, 0])).toBeCloseTo(0, 6);
    const hkl = uvwToHkl(g, [1, 0, 0]);
    expect(hkl[1] / hkl[0]).toBeCloseTo(-0.5, 12);
    expect(hkl[2]).toBe(0);
    // Geometry of the rhombic base: gamma = 120 between a and b, |a + b| = a.
    expect(angleBetweenDirections(g, [1, 0, 0], [0, 1, 0])).toBeCloseTo(120, 10);
    expect(directionLength(g, [1, 1, 0])).toBeCloseTo(fixtures.graphite.cell.a, 10);
    expect(dSpacing(g, [1, 0, 0])).toBeCloseTo((fixtures.graphite.cell.a * Math.sqrt(3)) / 2, 10);
  });

  it('monoclinic ZrO2: [100] is tilted from the (100) normal by beta - 90 degrees', () => {
    const z = buildLattice(fixtures.ZrO2_baddeleyite.cell);
    expect(angleDirectionToPlaneNormal(z, [1, 0, 0], [1, 0, 0])).toBeCloseTo(
      fixtures.ZrO2_baddeleyite.cell.beta - 90,
      6,
    );
    // The unique axis b is perpendicular to the ac-plane, so [010] is the normal of (010).
    expect(angleDirectionToPlaneNormal(z, [0, 1, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('legacy v6 formula (sin of a value in degrees) is wrong for triclinic cells only', () => {
    // The bug only enters through c_y = c (cos a - cos b cos g) / sin(g). Cells whose numerator is
    // zero (cubic, tetragonal, hexagonal, monoclinic with unique axis b) are unaffected...
    for (const name of ['graphite', 'ZrO2_baddeleyite', 'rutile', 'Si', 'NaCl']) {
      const correct = buildLattice(fixtures[name].cell).M;
      expectMatrixClose(v6Matrix(fixtures[name].cell), correct, 9);
    }
    // ...but a triclinic cell exposes it. The deviation is ~0.15 angstrom, vastly more than
    // rounding noise (1e-9), so assert "clearly wrong" rather than a specific value.
    const albite = fixtures.albite;
    const legacy = v6Matrix(albite.cell);
    const worst = Math.max(
      ...legacy.flatMap((row, i) => row.map((x, j) => Math.abs(x - albite.matrix_standard[i][j]))),
    );
    expect(worst).toBeGreaterThan(0.05);
    // The new code agrees with pymatgen's independent computation on the same cell.
    expectMatrixClose(buildLattice(albite.cell).M, albite.matrix_standard);
  });
});

describe('nearest-index search', () => {
  const cubic = buildLattice({ a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 });

  it('reports the angular deviation of an inexact direction', () => {
    const r = cartesianToNearestUvw(cubic, [1, 0.02, 0]);
    expect(r.indices).toEqual([1, 0, 0]);
    expect(r.angleDeg).toBeCloseTo((Math.atan(0.02) * 180) / Math.PI, 10);
  });

  it('searches exhaustively and respects maxIndex', () => {
    const v = uvwToCart(cubic, [7, 1, 0]);
    expect(cartesianToNearestUvw(cubic, v, 7).indices).toEqual([7, 1, 0]);
    const limited = cartesianToNearestUvw(cubic, v, 6);
    expect(limited.indices).not.toEqual([7, 1, 0]);
    expect(limited.angleDeg).toBeGreaterThan(0.1);
  });

  it('keeps the sign: the opposite viewing direction gives the opposite indices', () => {
    expect(cartesianToNearestUvw(cubic, [-1, 0, 0]).indices).toEqual([-1, 0, 0]);
    expect(canonicalSign(cartesianToNearestUvw(cubic, [-1, 0, 0]).indices)).toEqual([1, 0, 0]);
  });

  it('returns coprime indices, never multiples', () => {
    expect(cartesianToNearestUvw(cubic, [8, 0, 0]).indices).toEqual([1, 0, 0]);
    expect(cartesianToNearestHkl(cubic, [0, 0, 3]).indices).toEqual([0, 0, 1]);
  });

  it('breaks a genuine tie in favour of the lowest indices', () => {
    // Exactly between [100] and [110] (22.5 degrees from each) with maxIndex = 1.
    const bisector: Vec3 = [1, Math.tan(Math.PI / 8), 0];
    const r = cartesianToNearestUvw(cubic, bisector, 1);
    expect(r.indices).toEqual([1, 0, 0]);
    expect(r.angleDeg).toBeCloseTo(22.5, 10);
  });

  it('is cached per lattice but gives identical answers on repeated calls', () => {
    const a = cartesianToNearestUvw(cubic, [1, 2, 3]);
    const b = cartesianToNearestUvw(cubic, [1, 2, 3]);
    expect(a).toEqual(b);
    expect(a.indices).toEqual([1, 2, 3]);
  });

  it('rejects a zero vector and a bad maxIndex', () => {
    expect(() => cartesianToNearestUvw(cubic, [0, 0, 0])).toThrow(LatticeError);
    expect(() => cartesianToNearestUvw(cubic, [1, 0, 0], 0)).toThrow(RangeError);
    expect(() => cartesianToNearestUvw(cubic, [1, 0, 0], 2.5)).toThrow(RangeError);
  });
});

describe('invalid input', () => {
  const cell: Cell = { a: 5, b: 6, c: 7, alpha: 80, beta: 85, gamma: 95 };

  it('rejects non-physical cells with a LatticeError', () => {
    expect(() => buildLattice({ ...cell, a: 0 })).toThrow(LatticeError);
    expect(() => buildLattice({ ...cell, c: -1 })).toThrow(LatticeError);
    expect(() => buildLattice({ ...cell, alpha: 0 })).toThrow(LatticeError);
    expect(() => buildLattice({ ...cell, beta: 180 })).toThrow(LatticeError);
    expect(() => buildLattice({ ...cell, gamma: Number.NaN })).toThrow(LatticeError);
    // Three 150-degree angles cannot close a parallelepiped (sum > 360).
    expect(() => buildLattice({ ...cell, alpha: 150, beta: 150, gamma: 150 })).toThrow(
      LatticeError,
    );
    // Coplanar a, b, c (alpha + beta = gamma, or |alpha - beta| = gamma) have zero volume.
    expect(() => buildLattice({ ...cell, alpha: 40, beta: 50, gamma: 90 })).toThrow(LatticeError);
    expect(() => buildLattice({ ...cell, alpha: 40, beta: 50, gamma: 10 })).toThrow(LatticeError);
    // Just inside the triangle inequality the cell is valid again.
    expect(() => buildLattice({ ...cell, alpha: 40, beta: 50, gamma: 60 })).not.toThrow();
  });

  it('dSpacing is undefined for (0,0,0)', () => {
    expect(() => dSpacing(buildLattice(cell), [0, 0, 0])).toThrow(RangeError);
  });
});
