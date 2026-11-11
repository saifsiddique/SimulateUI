import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal } from '../../src/core/crystal';
import { detectSpaceGroup, loadMoyo } from '../../src/symmetry/detect';
import { fixtureDir, fixtures, names } from './helpers/fixtures';

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve('@spglib/moyo-wasm/moyo_wasm_bg.wasm');
  await loadMoyo(readFileSync(wasm));
});

describe('space-group detection (moyo WASM)', () => {
  for (const name of names) {
    it(`${name}: detects the number spglib/pymatgen report`, async () => {
      const { structure } = parseFirstStructure(
        readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8'),
      );
      const { crystal } = buildCrystal(structure);
      const detected = await detectSpaceGroup(crystal);
      expect(detected.number).toBe(fixtures[name].space_group.detected_number);
      expect(detected.wyckoffs).toHaveLength(crystal.positions.length);
    });
  }

  it('agrees with the symmetry buildCrystal derives for the fixtures', async () => {
    for (const name of names) {
      const { structure } = parseFirstStructure(
        readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8'),
      );
      const { crystal } = buildCrystal(structure);
      expect((await detectSpaceGroup(crystal)).number, name).toBe(crystal.spaceGroup.number);
    }
  });

  it('finds the true symmetry of a cell written out in P1, and the loss of it when atoms move', async () => {
    const { structure } = parseFirstStructure(readFileSync(`${fixtureDir}cifs/NaCl.cif`, 'utf8'));
    const full = buildCrystal(structure).crystal;
    const p1Atoms = full.atoms.map((a, i) => ({
      label: `${a.element}${i}`,
      element: a.element,
      x: a.frac[0],
      y: a.frac[1],
      z: a.frac[2],
      occupancy: 1,
    }));
    const p1 = buildCrystal({ ...structure, symops: [], spaceGroup: {}, atoms: p1Atoms }).crystal;
    expect(p1.spaceGroup.number).toBe(1);
    expect((await detectSpaceGroup(p1)).number).toBe(225);

    p1Atoms[0] = { ...p1Atoms[0], x: p1Atoms[0].x + 0.02 };
    const bent = buildCrystal({ ...structure, symops: [], spaceGroup: {}, atoms: p1Atoms }).crystal;
    expect((await detectSpaceGroup(bent)).number).not.toBe(225);
  });
});
