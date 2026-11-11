import { describe, expect, it } from 'vitest';
import {
  ABERRATIONS,
  aberrationRequest,
  fromUi,
  randomAberrations,
  phiName,
  toUi,
  zeroAberrations,
} from '../../src/core/aberrations';

describe('aberrations', () => {
  it('lists abTEM names, with angles for the non-symmetric terms', () => {
    const ids = ABERRATIONS.map((d) => d.id);
    expect(ids).toContain('C56');
    expect(ABERRATIONS.find((d) => d.id === 'C30')!.angle).toBe(false);
    expect(Object.keys(zeroAberrations())).toContain('phi12');
    expect(Object.keys(zeroAberrations())).not.toContain('phi30');
    expect(phiName('C45')).toBe('phi45');
  });
  it('converts C3 and the higher orders between µm and angstrom', () => {
    const cs = ABERRATIONS.find((d) => d.id === 'C30')!;
    expect(fromUi(cs, 1200)).toBeCloseTo(1.2e7);
    expect(toUi(cs, 1.2e7)).toBeCloseTo(1200);
    const c45 = ABERRATIONS.find((d) => d.id === 'C45')!;
    expect(c45.unit).toBe('µm');
    expect(toUi(c45, 1e4)).toBeCloseTo(1);
    const c12 = ABERRATIONS.find((d) => d.id === 'C12')!;
    expect(fromUi(c12, 5)).toBe(5);
  });
  it('sends only the non-zero coefficients, angles in radians', () => {
    const ab = zeroAberrations();
    expect(aberrationRequest(ab)).toEqual({});
    ab.C12 = 20;
    ab.phi12 = 90;
    ab.C30 = 1.2e7;
    expect(aberrationRequest(ab)).toEqual({ C12: 20, phi12: Math.PI / 2, C30: 1.2e7 });
  });
});

describe('random aberrations', () => {
  const lcg = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  it('draws every coefficient from its range and every angle from 0 to 360 degrees', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const ab = randomAberrations(lcg(seed));
      for (const d of ABERRATIONS) {
        expect(ab[d.id]).toBeGreaterThanOrEqual(d.random[0]);
        expect(ab[d.id]).toBeLessThanOrEqual(d.random[1]);
        if (d.angle) {
          expect(ab[phiName(d.id)]).toBeGreaterThanOrEqual(0);
          expect(ab[phiName(d.id)]).toBeLessThan(360);
        }
      }
    }
  });
  it('has the stated ranges (in Å) and Haider names', () => {
    const by = Object.fromEntries(ABERRATIONS.map((d) => [d.id, d]));
    expect(by.C12.random).toEqual([0, 20]); // A1: 0 to 2 nm
    expect(by.C21.random).toEqual([0, 50]); // B2: 0 to 5 nm
    expect(by.C23.random).toEqual([0, 50]); // A2: 0 to 5 nm
    expect(by.C30.random).toEqual([-5000, 5000]); // C3: ±500 nm
    expect(by.C32.random).toEqual([0, 1000]); // S3: 0 to 100 nm
    expect(by.C34.random).toEqual([0, 1000]); // A3: 0 to 100 nm
    for (const id of ['C41', 'C43', 'C45', 'C50', 'C52', 'C54', 'C56'])
      expect(by[id].random).toEqual([0, 50000]); // the rest: 0 to 5 µm
    expect([by.C12, by.C21, by.C23, by.C30, by.C32, by.C34].map((d) => d.haider)).toEqual([
      'A1',
      'B2',
      'A2',
      'C3',
      'S3',
      'A3',
    ]);
  });
  it('leaves the defocus out', () => {
    expect(randomAberrations(() => 0.5)).not.toHaveProperty('defocus');
  });
});
