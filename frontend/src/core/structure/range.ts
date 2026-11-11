/**
 * Which lattice images of the unit-cell atoms are shown (context.md M6 task 1).
 *
 * A fractional box per axis, optionally cut by a slab: the atoms whose distance from the plane
 * (hkl) through the origin lies between `offset` and `offset + thickness` angstrom. The box says
 * how far the slab extends sideways, so a slab is always the intersection of the two.
 *
 * With `boundary` (the default) the box is closed: an atom exactly on a bound is shown, so
 * [0, 1]^3 is the cell *with* its boundary atoms (the NaCl corner atom appears at all eight
 * corners, 27 atoms in all). Without it the upper bounds are exclusive: [0, 1)^3 is exactly the
 * unit-cell content (8 atoms for NaCl).
 */
import type { Crystal } from '../crystal';
import { dSpacing } from '../lattice';
import type { Vec3 } from '../math/vec3';

export interface Range {
  min: Vec3;
  max: Vec3;
}

/** A slab (hkl) at `offset` angstrom from the origin plane, `thickness` angstrom thick. */
export interface Slab {
  hkl: Vec3;
  offset: number;
  thickness: number;
}

export interface PlaceOptions {
  /** Include atoms on the upper bounds (default true). */
  boundary?: boolean;
  slab?: Slab | null;
}

/** Bounds are widened by this much (fractional) so atoms on a bound survive rounding. */
export const RANGE_EPSILON = 1e-4;

export const UNIT_CELL_RANGE: Range = { min: [0, 0, 0], max: [1, 1, 1] };

/** Struct-of-arrays list of placed atoms, cheap to hold for 10^5 atoms. */
export interface PlacedAtoms {
  count: number;
  /** Index into `Crystal.atoms`. */
  atom: Uint32Array;
  /** Integer lattice translation of each image, 3 per atom. */
  cell: Int16Array;
  /** Fractional position including the translation, 3 per atom. */
  frac: Float64Array;
}

/** Hard cap so a typo in a range cannot ask the browser for a billion atoms. */
export const MAX_PLACED_ATOMS = 2_000_000;

export class RangeError extends Error {}

/** A number that identifies (unit-cell atom, lattice translation); |translation| < 1024. */
export const atomKey = (atom: number, i: number, j: number, k: number): number =>
  ((atom * 2048 + (i + 1024)) * 2048 + (j + 1024)) * 2048 + (k + 1024);

export function validateRange(range: Range): void {
  for (let k = 0; k < 3; k++) {
    const { min, max } = range;
    if (!(Number.isFinite(min[k]) && Number.isFinite(max[k])) || max[k] < min[k]) {
      throw new RangeError(`Invalid range on axis ${'abc'[k]}: ${min[k]} to ${max[k]}.`);
    }
  }
}

export function placeAtoms(
  crystal: Crystal,
  range: Range = UNIT_CELL_RANGE,
  options: PlaceOptions = {},
): PlacedAtoms {
  const { min, max } = range;
  validateRange(range);
  const boundary = options.boundary ?? true;
  const slab = options.slab ?? null;
  let slabScale = 0; // distance from the origin plane = slabScale * (h f1 + k f2 + l f3)
  if (slab) {
    if (slab.hkl.every((x) => x === 0)) throw new RangeError('A slab needs a non-zero (hkl).');
    if (!(slab.thickness > 0)) throw new RangeError('A slab needs a positive thickness.');
    slabScale = dSpacing(crystal.lattice, slab.hkl);
  }
  const span = [0, 1, 2].map((k) => Math.floor(max[k] + RANGE_EPSILON) - Math.ceil(min[k] - 1) + 2);
  if (span[0] * span[1] * span[2] * crystal.atoms.length > MAX_PLACED_ATOMS * 8) {
    throw new RangeError('The requested range is far too large to display.');
  }

  const atoms: number[] = [];
  const cells: number[] = [];
  const fracs: number[] = [];
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  for (let ai = 0; ai < crystal.atoms.length; ai++) {
    const f = crystal.atoms[ai].frac;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.ceil(min[k] - f[k] - RANGE_EPSILON);
      hi[k] = boundary
        ? Math.floor(max[k] - f[k] + RANGE_EPSILON)
        : Math.ceil(max[k] - f[k] - RANGE_EPSILON) - 1;
    }
    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let k = lo[2]; k <= hi[2]; k++) {
          const x = f[0] + i;
          const y = f[1] + j;
          const z = f[2] + k;
          if (slab) {
            const dist = (slab.hkl[0] * x + slab.hkl[1] * y + slab.hkl[2] * z) * slabScale;
            const tol = 1e-4;
            if (dist < slab.offset - tol || dist > slab.offset + slab.thickness + tol) continue;
          }
          atoms.push(ai);
          cells.push(i, j, k);
          fracs.push(x, y, z);
          if (atoms.length > MAX_PLACED_ATOMS) {
            throw new RangeError(
              `More than ${MAX_PLACED_ATOMS.toLocaleString('en')} atoms in range; reduce the range.`,
            );
          }
        }
  }
  return {
    count: atoms.length,
    atom: Uint32Array.from(atoms),
    cell: Int16Array.from(cells),
    frac: Float64Array.from(fracs),
  };
}

/** The range presets of the viewer. */
export type RangePreset = 'cell' | 'cellBoundary' | 'supercell2';

export function presetRange(preset: RangePreset): { range: Range; boundary: boolean } {
  switch (preset) {
    case 'cell':
      return { range: { min: [0, 0, 0], max: [1, 1, 1] }, boundary: false };
    case 'cellBoundary':
      return { range: { min: [0, 0, 0], max: [1, 1, 1] }, boundary: true };
    case 'supercell2':
      return { range: { min: [0, 0, 0], max: [2, 2, 2] }, boundary: true };
  }
}
