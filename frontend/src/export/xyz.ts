/**
 * Atom lists of the structure view as XYZ files (context.md M12).
 *
 * - Standard XYZ: the number of atoms, a comment line, then `Symbol x y z` in angstrom (the
 *   crystal's Cartesian frame, a ∥ x, as shown).
 * - XYZ (computem): the number of atoms, the extent of the view `Lx Ly Lz`, then one line per atom
 *   `Z x y z occupancy B` (atomic number, angstrom positions measured from the corner of the view,
 *   occupancy, Debye-Waller factor B = 8π²U in angstrom²), and a last line `-1`.
 *
 * "The view" is what the viewer shows: the atoms inside the range that are not hidden, plus, for the
 * standard file, the bonded atoms just outside it that are drawn too.
 */
import type { Crystal } from '../core/crystal';
import { atomicU } from '../core/diffraction/electron';
import { atomicNumber } from '../core/elements';
import { fracToCart, type Lattice } from '../core/lattice';
import type { Vec3 } from '../core/math/vec3';
import type { Appearance, Range, StructureModel } from '../core/structure';

export interface ViewAtom {
  element: string;
  /** Atomic number. */
  Z: number;
  /** Cartesian position, angstrom. */
  pos: Vec3;
  occupancy: number;
  /** Debye-Waller factor B = 8π²U (angstrom²); 0 when the CIF has no displacement parameter. */
  B: number;
  inRange: boolean;
}

/** The atoms of the view in model order; hidden atoms are left out. */
export function viewAtoms(
  crystal: Crystal,
  model: StructureModel,
  app: Pick<Appearance, 'atomVisible'> | null,
): ViewAtom[] {
  const U = atomicU(crystal);
  const out: ViewAtom[] = [];
  for (let i = 0; i < model.count; i++) {
    if (app && app.atomVisible[i] === 0) continue;
    const index = model.placed.atom[i];
    const a = crystal.atoms[index];
    out.push({
      element: a.element,
      Z: atomicNumber(a.element),
      pos: [model.cart[3 * i], model.cart[3 * i + 1], model.cart[3 * i + 2]],
      occupancy: a.occupancy,
      B: 8 * Math.PI * Math.PI * U[index],
      inRange: model.inRange[i] === 1,
    });
  }
  return out;
}

/** Fixed decimals without a negative zero ("-0.000000"). */
export function fixed(x: number, digits: number): string {
  const s = x.toFixed(digits);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

export function writeXyz(crystal: Crystal, atoms: readonly ViewAtom[]): string {
  const c = crystal.cell;
  const comment =
    `${crystal.name} | cell ${[c.a, c.b, c.c].map((x) => fixed(x, 5)).join(' ')} ` +
    `${[c.alpha, c.beta, c.gamma].map((x) => fixed(x, 3)).join(' ')} | angstrom, a along x`;
  const lines = [String(atoms.length), comment];
  for (const a of atoms)
    lines.push(`${a.element.padEnd(2)} ${a.pos.map((x) => fixed(x, 6).padStart(12)).join(' ')}`);
  return lines.join('\n') + '\n';
}

/**
 * The box of a range: the corner with the smallest Cartesian coordinates and the extent along x,
 * y and z of the whole parallelepiped (for a non-orthogonal cell this is its bounding box).
 */
export function rangeBox(lattice: Lattice, range: Range): { origin: Vec3; extent: Vec3 } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of [0, 1])
    for (const j of [0, 1])
      for (const k of [0, 1]) {
        const p = fracToCart(lattice, [
          i ? range.max[0] : range.min[0],
          j ? range.max[1] : range.min[1],
          k ? range.max[2] : range.min[2],
        ]);
        for (let d = 0; d < 3; d++) {
          lo[d] = Math.min(lo[d], p[d]);
          hi[d] = Math.max(hi[d], p[d]);
        }
      }
  return { origin: lo, extent: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

/**
 * The computem file for the atoms of the range. Positions are measured from the corner of the
 * range's box; atoms outside the range (bonded extras) are not written, so every line lies in the
 * box. With a slab the extent is still the range's box.
 */
export function writeComputemXyz(
  lattice: Lattice,
  atoms: readonly ViewAtom[],
  range: Range,
): string {
  const { origin, extent } = rangeBox(lattice, range);
  const own = atoms.filter((a) => a.inRange);
  const lines = [String(own.length), extent.map((x) => fixed(x, 6)).join(' ')];
  for (const a of own)
    lines.push(
      [
        String(a.Z),
        ...[0, 1, 2].map((d) => fixed(a.pos[d] - origin[d], 6)),
        String(+a.occupancy.toFixed(6)),
        fixed(a.B, 6),
      ].join(' '),
    );
  lines.push('-1');
  return lines.join('\n') + '\n';
}
