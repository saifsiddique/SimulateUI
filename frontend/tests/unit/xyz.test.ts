import { describe, expect, it } from 'vitest';
import { buildCrystal } from '../../src/core/crystal';
import { parseXyz } from '../../src/core/xyz';

const cubic = `2
Lattice="5 0 0 0 5 0 0 0 5" Properties=species:S:1:pos:R:3
Si 0 0 0
Si 2.5 2.5 2.5
`;

describe('XYZ', () => {
  it('reads an extxyz lattice into fractional coordinates', () => {
    const { structure, warnings } = parseXyz(cubic);
    expect(warnings).toEqual([]);
    expect(structure.cell.a).toBeCloseTo(5);
    expect(structure.cell.gamma).toBeCloseTo(90);
    expect(structure.atoms[1].x).toBeCloseTo(0.5);
    expect(structure.atoms[1].y).toBeCloseTo(0.5);
    const { crystal } = buildCrystal(structure);
    expect(crystal.atoms).toHaveLength(2);
  });

  it('keeps fractional coordinates when the lattice is skewed', () => {
    const text = `1
Lattice="2 0 0 1 2 0 0 0 3"
C 3 2 0
`;
    const { structure } = parseXyz(text);
    expect(structure.atoms[0].x).toBeCloseTo(1);
    expect(structure.atoms[0].y).toBeCloseTo(1);
    expect(structure.atoms[0].z).toBeCloseTo(0);
    expect(structure.cell.a).toBeCloseTo(2);
    expect(structure.cell.b).toBeCloseTo(Math.hypot(1, 2));
  });

  it('boxes a plain XYZ and says the cell was guessed', () => {
    const { structure, warnings } = parseXyz('1\ncomment\nSi 1 2 3\n');
    expect(warnings[0]).toMatch(/no lattice/);
    expect(structure.cell.alpha).toBe(90);
    expect(structure.atoms[0].element).toBe('Si');
  });

  it('rejects a bad file', () => {
    expect(() => parseXyz('nope')).toThrow(/number of atoms/);
  });
});
