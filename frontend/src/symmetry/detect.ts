/**
 * Space-group detection from the atomic positions, using moyo (a Rust re-implementation of
 * spglib) compiled to WebAssembly. This lives outside `core/` because it loads a WASM module
 * asynchronously; it is meant to run in a worker or after the UI has loaded.
 *
 * `buildCrystal` trusts the CIF's declared symmetry. This checks it against what the positions
 * actually support, so the UI can warn about a wrong or too-high declared group.
 */
import init, { analyze_cell, initSync, type SyncInitInput } from '@spglib/moyo-wasm';
import type { Crystal } from '../core/crystal';

export interface DetectedSymmetry {
  /** International Tables number. */
  number: number;
  hmSymbol: string;
  hallNumber: number;
  pearsonSymbol: string;
  /** Operations found for the cell as given (centring included for a conventional cell). */
  nOperations: number;
  /** Wyckoff letter per unit-cell position, in `crystal.positions` order. */
  wyckoffs: string[];
}

let ready: Promise<void> | undefined;

/**
 * Load the WASM module. In the browser call it with no argument (Vite serves the file); in Node
 * or tests pass the module bytes.
 */
export function loadMoyo(bytes?: SyncInitInput): Promise<void> {
  ready ??= bytes
    ? Promise.resolve().then(() => void initSync({ module: bytes }))
    : init().then(() => undefined);
  return ready;
}

/**
 * Species label per position: positions with the same species and occupancies share a number, so
 * mixed Fe/Mg sites are distinguished from pure Fe and pure Mg sites.
 */
function speciesNumbers(crystal: Crystal): number[] {
  const ids = new Map<string, number>();
  return crystal.positions.map((p) => {
    const signature = p.atoms
      .map((i) => `${crystal.atoms[i].element}:${crystal.atoms[i].occupancy.toFixed(3)}`)
      .sort()
      .join('+');
    if (!ids.has(signature)) ids.set(signature, ids.size + 1);
    return ids.get(signature)!;
  });
}

/** Detect the space group of the crystal's unit-cell content. `symprec` is in angstrom. */
export async function detectSpaceGroup(
  crystal: Crystal,
  symprec = 1e-3,
): Promise<DetectedSymmetry> {
  await loadMoyo();
  const M = crystal.lattice.M;
  const cell = {
    lattice: {
      basis: [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]],
    },
    positions: crystal.positions.map((p) => p.frac),
    numbers: speciesNumbers(crystal),
  };
  const result = analyze_cell(JSON.stringify(cell), symprec, 'Standard');
  return {
    number: result.number,
    hmSymbol: result.hm_symbol,
    hallNumber: result.hall_number,
    pearsonSymbol: result.pearson_symbol,
    nOperations: result.operations.length,
    wyckoffs: result.wyckoffs,
  };
}
