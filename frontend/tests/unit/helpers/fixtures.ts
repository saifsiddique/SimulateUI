// Loader and types for the pymatgen-generated fixtures (scripts/make_fixtures.py), shared by every
// unit test that compares against them.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type NumMatrix = number[][];

export interface PxrdPeak {
  two_theta: number;
  intensity: number;
  d: number;
  hkls: { hkl: number[]; m: number }[];
}

export interface Fixture {
  name: string;
  source: { cod_id: number; cif: string; sha256: string };
  cell: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
  volume: number;
  metric: NumMatrix;
  recip_metric: NumMatrix;
  matrix_standard: NumMatrix;
  recip_matrix_standard: NumMatrix;
  space_group: { declared_number: number | null; detected_number: number; n_operations: number };
  unit_cell: {
    n_sites: number;
    counts: Record<string, number>;
    atoms: { species: Record<string, number>; frac: [number, number, number] }[];
  };
  reflections: { rows: number[][] };
  zones: Record<string, string[]>;
  tem: { voltage_kV: number; wavelength: number; zones: Record<string, number[][]> };
  pxrd: { wavelength: number; two_theta_range: [number, number]; peaks: PxrdPeak[] };
}

/** Absolute path of `tests/fixtures/` with a trailing slash. */
export const fixtureDir = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export const names: string[] = readdirSync(`${fixtureDir}json`)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

export const fixtures: Record<string, Fixture> = Object.fromEntries(
  names.map((n) => [n, JSON.parse(readFileSync(`${fixtureDir}json/${n}.json`, 'utf8')) as Fixture]),
);
