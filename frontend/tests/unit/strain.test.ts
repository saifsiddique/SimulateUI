import { describe, expect, it } from 'vitest';
import { formatStrain, strainLevel } from '../../src/core/strain';

describe('strain presentation', () => {
  it('levels', () => {
    expect(strainLevel(0)).toBe('ok');
    expect(strainLevel(0.01)).toBe('ok');
    expect(strainLevel(0.026)).toBe('warn');
    expect(strainLevel(0.09)).toBe('bad');
    expect(strainLevel(0.03, 0.05)).toBe('ok');
  });
  it('format', () => {
    expect(formatStrain(0)).toBe('0 %');
    expect(formatStrain(0.0262)).toBe('+2.62 %');
    expect(formatStrain(-0.0006)).toBe('−0.060 %');
  });
});
