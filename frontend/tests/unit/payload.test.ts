import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal } from '../../src/core/crystal';
import { orthogonalCifStructure, partialSites, structurePayload } from '../../src/core/payload';
import { fixtureDir, names } from './helpers/fixtures';

// The backend tests (backend/tests/test_structure.py) read these files: they are the browser's
// exact output for each fixture CIF. Regenerate with `UPDATE_PAYLOADS=1 npm test`.
const dir = `${fixtureDir}payloads/`;

function payloadOf(name: string) {
  const raw = readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8');
  const { crystal } = buildCrystal(parseFirstStructure(raw).structure);
  return { crystal, payload: structurePayload(crystal, raw, `${name}.cif`) };
}

describe('structure payload', () => {
  it.each(names)('%s: matches the committed payload (backend fixture)', (name) => {
    const { payload } = payloadOf(name);
    const file = `${dir}${name}.json`;
    if (process.env.UPDATE_PAYLOADS) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(payload, null, 1) + '\n');
    }
    expect(existsSync(file), 'run UPDATE_PAYLOADS=1 npm test').toBe(true);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  });

  it.each(names)('%s: atom count and cell come from the unit-cell content', (name) => {
    const { crystal, payload } = payloadOf(name);
    expect(payload.atoms).toHaveLength(crystal.atoms.length);
    expect(payload.cell).toEqual(crystal.cell);
    for (const a of payload.atoms) expect(a.frac.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('lists partially occupied and mixed sites', () => {
    expect(partialSites(payloadOf('Si').crystal)).toHaveLength(0);
    const olivine = partialSites(payloadOf('olivine_partial').crystal);
    expect(olivine.length).toBeGreaterThan(0);
    expect(olivine[0].species.length).toBeGreaterThan(1);
  });

  it('turns an orthogonal cell from the backend into a viewable crystal', () => {
    const s = orthogonalCifStructure('ortho', {
      cell: [4, 5, 6],
      atoms: [
        { element: 'Na', frac: [0, 0, 0], occupancy: 1 },
        { element: 'Cl', frac: [0.5, 0.5, 0.5], occupancy: 1, uiso: 0.01 },
      ],
    });
    const { crystal } = buildCrystal(s as Parameters<typeof buildCrystal>[0]);
    expect(crystal.atoms).toHaveLength(2);
    expect(crystal.cell.gamma).toBe(90);
  });
});
