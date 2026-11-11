import { describe, expect, it } from 'vitest';
import {
  clampDetector,
  detectorPreset,
  fitView,
  formatLength,
  fromScreen,
  panBy,
  scaleBar,
  scanGrid,
  toScreen,
  zoomAt,
} from '../../src/core/plane';

const stage = { w: 400, h: 300, flipX: true };

describe('plane mapping', () => {
  it('fits the bounds and puts +x to the left, +y up', () => {
    const v = fitView({ u0: 0, u1: 20, v0: 0, v1: 10 }, 400, 300, 0);
    expect(v.scale).toBeCloseTo(20);
    const origin = toScreen(v, stage, 0, 0);
    const far = toScreen(v, stage, 20, 10);
    expect(origin.x).toBeCloseTo(400); // x = 0 on the right
    expect(far.x).toBeCloseTo(0);
    expect(origin.y).toBeGreaterThan(far.y); // y up
  });

  it('round-trips through fromScreen, and zoom keeps the point under the pointer', () => {
    const v = fitView({ u0: -5, u1: 5, v0: -5, v1: 5 }, 400, 300);
    const p = toScreen(v, stage, 1.5, -2);
    const back = fromScreen(v, stage, p.x, p.y);
    expect(back.u).toBeCloseTo(1.5);
    expect(back.v).toBeCloseTo(-2);
    const z = zoomAt(v, stage, p.x, p.y, 3);
    expect(z.scale).toBeCloseTo(v.scale * 3);
    const still = toScreen(z, stage, 1.5, -2);
    expect(still.x).toBeCloseTo(p.x);
    expect(still.y).toBeCloseTo(p.y);
  });

  it('pans with the pointer', () => {
    const v = fitView({ u0: 0, u1: 10, v0: 0, v1: 10 }, 400, 300);
    const before = toScreen(v, stage, 3, 3);
    const after = toScreen(panBy(v, stage, 25, -10), stage, 3, 3);
    expect(after.x - before.x).toBeCloseTo(25);
    expect(after.y - before.y).toBeCloseTo(-10);
  });
});

describe('scale bar', () => {
  it('takes a round length near the target', () => {
    const b = scaleBar(37, 90); // 90 px is 2.43 units
    expect(b.value).toBe(2);
    expect(b.px).toBeCloseTo(74);
    expect(scaleBar(0.9, 90).value).toBe(100);
    expect(scaleBar(1000, 90).value).toBeCloseTo(0.1);
  });
  it('formats lengths without float noise', () => {
    expect(formatLength(0.30000000000000004)).toBe('0.3');
    expect(formatLength(200)).toBe('200');
  });
});

describe('scan grid', () => {
  it('counts floor(w / step) positions per side and decimates large grids', () => {
    const g = scanGrid({ x0: 1, y0: 2, w: 10, h: 5 }, 0.5);
    expect(g.count).toBe(20 * 10);
    expect(g.points[0]).toEqual([1, 2]);
    expect(g.stride).toBe(1);
    const big = scanGrid({ x0: 0, y0: 0, w: 100, h: 100 }, 0.1, 2500);
    expect(big.count).toBe(1_000_000);
    expect(big.points.length).toBeLessThanOrEqual(2500);
    expect(big.stride).toBe(20);
  });
});

describe('detectors', () => {
  it('presets follow alpha; inner stays below outer', () => {
    expect(detectorPreset('BF', 20)).toEqual({ name: 'BF', inner: 0, outer: 20 });
    expect(detectorPreset('ABF', 20)).toEqual({ name: 'ABF', inner: 10, outer: 20 });
    expect(detectorPreset('HAADF', 20).inner).toBe(50);
    expect(clampDetector({ name: 'x', inner: 30, outer: 10 })).toEqual({
      name: 'x',
      inner: 30,
      outer: 30.5,
    });
  });
});
