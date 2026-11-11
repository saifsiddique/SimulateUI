// Unit-cell construction on real files: the local COD sample (scripts/fetch_cod_sample.py) and any
// folder named by CRYSTALLENS_EXTRA_CIFS. Writes tests/cod_sample/_crystal.json (compared with
// pymatgen by scripts/check_cod_crystal.py) and _crystal_report.txt.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal, type Crystal } from '../../src/core/crystal';

const codDir = fileURLToPath(new URL('../cod_sample/', import.meta.url));
const extraDir = process.env.CRYSTALLENS_EXTRA_CIFS;

const cifFiles = (dir: string | undefined): string[] =>
  dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cif')) : [];

/** Properties that must hold for any crystal, whatever the file. */
function expectInvariants(c: Crystal) {
  expect(c.atoms.length).toBeGreaterThan(0);
  expect(c.positions.length).toBeLessThanOrEqual(c.atoms.length);
  expect(c.positions.flatMap((p) => p.atoms).sort((a, b) => a - b)).toEqual(
    c.atoms.map((_, i) => i),
  );
  for (const a of c.atoms) {
    for (const x of a.frac) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  }
  for (const s of c.sites) {
    expect(s.multiplicity).toBeGreaterThanOrEqual(1);
    expect(s.multiplicity).toBeLessThanOrEqual(c.ops.length);
    // Multiplicity divides the group order (an orbit is a coset of the site-symmetry group).
    expect(c.ops.length % s.multiplicity, `${s.label}`).toBe(0);
  }
  expect(c.atoms.length).toBe(c.sites.reduce((n, s) => n + s.multiplicity, 0));
}

describe.skipIf(cifFiles(extraDir).length === 0)('user CIFs: unit cell', () => {
  for (const file of cifFiles(extraDir)) {
    it(file, () => {
      const { structure } = parseFirstStructure(readFileSync(`${extraDir}/${file}`, 'utf8'));
      const { crystal } = buildCrystal(structure);
      expectInvariants(crystal);
    });
  }
});

describe.skipIf(cifFiles(codDir).length === 0)('COD random sample: unit cell', () => {
  it('builds at least 98% of the parsable files and keeps every invariant', () => {
    const failures = new Map<string, string[]>();
    const warned = new Map<string, number>();
    const summary: Record<string, unknown> = {};
    let parsed = 0;
    let built = 0;
    for (const file of cifFiles(codDir)) {
      let structure;
      try {
        structure = parseFirstStructure(readFileSync(`${codDir}${file}`, 'utf8')).structure;
      } catch {
        continue; // reported by the M2 corpus test
      }
      parsed++;
      try {
        const { crystal, warnings } = buildCrystal(structure);
        expectInvariants(crystal);
        built++;
        for (const w of warnings) {
          const key = w.message
            .replace(/"[^"]*"/g, '".."')
            .replace(/[\d.]+/g, '#')
            .slice(0, 90);
          warned.set(key, (warned.get(key) ?? 0) + 1);
        }
        summary[file.replace(/\.cif$/, '')] = {
          nPositions: crystal.positions.length,
          nAtoms: crystal.atoms.length,
          sg: crystal.spaceGroup.number ?? null,
          order: crystal.ops.length,
          counts: crystal.summary.counts,
          source: crystal.spaceGroup.source,
          warned: warnings.length,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const key = message.replace(/[\d.]+/g, '#').slice(0, 90);
        failures.set(key, [...(failures.get(key) ?? []), file]);
      }
    }
    writeFileSync(`${codDir}_crystal.json`, JSON.stringify(summary));
    const nl = String.fromCharCode(10);
    const report = [
      `Unit cell: ${built}/${parsed} built (${((100 * built) / parsed).toFixed(2)}%)`,
      ...[...failures].map(([k, v]) => `  FAIL ${v.length} x ${k} (e.g. ${v[0]})`),
      'warnings:',
      ...[...warned].map(([k, v]) => `  ${v} x ${k}`),
      '',
    ].join(nl);
    writeFileSync(`${codDir}_crystal_report.txt`, report);
    expect(built / parsed, report).toBeGreaterThanOrEqual(0.98);
  }, 120_000);
});
