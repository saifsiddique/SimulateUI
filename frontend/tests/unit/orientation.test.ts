import { describe, expect, it } from 'vitest';
import {
  angleBetweenDirections,
  buildLattice,
  cartesianToNearestHkl,
} from '../../src/core/lattice';
import { angleBetween, cross, dot, norm, type Vec3 } from '../../src/core/math/vec3';
import {
  READOUT_HYSTERESIS,
  defaultUp,
  directionAlongUvw,
  directionNormalToHkl,
  makeFrame,
  readOrientation,
  rotateView,
  snapToZoneAxis,
  type ReadoutMemory,
} from '../../src/core/orientation';
import { defaultViewSettings, parseViewSettings } from '../../src/core/structure';
import { fixtures } from './helpers/fixtures';

const graphite = buildLattice(fixtures.graphite.cell);
const zro2 = buildLattice(fixtures.ZrO2_baddeleyite.cell);
const nacl = buildLattice(fixtures.NaCl.cell);

describe('view along [uvw] and normal to (hkl): M7 acceptance', () => {
  it('graphite: [100] and the (100) normal are 30 degrees apart', () => {
    const along = directionAlongUvw(graphite, [1, 0, 0]);
    const normal = directionNormalToHkl(graphite, [1, 0, 0]);
    expect(angleBetween(along, normal)).toBeCloseTo(30, 6);
  });

  it('graphite: [110] and the (110) normal are the same view', () => {
    const along = directionAlongUvw(graphite, [1, 1, 0]);
    const normal = directionNormalToHkl(graphite, [1, 1, 0]);
    expect(angleBetween(along, normal)).toBeCloseTo(0, 6);
  });

  it('graphite: [100] equals the normal to (2 -1 0)', () => {
    const along = directionAlongUvw(graphite, [1, 0, 0]);
    const normal = directionNormalToHkl(graphite, [2, -1, 0]);
    expect(angleBetween(along, normal)).toBeCloseTo(0, 6);
  });

  it('monoclinic ZrO2: [100] and the (100) normal differ by beta - 90', () => {
    const along = directionAlongUvw(zro2, [1, 0, 0]);
    const normal = directionNormalToHkl(zro2, [1, 0, 0]);
    expect(angleBetween(along, normal)).toBeCloseTo(fixtures.ZrO2_baddeleyite.cell.beta - 90, 6);
  });

  it('typing an index and reading it back round trips', () => {
    for (const lat of [graphite, zro2, nacl]) {
      for (const idx of [
        [1, 0, 0],
        [1, 1, 1],
        [2, -1, 0],
        [3, 2, 1],
        [-1, 0, 4],
      ] as Vec3[]) {
        const r = readOrientation(lat, directionAlongUvw(lat, idx), {});
        expect(r.uvw.indices).toEqual(idx);
        expect(r.uvw.angleDeg).toBeLessThan(1e-6);
        const h = readOrientation(lat, directionNormalToHkl(lat, idx), {});
        expect(h.hkl.indices).toEqual(idx);
        expect(h.hkl.angleDeg).toBeLessThan(1e-6);
      }
    }
  });
});

describe('default up', () => {
  it('is c, or b when looking along c', () => {
    const c: Vec3 = [nacl.M[0][2], nacl.M[1][2], nacl.M[2][2]];
    const b: Vec3 = [nacl.M[0][1], nacl.M[1][1], nacl.M[2][1]];
    expect(defaultUp(nacl, [1, 0, 0])).toEqual(c);
    expect(defaultUp(nacl, c)).toEqual(b);
    expect(defaultUp(nacl, [-c[0], -c[1], -c[2]])).toEqual(b);
  });
});

describe('rotateView', () => {
  const start = makeFrame([0, 0, -1], [0, 1, 0])!; // screen-right is +x
  const right = (f: { direction: Vec3; up: Vec3 }): Vec3 => cross(f.direction, f.up);

  it('keeps an orthonormal frame', () => {
    let f = start;
    for (const turn of [
      { right: 13 },
      { upward: -27 },
      { roll: 41 },
      { right: 5, upward: 7, roll: 9 },
    ])
      f = rotateView(f, turn);
    expect(norm(f.direction)).toBeCloseTo(1, 12);
    expect(norm(f.up)).toBeCloseTo(1, 12);
    expect(dot(f.direction, f.up)).toBeCloseTo(0, 12);
  });

  it('turns by exactly the requested angle', () => {
    expect(angleBetween(start.direction, rotateView(start, { right: 17 }).direction)).toBeCloseTo(
      17,
      9,
    );
    expect(angleBetween(start.direction, rotateView(start, { upward: 33 }).direction)).toBeCloseTo(
      33,
      9,
    );
    expect(angleBetween(start.direction, rotateView(start, { roll: 33 }).direction)).toBeCloseTo(
      0,
      9,
    );
    expect(angleBetween(start.up, rotateView(start, { roll: 90 }).up)).toBeCloseTo(90, 9);
  });

  it('right moves the near side of the crystal to the right, like dragging right', () => {
    // Dragging right swings the near face to the right. A point P appears at screen x = P . right;
    // the near-side point starts at x = 0 and must end up at positive x.
    const p: Vec3 = [0, 0, 1]; // the near side of the crystal, towards the camera
    const moved = rotateView(start, { right: 10 });

    expect(dot(p, right(moved))).toBeGreaterThan(0);
    expect(dot(p, right(moved))).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 9);
    const up = rotateView(start, { upward: 10 });
    expect(dot(p, up.up)).toBeGreaterThan(0);
  });

  it('opposite turns cancel', () => {
    const f = rotateView(rotateView(start, { right: 25, upward: 10 }), { upward: -10 });
    const back = rotateView(f, { right: -25 });
    expect(angleBetween(back.direction, start.direction)).toBeLessThan(1e-9);
    expect(angleBetween(back.up, start.up)).toBeLessThan(1e-9);
  });

  it('four 90 degree rolls return to the start', () => {
    let f = start;
    for (let i = 0; i < 4; i++) f = rotateView(f, { roll: 90 });
    expect(angleBetween(f.up, start.up)).toBeLessThan(1e-9);
  });

  it('survives looking straight along the old up vector', () => {
    const f = rotateView(start, { upward: 90 });
    expect(Number.isFinite(f.up[0] + f.up[1] + f.up[2])).toBe(true);
    expect(dot(f.direction, f.up)).toBeCloseTo(0, 12);
  });
});

describe('readout', () => {
  it('does not flicker between two nearly equal candidates', () => {
    // Midway between [001] and [101] in a cubic cell: tiny wobbles must not flip the answer.
    const memory: ReadoutMemory = {};
    const base = Math.atan2(1, 1) / 2; // 22.5 degrees from [001]
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const wobble = (i % 2 ? 1 : -1) * 0.01 * (Math.PI / 180);
      const t = base + wobble;
      const dir: Vec3 = [Math.sin(t), 0, Math.cos(t)];
      seen.add(readOrientation(nacl, dir, memory).uvw.indices.join(','));
    }
    expect(seen.size).toBe(1);
    expect(READOUT_HYSTERESIS).toBeGreaterThan(0.01);
  });

  it('does release the old answer once clearly beaten', () => {
    const memory: ReadoutMemory = {};
    readOrientation(nacl, [0, 0, 1], memory);
    const r = readOrientation(nacl, [1, 0, 0], memory);
    expect(r.uvw.indices).toEqual([1, 0, 0]);
  });

  it('agrees with the plain search when there is no memory', () => {
    const dir: Vec3 = [0.3, -0.2, 0.9];
    const r = readOrientation(zro2, dir, {});
    expect(r.hkl.indices).toEqual(cartesianToNearestHkl(zro2, dir).indices);
  });
});

describe('snap to the nearest zone axis', () => {
  it('snaps inside the threshold and not outside', () => {
    const exact = directionAlongUvw(nacl, [1, 1, 0]);
    const tilted = rotateView(makeFrame(exact, [0, 0, 1])!, { right: 1.5 }).direction;
    const hit = snapToZoneAxis(nacl, tilted, 2);
    expect(hit?.indices).toEqual([1, 1, 0]);
    expect(hit!.angleDeg).toBeCloseTo(1.5, 6);
    expect(angleBetweenDirections(nacl, hit!.indices, [1, 1, 0])).toBeCloseTo(0, 9);
    expect(snapToZoneAxis(nacl, tilted, 1)).toBeNull();
  });

  it('keeps the sign of the line of sight', () => {
    const hit = snapToZoneAxis(nacl, [0, 0, -1], 2);
    expect(hit?.indices).toEqual([0, 0, -1]);
  });
});

describe('orientation settings', () => {
  it('snap and tilt settings default off/2/3/5, survive JSON, and reject nonsense', () => {
    const d = defaultViewSettings(null);
    expect([d.snapToZone, d.snapDegrees, d.snapMaxIndex, d.tiltStep]).toEqual([false, 2, 3, 5]);
    const s = { ...d, snapToZone: true, snapDegrees: 4, snapMaxIndex: 2, tiltStep: 15 };
    expect(parseViewSettings(JSON.parse(JSON.stringify(s)), null)).toEqual(s);
    const bad = parseViewSettings({ snapDegrees: -1, snapMaxIndex: 2.5, tiltStep: 'x' }, null);
    expect([bad.snapDegrees, bad.snapMaxIndex, bad.tiltStep]).toEqual([2, 3, 5]);
  });
});
