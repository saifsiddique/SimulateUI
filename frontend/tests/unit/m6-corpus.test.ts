// The M6 structure code on real files: the fixtures, the local COD sample
// (scripts/fetch_cod_sample.py) and any folder named by CRYSTALLENS_EXTRA_CIFS. For each crystal:
// default bond rules, the model with and without bonds beyond the range, whole-molecule completion,
// coordination polyhedra for every element, and agreement between the spatial bond search and the
// periodic bond graph. Writes tests/cod_sample/_m6_report.txt.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal, type Crystal } from '../../src/core/crystal';
import {
  buildBondGraph,
  buildModel,
  buildPolyhedra,
  defaultAppearance,
  defaultBondRules,
  resolveAppearance,
} from '../../src/core/structure';
import { fixtureDir, names } from './helpers/fixtures';

const codDir = fileURLToPath(new URL('../cod_sample/', import.meta.url));
const extraDir = process.env.CRYSTALLENS_EXTRA_CIFS;

const cifFiles = (dir: string | undefined): string[] =>
  dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cif')) : [];

interface Row {
  name: string;
  atoms: number;
  rules: number;
  bondsPerAtom: number;
  polyhedra: number;
  ms: number;
  warning?: string;
}

/** Everything that must hold for one crystal; returns a summary row. */
function check(name: string, crystal: Crystal): Row {
  const t0 = performance.now();
  const rules = defaultBondRules(crystal);

  // 1. Model in the default range: valid indices, no duplicate bonds, no self bonds.
  const base = buildModel(crystal, { bonds: { rules } });
  const seen = new Set<number>();
  for (let b = 0; b < base.bonds.length; b += 2) {
    const i = base.bonds[b];
    const j = base.bonds[b + 1];
    expect(i).toBeLessThan(j);
    expect(j).toBeLessThan(base.count);
    expect(seen.has(i * base.count + j), `${name} duplicate bond ${i}-${j}`).toBe(false);
    seen.add(i * base.count + j);
    expect(base.bondRule[b / 2]).toBeLessThan(rules.length);
  }

  // 2. The spatial search and the periodic graph agree: an atom well inside a 3 x 3 x 3 block has
  //    exactly as many bonds as its unit-cell atom has graph neighbours.
  if (crystal.atoms.length <= 200) {
    const graph = buildBondGraph(crystal, rules);
    const block = buildModel(crystal, {
      range: { min: [0, 0, 0], max: [3, 3, 3] },
      boundary: false,
      bonds: { rules },
    });
    const degree = new Uint32Array(block.count);
    for (const i of block.bonds) degree[i]++;
    let checked = 0;
    for (let i = 0; i < block.count; i++) {
      const shift = [
        block.placed.cell[3 * i],
        block.placed.cell[3 * i + 1],
        block.placed.cell[3 * i + 2],
      ];
      if (!shift.every((s) => s === 1)) continue; // the middle cell: all its neighbours are in the block
      const a = block.placed.atom[i];
      // neighbours may lie more than one cell away in very oblique or tiny cells; skip those
      let near = true;
      for (let e = graph.start[a]; e < graph.start[a + 1]; e++)
        for (let k = 0; k < 3; k++) if (Math.abs(graph.shift[3 * e + k]) > 1) near = false;
      if (!near) continue;
      expect(degree[i], `${name} atom ${a}`).toBe(graph.start[a + 1] - graph.start[a]);
      checked++;
    }
    void checked;
  }

  // 3. Beyond the range and complete molecules: every added atom is bonded to a shown atom.
  for (const options of [{ beyondRange: true }, { completeMolecules: true }]) {
    const m = buildModel(crystal, { bonds: { rules, ...options } });
    expect(m.count).toBeGreaterThanOrEqual(base.count);
    const bonded = new Uint8Array(m.count);
    for (let b = 0; b < m.bonds.length; b += 2) {
      bonded[m.bonds[b]] = 1;
      bonded[m.bonds[b + 1]] = 1;
    }
    for (let i = 0; i < m.count; i++)
      if (!m.inRange[i]) expect(bonded[i], `${name} added atom`).toBe(1);
  }

  // 4. Polyhedra around every element: no throw, sizes consistent.
  const model = buildModel(crystal, { bonds: { rules, beyondRange: true } });
  const app = resolveAppearance(crystal, model, defaultAppearance(), rules);
  const graph = buildBondGraph(crystal, rules);
  const poly = buildPolyhedra(model, app, graph, model.elements);
  expect(poly.triangles.length % 9).toBe(0);
  expect(poly.edges.length % 6).toBe(0);
  expect(poly.triangleColor.length).toBe(poly.triangles.length);

  const row: Row = {
    name,
    atoms: crystal.atoms.length,
    rules: rules.length,
    bondsPerAtom: base.count ? (base.bonds.length / 2 / base.count) * 2 : 0,
    polyhedra: poly.count,
    ms: Math.round(performance.now() - t0),
  };
  if (model.warnings.length) row.warning = model.warnings[0].slice(0, 80);
  return row;
}

const load = (path: string): Crystal =>
  buildCrystal(parseFirstStructure(readFileSync(path, 'utf8')).structure).crystal;

describe('fixtures: bonds, rules and polyhedra', () => {
  for (const name of names) {
    it(name, () => {
      check(name, load(`${fixtureDir}cifs/${name}.cif`));
    });
  }
});

describe.skipIf(cifFiles(extraDir).length === 0)('user CIFs: bonds, rules and polyhedra', () => {
  const rows: Row[] = [];
  for (const file of cifFiles(extraDir)) {
    it(file, () => {
      rows.push(check(file, load(`${extraDir}/${file}`)));
    });
  }
  it('lists what was found', () => {
    if (existsSync(codDir)) {
      writeFileSync(
        `${codDir}_m6_user_report.txt`,
        rows
          .map(
            (r) =>
              `${r.name}\tatoms ${r.atoms}\trules ${r.rules}\tbonds/atom ${r.bondsPerAtom.toFixed(2)}\tpolyhedra ${r.polyhedra}\t${r.ms} ms${r.warning ? '\t' + r.warning : ''}`,
          )
          .join('\n') + '\n',
      );
    }
  });
});

describe.skipIf(cifFiles(codDir).length === 0)(
  'COD random sample: bonds, rules and polyhedra',
  () => {
    it('handles every file that builds, quickly', () => {
      const failures: string[] = [];
      const rows: Row[] = [];
      let slowest = 0;
      for (const file of cifFiles(codDir)) {
        let crystal: Crystal;
        try {
          crystal = load(`${codDir}${file}`);
        } catch {
          continue; // reported by the M2/M3 corpus tests
        }
        if (crystal.atoms.length > 1500) continue; // keeps the test fast; big cells are covered by the stress runs
        try {
          const row = check(file, crystal);
          slowest = Math.max(slowest, row.ms);
          rows.push(row);
        } catch (e) {
          failures.push(`${file}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
        }
      }
      writeFileSync(
        `${codDir}_m6_report.txt`,
        `checked ${rows.length} files, ${failures.length} failures, slowest ${slowest} ms\n` +
          failures.join('\n') +
          '\n' +
          rows
            .filter((r) => r.warning)
            .map((r) => `${r.name}\t${r.warning}`)
            .join('\n') +
          '\n',
      );
      expect(failures).toEqual([]);
      expect(rows.length).toBeGreaterThan(300);
    }, 600_000);
  },
);
