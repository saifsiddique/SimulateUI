import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure, type CifStructure } from '../../src/core/cif';
import { buildCrystal, compactFormula } from '../../src/core/crystal';
import { SymmetryError } from '../../src/core/errors';
import { periodicDistance } from '../../src/core/symmetry/expand';
import {
  centringVectors,
  closure,
  findSpaceGroupsByHM,
  formatSymop,
  hallToOps,
  parseSymop,
  pointGroupRotations,
  standardSetting,
  type SymOp,
} from '../../src/core/symmetry';
import { fixtureDir, fixtures, names } from './helpers/fixtures';

const load = (name: string): CifStructure =>
  parseFirstStructure(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8')).structure;

describe('symmetry operation parser', () => {
  const op = (s: string): SymOp => parseSymop(s);

  it('reads the usual forms exactly', () => {
    expect(op('-x+1/2, y, z+1/4')).toEqual({
      R: [
        [-1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      t: [0.5, 0, 0.25],
    });
    expect(op('x-y, x, z+1/6').R).toEqual([
      [1, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ]);
    expect(op('x-y, x, z+1/6').t[2]).toBeCloseTo(1 / 6, 15);
    expect(op('+x,+y,+z')).toEqual(op('x, y, z'));
    expect(op('1/2+x, -y+1/2, 0.5-z').t).toEqual([0.5, 0.5, 0.5]);
    expect(op('X, Y, Z')).toEqual(op('x,y,z'));
    expect(op(' -y , x - y , z + 2/3 ').t[2]).toBeCloseTo(2 / 3, 15);
  });

  it('snaps rounded decimals like 0.3333 to thirds', () => {
    expect(op('x+0.3333, y+0.6667, z+0.25').t).toEqual([1 / 3, 2 / 3, 0.25]);
    expect(op('x+0.123, y, z').t[0]).toBe(0.123);
  });

  it('throws SymmetryError for malformed operations', () => {
    for (const bad of ['x,y', 'x,y,z,x', 'x,,z', 'x,y,q', '1/2x,y,z', 'x+1/0,y,z', '']) {
      expect(() => parseSymop(bad), bad).toThrow(SymmetryError);
    }
  });

  it('formats back to text that parses to the same operation', () => {
    for (const o of hallToOps('-F 4vw 2vw 3')) {
      expect(parseSymop(formatSymop(o))).toEqual(o);
    }
  });
});

describe('groups', () => {
  it('closes generators to the full group modulo lattice translations', () => {
    const inversion = parseSymop('-x,-y,-z');
    const screw = parseSymop('-x, y+1/2, -z+1/2');
    expect(closure([inversion, screw])).toHaveLength(4);
    expect(closure([parseSymop('x+1/2,y+1/2,z')])).toHaveLength(2);
  });

  it('refuses operations that do not form a finite crystallographic group', () => {
    expect(() => closure([parseSymop('x+y, y, z'), parseSymop('x, y+z, z')])).toThrow(
      SymmetryError,
    );
  });

  it('knows centring and point-group rotations', () => {
    const fcc = hallToOps('-F 4 2 3');
    expect(fcc).toHaveLength(192);
    expect(centringVectors(fcc)).toHaveLength(3);
    expect(pointGroupRotations(fcc)).toHaveLength(48);
    expect(pointGroupRotations(hallToOps('-P 6 2c'))).toHaveLength(24);
    expect(centringVectors(hallToOps('P 1'))).toEqual([]);
  });

  it('looks up Hermann-Mauguin symbols regardless of spacing, underscores and case', () => {
    expect(findSpaceGroupsByHM('P 1 21/c 1')[0].number).toBe(14);
    expect(findSpaceGroupsByHM('P 21/c')[0].number).toBe(14);
    expect(findSpaceGroupsByHM('P 63/m m c')[0].number).toBe(194);
    expect(findSpaceGroupsByHM('p n m a')[0].number).toBe(62);
    expect(findSpaceGroupsByHM('P b n m')[0].hall).toBe('-P 2c 2ab');
    expect(findSpaceGroupsByHM('F d -3 m :1')[0].choice).toBe('1');
    expect(findSpaceGroupsByHM('F d -3 m :2')[0].choice).toBe('2');
    expect(findSpaceGroupsByHM('not a group')).toEqual([]);
    expect(standardSetting(227)?.short).toBe('Fd-3m');
  });
});

describe('unit cell of the fixture structures', () => {
  for (const name of names) {
    describe(name, () => {
      const fx = fixtures[name];
      const { crystal, warnings } = buildCrystal(load(name));

      it('has the same sites, element counts and space group as pymatgen/spglib', () => {
        expect(crystal.positions.length).toBe(fx.unit_cell.n_sites);
        for (const [el, n] of Object.entries(fx.unit_cell.counts)) {
          expect(crystal.summary.counts[el], el).toBeCloseTo(n, 6);
        }
        expect(Object.keys(crystal.summary.counts).sort()).toEqual(
          Object.keys(fx.unit_cell.counts).sort(),
        );
        expect(crystal.spaceGroup.number).toBe(fx.space_group.detected_number);
        expect(crystal.ops.length).toBe(fx.space_group.n_operations);
        expect(warnings).toEqual([]);
      });

      it('places every pymatgen atom (species, occupancy, position) on one of ours', () => {
        for (const ref of fx.unit_cell.atoms) {
          const match = crystal.positions.find(
            (p) => periodicDistance(crystal.lattice, p.frac, ref.frac) < 0.01,
          );
          expect(match, `no position near ${ref.frac}`).toBeDefined();
          const ours: Record<string, number> = {};
          for (const i of match!.atoms) {
            const a = crystal.atoms[i];
            ours[a.element] = (ours[a.element] ?? 0) + a.occupancy;
          }
          for (const [el, occ] of Object.entries(ref.species)) {
            expect(ours[el], `${el} at ${ref.frac}`).toBeCloseTo(occ, 3);
          }
        }
      });

      it('summarises the cell content', () => {
        expect(crystal.summary.volume).toBeCloseTo(fx.volume, 6);
        expect(crystal.summary.Z).toBeGreaterThan(0);
      });
    });
  }

  it('reports multiplicities of special positions (Si: 8a gives 8 atoms from 192 operations)', () => {
    const { crystal } = buildCrystal(load('Si'));
    expect(crystal.sites).toHaveLength(1);
    expect(crystal.sites[0].multiplicity).toBe(8);
    expect(crystal.summary.formula).toBe('Si');
    expect(crystal.summary.Z).toBe(8);
  });

  it('computes the formula and Z from the cell content', () => {
    expect(buildCrystal(load('albite')).crystal.summary).toMatchObject({
      formula: 'Al Na O8 Si3',
      Z: 4,
    });
    expect(buildCrystal(load('NaCl')).crystal.summary).toMatchObject({ formula: 'Cl Na', Z: 4 });
  });

  it('merges the Fe/Mg mixture of olivine into shared positions', () => {
    const { crystal } = buildCrystal(load('olivine_partial'));
    const mixed = crystal.positions.filter((p) => p.atoms.length > 1);
    expect(mixed.length).toBeGreaterThan(0);
    expect(crystal.atoms.length).toBeGreaterThan(crystal.positions.length);
  });
});

describe('symmetry from the space-group symbol alone', () => {
  // Fixtures whose declared H-M symbol identifies the setting; albite is declared 'C -1', a
  // non-standard centring of P-1 that no table entry carries, so it is expected to need symops.
  for (const name of names.filter((n) => n !== 'albite')) {
    it(`${name}: same unit cell as with the CIF's own operations`, () => {
      const full = buildCrystal(load(name)).crystal;
      const s = { ...load(name), symops: [] };
      const { crystal, warnings } = buildCrystal(s);
      expect(crystal.spaceGroup.source).toBe('space-group-table');
      expect(crystal.positions.length).toBe(full.positions.length);
      expect(crystal.atoms.length).toBe(full.atoms.length);
      expect(crystal.ops.length).toBe(full.ops.length);
      // Only an ambiguity warning about the origin choice is acceptable.
      for (const w of warnings) expect(w.message).toMatch(/origin \/ axes choice/);
    });
  }

  it('falls back to the IT number, then to P1 with a warning', () => {
    const si = load('NaCl');
    const byNumber = buildCrystal({ ...si, symops: [], spaceGroup: { number: 225 } });
    expect(byNumber.crystal.ops).toHaveLength(192);
    const p1 = buildCrystal({ ...si, symops: [], spaceGroup: {} });
    expect(p1.crystal.spaceGroup.source).toBe('p1-assumed');
    expect(p1.warnings.some((w) => w.message.includes('P1'))).toBe(true);
    expect(p1.crystal.atoms).toHaveLength(si.atoms.length);
  });

  it('prefers the Hall symbol when given', () => {
    const si = load('Si');
    const { crystal } = buildCrystal({
      ...si,
      symops: [],
      spaceGroup: { hall: 'F 4d 2 3 -1d (0 0 0)' },
    });
    expect(crystal.ops).toHaveLength(192);
  });
});

describe('robustness of the symmetry step', () => {
  it('de-duplicates repeated operations (as in pymatgen-written CIFs)', () => {
    const s = load('NaCl');
    const doubled = { ...s, symops: [...s.symops, ...s.symops] };
    const { crystal, warnings } = buildCrystal(doubled);
    expect(crystal.ops).toHaveLength(192);
    expect(crystal.atoms).toHaveLength(8);
    expect(warnings).toEqual([]);
  });

  it('completes an operation list that is only a set of generators', () => {
    const s = load('NaCl');
    const { crystal, warnings } = buildCrystal({
      ...s,
      symops: ['-x,-y,-z', '-y,x,z', 'z,x,y', 'x+1/2,y+1/2,z', 'x+1/2,y,z+1/2'],
    });
    expect(crystal.ops).toHaveLength(192);
    expect(warnings.some((w) => w.message.includes('generate'))).toBe(true);
    expect(crystal.atoms).toHaveLength(8);
  });

  it('warns when the listed operations contradict the declared space group', () => {
    const s = load('NaCl');
    const { warnings } = buildCrystal({ ...s, spaceGroup: { number: 194 } });
    expect(warnings.some((w) => w.message.includes('194'))).toBe(true);
  });

  it('falls back to the symbol when an operation cannot be read', () => {
    const s = load('NaCl');
    const { crystal, warnings } = buildCrystal({ ...s, symops: ['x,y,z', 'garbage'] });
    expect(crystal.spaceGroup.source).toBe('space-group-table');
    expect(warnings.length).toBeGreaterThan(0);
    expect(crystal.atoms).toHaveLength(8);
  });

  it('keeps overlapping atoms but warns when their occupancies exceed 1', () => {
    const s = load('NaCl');
    const dup = { ...s, atoms: [...s.atoms, { ...s.atoms[0], label: 'Na2' }] };
    const { crystal, warnings } = buildCrystal(dup);
    expect(crystal.atoms.length).toBe(12);
    expect(crystal.positions.length).toBe(8);
    expect(warnings.some((w) => w.message.includes('occupancy'))).toBe(true);
  });

  it('wraps coordinates outside [0, 1) and merges atoms at 0 and 1', () => {
    const s = load('NaCl');
    const shifted = { ...s, atoms: s.atoms.map((a) => ({ ...a, x: a.x + 1, y: a.y - 2 })) };
    const { crystal } = buildCrystal(shifted);
    expect(crystal.atoms).toHaveLength(8);
    for (const a of crystal.atoms) {
      for (const x of a.frac) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
        expect(Object.is(x, -0)).toBe(false);
      }
    }
  });

  it('treats 0.9999999 as 0: rounding noise in a coordinate does not leave atoms outside [0, 1)', () => {
    const s = load('NaCl');
    const noisy = { ...s, atoms: s.atoms.map((a) => ({ ...a, x: a.x - 1e-7, z: a.z + 1e-7 })) };
    const { crystal } = buildCrystal(noisy);
    expect(crystal.atoms).toHaveLength(8);
    for (const a of crystal.atoms) for (const x of a.frac) expect(x).toBeLessThan(1 - 1e-6);
  });

  it('does not merge distinct atoms of a large primitive cell', () => {
    const s = load('graphite');
    const grid = Array.from({ length: 30 }, (_, i) => ({
      ...s.atoms[0],
      label: `C${i}`,
      x: (i % 5) / 5,
      y: Math.floor(i / 5) / 6,
      z: 0.123,
    }));
    const { crystal } = buildCrystal({ ...s, symops: ['x,y,z'], spaceGroup: {}, atoms: grid });
    expect(crystal.atoms).toHaveLength(30);
  });
});

describe('compact formula for labels', () => {
  const f = (counts: Record<string, number>, Z?: number) => compactFormula({ counts, Z });
  it('puts the electropositive element first, by the IUPAC sequence', () => {
    expect(f({ O: 4, Ti: 2 }, 2)).toBe('TiO2');
    expect(f({ Cl: 4, Na: 4 }, 4)).toBe('NaCl');
    expect(f({ Ge: 4, Fe: 4 }, 4)).toBe('FeGe');
    expect(f({ Te: 12, Er: 4 }, 4)).toBe('ErTe3');
    expect(f({ Te: 2, Pt: 1 }, 1)).toBe('PtTe2'); // electronegativity alone would put Te first
    expect(f({ O: 32, Si: 12, Al: 4, Na: 4 }, 4)).toBe('NaAlSi3O8');
  });
  it('keeps fractions, and Hill order for organics', () => {
    expect(f({ Mg: 7.2, Fe: 0.8, Si: 4, O: 16 }, 4)).toBe('Mg1.8Fe0.2SiO4');
    expect(f({ O: 2, H: 6, C: 2 }, 1)).toBe('C2H6O2');
  });
  it('labels the fixture files as a chemist writes them', () => {
    const label = (name: string) =>
      compactFormula(
        buildCrystal(
          parseFirstStructure(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8')).structure,
        ).crystal.summary,
      );
    expect(label('rutile')).toBe('TiO2');
    expect(label('albite')).toBe('NaAlSi3O8');
    expect(label('ZrO2_baddeleyite')).toBe('ZrO2');
  });
});
