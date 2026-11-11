/**
 * A small XYZ reader (plain XYZ and extxyz with a Lattice), producing the same description a CIF
 * does so `buildCrystal` can build it. Without a lattice the atoms are placed in a box around
 * them and a warning says the cell was guessed.
 */
import type { Cell } from './crystal';
import type { CifAtom, CifStructure } from './cif/structure';
import { CifError } from './errors';
import { isElementSymbol } from './elements';
import { inverse, mulVec, transpose, type Mat3 } from './math/mat3';
import type { Vec3 } from './math/vec3';
import { cross, dot, norm } from './math/vec3';

export interface XyzRead {
  structure: CifStructure;
  /** The file text, kept so the backend can cross-check when it understands the format. */
  raw: string;
  warnings: string[];
}

const angle = (a: Vec3, b: Vec3) => (Math.atan2(norm(cross(a, b)), dot(a, b)) * 180) / Math.PI;

/** Cell parameters of three lattice vectors (rows), in the file's Cartesian frame. */
function cellOf(rows: [Vec3, Vec3, Vec3]): Cell {
  const [a, b, c] = rows;
  return {
    a: norm(a),
    b: norm(b),
    c: norm(c),
    alpha: angle(b, c),
    beta: angle(a, c),
    gamma: angle(a, b),
  };
}

/** `Lattice="ax ay az bx ..."` from an extxyz comment, rows a, b, c. */
function latticeFromComment(comment: string): [Vec3, Vec3, Vec3] | null {
  const m = /Lattice="([^"]+)"/i.exec(comment);
  if (!m) return null;
  const n = m[1].trim().split(/\s+/).map(Number);
  if (n.length !== 9 || n.some((x) => !Number.isFinite(x))) {
    throw new CifError('The Lattice in this XYZ file is not nine numbers.');
  }
  const row = (i: number): Vec3 => [n[i], n[i + 1], n[i + 2]];
  return [row(0), row(3), row(6)];
}

function elementOf(token: string): string {
  const run = /^[A-Za-z]{1,2}/.exec(token)?.[0] ?? '';
  const symbol = run.length === 1 ? run.toUpperCase() : run[0].toUpperCase() + run[1].toLowerCase();
  if (!isElementSymbol(symbol)) throw new CifError(`"${token}" is not an element symbol.`);
  return symbol;
}

export function parseXyz(text: string, name = 'xyz'): XyzRead {
  const body = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim());
  const count = Number(body[0]);
  if (!Number.isInteger(count) || count < 1) {
    throw new CifError('An XYZ file starts with the number of atoms.');
  }
  const comment = body[1] ?? '';
  const rows = body.slice(2).filter((l) => l !== '');
  if (rows.length < count) throw new CifError(`Expected ${count} atoms, found ${rows.length}.`);

  const lattice = latticeFromComment(comment);
  const warnings: string[] = [];
  const carts: { element: string; p: Vec3 }[] = [];
  for (let i = 0; i < count; i++) {
    const t = rows[i].split(/\s+/);
    if (t.length < 4) throw new CifError(`Atom ${i + 1} needs an element and x y z.`);
    const p: Vec3 = [Number(t[1]), Number(t[2]), Number(t[3])];
    if (!p.every(Number.isFinite)) throw new CifError(`Atom ${i + 1} has a bad coordinate.`);
    carts.push({ element: elementOf(t[0]), p });
  }

  let cell: Cell;
  let frac: Vec3[];
  if (lattice) {
    cell = cellOf(lattice);
    // r = frac_x·a + frac_y·b + frac_z·c, so frac = (Mᵀ)⁻¹ r.
    let toFrac: Mat3;
    try {
      toFrac = transpose(inverse(lattice));
    } catch {
      throw new CifError('The lattice in this file has no volume.');
    }
    frac = carts.map((a) => mulVec(toFrac, a.p));
  } else {
    const min = [0, 1, 2].map((k) => Math.min(...carts.map((a) => a.p[k])));
    const max = [0, 1, 2].map((k) => Math.max(...carts.map((a) => a.p[k])));
    const pad = 2;
    const lengths = max.map((v, k) => Math.max(v - min[k] + 2 * pad, 4));
    cell = { a: lengths[0], b: lengths[1], c: lengths[2], alpha: 90, beta: 90, gamma: 90 };
    frac = carts.map((a) => [
      (a.p[0] - min[0] + pad) / lengths[0],
      (a.p[1] - min[1] + pad) / lengths[1],
      (a.p[2] - min[2] + pad) / lengths[2],
    ]);
    warnings.push(
      'This XYZ file has no lattice, so the cell is a box around the atoms. A CIF is needed for a real crystal.',
    );
  }

  const atoms: CifAtom[] = carts.map((a, i) => ({
    label: `${a.element}${i + 1}`,
    element: a.element,
    x: frac[i][0],
    y: frac[i][1],
    z: frac[i][2],
    occupancy: 1,
  }));
  const structure: CifStructure = {
    name,
    cell,
    spaceGroup: { hm: 'P 1', number: 1 },
    symops: ['x, y, z'],
    atoms,
    ids: {},
  };
  return { structure, raw: text, warnings };
}
