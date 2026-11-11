import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPACE_GROUP_ROWS } from '../../src/core/symmetry/data/spacegroups';
import { hallToOps } from '../../src/core/symmetry/hall';
import type { SymOp } from '../../src/core/symmetry/symop';
import { fixtureDir } from './helpers/fixtures';

const reference = JSON.parse(readFileSync(`${fixtureDir}spacegroup_ops.json`, 'utf8')) as {
  ops: Record<string, { n: number; hash: string }>;
};

/** Same canonical string and FNV-1a hash as scripts/make_spacegroup_table.py. */
export function opsHash(ops: readonly SymOp[]): { n: number; hash: string } {
  const strings = ops.map((op) => {
    const t = op.t.map((x) => (((Math.round(x * 12) % 12) + 12) % 12).toString());
    return `${op.R.flat()
      .map((v) => v + 0)
      .join(',')};${t.join(',')}`;
  });
  strings.sort();
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(strings.join('|'))) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return { n: strings.length, hash: h.toString(16).padStart(8, '0') };
}

describe('Hall symbols', () => {
  it('reproduce the operations of all 530 spglib settings', () => {
    const wrong: string[] = [];
    for (const [hallNumber, number, hall, short, , choice] of SPACE_GROUP_ROWS) {
      let got: { n: number; hash: string };
      try {
        got = opsHash(hallToOps(hall));
      } catch (e) {
        wrong.push(
          `${hallNumber} #${number} ${short}:${choice} "${hall}" threw ${(e as Error).message}`,
        );
        continue;
      }
      const want = reference.ops[String(hallNumber)];
      if (got.n !== want.n || got.hash !== want.hash) {
        wrong.push(`${hallNumber} #${number} ${short}:${choice} "${hall}" ops ${got.n}/${want.n}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
