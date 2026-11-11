import { describe, expect, it } from 'vitest';
import { chi, chiMap, chiTerms, phaseColor } from '../../src/core/chi';
import { zeroAberrations } from '../../src/core/aberrations';

const lam = 0.025079; // 200 kV

describe('aberration phase χ(k)', () => {
  it('is zero without aberrations', () => {
    expect(chiTerms(zeroAberrations(), 0)).toEqual([]);
    const m = chiMap([], lam, 20, 25, 16);
    expect(m.maxInside).toBe(0);
    expect(m.flatRadius).toBeNull();
  });
  it('defocus: χ = −π Δf α² / λ with abTEM sign (positive defocus = underfocus)', () => {
    const t = chiTerms(zeroAberrations(), 100);
    expect(chi(t, lam, 0.01, 0)).toBeCloseTo((-Math.PI * 100 * 1e-4) / lam, 9);
  });
  it('Cs: χ = π Cs α⁴ / (2λ)', () => {
    const ab = zeroAberrations();
    ab.C30 = 1.2e7; // 1.2 mm
    const t = chiTerms(ab, 0);
    expect(chi(t, lam, 0, 0.01)).toBeCloseTo((Math.PI * 1.2e7 * 1e-8) / (2 * lam), 6);
  });
  it('two-fold astigmatism follows its angle', () => {
    const ab = zeroAberrations();
    ab.C12 = 50;
    ab.phi12 = 90;
    const t = chiTerms(ab, 0);
    // along y the phase is +, along x −, with φ12 = 90°
    expect(chi(t, lam, 0, 0.01)).toBeGreaterThan(0);
    expect(chi(t, lam, 0.01, 0)).toBeLessThan(0);
  });
  it('maps +x to the left: the first column is θx = +half', () => {
    const ab = zeroAberrations();
    ab.C21 = 1000; // axial coma, odd in θ: tells left from right
    const t = chiTerms(ab, 0);
    const m = chiMap(t, lam, 20, 20, 5);
    const mid = 2 * 5;
    expect(m.values[mid]).toBeCloseTo(chi(t, lam, 0.02, 0), 9);
    expect(m.values[mid + 4]).toBeCloseTo(chi(t, lam, -0.02, 0), 9);
    expect(m.values[2]).toBeCloseTo(chi(t, lam, 0, 0.02), 9); // top row: +y
  });
  it('finds the π/4 radius of a defocus', () => {
    // |χ| = π Δf θ² / λ = π/4 at θ = sqrt(λ / (4 Δf))
    const m = chiMap(chiTerms(zeroAberrations(), 50), lam, 20, 30, 301);
    expect(m.flatRadius!).toBeCloseTo(Math.sqrt(lam / 200) * 1e3, 0);
  });
  it('colours a phase cyclically', () => {
    expect(phaseColor(0)).toEqual(phaseColor(2 * Math.PI));
    expect(phaseColor(-Math.PI)).toEqual(phaseColor(Math.PI));
    expect(phaseColor(Math.PI)).not.toEqual(phaseColor(0));
  });
});
