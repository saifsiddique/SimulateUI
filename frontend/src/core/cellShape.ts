/**
 * Which special form of the cell-to-Cartesian equations applies to a cell (context.md 5.2:
 * a || x, b in the xy-plane). Used to show the user the equations that generate a, b, c, next to
 * a reference page for the lattice family.
 */
import type { Cell } from './crystal';
import type { Vec3 } from './math/vec3';
import { cosDeg, sinDeg } from './math/trig';
import type { CrystalSystem } from './symmetry/spacegroup';

export type CellShape =
  | 'cubic'
  | 'tetragonal'
  | 'orthorhombic'
  | 'hexagonal'
  | 'rhombohedral'
  | 'monoclinic-b'
  | 'monoclinic-c'
  | 'monoclinic-a'
  | 'triclinic';

const near = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol;

/**
 * The shape follows the cell metric (with 1e-3 relative / 0.01 degree tolerance), checked against
 * the crystal system when one is known: a trigonal crystal is drawn with hexagonal or rhombohedral
 * axes depending on its setting; a cell that does not have its system's metric is 'triclinic'
 * (the general equations always hold).
 */
export function cellShape(cell: Cell, system?: CrystalSystem): CellShape {
  const { a, b, c, alpha, beta, gamma } = cell;
  const L = (x: number, y: number) => near(x, y, 1e-3 * Math.max(x, y));
  const A = (x: number, y: number) => near(x, y, 0.01);
  const right = [alpha, beta, gamma].map((x) => A(x, 90));
  const allRight = right.every(Boolean);

  const metric: CellShape = (() => {
    if (allRight && L(a, b) && L(b, c)) return 'cubic';
    if (allRight && L(a, b)) return 'tetragonal';
    if (allRight) return 'orthorhombic';
    if (right[0] && right[1] && A(gamma, 120) && L(a, b)) return 'hexagonal';
    if (L(a, b) && L(b, c) && A(alpha, beta) && A(beta, gamma)) return 'rhombohedral';
    if (right[0] && right[2]) return 'monoclinic-b';
    if (right[0] && right[1]) return 'monoclinic-c';
    if (right[1] && right[2]) return 'monoclinic-a';
    return 'triclinic';
  })();
  if (!system) return metric;
  const allowed: Record<CrystalSystem, CellShape[]> = {
    cubic: ['cubic'],
    tetragonal: ['tetragonal'],
    orthorhombic: ['orthorhombic'],
    hexagonal: ['hexagonal'],
    trigonal: ['hexagonal', 'rhombohedral'],
    monoclinic: ['monoclinic-b', 'monoclinic-c', 'monoclinic-a'],
    triclinic: ['triclinic'],
  };
  return allowed[system].includes(metric) ? metric : 'triclinic';
}

/**
 * a, b, c in Cartesian coordinates from the special-form equations of `shape`, written out
 * separately from `cellToMatrix` so a test can check that the equations shown to the user are the
 * ones the program uses.
 */
export function shapeVectors(shape: CellShape, cell: Cell): [Vec3, Vec3, Vec3] {
  const { a, b, c, alpha, beta, gamma } = cell;
  switch (shape) {
    case 'cubic':
      return [
        [a, 0, 0],
        [0, a, 0],
        [0, 0, a],
      ];
    case 'tetragonal':
      return [
        [a, 0, 0],
        [0, a, 0],
        [0, 0, c],
      ];
    case 'orthorhombic':
      return [
        [a, 0, 0],
        [0, b, 0],
        [0, 0, c],
      ];
    case 'hexagonal':
      return [
        [a, 0, 0],
        [-a / 2, (Math.sqrt(3) / 2) * a, 0],
        [0, 0, c],
      ];
    case 'rhombohedral': {
      const ca = cosDeg(alpha);
      const sa = sinDeg(alpha);
      return [
        [a, 0, 0],
        [a * ca, a * sa, 0],
        [a * ca, (a * (ca - ca * ca)) / sa, (a * Math.sqrt(1 - 3 * ca * ca + 2 * ca ** 3)) / sa],
      ];
    }
    case 'monoclinic-b':
      return [
        [a, 0, 0],
        [0, b, 0],
        [c * cosDeg(beta), 0, c * sinDeg(beta)],
      ];
    case 'monoclinic-c':
      return [
        [a, 0, 0],
        [b * cosDeg(gamma), b * sinDeg(gamma), 0],
        [0, 0, c],
      ];
    case 'monoclinic-a':
      return [
        [a, 0, 0],
        [0, b, 0],
        [0, c * cosDeg(alpha), c * sinDeg(alpha)],
      ];
    case 'triclinic': {
      const cx = c * cosDeg(beta);
      const cy = (c * (cosDeg(alpha) - cosDeg(beta) * cosDeg(gamma))) / sinDeg(gamma);
      return [
        [a, 0, 0],
        [b * cosDeg(gamma), b * sinDeg(gamma), 0],
        [cx, cy, Math.sqrt(c * c - cx * cx - cy * cy)],
      ];
    }
  }
}
