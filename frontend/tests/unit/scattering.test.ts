import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal } from '../../src/core/crystal';
import { density } from '../../src/core/density';
import {
  ScatteringError,
  atomicMass,
  bn,
  elementInfo,
  fe,
  fx,
  ionKey,
  parseSpecies,
  sFromD,
} from '../../src/core/scattering';
import { ELEMENT_SYMBOLS } from '../../src/core/elements';
import { ELEMENT_ROWS } from '../../src/core/scattering/data/elements';
import { WAASMAIER_KIRFEL } from '../../src/core/scattering/data/xray';
import { LOBATO } from '../../src/core/scattering/data/electron';
import { fixtureDir, fixtures, names } from './helpers/fixtures';

const Z: Record<string, number> = { H: 1, C: 6, O: 8, Si: 14, Fe: 26, Au: 79 };
const MOTT_BETHE = 0.023934; // m e^2 / (2 h^2) in angstrom, f_e = this * (Z - f_x) / s^2

describe('species parsing', () => {
  it('reads charges written either way, and element case', () => {
    expect(parseSpecies('Fe3+')).toEqual({ element: 'Fe', charge: 3 });
    expect(parseSpecies('Fe+3')).toEqual({ element: 'Fe', charge: 3 });
    expect(parseSpecies('Fe+++')).toEqual({ element: 'Fe', charge: 3 });
    expect(parseSpecies('O2-')).toEqual({ element: 'O', charge: -2 });
    expect(parseSpecies('O-2')).toEqual({ element: 'O', charge: -2 });
    expect(parseSpecies('O-')).toEqual({ element: 'O', charge: -1 });
    expect(parseSpecies('cu')).toEqual({ element: 'Cu', charge: 0 });
    expect(parseSpecies('D')).toEqual({ element: 'H', charge: 0, isotope: 'D' });
    expect(ionKey('Fe', 3)).toBe('Fe+++');
    expect(ionKey('O', -2)).toBe('O--');
    expect(ionKey('Fe', 0)).toBe('Fe');
  });

  it('throws ScatteringError for non-elements and unreadable charges', () => {
    expect(() => parseSpecies('Qq')).toThrow(ScatteringError);
    expect(() => parseSpecies('Fe3x')).toThrow(ScatteringError);
  });
});

describe('X-ray scattering factors (Waasmaier-Kirfel)', () => {
  it('equal the atomic number at s = 0 for every neutral atom', () => {
    for (const el of ELEMENT_SYMBOLS.slice(0, 98)) {
      expect(fx(el, 0), el).toBeCloseTo(ELEMENT_SYMBOLS.indexOf(el) + 1, 1);
    }
  });

  it('equal Z minus the charge for ions at s = 0', () => {
    expect(fx('Fe3+', 0)).toBeCloseTo(23, 1);
    expect(fx('Fe2+', 0)).toBeCloseTo(24, 1);
    expect(fx('O2-', 0)).toBeCloseTo(10, 1);
    expect(fx('Si4+', 0)).toBeCloseTo(10, 1);
  });

  it('decrease monotonically with s', () => {
    for (const el of ['H', 'C', 'Fe', 'Au']) {
      let previous = Infinity;
      for (let s = 0; s <= 4; s += 0.25) {
        const f = fx(el, s);
        expect(f, `${el} ${s}`).toBeLessThan(previous);
        previous = f;
      }
    }
  });

  it('falls back to the neutral atom for ions without a table, and rejects unknown elements', () => {
    expect(fx('Ar2+', 0.3)).toBe(fx('Ar', 0.3));
    expect(() => fx('Og', 0.3)).toThrow(ScatteringError);
  });

  it('matches the International Tables value for carbon (f = 1.685 at s = 0.5)', () => {
    expect(fx('C', 0.5)).toBeCloseTo(1.685, 2);
  });
});

describe('electron scattering factors', () => {
  it('Lobato, Peng and Mott-Bethe(Waasmaier-Kirfel) agree within 1.5% (s = 0.25, 0.5, 1.0)', () => {
    // Three independent routes to the same quantity: the Lobato fit, the Mott-Bethe formula
    // applied to the X-ray table, and (below) the Peng fit. Agreement fixes the s/q convention.
    for (const [el, z] of Object.entries(Z)) {
      for (const s of [0.25, 0.5, 1.0]) {
        const mb = (MOTT_BETHE * (z - fx(el, s))) / (s * s);
        expect(Math.abs(fe(el, s) / mb - 1), `${el} s=${s}`).toBeLessThan(0.015);
      }
    }
  });

  it('are stored in angstrom: hydrogen f_e(0) is about 0.53 and decreases like 1/s^2 at large s', () => {
    expect(fe('H', 0)).toBeCloseTo(0.5298, 2);
    expect(fe('C', 0)).toBeCloseTo(2.5, 0);
    const ratio = fe('Au', 4) / fe('Au', 2);
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.3);
  });

  it('use the ion table at small s and the neutral atom beyond s = 2', () => {
    expect(fe('O2-', 0.1)).toBeGreaterThan(fe('O', 0.1)); // extra electrons raise the forward amplitude
    expect(fe('O2-', 2.5)).toBe(fe('O', 2.5));
    expect(fe('Xe2+', 0.3)).toBe(fe('Xe', 0.3)); // no ionic table: neutral atom
  });

  it('exist for every element up to Lr (103)', () => {
    for (const el of ELEMENT_SYMBOLS.slice(0, 103)) expect(fe(el, 0.4), el).toBeGreaterThan(0);
    expect(Object.keys(LOBATO)).toHaveLength(103);
  });
});

describe('neutron scattering lengths (Sears 1992)', () => {
  it('match the published values (fm)', () => {
    const sears: Record<string, number> = {
      H: -3.739,
      C: 6.646,
      O: 5.803,
      Si: 4.1491,
      Fe: 9.45,
      Ni: 10.3,
      Ti: -3.438,
      V: -0.3824,
      Mn: -3.73,
    };
    for (const [el, b] of Object.entries(sears)) expect(bn(el), el).toBeCloseTo(b, 3);
    expect(bn('D')).toBeCloseTo(6.671, 3);
  });
});

describe('element data', () => {
  it('has all 118 elements with the right symbols and in order', () => {
    expect(ELEMENT_ROWS.map((r) => r.symbol)).toEqual([...ELEMENT_SYMBOLS]);
    expect(ELEMENT_ROWS.map((r) => r.Z)).toEqual(ELEMENT_SYMBOLS.map((_, i) => i + 1));
  });

  it('gives masses, radii and colours', () => {
    const fe = elementInfo('Fe');
    expect(fe.mass).toBeCloseTo(55.845, 3);
    expect(fe.covalentRadius).toBeCloseTo(1.32, 2);
    expect(fe.vdwRadius).toBeCloseTo(2.44, 2);
    expect(fe.color).toBe('#e06633');
    expect(fe.ionicRadii[3]).toBeCloseTo(0.785, 3);
    expect(elementInfo('H').color).toBe('#ffffff');
    expect(elementInfo('O').color).toBe('#ff0d0d');
    expect(elementInfo('C').mass).toBeCloseTo(12.011, 3);
    expect(atomicMass('H', 'D')).toBeCloseTo(2.014, 3);
    expect(() => elementInfo('Xx')).toThrow(ScatteringError);
    expect(Object.keys(WAASMAIER_KIRFEL).length).toBeGreaterThan(200);
  });

  it('converts d to s', () => {
    expect(sFromD(2)).toBe(0.25);
  });
});

describe('against the fixtures (pymatgen)', () => {
  for (const name of names) {
    const fx_ = fixtures[name];
    const { crystal } = buildCrystal(
      parseFirstStructure(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8')).structure,
    );

    it(`${name}: structure-factor intensities agree with pymatgen's table at small s`, () => {
      const rows = fx_.reflections.rows;
      const f2max = Math.max(...rows.map((r) => r[4]));
      let checked = 0;
      for (const [h, k, l, d, ref] of rows) {
        // pymatgen derives its X-ray table from electron parameters with the Mott-Bethe formula,
        // which is off by up to 6% in f for s > 0.5 (e.g. C at s = 1: +4%). Below s = 0.4, on
        // reflections that are not the result of near-cancellation, the two agree to a few %.
        const s = sFromD(d);
        if (ref < 0.1 * f2max || s > 0.4) continue;
        let re = 0;
        let im = 0;
        for (const atom of crystal.atoms) {
          const phase = 2 * Math.PI * (h * atom.frac[0] + k * atom.frac[1] + l * atom.frac[2]);
          const f = atom.occupancy * fx(atom.element, s);
          re += f * Math.cos(phase);
          im += f * Math.sin(phase);
        }
        expect(Math.abs((re * re + im * im) / ref - 1), `${name} (${h} ${k} ${l})`).toBeLessThan(
          0.05,
        );
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('density', () => {
  const rho = (name: string): number =>
    density(
      buildCrystal(
        parseFirstStructure(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8')).structure,
      ).crystal,
    );

  it('matches the known densities of the fixture crystals', () => {
    expect(rho('Si')).toBeCloseTo(2.33, 1);
    expect(rho('NaCl')).toBeCloseTo(2.165, 1);
    expect(rho('rutile')).toBeCloseTo(4.25, 1);
    expect(rho('graphite')).toBeCloseTo(2.27, 1);
    expect(rho('ZrO2_baddeleyite')).toBeCloseTo(5.82, 1);
  });
});
