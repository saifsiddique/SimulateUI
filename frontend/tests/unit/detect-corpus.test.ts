// How often the space group detected from the atomic positions (moyo) equals the one the CIF
// declares, over the local COD sample. Writes tests/cod_sample/_detect_report.txt.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal } from '../../src/core/crystal';
import { detectSpaceGroup, loadMoyo } from '../../src/symmetry/detect';

const codDir = fileURLToPath(new URL('../cod_sample/', import.meta.url));
const files = existsSync(codDir) ? readdirSync(codDir).filter((f) => f.endsWith('.cif')) : [];

describe.skipIf(files.length === 0)('COD sample: detected vs declared space group', () => {
  beforeAll(async () => {
    const wasm = createRequire(import.meta.url).resolve('@spglib/moyo-wasm/moyo_wasm_bg.wasm');
    await loadMoyo(readFileSync(wasm));
  });

  it('runs on every file; most agree with the declared group', async () => {
    let compared = 0;
    let agree = 0;
    const crashed: string[] = [];
    const differ: string[] = [];
    for (const file of files) {
      let crystal;
      try {
        crystal = buildCrystal(
          parseFirstStructure(readFileSync(`${codDir}${file}`, 'utf8')).structure,
        ).crystal;
      } catch {
        continue;
      }
      if (crystal.positions.length > 3000) continue; // keep the run short
      try {
        const d = await detectSpaceGroup(crystal);
        compared++;
        if (d.number === crystal.spaceGroup.number) agree++;
        else differ.push(`${file}: declared ${crystal.spaceGroup.number}, detected ${d.number}`);
      } catch (e) {
        crashed.push(`${file}: ${(e as Error).message}`);
      }
    }
    const nl = String.fromCharCode(10);
    const report = [
      `Detected = declared for ${agree}/${compared} files (${((100 * agree) / compared).toFixed(1)}%)`,
      `moyo failed on ${crashed.length}`,
      ...crashed.slice(0, 10),
      `${differ.length} differ (symmetry lower than declared at 1e-3 A, or wrong declaration):`,
      ...differ.slice(0, 40),
      '',
    ].join(nl);
    writeFileSync(`${codDir}_detect_report.txt`, report);
    expect(crashed.length / compared).toBeLessThan(0.02);
    expect(agree / compared).toBeGreaterThan(0.85);
  }, 600_000);
});
