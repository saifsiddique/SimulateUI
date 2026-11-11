// Real-file checks for the CIF parser: the committed fixtures always; a local COD sample
// (scripts/fetch_cod_sample.py) and any folder named by CRYSTALLENS_EXTRA_CIFS when present.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCif, parseFirstStructure, writeCif, type CifStructure } from '../../src/core/cif';
import { CifError } from '../../src/core/errors';
import { fixtureDir, fixtures, names } from './helpers/fixtures';

const codDir = fileURLToPath(new URL('../cod_sample/', import.meta.url));
const extraDir = process.env.CRYSTALLENS_EXTRA_CIFS;

const cifFiles = (dir: string | undefined): string[] =>
  dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cif')) : [];

/** parse -> write -> parse must reproduce the structure exactly. */
function expectRoundTrip(structure: CifStructure) {
  const again = parseFirstStructure(writeCif(structure));
  expect(again.warnings).toEqual([]);
  expect(again.structure).toEqual(structure);
}

describe('fixture CIFs (COD, committed)', () => {
  for (const name of names) {
    describe(name, () => {
      const text = readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8');
      const fx = fixtures[name];

      it('parses to the cell and space-group number pymatgen reads', () => {
        const { structure } = parseFirstStructure(text);
        for (const key of ['a', 'b', 'c', 'alpha', 'beta', 'gamma'] as const) {
          expect(structure.cell[key], key).toBeCloseTo(fx.cell[key], 9);
        }
        expect(structure.spaceGroup.number ?? null).toBe(fx.space_group.declared_number);
        expect(structure.atoms.length).toBeGreaterThan(0);
        expect(structure.ids.cod).toBe(String(fx.source.cod_id));
      });

      it('round-trips through the writer', () => {
        expectRoundTrip(parseFirstStructure(text).structure);
      });
    });
  }

  it('reads the symmetry operations the CIF lists (counts checked against spglib)', () => {
    // Every fixture CIF lists its full operation set, so the count equals spglib's n_operations.
    for (const name of names) {
      const text = readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8');
      const { structure } = parseFirstStructure(text);
      expect(structure.symops.length, name).toBe(fixtures[name].space_group.n_operations);
    }
  });

  it('keeps partial occupancy (olivine) and per-site element/occupancy', () => {
    const { structure } = parseFirstStructure(
      readFileSync(`${fixtureDir}cifs/olivine_partial.cif`, 'utf8'),
    );
    expect(structure.atoms.some((a) => a.occupancy < 1)).toBe(true);
  });
});

describe.skipIf(cifFiles(extraDir).length === 0)('user CIFs (CRYSTALLENS_EXTRA_CIFS)', () => {
  for (const file of cifFiles(extraDir)) {
    it(`${file}: parses, every block, and round-trips`, () => {
      const text = readFileSync(`${extraDir}/${file}`, 'utf8');
      const outcomes = parseCif(text);
      expect(outcomes.length).toBeGreaterThan(0);
      for (const o of outcomes) {
        expect(o.error, `${file} ${o.name}`).toBeUndefined();
        expect(o.structure!.atoms.length).toBeGreaterThan(0);
        expectRoundTrip(o.structure!);
      }
    });
  }
});

describe.skipIf(cifFiles(codDir).length === 0)('COD random sample', () => {
  const files = cifFiles(codDir);

  it('parses at least 98% and round-trips every success', () => {
    const failures = new Map<string, string[]>();
    const warned = new Map<string, number>();
    let ok = 0;
    const summary: Record<string, unknown> = {};
    for (const file of files) {
      const text = readFileSync(`${codDir}${file}`, 'utf8');
      try {
        const { structure, warnings } = parseFirstStructure(text);
        for (const w of warnings) {
          const key = w.message
            .replace(/"[^"]*"/g, '".."')
            .replace(/[\d.]+/g, '#')
            .slice(0, 80);
          warned.set(key, (warned.get(key) ?? 0) + 1);
        }
        expectRoundTrip(structure);
        ok++;
        summary[file.replace(/\.cif$/, '')] = {
          cell: structure.cell,
          sg: structure.spaceGroup.number ?? null,
          nSymops: structure.symops.length,
          atoms: structure.atoms.map((a) => [a.element, a.x, a.y, a.z, a.occupancy]),
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const category = message.replace(/[\d.]+/g, '#').slice(0, 90);
        failures.set(category, [...(failures.get(category) ?? []), file]);
      }
    }
    writeFileSync(`${codDir}_ours.json`, JSON.stringify(summary));
    const rate = ok / files.length;
    const report = [...failures].map(([k, v]) => `${v.length} x ${k}  (e.g. ${v[0]})`);
    // vitest swallows console output of passing tests, so the report goes to a file as well.
    const headline = `COD sample: ${ok}/${files.length} parsed (${(rate * 100).toFixed(2)}%)`;
    writeFileSync(
      `${codDir}_report.txt`,
      [headline, ...report, 'warnings:', ...[...warned].map(([k, v]) => `  ${v} x ${k}`), ''].join(
        String.fromCharCode(10),
      ),
    );
    expect(rate, report.join('\n')).toBeGreaterThanOrEqual(0.98);
  });
});

describe('malformed input', () => {
  const texts = names.map((n) => readFileSync(`${fixtureDir}cifs/${n}.cif`, 'utf8'));

  it('never throws anything but CifError, whatever part of a real file is cut away', () => {
    // Deterministic pseudo-random cuts (LCG), so a failure is reproducible.
    let seed = 12345;
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (const text of texts) {
      for (let i = 0; i < 150; i++) {
        const cut = rand(text.length);
        const len = rand(400);
        const variants = [text.slice(0, cut), text.slice(0, cut) + text.slice(cut + len)];
        for (const v of variants) {
          try {
            parseCif(v);
          } catch (e) {
            expect(e, `cut ${cut}/${len}`).toBeInstanceOf(CifError);
          }
        }
      }
    }
  });

  it('parses a 20,000-atom CIF quickly', () => {
    const rows = Array.from({ length: 20000 }, (_, i) => `C${i} C ${i / 20000} 0.1 0.2 1`).join(
      '\n',
    );
    const text = `data_big\n_cell_length_a 50 _cell_length_b 50 _cell_length_c 50\n_cell_angle_alpha 90 _cell_angle_beta 90 _cell_angle_gamma 90\nloop_ _atom_site_label _atom_site_type_symbol _atom_site_fract_x _atom_site_fract_y _atom_site_fract_z _atom_site_occupancy\n${rows}\n`;
    const t0 = performance.now();
    const { structure } = parseFirstStructure(text);
    expect(structure.atoms).toHaveLength(20000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
