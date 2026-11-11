import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { cellShape, shapeVectors, type CellShape } from '../../src/core/cellShape';
import { buildCrystal, type Cell } from '../../src/core/crystal';
import { buildLattice } from '../../src/core/lattice';
import {
  DEFAULT_XRAY_LINE,
  sFromTwoTheta,
  twoThetaFromD,
  twoThetaFromS,
} from '../../src/core/radiation';
import { hmTokens, hmUnicode } from '../../src/core/symmetry/hmFormat';
import { SPACE_GROUP_TYPES } from '../../src/core/symmetry/spacegroup';
import { fixtureDir, names } from './helpers/fixtures';

describe('radiation', () => {
  it('defaults to Cu Kalpha1', () => {
    expect(DEFAULT_XRAY_LINE.id).toBe('CuKa1');
    expect(DEFAULT_XRAY_LINE.lambda).toBeCloseTo(1.5406, 4);
  });

  it('gives the textbook Si (111) angle with Cu Kalpha1 and round-trips 2theta <-> s', () => {
    expect(twoThetaFromD(3.1356, 1.5405929)).toBeCloseTo(28.443, 2);
    const s = sFromTwoTheta(40, 1.5405929);
    expect(twoThetaFromS(s, 1.5405929)).toBeCloseTo(40, 10);
    expect(s).toBeCloseTo(1 / (2 * (1.5405929 / (2 * Math.sin((20 * Math.PI) / 180)))), 12);
  });

  it('returns NaN when there is no reflection', () => {
    expect(twoThetaFromD(0.7, 1.5406)).toBeNaN();
    expect(twoThetaFromS(1, 1.5406)).toBeNaN();
  });
});

describe('Hermann-Mauguin typesetting', () => {
  it('turns screw axes into subscripts and rotoinversions into bars', () => {
    expect(hmUnicode('P6_3/mmc')).toBe('P6₃/mmc');
    expect(hmUnicode('Fd-3m')).toBe('Fd3̅m');
    expect(hmUnicode('I4_1/amd')).toBe('I4₁/amd');
    expect(hmUnicode('P2_12_12_1')).toBe('P2₁2₁2₁');
    expect(hmUnicode('P-42_1c')).toBe('P4̅2₁c');
    expect(hmUnicode('P 63/m m c')).toBe('P63/mmc'); // CIF spelling without '_' is left as is
  });

  it('marks letters italic and digits upright, and keeps a setting suffix', () => {
    const t = hmTokens('Pnma');
    expect(t.every((x) => x.italic)).toBe(true);
    expect(hmTokens('P2_1/c')[1]).toEqual({ text: '2', sub: '1', italic: false });
    expect(hmTokens('Fd-3m:2').at(-1)).toEqual({ text: ':2', italic: false });
  });

  it('handles every symbol in the table without leaving underscores', () => {
    for (const sg of SPACE_GROUP_TYPES) {
      const text = hmTokens(sg.short)
        .map((t) => t.text + (t.sub ?? ''))
        .join('');
      expect(text, sg.short).not.toContain('_');
    }
  });
});

describe('cell shape and the equations for a, b, c', () => {
  const cell = (a: number, b: number, c: number, al: number, be: number, ga: number): Cell => ({
    a,
    b,
    c,
    alpha: al,
    beta: be,
    gamma: ga,
  });
  const cases: [CellShape, Cell][] = [
    ['cubic', cell(5, 5, 5, 90, 90, 90)],
    ['tetragonal', cell(4, 4, 7, 90, 90, 90)],
    ['orthorhombic', cell(4, 5, 7, 90, 90, 90)],
    ['hexagonal', cell(3, 3, 8, 90, 90, 120)],
    ['rhombohedral', cell(5.4, 5.4, 5.4, 55.3, 55.3, 55.3)],
    ['monoclinic-b', cell(5.1, 5.2, 5.3, 90, 99.2, 90)],
    ['monoclinic-c', cell(5.1, 5.2, 5.3, 90, 90, 104)],
    ['monoclinic-a', cell(5.1, 5.2, 5.3, 97, 90, 90)],
    ['triclinic', cell(8.1, 12.8, 7.2, 94.3, 116.6, 87.7)],
  ];

  it('recognises each shape and its equations reproduce the lattice matrix', () => {
    for (const [shape, c] of cases) {
      expect(cellShape(c), shape).toBe(shape);
      const M = buildLattice(c).M;
      const v = shapeVectors(shape, c);
      for (let k = 0; k < 3; k++)
        for (let i = 0; i < 3; i++) expect(v[k][i], `${shape} ${k} ${i}`).toBeCloseTo(M[i][k], 9);
    }
  });

  it('follows the crystal system: trigonal may be hexagonal or rhombohedral', () => {
    expect(cellShape(cases[3][1], 'trigonal')).toBe('hexagonal');
    expect(cellShape(cases[4][1], 'trigonal')).toBe('rhombohedral');
    // A cubic metric is not one an orthorhombic system allows, so the general form is shown.
    expect(cellShape(cases[0][1], 'orthorhombic')).toBe('triclinic');
  });

  it('uses the special equations for every fixture crystal', () => {
    for (const name of names) {
      const crystal = buildCrystal(
        parseFirstStructure(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8')).structure,
      ).crystal;
      const shape = cellShape(crystal.cell, crystal.spaceGroup.crystalSystem);
      const v = shapeVectors(shape, crystal.cell);
      for (let k = 0; k < 3; k++)
        for (let i = 0; i < 3; i++) expect(v[k][i]).toBeCloseTo(crystal.lattice.M[i][k], 9);
      if (name === 'graphite') expect(shape).toBe('hexagonal');
      if (name === 'ZrO2_baddeleyite') expect(shape).toBe('monoclinic-b');
      if (name === 'Si') expect(shape).toBe('cubic');
    }
  });
});
