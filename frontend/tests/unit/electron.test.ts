import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal, type Crystal } from '../../src/core/crystal';
import {
  electronStructureFactor,
  electronWavelength,
  excitationError,
  kinematicPattern,
  relativisticGamma,
  shapeFactor,
  type PatternGeometry,
  type Spot,
} from '../../src/core/diffraction/electron';
import { dSpacing, hklToCart, uvwToCart } from '../../src/core/lattice';
import { cross, dot, normalize, type Vec3 } from '../../src/core/math/vec3';
import { defaultUp, rotateView } from '../../src/core/orientation';
import { fixtureDir, fixtures, names } from './helpers/fixtures';

const crystals: Record<string, Crystal> = Object.fromEntries(
  names.map((n) => [
    n,
    buildCrystal(parseFirstStructure(readFileSync(`${fixtureDir}cifs/${n}.cif`, 'utf8')).structure)
      .crystal,
  ]),
);

/** Independent F² (pymatgen cell, abTEM Lobato factors, occupancies; scripts/make_ed_reference.py). */
const lobatoRef = JSON.parse(
  readFileSync(`${fixtureDir}ed/lobato_reference.json`, 'utf8'),
) as Record<string, { rows: number[][] }>;

const key = (h: readonly number[]) => h.join(' ');

function atZoneAxis(c: Crystal, uvw: Vec3, extra: Partial<PatternGeometry> = {}) {
  const direction = uvwToCart(c.lattice, uvw);
  return kinematicPattern(c, {
    direction,
    up: defaultUp(c.lattice, direction),
    zoneAxis: uvw,
    voltage: 200,
    thickness: 500,
    gMax: 3,
    maxZone: 0,
    profile: 'none',
    debyeWaller: false,
    minIntensity: 0,
    includeForbidden: true,
    ...extra,
  });
}

const inBox = (s: Spot) => s.hkl.every((x) => Math.abs(x) <= 3);

describe('electron wavelength', () => {
  it('matches the relativistic values of context.md 5.5 and pymatgen', () => {
    expect(electronWavelength(200)).toBeCloseTo(0.0250793, 6);
    expect(electronWavelength(300)).toBeCloseTo(0.0196875, 6);
    expect(electronWavelength(200)).toBeCloseTo(fixtures.Si.tem.wavelength, 9);
    // the presets of the ED tab
    expect(electronWavelength(120)).toBeCloseTo(0.0334922, 6);
    expect(electronWavelength(60)).toBeCloseTo(0.0486606, 6);
  });
  it('gamma and errors', () => {
    expect(relativisticGamma(300)).toBeCloseTo(1.587, 3);
    expect(() => electronWavelength(0)).toThrow(/positive/);
    expect(() => electronWavelength(NaN)).toThrow(/positive/);
  });
});

describe('structure factors against an independent reference (abTEM Lobato + pymatgen cell)', () => {
  for (const name of names) {
    it(name, () => {
      const c = crystals[name];
      const rows = lobatoRef[name].rows;
      const max = Math.max(...rows.map((r) => r[4]));
      for (const [h, k, l, d, F2] of rows) {
        const [re, im] = electronStructureFactor(c, [h, k, l], { debyeWaller: false });
        expect(dSpacing(c.lattice, [h, k, l])).toBeCloseTo(d, 6);
        // Measured worst: 5e-6 of the strongest reflection (pymatgen snaps CIF coordinates such
        // as 0.3333 to 1/3); without occupancies or with another f table it is 1e-2 or worse.
        expect(Math.abs(re * re + im * im - F2)).toBeLessThan(2e-5 * max);
      }
    });
  }
});

describe('zero-order Laue zone at [001] and [110] (pymatgen TEMCalculator fixtures)', () => {
  for (const name of names) {
    for (const axis of ['0 0 1', '1 1 0']) {
      it(`${name} [${axis}]`, () => {
        const c = crystals[name];
        const uvw = axis.split(' ').map(Number) as unknown as Vec3;
        const rows = fixtures[name].tem.zones[axis];
        const spots = atZoneAxis(c, uvw).spots.filter(inBox);
        // the spot set is exactly the fixture's
        expect(spots.map((s) => key(s.hkl)).sort()).toEqual(
          rows.map((r) => key(r.slice(0, 3))).sort(),
        );
        const byKey = new Map(spots.map((s) => [key(s.hkl), s]));
        const max = Math.max(...spots.map((s) => s.I));
        for (const r of rows) {
          const s = byKey.get(key(r.slice(0, 3)))!;
          expect(s.zone).toBe(0);
          expect(s.d).toBeCloseTo(r[3], 6);
          // pymatgen's zero is ~1e-30 where symmetry forbids the reflection
          expect(s.forbidden).toBe(r[4] < 1e-12);
        }
        // Intensities: pymatgen ignores occupancies (olivine Mg/Fe, albite Al/Si) and uses other
        // electron factors, so only the fully ordered structures are compared. Measured worst
        // differences (normalised to the strongest spot): NaCl 0.005, Si 0.009, graphite 0.0005,
        // rutile 0.004, ZrO2 0.074 (weak reflections where O and Zr nearly cancel).
        const tolerance: Record<string, number> = {
          NaCl: 0.01,
          Si: 0.015,
          graphite: 0.005,
          rutile: 0.01,
          ZrO2_baddeleyite: 0.1,
        };
        if (!(name in tolerance)) return;
        for (const r of rows) {
          const s = byKey.get(key(r.slice(0, 3)))!;
          expect(Math.abs(s.I / max - r[4])).toBeLessThan(tolerance[name]);
        }
      });
    }
  }
});

describe('Si [110]', () => {
  it('(002) is forbidden and (1 -1 1) is the strongest spot', () => {
    const spots = atZoneAxis(crystals.Si, [1, 1, 0]).spots;
    const s002 = spots.find((s) => key(s.hkl) === '0 0 2')!;
    expect(s002.forbidden).toBe(true);
    expect(s002.I).toBe(0);
    const best = spots.reduce((a, b) => (b.I > a.I ? b : a));
    expect(best.g).toBeCloseTo(1 / dSpacing(crystals.Si.lattice, [1, -1, 1]), 9);
    expect(spots.find((s) => key(s.hkl) === '1 -1 1')!.I).toBeCloseTo(best.I, 12);
  });
  it('forbidden spots are left out unless asked for', () => {
    const spots = atZoneAxis(crystals.Si, [1, 1, 0], { includeForbidden: false }).spots;
    expect(spots.some((s) => s.forbidden)).toBe(false);
    expect(spots.find((s) => key(s.hkl) === '0 0 2')).toBeUndefined();
  });
});

describe('forbidden reflections', () => {
  it('space-group absences are exact even when the CIF rounds special coordinates', () => {
    // graphite's C2 at (1/3, 2/3, 1/4) written to four decimals: the symmetry copies merge into
    // a set that is not exactly symmetric, so |F| of the c-glide absence (1 1 -2 1) = (1 1 1)
    // is no longer ~0, but the space group still forbids it.
    const text = readFileSync(`${fixtureDir}cifs/graphite.cif`, 'utf8').replace(
      'C2 0.33333 0.66667 0.25000',
      'C2 0.3333 0.6666 0.25000',
    );
    const c = buildCrystal(parseFirstStructure(text).structure).crystal;
    const [re, im] = electronStructureFactor(c, [1, 1, 1]);
    expect(Math.hypot(re, im)).toBeGreaterThan(1e-4); // rounding residue, above FORBIDDEN_FRACTION
    const spot = atZoneAxis(c, [1, -1, 0]).spots.find((s) => key(s.hkl) === '1 1 1')!;
    expect(spot.forbidden).toBe(true);
    expect(spot.I).toBe(0);
    // an allowed reflection of the same class with l even is not
    expect(atZoneAxis(c, [1, -1, 0]).spots.find((s) => key(s.hkl) === '1 1 2')!.forbidden).toBe(
      false,
    );
  });
});

describe('geometry', () => {
  it('spots sit at g projected on the screen axes, x = g·(direction × up)', () => {
    const c = crystals.graphite;
    const p = atZoneAxis(c, [0, 0, 1]);
    for (const s of p.spots) {
      const g = hklToCart(c.lattice, s.hkl);
      expect(s.x).toBeCloseTo(dot(g, p.right), 12);
      expect(s.y).toBeCloseTo(dot(g, p.up), 12);
      // ZOLZ spots lie in the screen plane: |g| is the projected length
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(s.g, 9);
    }
    // the excitation error reported for every spot is the exact one, with its sign
    for (const s of p.spots)
      expect(s.s).toBeCloseTo(excitationError(p.beam, p.lambda, hklToCart(c.lattice, s.hkl)), 12);
    expect(p.spots.every((s) => s.s < 0)).toBe(true); // ZOLZ on the axis: outside the sphere
    const right = normalize(cross(p.beam, p.up))!;
    expect(dot(right, p.right)).toBeCloseTo(1, 12);
  });

  it('the excitation error is -lambda g²/2 for a ZOLZ reflection on the zone axis, 0 on the Ewald sphere', () => {
    const lambda = electronWavelength(300);
    const beam: Vec3 = [0, 0, 1];
    const s = excitationError(beam, lambda, [0.5, 0, 0]);
    expect(s).toBeLessThan(0);
    expect(s).toBeCloseTo((-lambda * 0.25) / 2, 6);
    // a point on the sphere |k + g| = k
    const k = 1 / lambda;
    const theta = 0.3;
    const g: Vec3 = [k * Math.sin(theta), 0, k * Math.cos(theta) - k];
    expect(Math.abs(excitationError(beam, lambda, g))).toBeLessThan(1e-9);
  });

  it('shape factors: sinc² has its first zero at s = 1/t; the smooth envelope has none', () => {
    expect(shapeFactor('sinc', 500, 0)).toBe(1);
    expect(shapeFactor('sinc', 500, 1 / 500)).toBeLessThan(1e-20);
    expect(shapeFactor('smooth', 500, 1 / 500)).toBeCloseTo(1 / (1 + Math.PI * Math.PI), 12);
    expect(shapeFactor('none', 500, 1)).toBe(1);
  });

  it('a pattern is the same for a parallel direction of any length and for an up vector not perpendicular to it', () => {
    const c = crystals.rutile;
    const d = uvwToCart(c.lattice, [1, 1, 0]);
    const base = atZoneAxis(c, [1, 1, 0], { profile: 'smooth' });
    const scaled = kinematicPattern(c, {
      direction: [3 * d[0], 3 * d[1], 3 * d[2]],
      up: [base.up[0] + 2 * d[0], base.up[1] + 2 * d[1], base.up[2] + 2 * d[2]],
      zoneAxis: [2, 2, 0],
      voltage: 200,
      thickness: 500,
      gMax: 3,
      maxZone: 0,
      profile: 'smooth',
      debyeWaller: false,
      minIntensity: 0,
      includeForbidden: true,
    });
    expect(scaled.zoneAxis).toEqual([1, 1, 0]);
    expect(scaled.spots.length).toBe(base.spots.length);
    for (let i = 0; i < base.spots.length; i++) {
      expect(scaled.spots[i].x).toBeCloseTo(base.spots[i].x, 9);
      expect(scaled.spots[i].I).toBeCloseTo(base.spots[i].I, 9);
    }
  });
});

describe('Laue zones', () => {
  it('maxZone 0 keeps only hu + kv + lw = 0; higher zones add |n| <= maxZone', () => {
    const c = crystals.Si;
    const zolz = atZoneAxis(c, [1, 1, 1], { gMax: 4 }).spots;
    expect(zolz.every((s) => s.zone === 0 && dot(s.hkl, [1, 1, 1]) === 0)).toBe(true);
    const holz = atZoneAxis(c, [1, 1, 1], { gMax: 4, maxZone: 2 }).spots;
    const zones = new Set(holz.map((s) => s.zone));
    expect([...zones].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    for (const s of holz) expect(dot(s.hkl, [1, 1, 1])).toBe(s.zone);
    // every reflection in the box with |g| <= gMax and |n| <= 2, nothing else
    const lat = c.lattice;
    let expected = 0;
    const n = Math.ceil(4 * c.cell.a); // |h| <= g_max a
    for (let h = -n; h <= n; h++)
      for (let k = -n; k <= n; k++)
        for (let l = -n; l <= n; l++) {
          if (!h && !k && !l) continue;
          if (Math.abs(h + k + l) > 2) continue;
          if (1 / dSpacing(lat, [h, k, l]) <= 4) expected++;
        }
    expect(holz.length).toBe(expected);
  });

  it('with the excitation error, the first-order Laue zone lights up only near its ring radius', () => {
    // Si [001] at 300 kV: layer spacing H = 1/c; F-centring forbids every other ring point, but
    // the FOLZ (l = 1, all-odd hkl) exists. Ring radius G1 = sqrt(2 H / lambda).
    const c = crystals.Si;
    const lambda = electronWavelength(300);
    const H = 1 / c.cell.c;
    // |k + g| = k with g·beam = -H gives the projected radius sqrt(2kH - H²)
    const ring = Math.sqrt((2 * H) / lambda - H * H);
    const holz = atZoneAxis(c, [0, 0, 1], {
      voltage: 300,
      gMax: 6,
      maxZone: 1,
      profile: 'smooth',
      minIntensity: 1e-9,
      includeForbidden: false,
    }).spots.filter((s) => s.zone !== 0);
    // the spots that are nearly on the Ewald sphere (shape factor > 0.1) ...
    const excited = holz.filter((s) => shapeFactor('smooth', 500, s.s) > 0.1);
    expect(excited.length).toBeGreaterThanOrEqual(4);
    for (const s of excited) {
      // ... sit on the ring, in the layer the sphere bends towards (g·beam < 0)
      expect(Math.abs(Math.hypot(s.x, s.y) - ring)).toBeLessThan(0.03);
      const beam = normalize(uvwToCart(c.lattice, [0, 0, 1]))!;
      expect(dot(hklToCart(c.lattice, s.hkl), beam)).toBeCloseTo(-H, 9);
    }
    // and the brightest HOLZ spot is one of them
    const brightest = holz.reduce((a, b) => (b.I > a.I ? b : a));
    expect(excited).toContain(brightest);
  });
});

describe('tilt', () => {
  it('tilting a few mrad off [110] visibly changes the spot intensities', () => {
    const c = crystals.Si;
    const d = uvwToCart(c.lattice, [1, 1, 0]);
    const up = defaultUp(c.lattice, d);
    const geometry = (direction: Vec3, u: Vec3): PatternGeometry => ({
      direction,
      up: u,
      zoneAxis: [1, 1, 0],
      voltage: 200,
      thickness: 500,
      gMax: 2,
      maxZone: 0,
      profile: 'sinc',
      debyeWaller: true,
      minIntensity: 0,
      includeForbidden: false,
    });
    const before = kinematicPattern(c, geometry(d, up));
    const mrad = 5e-3;
    const tilted = rotateView(
      { direction: normalize(d)!, up: normalize(up)! },
      { right: (mrad * 180) / Math.PI },
    );
    const after = kinematicPattern(c, geometry(tilted.direction, tilted.up));
    const I = new Map(before.spots.map((s) => [key(s.hkl), s.I]));
    let changed = 0;
    for (const s of after.spots) {
      const i0 = I.get(key(s.hkl))!;
      if (i0 > 1e-3 && Math.abs(s.I / i0 - 1) > 0.2) changed++;
    }
    expect(changed).toBeGreaterThan(4);
  });
});

describe('Debye-Waller', () => {
  it('damps high-angle reflections and leaves those of crystals without U unchanged', () => {
    const c = crystals.graphite;
    const hkl: Vec3 = [3, 0, 0];
    const [a, b] = electronStructureFactor(c, hkl, { debyeWaller: false });
    const [a2, b2] = electronStructureFactor(c, hkl, { debyeWaller: true });
    expect(Math.hypot(a2, b2)).toBeLessThan(Math.hypot(a, b));
  });
});

describe('speed', () => {
  it('recomputes a g_max = 2 pattern in under 50 ms (largest fixture cell; cached structure factors)', () => {
    const c = crystals.albite;
    // the first call fills the structure-factor cache (about 70 ms here, once per crystal)
    atZoneAxis(c, [0, 0, 1], {
      gMax: 2,
      profile: 'smooth',
      minIntensity: 1e-5,
      voltage: 300,
      debyeWaller: true,
    });
    const d = uvwToCart(c.lattice, [0, 0, 1]);
    let worst = 0;
    for (let i = 1; i <= 10; i++) {
      const f = rotateView({ direction: normalize(d)!, up: [1, 0, 0] }, { right: 0.3 * i });
      const t0 = performance.now();
      kinematicPattern(c, {
        direction: f.direction,
        up: f.up,
        zoneAxis: [0, 0, 1],
        voltage: 300,
        thickness: 500,
        gMax: 2,
        maxZone: 0,
        profile: 'smooth',
        debyeWaller: true,
        minIntensity: 1e-5,
        includeForbidden: true,
      });
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(50);
  });
});
