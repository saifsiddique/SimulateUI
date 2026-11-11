import { describe, expect, it } from 'vitest';
import { ASSUMED_SIGMA, defaultSigmas, effectiveSigmas } from '../../src/core/thermal';

describe('thermal sigma', () => {
  it('is the square root of the mean Uiso of each element', () => {
    const d = defaultSigmas(
      ['Sr', 'Ti', 'O'],
      [0, 1, 2, 2, 2],
      [0.01, 0.0064, 0.0225, 0.0225, 0.0225],
    );
    expect(d.map((x) => x.element)).toEqual(['Sr', 'Ti', 'O']);
    expect(d[0].sigma).toBeCloseTo(0.1);
    expect(d[1].sigma).toBeCloseTo(0.08);
    expect(d[2].sigma).toBeCloseTo(0.15);
    expect(d.every((x) => !x.assumed)).toBe(true);
  });
  it('averages Uiso over the atoms of an element that have one', () => {
    const d = defaultSigmas(['Si'], [0, 0, 0], [0.01, null, 0.03]);
    expect(d[0].sigma).toBeCloseTo(Math.sqrt(0.02), 4);
  });
  it('assumes a typical value for an element without Uiso, and says so', () => {
    const d = defaultSigmas(['Si', 'O'], [0, 1], [0.01, null]);
    expect(d[0].assumed).toBe(false);
    expect(d[1]).toEqual({ element: 'O', sigma: ASSUMED_SIGMA, assumed: true });
    expect(defaultSigmas(['Si'], [0], null)[0].assumed).toBe(true);
    expect(defaultSigmas(['Si'], [0], [0])[0].assumed).toBe(true); // zero is no information
  });
  it('lets the user override one element', () => {
    const d = defaultSigmas(['Si', 'O'], [0, 1], [0.01, 0.02]);
    const e = effectiveSigmas(d, { O: 0.2, Zr: 1 });
    expect(e.O).toBe(0.2);
    expect(e.Si).toBeCloseTo(0.1);
    expect('Zr' in e).toBe(false); // not in the specimen
  });
});
