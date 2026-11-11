import { describe, expect, it } from 'vitest';
import {
  cumulative,
  countIncluded,
  discAlpha,
  fractionWithin,
  hklLabel,
  isIncluded,
  kMaxForFraction,
  logFrac,
  snapK,
  type Refl,
} from '../../src/core/bloch';

const r = (g: number, f: number, sg = 0, hkl: [number, number, number] = [1, 0, 0]): Refl => ({
  hkl,
  q: [g, 0],
  g,
  sg,
  zolz: sg === 0,
  f,
});
const direct = r(0, 1, 0, [0, 0, 0]);

describe('Bloch beam selection', () => {
  it('keeps the direct beam always, others inside k max and near the Ewald sphere', () => {
    expect(isIncluded(direct, 0.3, 0.01, 0)).toBe(true);
    expect(isIncluded(r(1, 1), 2, 0.01, 0)).toBe(true);
    expect(isIncluded(r(2.5, 1), 2, 0.01, 0)).toBe(false); // outside k max
    expect(isIncluded(r(1, 1, 0.05), 2, 0.01, 0)).toBe(false); // too far off the sphere
  });
  it('a convergent disc brings in beams off the sphere by up to |g_xy| alpha', () => {
    const b = r(2, 1, 0.05);
    expect(isIncluded(b, 3, 0.01, 0)).toBe(false);
    expect(isIncluded(b, 3, 0.01, 0.02)).toBe(false); // 0.05 - 2 * 0.02 = 0.01, not below
    expect(isIncluded(b, 3, 0.011, 0.02)).toBe(true);
    expect(isIncluded(b, 3, 0.01, 0.0201)).toBe(true);
    expect(isIncluded(b, 3, 0.01, 0.019)).toBe(false);
  });
  it('rounds the disc to the pattern pixel as the run does', () => {
    const lam = 0.0197; // 300 kV
    const a = discAlpha(10, 0.02, lam);
    expect(a).toBeCloseTo(Math.round(10e-3 / lam / 0.02) * 0.02 * lam, 12);
    expect(a * 1e3).toBeGreaterThan(9);
    expect(a * 1e3).toBeLessThan(11);
    expect(discAlpha(0, 0.02, lam)).toBe(0);
  });
  it('counts the included beams', () => {
    const refl = [direct, r(1, 1), r(1.5, 1), r(2.5, 1)];
    expect(countIncluded(refl, 2, 0.01, 0)).toBe(3);
  });
});

describe('cumulative kinematic intensity', () => {
  const refl = [direct, r(1, 3), r(2, 2), r(3, 1), r(4, 0), r(5, 0, 0.5)];
  it('is a share of sum |F|^2 of the reflections the run can use, without the direct beam', () => {
    const c = cumulative(refl, 0.01, 0);
    expect(c.total).toBe(9 + 4 + 1);
    expect(c.g).toEqual([1, 2, 3, 4]);
    expect(c.frac[0]).toBeCloseTo(9 / 14);
    expect(c.frac[3]).toBeCloseTo(1);
  });
  it('gives the share inside k max and the k max for a share', () => {
    const c = cumulative(refl, 0.01, 0);
    expect(fractionWithin(c, 0.5)).toBe(0);
    expect(fractionWithin(c, 2.5)).toBeCloseTo(13 / 14);
    expect(kMaxForFraction(c, 0.5, 5)).toBe(1.01); // just beyond the 1.0 reflection
    expect(kMaxForFraction(c, 0.99, 5)).toBe(3.01);
    expect(kMaxForFraction(c, 0.99, 3)).toBe(3); // capped at g max
    expect(kMaxForFraction(cumulative([direct], 0.01, 0), 0.9, 5)).toBeNull();
  });
  it('a bigger disc admits more reflections', () => {
    const far = [direct, r(1, 1), r(2, 1, 0.1)];
    expect(cumulative(far, 0.01, 0).g).toEqual([1]);
    expect(cumulative(far, 0.01, 0.05).g).toEqual([1, 2]);
  });
});

describe('helpers', () => {
  it('snaps k max to steps inside the range', () => {
    expect(snapK(2.026, 5)).toBeCloseTo(2.05);
    expect(snapK(0.01, 5)).toBe(0.2);
    expect(snapK(9, 5)).toBe(5);
  });
  it('puts structure factors on a log scale between 1e-4 and 1', () => {
    expect(logFrac(1, 1)).toBe(1);
    expect(logFrac(1e-2, 1)).toBeCloseTo(0.5);
    expect(logFrac(1e-6, 1)).toBe(0);
    expect(logFrac(0, 1)).toBe(0);
  });
  it('labels the Miller indices', () => {
    expect(hklLabel([-1, 1, 0])).toBe('(-1 1 0)');
  });
});
