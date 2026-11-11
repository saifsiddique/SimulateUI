import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/core/math/vec3';
import {
  affineFrom,
  applyAffine,
  beamArrow,
  boxEdges,
  clampFov,
  dragFov,
  fovMargin,
  fovCells,
  fovPreset,
  screenDeltaToSpecimen,
} from '../../src/core/specimen';

const corners: Vec3[] = [];
for (const x of [0, 1])
  for (const y of [0, 1]) for (const z of [0, 1]) corners.push([2 * x, 3 * y, 4 * z]);

describe('overlay geometry', () => {
  it('box edges: 12 edges, each along one axis with the box length', () => {
    const e = boxEdges(corners);
    expect(e.length).toBe(72);
    const lengths = [];
    for (let i = 0; i < 12; i++) {
      const d = [0, 1, 2].map((k) => e[6 * i + 3 + k] - e[6 * i + k]);
      expect(d.filter((x) => x !== 0)).toHaveLength(1);
      lengths.push(Math.hypot(...d));
    }
    expect(lengths.sort()).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  });
  it('beam arrow runs along the beam through the centre', () => {
    const a = beamArrow([1, 1, 1], [0, 0, 2], 5);
    expect([...a.slice(0, 6)]).toEqual([1, 1, -4, 1, 1, 6]);
    expect(a.length).toBe(6 + 4 * 6);
  });
});

describe('scan field of view', () => {
  const box: [number, number] = [40, 30];
  it('presets', () => {
    expect(fovPreset('whole', box, [5, 5])).toEqual({ x0: 0, y0: 0, w: 40, h: 30 });
    expect(fovPreset('centre50', box, [5, 5])).toEqual({ x0: 10, y0: 7.5, w: 20, h: 15 });
    expect(fovPreset('repeat', box, [5, 6])).toEqual({ x0: 17.5, y0: 12, w: 5, h: 6 });
  });
  it('clamps into the box and keeps a minimum size', () => {
    expect(clampFov({ x0: -5, y0: 28, w: 10, h: 10 }, box)).toEqual({
      x0: 0,
      y0: 20,
      w: 10,
      h: 10,
    });
    expect(clampFov({ x0: 0, y0: 0, w: 100, h: 0 }, box)).toEqual({ x0: 0, y0: 0, w: 40, h: 0.5 });
  });
  it('drags: move, and edges/corners', () => {
    const f = { x0: 10, y0: 10, w: 10, h: 10 };
    expect(dragFov(f, 'move', 5, -3, box)).toEqual({ x0: 15, y0: 7, w: 10, h: 10 });
    expect(dragFov(f, 'move', 100, 100, box)).toEqual({ x0: 30, y0: 20, w: 10, h: 10 });
    expect(dragFov(f, 'e', 4, 0, box)).toEqual({ x0: 10, y0: 10, w: 14, h: 10 });
    expect(dragFov(f, 'w', 4, 0, box)).toEqual({ x0: 14, y0: 10, w: 6, h: 10 });
    expect(dragFov(f, 'ne', 2, 3, box)).toEqual({ x0: 10, y0: 10, w: 12, h: 13 });
    expect(dragFov(f, 'sw', 20, 20, box)).toEqual({ x0: 19.5, y0: 19.5, w: 0.5, h: 0.5 });
  });
  it('margin to the box edge', () => {
    expect(fovMargin({ x0: 10, y0: 5, w: 10, h: 10 }, box)).toBe(5);
  });
});

describe('screen mapping', () => {
  it('round trips a displacement', () => {
    // a rotated, scaled, y-flipped view: x -> right 3 px/A, y -> up 3 px/A, then rotated 30 deg
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const o = { x: 100, y: 200 };
    const ex = { x: 100 + 3 * c, y: 200 - 3 * s };
    const ey = { x: 100 + 3 * s, y: 200 - 3 * c };
    const m = affineFrom(o, ex, ey);
    const p = applyAffine(m, 2, 5);
    const [dx, dy] = screenDeltaToSpecimen(m, p.x - o.x, p.y - o.y);
    expect(dx).toBeCloseTo(2, 10);
    expect(dy).toBeCloseTo(5, 10);
  });
});

describe('fovCells', () => {
  it('takes whole cells on a cell origin, as centred as possible, and no more than fit', () => {
    expect(fovCells([40, 30], [5, 6], [2, 2])).toEqual({ x0: 15, y0: 12, w: 10, h: 12 });
    expect(fovCells([40, 30], [5, 6], [20, 20])).toEqual({ x0: 0, y0: 0, w: 40, h: 30 });
    const f = fovCells([40, 30], [5, 6], [3, 1]);
    expect(f.x0 % 5).toBeCloseTo(0, 9);
    expect(f.w).toBe(15);
    expect(f.h).toBe(6);
  });
});
