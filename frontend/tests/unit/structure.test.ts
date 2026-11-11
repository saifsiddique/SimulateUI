import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal } from '../../src/core/crystal';
import {
  RangeError,
  angle,
  buildModel,
  limitsFromRules,
  newBondRule,
  distance,
  findBonds,
  measure,
  pickSphere,
  placeAtoms,
  torsion,
} from '../../src/core/structure';
import { fixtureDir } from './helpers/fixtures';

const load = (name: string) =>
  buildCrystal(parseFirstStructure(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8')).structure)
    .crystal;

describe('placeAtoms', () => {
  const nacl = load('NaCl');

  it('puts boundary atoms on every face of the closed unit cell (27 = 14 Na + 13 Cl)', () => {
    const placed = placeAtoms(nacl);
    expect(nacl.atoms).toHaveLength(8);
    expect(placed.count).toBe(27);
  });

  it('fills a 2x2x2 range with every point of the half-spaced grid (5^3)', () => {
    expect(placeAtoms(nacl, { min: [0, 0, 0], max: [2, 2, 2] }).count).toBe(125);
  });

  it('supports negative and fractional ranges', () => {
    const placed = placeAtoms(nacl, { min: [-0.6, -0.6, -0.6], max: [0.1, 0.1, 0.1] });
    expect(placed.count).toBe(8); // grid points at -0.5 and 0 on each axis
    for (let i = 0; i < placed.count; i++) {
      for (let k = 0; k < 3; k++) {
        const f = placed.frac[3 * i + k];
        expect(f).toBeGreaterThanOrEqual(-0.6);
        expect(f).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('records the lattice translation of each image', () => {
    const placed = placeAtoms(nacl, { min: [1, 0, 0], max: [2, 1, 1] });
    for (let i = 0; i < placed.count; i++) {
      const f = nacl.atoms[placed.atom[i]].frac;
      expect(placed.frac[3 * i]).toBeCloseTo(f[0] + placed.cell[3 * i], 12);
    }
  });

  it('rejects inverted and absurd ranges', () => {
    expect(() => placeAtoms(nacl, { min: [0, 0, 0], max: [-1, 1, 1] })).toThrow(RangeError);
    expect(() => placeAtoms(nacl, { min: [0, 0, 0], max: [500, 500, 500] })).toThrow(RangeError);
    expect(() => placeAtoms(nacl, { min: [NaN, 0, 0], max: [1, 1, 1] })).toThrow(RangeError);
  });
});

describe('findBonds', () => {
  it('finds the 54 nearest-neighbour bonds of the closed NaCl cell and no Na-Na or Cl-Cl', () => {
    const model = buildModel(load('NaCl'));
    expect(model.count).toBe(27);
    expect(model.bonds.length / 2).toBe(54);
    for (let b = 0; b < model.bonds.length; b += 2) {
      const i = model.bonds[b];
      const j = model.bonds[b + 1];
      expect(model.species[i]).not.toBe(model.species[j]);
      expect(
        distance(
          [model.cart[3 * i], model.cart[3 * i + 1], model.cart[3 * i + 2]],
          [model.cart[3 * j], model.cart[3 * j + 1], model.cart[3 * j + 2]],
        ),
      ).toBeCloseTo(5.62 / 2, 3);
    }
  });

  it('agrees with brute force on random points', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const count = 400;
    const cart = new Float64Array(3 * count).map(() => rnd() * 20);
    const species = new Uint16Array(count).map(() => Math.floor(rnd() * 3));
    const elements = ['H', 'C', 'O'];
    const rules = [];
    for (let i = 0; i < 3; i++)
      for (let j = i; j < 3; j++) rules.push(newBondRule(elements[i], elements[j]));
    const limits = limitsFromRules(elements, rules);
    const got = findBonds({ cart, count, species, nSpecies: 3, ...limits }).pairs;
    const found = new Set<string>();
    for (let b = 0; b < got.length; b += 2) found.add(`${got[b]} ${got[b + 1]}`);
    const expected = new Set<string>();
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++) {
        const d = Math.hypot(
          cart[3 * i] - cart[3 * j],
          cart[3 * i + 1] - cart[3 * j + 1],
          cart[3 * i + 2] - cart[3 * j + 2],
        );
        const p = species[i] * 3 + species[j];
        if (d <= limits.maxDistance[p] && d >= limits.minDistance[p]) expected.add(`${i} ${j}`);
      }
    expect(expected.size).toBeGreaterThan(20);
    expect(found).toEqual(expected);
  });

  it('handles empty and single-atom inputs', () => {
    const limits = limitsFromRules(['C'], [newBondRule('C', 'C')]);
    const base = { species: new Uint16Array(1), nSpecies: 1, ...limits };
    expect(findBonds({ ...base, cart: new Float64Array(0), count: 0 }).pairs).toHaveLength(0);
    expect(findBonds({ ...base, cart: new Float64Array(3), count: 1 }).pairs).toHaveLength(0);
  });
});

describe('model and styles', () => {
  it('lists the elements present, with colours and radii', () => {
    const model = buildModel(load('NaCl'));
    expect(model.elements.sort()).toEqual(['Cl', 'Na']);
    expect(model.info.every((i) => /^#[0-9a-f]{6}$/.test(i.color))).toBe(true);
    expect(model.bounds.max[0]).toBeCloseTo(5.62, 3);
  });

  it('can skip the bond search', () => {
    expect(buildModel(load('NaCl'), { bonds: false }).bonds).toHaveLength(0);
  });

  it('handles a file with a hexagonal cell (positions use the standard frame)', () => {
    const model = buildModel(load('graphite'));
    expect(model.count).toBeGreaterThan(4);
    expect(model.bonds.length).toBeGreaterThan(0);
  });
});

describe('measure', () => {
  it('computes distance and angle', () => {
    expect(distance([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(angle([1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeCloseTo(90, 10);
    expect(angle([1, 0, 0], [0, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 10);
    expect(angle([1, 0, 0], [0, 0, 0], [0, 0, 0])).toBeNaN();
    const tetra = Math.acos(-1 / 3) * (180 / Math.PI);
    expect(angle([1, 1, 1], [0, 0, 0], [1, -1, -1])).toBeCloseTo(tetra, 8);
  });

  it('computes torsion with the IUPAC sign', () => {
    // b-c along z; a at +x on the near side; d rotated about z by +90 deg (counter-clockwise seen
    // from +z) from a is looking from b to c (down +z): counter-clockwise from +z is
    // anticlockwise, which is a negative torsion.
    expect(torsion([1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1])).toBeCloseTo(0, 10);
    expect(torsion([1, 0, 0], [0, 0, 0], [0, 0, 1], [-1, 0, 1])).toBeCloseTo(180, 10);
    expect(Math.abs(torsion([1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]))).toBeCloseTo(90, 10);
    expect(torsion([1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1])).toBeCloseTo(
      -torsion([1, 0, 0], [0, 0, 0], [0, 0, 1], [0, -1, 1]),
      10,
    );
    // The textbook case: gauche- / gauche+ butane is +/-60 and the sign flips under mirroring.
    const a: [number, number, number] = [1, 0, 0];
    const d = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 1] as [number, number, number];
    const dm = [d[0], -d[1], d[2]] as [number, number, number];
    expect(torsion(a, [0, 0, 0], [0, 0, 1], d)).toBeCloseTo(
      -torsion(a, [0, 0, 0], [0, 0, 1], dm),
      10,
    );
    expect(Math.abs(torsion(a, [0, 0, 0], [0, 0, 1], d))).toBeCloseTo(60, 8);
    expect(torsion([1, 0, 0], [0, 0, 0], [2, 0, 0], [3, 1, 0])).toBeNaN();
  });

  it('describes a selection by its length', () => {
    const p: [number, number, number][] = [
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ];
    expect(measure([])).toEqual([]);
    expect(measure([p[0]])).toEqual([]);
    expect(measure(p.slice(0, 2)).map((m) => m.kind)).toEqual(['distance']);
    expect(measure(p.slice(0, 3)).map((m) => m.kind)).toEqual(['distance', 'distance', 'angle']);
    const four = measure(p);
    expect(four.map((m) => m.kind)).toEqual(['distance', 'distance', 'distance', 'torsion']);
    expect(four[3].value).toBeCloseTo(0, 10);
    expect(four[3].anchor).toEqual([0, 0, 0.5]);
    expect(measure(p.slice(0, 3))[2].anchor).toEqual([0, 0, 0]);
  });
});

describe('pickSphere', () => {
  const centres = new Float64Array([0, 0, 0, 0, 0, -5, 3, 0, 0]);
  const radii = new Float32Array([1, 1, 1]);

  it('returns the nearest sphere along the ray', () => {
    const hit = pickSphere(0, 0, 10, 0, 0, -1, centres, radii, 3);
    expect(hit?.index).toBe(0);
    expect(hit?.t).toBeCloseTo(9, 10);
  });

  it('misses between spheres and respects the radius exactly', () => {
    expect(pickSphere(1.01, 0, 10, 0, 0, -1, centres, radii, 3)).toBeNull();
    expect(pickSphere(0.99, 0, 10, 0, 0, -1, centres, radii, 3)?.index).toBe(0);
    expect(pickSphere(3, 0.99, 10, 0, 0, -1, centres, radii, 3)?.index).toBe(2);
  });

  it('ignores hidden spheres (radius 0), spheres behind the ray, and handles an inside origin', () => {
    expect(pickSphere(0, 0, 10, 0, 0, -1, centres, new Float32Array([0, 1, 1]), 3)?.index).toBe(1);
    expect(pickSphere(0, 0, 10, 0, 0, 1, centres, radii, 3)).toBeNull();
    expect(pickSphere(0, 0, 0, 0, 0, -1, centres, radii, 3)?.index).toBe(0);
  });
});
