import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal, type Crystal } from '../../src/core/crystal';
import {
  MANUAL_RULE,
  RangeError,
  addManualBond,
  applyRangePreset,
  atomKey,
  bondHalfColours,
  buildBondGraph,
  buildModel,
  buildPolyhedra,
  convexHullFaces,
  defaultAppearance,
  defaultBondRules,
  defaultViewSettings,
  getBondGraph,
  newBondRule,
  parseViewSettings,
  placeAtoms,
  presetRange,
  removeManualBond,
  resolveAppearance,
  resolveColours,
  resolveSites,
  settingsForNewCrystal,
  visibilityTree,
  type AtomRef,
  type StructureModel,
} from '../../src/core/structure';
import { cross, dot, sub, type Vec3 } from '../../src/core/math/vec3';
import { fixtureDir } from './helpers/fixtures';

const fromText = (text: string): Crystal =>
  buildCrystal(parseFirstStructure(text).structure).crystal;
const load = (name: string) => fromText(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8'));

/** A molecular crystal: linear CO2 molecules, one per 10 A cube, straddling the cell boundary. */
const CO2 = `data_co2
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
loop_
_space_group_symop_operation_xyz
x,y,z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0.99 0.5 0.5
O1 O 0.874 0.5 0.5
O2 O 1.106 0.5 0.5
`;

/** NaCl written with oxidation states in the type symbols. */
const NACL_IONIC = `data_nacl
_cell_length_a 5.62
_cell_length_b 5.62
_cell_length_c 5.62
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'F m -3 m'
_space_group_IT_number 225
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na1 Na1+ 0 0 0
Cl1 Cl1- 0.5 0.5 0.5
`;

/** bcc iron with a second, different metal, to have a compound without an anion. */
const INTERMETALLIC = `data_fealfe
_cell_length_a 2.87
_cell_length_b 2.87
_cell_length_c 2.87
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_space_group_name_H-M_alt 'P 1'
loop_
_space_group_symop_operation_xyz
x,y,z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Fe1 Fe 0 0 0
Al1 Al 0.5 0.5 0.5
`;

const ref = (atom: number, cell: [number, number, number] = [0, 0, 0]): AtomRef => ({ atom, cell });

describe('range: boundary and slab', () => {
  const nacl = load('NaCl');

  it('the three presets give 8 / 27 / 125 atoms for NaCl', () => {
    const count = (p: Parameters<typeof presetRange>[0]) => {
      const { range, boundary } = presetRange(p);
      return placeAtoms(nacl, range, { boundary }).count;
    };
    expect(count('cell')).toBe(8);
    expect(count('cellBoundary')).toBe(27);
    expect(count('supercell2')).toBe(125);
  });

  it('without boundary every atom is inside [0, 1) and there are no duplicates', () => {
    const placed = placeAtoms(nacl, { min: [0, 0, 0], max: [1, 1, 1] }, { boundary: false });
    for (let i = 0; i < placed.count * 3; i++) {
      expect(placed.frac[i]).toBeGreaterThanOrEqual(0);
      expect(placed.frac[i]).toBeLessThan(1);
    }
  });

  it('cuts a slab by distance from the (001) plane', () => {
    const box = { min: [0, 0, 0] as Vec3, max: [2, 2, 2] as Vec3 };
    const thin = placeAtoms(nacl, box, { slab: { hkl: [0, 0, 1], offset: 0, thickness: 1 } });
    expect(thin.count).toBe(25); // the z = 0 layer: 5 x 5 grid points
    const two = placeAtoms(nacl, box, { slab: { hkl: [0, 0, 1], offset: 0, thickness: 3 } });
    expect(two.count).toBe(50); // z = 0 and z = 2.81 A
    const shifted = placeAtoms(nacl, box, { slab: { hkl: [0, 0, 1], offset: 2, thickness: 2 } });
    expect(shifted.count).toBe(25); // only z = 2.81 A
    for (let i = 0; i < two.count; i++) expect(two.frac[3 * i + 2] * 5.62).toBeLessThan(3.0001);
  });

  it('measures a slab normal to (111) along the plane normal, not along z', () => {
    const box = { min: [0, 0, 0] as Vec3, max: [3, 3, 3] as Vec3 };
    const slab = { hkl: [1, 1, 1] as Vec3, offset: 1, thickness: 2 };
    const placed = placeAtoms(nacl, box, { slab });
    expect(placed.count).toBeGreaterThan(0);
    const d111 = 5.62 / Math.sqrt(3);
    for (let i = 0; i < placed.count; i++) {
      const s = (placed.frac[3 * i] + placed.frac[3 * i + 1] + placed.frac[3 * i + 2]) * d111;
      expect(s).toBeGreaterThanOrEqual(1 - 1e-3);
      expect(s).toBeLessThanOrEqual(3 + 1e-3);
    }
  });

  it('rejects an empty (hkl) and a non-positive thickness', () => {
    const box = { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 };
    expect(() =>
      placeAtoms(nacl, box, { slab: { hkl: [0, 0, 0], offset: 0, thickness: 1 } }),
    ).toThrow(RangeError);
    expect(() =>
      placeAtoms(nacl, box, { slab: { hkl: [0, 0, 1], offset: 0, thickness: 0 } }),
    ).toThrow(RangeError);
  });
});

describe('bond rules and the periodic bond graph', () => {
  it('start with one rule per element pair that really bonds', () => {
    expect(defaultBondRules(load('NaCl')).map((r) => `${r.a}-${r.b}`)).toEqual(['Cl-Na']);
    expect(defaultBondRules(load('Si')).map((r) => `${r.a}-${r.b}`)).toEqual(['Si-Si']);
    // metal-metal pairs are left out when an anion is present (Ti-Ti is 2.96 A in rutile)
    const rutile = defaultBondRules(load('rutile')).map((r) => `${r.a}-${r.b}`);
    expect(rutile).toEqual(['O-Ti']);
    // but kept in an intermetallic, where there is no anion
    const fe = defaultBondRules(fromText(INTERMETALLIC)).map((r) => `${r.a}-${r.b}`);
    expect(fe).toContain('Fe-Fe');
  });

  it('give Cl-Na the covalent-radius limit 1.15 (1.02 + 1.66) = 3.08 and min 0.5', () => {
    const [rule] = defaultBondRules(load('NaCl'));
    expect(rule.max).toBeCloseTo(3.08, 2);
    expect(rule.min).toBe(0.5);
    expect(rule.visible).toBe(true);
  });

  it('give every atom of the Si cell four neighbours, and every atom of NaCl six', () => {
    const si = load('Si');
    const g = buildBondGraph(si, defaultBondRules(si));
    for (let a = 0; a < si.atoms.length; a++)
      expect(g.start[a + 1] - g.start[a], `Si ${a}`).toBe(4);
    const nacl = load('NaCl');
    const gn = buildBondGraph(nacl, defaultBondRules(nacl));
    for (let a = 0; a < nacl.atoms.length; a++) expect(gn.start[a + 1] - gn.start[a]).toBe(6);
  });

  it('Si bond count per atom is 4 inside a 3 x 3 x 3 block', () => {
    const si = load('Si');
    const model = buildModel(si, { range: { min: [0, 0, 0], max: [3, 3, 3] } });
    const degree = new Uint32Array(model.count);
    for (const i of model.bonds) degree[i]++;
    let inside = 0;
    for (let i = 0; i < model.count; i++) {
      const f = [0, 1, 2].map((k) => model.placed.frac[3 * i + k]);
      if (f.every((x) => x > 1 && x < 2)) {
        expect(degree[i]).toBe(4);
        inside++;
      }
    }
    expect(inside).toBe(4); // the four interior atoms of the diamond cell
  });

  it('is symmetric: if a bonds to b in cell t, then b bonds to a in cell -t', () => {
    for (const name of ['graphite', 'ZrO2_baddeleyite', 'albite']) {
      const c = load(name);
      const g = buildBondGraph(c, defaultBondRules(c));
      expect(g.atom.length, name).toBeGreaterThan(0);
      const edges = new Set<string>();
      for (let a = 0; a < c.atoms.length; a++)
        for (let e = g.start[a]; e < g.start[a + 1]; e++)
          edges.add(
            `${a} ${g.atom[e]} ${g.shift[3 * e]} ${g.shift[3 * e + 1]} ${g.shift[3 * e + 2]}`,
          );
      for (const key of edges) {
        const [a, b, i, j, k] = key.split(' ').map(Number);
        expect(edges.has(`${b} ${a} ${-i + 0} ${-j + 0} ${-k + 0}`), `${name} ${key}`).toBe(true);
      }
    }
  });

  it('caches the graph for the same crystal and rules', () => {
    const si = load('Si');
    const rules = defaultBondRules(si);
    expect(getBondGraph(si, rules)).toBe(getBondGraph(si, rules));
    expect(getBondGraph(si, [{ ...rules[0], max: 2.0 }])).not.toBe(getBondGraph(si, rules));
  });

  it('use edited limits: a short maximum removes the bonds, a long one adds Na-Na', () => {
    const nacl = load('NaCl');
    const rules = defaultBondRules(nacl);
    expect(buildModel(nacl, { bonds: { rules: [{ ...rules[0], max: 2.0 }] } }).bonds).toHaveLength(
      0,
    );
    const withNaNa = buildModel(nacl, {
      bonds: { rules: [...rules, { ...newBondRule('Na', 'Na'), max: 4.2 }] },
    });
    expect(withNaNa.bonds.length / 2).toBeGreaterThan(54);
    expect(new Set(withNaNa.bondRule)).toEqual(new Set([0, 1]));
  });
});

describe('bonds beyond the range, and complete molecules', () => {
  const nacl = load('NaCl');
  const base = { range: { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 }, boundary: false };

  it('adds only atoms bonded to an atom of the range, with no bonds between two added atoms', () => {
    const plain = buildModel(nacl, base);
    expect(plain.count).toBe(8);
    expect(plain.bonds.length / 2).toBe(12);
    const model = buildModel(nacl, { ...base, bonds: { beyondRange: true } });
    expect(model.count).toBe(8 + 24);
    expect(model.bonds.length / 2).toBe(12 + 24);
    for (let i = 0; i < model.count; i++) expect(model.inRange[i]).toBe(i < 8 ? 1 : 0);
    const degree = new Uint32Array(model.count);
    for (let b = 0; b < model.bonds.length; b += 2) {
      expect(model.inRange[model.bonds[b]] + model.inRange[model.bonds[b + 1]]).toBeGreaterThan(0);
      degree[model.bonds[b]]++;
      degree[model.bonds[b + 1]]++;
    }
    for (let i = 0; i < 8; i++) expect(degree[i]).toBe(6);
  });

  it('completing a framework is impossible: it warns and shows one shell instead', () => {
    const beyond = buildModel(nacl, { ...base, bonds: { beyondRange: true } });
    const complete = buildModel(nacl, { ...base, bonds: { completeMolecules: true } });
    expect(complete.count).toBe(beyond.count);
    expect(complete.warnings.join(' ')).toMatch(/framework/i);
    expect(beyond.warnings).toEqual([]);
  });

  it('completes the molecules of a molecular crystal across the cell boundary', () => {
    const co2 = fromText(CO2);
    const cut = buildModel(co2, { range: { min: [0, 0, 0], max: [1, 1, 1] }, boundary: false });
    expect(cut.count).toBe(3);
    const whole = buildModel(co2, {
      range: { min: [0, 0, 0], max: [1, 1, 1] },
      boundary: false,
      bonds: { completeMolecules: true },
    });
    expect(whole.warnings).toEqual([]);
    expect(whole.count).toBe(6); // two whole CO2 molecules
    expect(whole.bonds.length / 2).toBe(4);
    const elements = Array.from(whole.species, (s) => whole.elements[s])
      .sort()
      .join('');
    expect(elements).toBe('CCOOOO');
  });
});

describe('manual bonds', () => {
  const nacl = load('NaCl');
  const range = { min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 };

  it('draws a bond between two atoms that are not bonded, and removes a bond that is', () => {
    const plain = buildModel(nacl, { range });
    const placed = plain.placed;
    const at = (i: number): AtomRef => ({
      atom: placed.atom[i],
      cell: [placed.cell[3 * i], placed.cell[3 * i + 1], placed.cell[3 * i + 2]],
    });
    // a bonded pair and a pair that is not bonded
    const bonded = [plain.bonds[0], plain.bonds[1]];
    const isBonded = (i: number, j: number) => {
      for (let b = 0; b < plain.bonds.length; b += 2)
        if (plain.bonds[b] === Math.min(i, j) && plain.bonds[b + 1] === Math.max(i, j)) return true;
      return false;
    };
    let free: [number, number] = [0, 1];
    outer: for (let i = 0; i < plain.count; i++)
      for (let j = i + 1; j < plain.count; j++)
        if (!isBonded(i, j)) {
          free = [i, j];
          break outer;
        }

    const added = buildModel(nacl, {
      range,
      bonds: { manual: { add: [[at(free[0]), at(free[1])]], remove: [] } },
    });
    expect(added.bonds.length / 2).toBe(plain.bonds.length / 2 + 1);
    expect(added.bondRule[added.bondRule.length - 1]).toBe(MANUAL_RULE);

    const removed = buildModel(nacl, {
      range,
      bonds: { manual: { add: [], remove: [[at(bonded[1]), at(bonded[0])]] } },
    });
    expect(removed.bonds.length / 2).toBe(plain.bonds.length / 2 - 1);
  });

  it('ignores manual bonds whose atoms are not shown', () => {
    const m = buildModel(nacl, {
      range,
      bonds: { manual: { add: [[ref(0, [9, 9, 9]), ref(1)]], remove: [] } },
    });
    expect(m.bonds.length / 2).toBe(buildModel(nacl, { range }).bonds.length / 2);
  });

  it('keeps the add and remove lists consistent when a bond is drawn then deleted', () => {
    const a = ref(0);
    const b = ref(1);
    let m = addManualBond({ add: [], remove: [] }, a, b);
    expect(m).toEqual({ add: [[a, b]], remove: [] });
    expect(addManualBond(m, b, a)).toBe(m); // already there, either order
    m = removeManualBond(m, b, a);
    expect(m).toEqual({ add: [], remove: [] }); // deleting a manual bond just forgets it
    m = removeManualBond(m, a, b);
    expect(m).toEqual({ add: [], remove: [[a, b]] });
    m = addManualBond(m, a, b);
    expect(m).toEqual({ add: [], remove: [] }); // drawing a removed bond restores it
  });
});

describe('convex hulls and coordination polyhedra', () => {
  const octahedron: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const centroid = (pts: Vec3[]): Vec3 => {
    const s = pts.reduce<[number, number, number]>(
      (a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]],
      [0, 0, 0],
    );
    return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
  };
  const outward = (pts: Vec3[], faces: number[][]) => {
    const c = centroid(pts);
    for (const f of faces) {
      const n = cross(sub(pts[f[1]], pts[f[0]]), sub(pts[f[2]], pts[f[0]]));
      expect(dot(n, sub(pts[f[0]], c))).toBeGreaterThan(0);
    }
  };

  it('finds the 8 triangles of an octahedron and the 4 of a tetrahedron, facing outward', () => {
    const faces = convexHullFaces(octahedron);
    expect(faces).toHaveLength(8);
    expect(faces.every((f) => f.length === 3)).toBe(true);
    outward(octahedron, faces);
    const tetra: Vec3[] = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
    const tf = convexHullFaces(tetra);
    expect(tf).toHaveLength(4);
    outward(tetra, tf);
  });

  it('keeps coplanar points as one polygon: a cube has 6 square faces, a square pyramid 5 faces', () => {
    const cube: Vec3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push([x, y, z]);
    const cf = convexHullFaces(cube);
    expect(cf).toHaveLength(6);
    expect(cf.every((f) => f.length === 4)).toBe(true);
    outward(cube, cf);
    const pyramid: Vec3[] = [
      [1, 1, 0],
      [-1, 1, 0],
      [-1, -1, 0],
      [1, -1, 0],
      [0, 0, 1.5],
    ];
    const pf = convexHullFaces(pyramid);
    expect(pf.map((f) => f.length).sort()).toEqual([3, 3, 3, 3, 4]);
    outward(pyramid, pf);
  });

  it('handles degenerate inputs: too few points, collinear points, one planar polygon', () => {
    expect(convexHullFaces([])).toEqual([]);
    expect(
      convexHullFaces([
        [0, 0, 0],
        [1, 0, 0],
      ]),
    ).toEqual([]);
    expect(
      convexHullFaces([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ]),
    ).toEqual([]);
    const square: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ];
    expect(convexHullFaces(square)).toHaveLength(1);
  });

  it('satisfies Euler V - E + F = 2 for random points on a sphere (all faces triangles)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let trial = 0; trial < 5; trial++) {
      const pts: Vec3[] = [];
      for (let i = 0; i < 12; i++) {
        const z = 2 * rnd() - 1;
        const t = 2 * Math.PI * rnd();
        const r = Math.sqrt(1 - z * z);
        pts.push([r * Math.cos(t), r * Math.sin(t), z]);
      }
      const faces = convexHullFaces(pts);
      expect(faces).toHaveLength(2 * pts.length - 4);
      const edges = new Set<string>();
      for (const f of faces)
        for (let q = 0; q < f.length; q++) {
          const a = f[q];
          const b = f[(q + 1) % f.length];
          edges.add(a < b ? `${a},${b}` : `${b},${a}`);
        }
      expect(pts.length - edges.size + faces.length).toBe(2);
      outward(pts, faces);
    }
  });

  const polyhedra = (name: string, centres: string[], beyondRange: boolean) => {
    const c = load(name);
    const model: StructureModel = buildModel(c, { bonds: { beyondRange } });
    const app = resolveAppearance(c, model, defaultAppearance(), model.rules);
    return buildPolyhedra(model, app, getBondGraph(c, model.rules), centres);
  };

  it('draws a polyhedron only where all neighbours are shown, unless bonds go beyond the range', () => {
    // In the closed NaCl cell exactly one atom (the body centre) has all six neighbours inside.
    const closed = polyhedra('NaCl', ['Na', 'Cl'], false);
    expect(closed.count).toBe(1);
    expect(closed.skipped).toBe(26);
    const beyond = polyhedra('NaCl', ['Na', 'Cl'], true);
    expect(beyond.count).toBe(27);
    const na = polyhedra('NaCl', ['Na'], true).count;
    const cl = polyhedra('NaCl', ['Cl'], true).count;
    expect(na + cl).toBe(27);
    expect([13, 14]).toContain(na);
  });

  it('gives each octahedron 8 triangles and 12 edges, coloured like the centre', () => {
    const one = polyhedra('NaCl', ['Na', 'Cl'], false);
    expect(one.triangles.length).toBe(8 * 9);
    expect(one.edges.length).toBe(12 * 6);
    expect(one.triangleColor.length).toBe(8 * 9);
    expect(one.edgeColor.length).toBe(12 * 6);
  });

  it('draws nothing for no centres, or for a structure without bonds', () => {
    expect(polyhedra('NaCl', [], true).count).toBe(0);
    const c = load('NaCl');
    const model = buildModel(c, { bonds: false });
    const app = resolveAppearance(c, model, defaultAppearance(), []);
    expect(buildPolyhedra(model, app, getBondGraph(c, []), ['Na']).count).toBe(0);
  });
});

describe('appearance: colours, radii, visibility', () => {
  const nacl = load('NaCl');
  const model = buildModel(nacl);
  const rules = model.rules;
  const elementOf = (i: number) => model.elements[model.species[i]];
  const resolve = (
    patch: Partial<ReturnType<typeof defaultAppearance>> = {},
    hidden: AtomRef[] = [],
  ) => resolveAppearance(nacl, model, { ...defaultAppearance(), ...patch }, rules, hidden);
  const hex = (a: ReturnType<typeof resolve>, i: number) =>
    '#' + [0, 1, 2].map((k) => a.atomColor[3 * i + k].toString(16).padStart(2, '0')).join('');

  it('uses Jmol colours and 0.45 x covalent radii for ball and stick', () => {
    const a = resolve();
    for (let i = 0; i < model.count; i++) {
      if (elementOf(i) === 'Na') {
        expect(hex(a, i)).toBe('#ab5cf2');
        expect(a.atomRadius[i]).toBeCloseTo(1.66 * 0.45, 5);
      } else {
        expect(hex(a, i)).toBe('#1ff01f');
        expect(a.atomRadius[i]).toBeCloseTo(1.02 * 0.45, 5);
      }
    }
    expect(a.bondsDrawn).toBe(true);
  });

  it("'auto' means van der Waals for space filling, and space filling draws no bonds", () => {
    const a = resolve({ displayStyle: 'spaceFill' });
    const na = [...Array(model.count).keys()].find((i) => elementOf(i) === 'Na')!;
    expect(a.atomRadius[na]).toBeCloseTo(2.5, 5);
    expect(a.bondsDrawn).toBe(false);
    expect(
      resolve({ displayStyle: 'spaceFill', radiusScheme: 'covalent' }).atomRadius[na],
    ).toBeCloseTo(1.66, 5);
  });

  it('applies scale, the uniform scheme and a stick style using the stick radius', () => {
    const na = [...Array(model.count).keys()].find((i) => elementOf(i) === 'Na')!;
    expect(resolve({ radiusScale: 2 }).atomRadius[na]).toBeCloseTo(1.66 * 0.45 * 2, 5);
    expect(resolve({ radiusScheme: 'uniform', uniformRadius: 0.8 }).atomRadius[na]).toBeCloseTo(
      0.36,
      5,
    );
    expect(resolve({ displayStyle: 'stick' }).atomRadius[na]).toBeCloseTo(0.12, 5);
  });

  it('takes ionic radii from the oxidation states in the type symbols (Shannon)', () => {
    const ionic = fromText(NACL_IONIC);
    expect(ionic.sites.map((s) => s.typeSymbol)).toEqual(['Na1+', 'Cl1-']);
    const sites = resolveSites(ionic, { ...defaultAppearance(), radiusScheme: 'ionic' }, 0.12);
    expect(sites[0].radius).toBeCloseTo(1.16 * 0.45, 5);
    expect(sites[1].radius).toBeCloseTo(1.67 * 0.45, 5);
    // no oxidation state written: falls back to the covalent radius
    const si = resolveSites(load('Si'), { ...defaultAppearance(), radiusScheme: 'ionic' }, 0.12);
    expect(si[0].radius).toBeCloseTo(1.11 * 0.45, 5);
  });

  it('lets a site override beat an element override beat the default', () => {
    const label = nacl.sites.find((s) => s.element === 'Na')!.label;
    const a = resolve({
      elements: { Na: { color: '#00ff00', radius: 1 } },
      sites: { [label]: { color: '#0000ff' } },
    });
    const na = [...Array(model.count).keys()].find((i) => elementOf(i) === 'Na')!;
    expect(hex(a, na)).toBe('#0000ff'); // site colour
    expect(a.atomRadius[na]).toBe(1); // element radius (the site has none)
  });

  it('hides by element, by site and by individual atom, and hides the bonds of hidden atoms', () => {
    const na = [...Array(model.count).keys()].find((i) => elementOf(i) === 'Na')!;
    const cl = [...Array(model.count).keys()].find((i) => elementOf(i) === 'Cl')!;
    const noNa = resolve({ elements: { Na: { visible: false } } });
    let hiddenNa = 0;
    for (let i = 0; i < model.count; i++) {
      expect(noNa.atomVisible[i] === 0).toBe(elementOf(i) === 'Na');
      if (elementOf(i) === 'Na') hiddenNa++;
    }
    expect(hiddenNa).toBe(14);
    expect(noNa.bondVisible.every((v) => v === 0)).toBe(true); // every NaCl bond has an Na end

    const label = nacl.sites.find((s) => s.element === 'Cl')!.label;
    expect(resolve({ sites: { [label]: { visible: false } } }).atomVisible[cl]).toBe(0);

    const one = resolve({}, [
      {
        atom: model.placed.atom[na],
        cell: [
          model.placed.cell[3 * na],
          model.placed.cell[3 * na + 1],
          model.placed.cell[3 * na + 2],
        ],
      },
    ]);
    expect(one.atomVisible[na]).toBe(0);
    expect(one.atomVisible.reduce((s, v) => s + v, 0)).toBe(model.count - 1);
  });

  it('hides and colours the bonds of one rule, and colours the rest by their end atoms', () => {
    const [rule] = rules;
    const off = resolveAppearance(nacl, model, defaultAppearance(), [{ ...rule, visible: false }]);
    expect(off.bondVisible.every((v) => v === 0)).toBe(true);
    const red = resolveAppearance(nacl, model, defaultAppearance(), [
      { ...rule, color: '#ff0000', radius: 0.3 },
    ]);
    expect(bondHalfColours(model, red, 0)).toEqual([
      [255, 0, 0],
      [255, 0, 0],
    ]);
    expect(red.bondRadius[0]).toBeCloseTo(0.3, 6);
    const split = resolve();
    const i = model.bonds[0];
    const j = model.bonds[1];
    const [first, second] = bondHalfColours(model, split, 0);
    expect(first).toEqual(Array.from(split.atomColor.slice(3 * i, 3 * i + 3)));
    expect(second).toEqual(Array.from(split.atomColor.slice(3 * j, 3 * j + 3)));
    expect(first).not.toEqual(second); // an Na-Cl bond has two different halves
  });

  it('resolves colours alone, identically to the full appearance', () => {
    const settings = {
      ...defaultAppearance(),
      elements: { Na: { color: '#123456' } },
    };
    const rule = { ...rules[0], color: '#abcdef' };
    const full = resolveAppearance(nacl, model, settings, [rule]);
    const only = resolveColours(nacl, model, settings, [rule]);
    expect(Array.from(only.atomColor)).toEqual(Array.from(full.atomColor));
    expect(Array.from(only.ruleColor)).toEqual(Array.from(full.ruleColor));
    expect(Array.from(only.ruleColored)).toEqual([1]);
    // a manual bond has no rule colour and takes its end atoms'
    const manual = {
      ...model,
      bondRule: Uint16Array.from([MANUAL_RULE]),
      bonds: model.bonds.slice(0, 2),
    };
    expect(bondHalfColours(manual, only, 0)[0]).toEqual(
      Array.from(only.atomColor.slice(3 * model.bonds[0], 3 * model.bonds[0] + 3)),
    );
  });

  it('switches every bond off with the bonds flag', () => {
    expect(resolve({ bondsVisible: false }).bondsDrawn).toBe(false);
  });

  it('builds the visibility tree: elements with their sites and the current state', () => {
    const tree = visibilityTree(nacl, {
      ...defaultAppearance(),
      elements: { Cl: { visible: false } },
    });
    expect(tree.map((n) => n.element).sort()).toEqual(['Cl', 'Na']);
    const clNode = tree.find((n) => n.element === 'Cl')!;
    expect(clNode.visible).toBe(false);
    expect(clNode.sites[0].count).toBe(4);
    expect(tree.find((n) => n.element === 'Na')!.visible).toBe(true);
  });
});

describe('view settings survive a JSON round trip', () => {
  const nacl = load('NaCl');

  it('keeps every field of a heavily edited state', () => {
    const s = defaultViewSettings(nacl);
    applyRangePreset(s, 'supercell2');
    s.range.slab = { hkl: [1, 1, 0], offset: 0.5, thickness: 4 };
    s.bonds.rules[0] = {
      ...s.bonds.rules[0],
      max: 3.3,
      color: '#123456',
      radius: 0.2,
      visible: false,
    };
    s.bonds.rules.push(newBondRule('Na', 'Na'));
    s.bonds.beyondRange = true;
    s.bonds.completeMolecules = true;
    s.bonds.manual = { add: [[ref(0), ref(1, [1, 0, 0])]], remove: [[ref(2), ref(3)]] };
    s.polyhedra = { centres: ['Na'], opacity: 0.3, edges: false };
    s.appearance = {
      ...s.appearance,
      displayStyle: 'spaceFill',
      radiusScheme: 'ionic',
      radiusScale: 0.7,
      uniformRadius: 0.9,
      bondsVisible: false,
      background: '#102030',
      labels: 'site',
      elements: { Na: { color: '#112233', radius: 1.5, visible: false } },
      sites: { Cl1: { color: '#445566' } },
    };
    s.hiddenAtoms = [ref(4, [1, 1, 0])];
    s.showCell = false;
    s.showAxes = false;
    s.toon = true;
    s.projection = 'persp';
    const back = parseViewSettings(JSON.parse(JSON.stringify(s)), nacl);
    expect(back).toEqual(s);
  });

  it('fills in defaults for missing or malformed fields instead of failing', () => {
    const defaults = defaultViewSettings(nacl);
    expect(parseViewSettings(null, nacl)).toEqual(defaults);
    expect(parseViewSettings('nonsense', nacl)).toEqual(defaults);
    expect(parseViewSettings({}, nacl)).toEqual(defaults);
    const odd = parseViewSettings(
      {
        range: { min: [0, 0, 0], max: [-1, 1, 1] },
        bonds: { rules: [{ a: 'Na' }, 7], manual: { add: [[1, 2]] } },
        appearance: { displayStyle: 'cubist', background: 'red', radiusScale: -3 },
        polyhedra: { opacity: 7 },
        projection: 'fisheye',
      },
      nacl,
    );
    expect(odd.range).toEqual(defaults.range);
    expect(odd.bonds.rules).toEqual([]);
    expect(odd.bonds.manual.add).toEqual([]);
    expect(odd.appearance).toEqual(defaults.appearance);
    expect(odd.polyhedra.opacity).toBe(1);
    expect(odd.projection).toBe('ortho');
  });

  it('starts a new crystal with fresh rules and overrides but keeps the user preferences', () => {
    const s = defaultViewSettings(nacl);
    s.appearance.displayStyle = 'spaceFill';
    s.appearance.background = '#000000';
    s.appearance.elements = { Na: { color: '#ffffff' } };
    s.hiddenAtoms = [ref(0)];
    s.showCell = false;
    s.range.max = [3, 3, 3];
    const si = load('Si');
    const next = settingsForNewCrystal(s, si);
    expect(next.appearance.displayStyle).toBe('spaceFill');
    expect(next.appearance.background).toBe('#000000');
    expect(next.showCell).toBe(false);
    expect(next.appearance.elements).toEqual({});
    expect(next.hiddenAtoms).toEqual([]);
    expect(next.range.max).toEqual([1, 1, 1]);
    expect(next.bonds.rules.map((r) => `${r.a}-${r.b}`)).toEqual(['Si-Si']);
  });
});

describe('atom keys', () => {
  it('are unique for distinct (atom, cell) and independent of order of use', () => {
    const seen = new Set<number>();
    for (let a = 0; a < 3; a++)
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) seen.add(atomKey(a, i, j, k));
    expect(seen.size).toBe(3 * 125);
  });
});
