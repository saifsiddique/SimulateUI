// Integrity checks on the pymatgen-generated fixtures (scripts/make_fixtures.py). These guard the
// safety net itself: later modules compare their output against these files, so the files must be
// internally consistent, tied to their CIFs, and obey the frame conventions of context.md 5.2.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/core/meta';
import { fixtureDir as dir, fixtures, names } from './helpers/fixtures';

type Mat3 = number[][];

const mul = (a: Mat3, b: Mat3): Mat3 =>
  a.map((_, i) => b[0].map((_, j) => a[i].reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
const transpose = (a: Mat3): Mat3 => a[0].map((_, j) => a.map((row) => row[j]));
const rad = (deg: number) => (deg * Math.PI) / 180;

function expectMatrixClose(actual: Mat3, expected: Mat3, digits = 6) {
  actual.forEach((row, i) =>
    row.forEach((v, j) => expect(v, `[${i}][${j}]`).toBeCloseTo(expected[i][j], digits)),
  );
}

describe('fixture set', () => {
  it('covers the seven required structures', () => {
    expect(names).toEqual(
      ['NaCl', 'Si', 'ZrO2_baddeleyite', 'albite', 'graphite', 'olivine_partial', 'rutile'].sort(),
    );
    expect(APP_NAME).toBe('SimulateUI');
  });

  it('has a CIF for every fixture, unchanged since generation', () => {
    for (const f of Object.values(fixtures)) {
      const bytes = readFileSync(`${dir}${f.source.cif}`);
      expect(createHash('sha256').update(bytes).digest('hex'), f.name).toBe(f.source.sha256);
    }
  });

  it('matches the expected unit-cell content (context.md M3 acceptance)', () => {
    const sites = (n: string) => fixtures[n].unit_cell.n_sites;
    expect([sites('Si'), sites('NaCl'), sites('rutile'), sites('graphite')]).toEqual([8, 8, 6, 4]);
    expect(sites('ZrO2_baddeleyite')).toBe(12);
    expect(sites('albite')).toBe(52);
    expect(fixtures.olivine_partial.unit_cell.counts).toMatchObject({ Mg: 4, Fe: 4, Si: 4, O: 16 });
  });

  it('records the detected space-group number, agreeing with the CIF', () => {
    const numbers = names.map((n) => fixtures[n].space_group.detected_number);
    expect(numbers).toEqual([225, 227, 14, 2, 194, 62, 136]); // NaCl Si ZrO2 albite graphite olivine rutile
    for (const f of Object.values(fixtures)) {
      expect(f.space_group.declared_number, f.name).toBe(f.space_group.detected_number);
    }
  });
});

describe.each(names)('lattice invariants: %s', (name) => {
  const f = fixtures[name];

  it('volume equals sqrt(det G) and the closed-form cell volume', () => {
    const { a, b, c, alpha, beta, gamma } = f.cell;
    const [ca, cb, cg] = [alpha, beta, gamma].map((t) => Math.cos(rad(t)));
    const closedForm = a * b * c * Math.sqrt(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg);
    expect(closedForm).toBeCloseTo(f.volume, 6);

    const [[a1, a2, a3], [b1, b2, b3], [c1, c2, c3]] = f.metric;
    const det = a1 * (b2 * c3 - b3 * c2) - a2 * (b1 * c3 - b3 * c1) + a3 * (b1 * c2 - b2 * c1);
    expect(Math.sqrt(det)).toBeCloseTo(f.volume, 6);
  });

  it('standard-frame matrix has a || x and b in the xy-plane, and reproduces the metric', () => {
    const m = f.matrix_standard; // columns are a, b, c
    expect(m[1][0]).toBe(0);
    expect(m[2][0]).toBe(0);
    expect(m[2][1]).toBe(0);
    expect(m[0][0]).toBeCloseTo(f.cell.a, 9);
    expectMatrixClose(mul(transpose(m), m), f.metric);
  });

  it('reciprocal matrix satisfies a*_i . a_j = delta_ij and G* = inv(G)', () => {
    expectMatrixClose(mul(transpose(f.recip_matrix_standard), f.matrix_standard), [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expectMatrixClose(mul(f.metric, f.recip_metric), [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('d-spacings from the reciprocal metric match pymatgen for all 342 reflections', () => {
    expect(f.reflections.rows).toHaveLength(7 ** 3 - 1);
    for (const [h, k, l, d] of f.reflections.rows) {
      const v = [h, k, l];
      const q = v.reduce(
        (s, vi, i) => s + vi * v.reduce((t, vj, j) => t + f.recip_metric[i][j] * vj, 0),
        0,
      );
      expect(1 / Math.sqrt(q), `${h} ${k} ${l}`).toBeCloseTo(d, 7);
    }
  });

  it('zone lists are exactly the reflections satisfying hu + kv + lw = 0', () => {
    for (const [axis, members] of Object.entries(f.zones)) {
      const [u, v, w] = axis.split(' ').map(Number);
      const expected = f.reflections.rows
        .filter(([h, k, l]) => h * u + k * v + l * w === 0)
        .map(([h, k, l]) => `${h} ${k} ${l}`);
      expect(members, `[${axis}]`).toEqual(expected);
    }
  });

  it('TEM spots are exactly the zero-order Laue zone, with d matching the reflection table', () => {
    for (const [axis, spots] of Object.entries(f.tem.zones)) {
      const [u, v, w] = axis.split(' ').map(Number);
      const keys = spots.map(([h, k, l]) => `${h} ${k} ${l}`);
      const zone = f.zones[axis].filter((key) => key !== '0 0 0');
      expect([...keys].sort(), `[${axis}]`).toEqual([...zone].sort());
      for (const [h, k, l, d, intensity] of spots) {
        expect(h * u + k * v + l * w).toBe(0);
        const reference = f.reflections.rows.find((r) => r[0] === h && r[1] === k && r[2] === l)!;
        expect(d, `${h} ${k} ${l}`).toBeCloseTo(reference[3], 6);
        expect(intensity).toBeGreaterThanOrEqual(0);
        expect(intensity).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('powder peaks are sorted, in range, and obey Bragg’s law', () => {
    const { peaks, wavelength, two_theta_range: range } = f.pxrd;
    expect(peaks.length).toBeGreaterThan(0);
    peaks.forEach((p, i) => {
      expect(p.two_theta).toBeGreaterThanOrEqual(range[0]);
      expect(p.two_theta).toBeLessThanOrEqual(range[1]);
      if (i > 0) expect(p.two_theta).toBeGreaterThan(peaks[i - 1].two_theta);
      expect(wavelength / (2 * Math.sin(rad(p.two_theta / 2)))).toBeCloseTo(p.d, 5);
    });
    expect(Math.max(...peaks.map((p) => p.intensity))).toBeCloseTo(100, 6);
  });
});

describe('known physics in the fixtures', () => {
  const F2 = (name: string, hkl: number[]) =>
    fixtures[name].reflections.rows.find((r) => hkl.every((x, i) => r[i] === x))![4];

  it('diamond-cubic Si: (200) and (222) are forbidden, (111) and (220) are not', () => {
    expect(F2('Si', [2, 0, 0])).toBeCloseTo(0, 6);
    expect(F2('Si', [2, 2, 2])).toBeCloseTo(0, 6);
    expect(F2('Si', [1, 1, 1])).toBeGreaterThan(1000);
    expect(F2('Si', [2, 2, 0])).toBeGreaterThan(1000);
    expect(fixtures.Si.zones['1 1 0']).toContain('0 0 2'); // in the zone, yet kinematically forbidden
  });

  it('Si [110] electron spots: (002) is kinematically forbidden, the {111} spots are strongest', () => {
    const spots = fixtures.Si.tem.zones['1 1 0'];
    const intensity = (hkl: number[]) => spots.find((s) => hkl.every((x, i) => s[i] === x))![4];
    expect(intensity([0, 0, 2])).toBeLessThan(1e-12);
    expect(intensity([1, -1, 1])).toBeCloseTo(1, 9);
    expect(intensity([2, -2, 0])).toBeGreaterThan(0.5);
  });

  it('electron wavelength at 200 kV matches the relativistic value used in context.md 5.5', () => {
    for (const f of Object.values(fixtures)) {
      expect(f.tem.voltage_kV).toBe(200);
      expect(f.tem.wavelength).toBeCloseTo(0.0250793, 7);
    }
  });

  it('rock-salt NaCl: (111) is weak (f_Cl - f_Na), (200) is strong', () => {
    expect(F2('NaCl', [2, 0, 0])).toBeGreaterThan(10 * F2('NaCl', [1, 1, 1]));
  });

  it('hexagonal graphite: gamma = 120 degrees puts b at (-a/2, a*sqrt(3)/2, 0)', () => {
    const m = fixtures.graphite.matrix_standard;
    const a = fixtures.graphite.cell.a;
    expect(m[0][1]).toBeCloseTo(-a / 2, 6);
    expect(m[1][1]).toBeCloseTo((a * Math.sqrt(3)) / 2, 6);
  });

  it('a centred triclinic setting keeps its centring operations (albite C-1: 2 x 2 = 4)', () => {
    expect(fixtures.albite.space_group.n_operations).toBe(4);
  });
});
