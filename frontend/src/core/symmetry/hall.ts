/**
 * Hall-symbol interpreter (Hall 1981): turns '-P 2ybc' or 'R 3 -2"' into the full list of
 * operations of the space group. Verified against all 530 settings of spglib's database.
 */
import { SymmetryError } from '../errors';
import type { Mat3 } from '../math/mat3';
import type { Vec3 } from '../math/vec3';
import { closure, composeOps, type SymOp } from './symop';

const CENTRING: Record<string, Vec3[]> = {
  P: [],
  A: [[0, 1 / 2, 1 / 2]],
  B: [[1 / 2, 0, 1 / 2]],
  C: [[1 / 2, 1 / 2, 0]],
  I: [[1 / 2, 1 / 2, 1 / 2]],
  R: [
    [2 / 3, 1 / 3, 1 / 3],
    [1 / 3, 2 / 3, 2 / 3],
  ],
  S: [
    [1 / 3, 1 / 3, 2 / 3],
    [2 / 3, 2 / 3, 1 / 3],
  ],
  T: [
    [1 / 3, 2 / 3, 1 / 3],
    [2 / 3, 1 / 3, 2 / 3],
  ],
  F: [
    [0, 1 / 2, 1 / 2],
    [1 / 2, 0, 1 / 2],
    [1 / 2, 1 / 2, 0],
  ],
};

const TRANSLATION: Record<string, Vec3> = {
  a: [1 / 2, 0, 0],
  b: [0, 1 / 2, 0],
  c: [0, 0, 1 / 2],
  n: [1 / 2, 1 / 2, 1 / 2],
  u: [1 / 4, 0, 0],
  v: [0, 1 / 4, 0],
  w: [0, 0, 1 / 4],
  d: [1 / 4, 1 / 4, 1 / 4],
};

/** Rotations about z, as matrices on fractional coordinates (valid for hexagonal and cubic axes). */
const ROT_Z: Record<number, Mat3> = {
  1: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  2: [
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, 1],
  ],
  3: [
    [0, -1, 0],
    [1, -1, 0],
    [0, 0, 1],
  ],
  4: [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  6: [
    [1, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
};
/** 2-fold about the face diagonals a-b (') and a+b ("), for a principal axis z. */
const DIAG_Z: Record<string, Mat3> = {
  "'": [
    [0, -1, 0],
    [-1, 0, 0],
    [0, 0, -1],
  ],
  '"': [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
};
const BODY_DIAGONAL_3: Mat3 = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
];

type Axis = 'x' | 'y' | 'z';

/** Index permutations that carry the z axis to x or y (cyclic). */
const PERM: Record<Axis, [number, number, number]> = {
  z: [0, 1, 2],
  x: [1, 2, 0],
  y: [2, 0, 1],
};

function permute(R: Mat3, axis: Axis): Mat3 {
  const s = PERM[axis];
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[s[i]][s[j]] = R[i][j];
  return out as unknown as Mat3;
}

const AXIS_UNIT: Record<Axis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

const TOKEN = /^(-?)([1-6])(\d?)([xyz'"*]?)([abcnuvwd]*)$/;

interface Parsed {
  order: number;
  op: SymOp;
}

function parseMatrixSymbol(token: string, position: number, previousOrder: number): Parsed {
  const m = TOKEN.exec(token);
  if (!m) throw new SymmetryError(`Unreadable Hall matrix symbol "${token}".`);
  const improper = m[1] === '-';
  const order = Number(m[2]);
  const screw = m[3] === '' ? 0 : Number(m[3]);
  let axis = m[4];
  if (order === 5) throw new SymmetryError(`Bad rotation order in "${token}".`);

  let R: Mat3;
  let principal: Axis | undefined;
  if (order === 1) {
    R = ROT_Z[1];
  } else {
    if (axis === '') {
      if (position === 0) axis = 'z';
      else if (position === 1) axis = previousOrder === 2 || previousOrder === 4 ? 'x' : "'";
      else axis = order === 3 ? '*' : 'z';
    }
    if (axis === '*') {
      R = BODY_DIAGONAL_3;
    } else if (axis === "'" || axis === '"') {
      R = DIAG_Z[axis];
    } else {
      principal = axis as Axis;
      R = permute(ROT_Z[order], principal);
    }
  }
  if (improper) R = R.map((row) => row.map((v) => -v + 0)) as unknown as Mat3;

  const t: [number, number, number] = [0, 0, 0];
  if (screw > 0 && principal) {
    const u = AXIS_UNIT[principal];
    for (let i = 0; i < 3; i++) t[i] += (u[i] * screw) / order;
  }
  for (const ch of m[5]) {
    const v = TRANSLATION[ch];
    for (let i = 0; i < 3; i++) t[i] += v[i];
  }
  return { order, op: { R, t } };
}

/** All operations of the space group with this Hall symbol (translations reduced to [0, 1)). */
export function hallToOps(hall: string): SymOp[] {
  let text = hall.trim();
  let shift: Vec3 = [0, 0, 0];
  const basis = /\(([^)]*)\)/.exec(text);
  if (basis) {
    text = text.replace(basis[0], '').trim();
    const v = basis[1].trim().split(/\s+/).map(Number);
    if (v.length !== 3 || v.some((x) => !Number.isInteger(x))) {
      throw new SymmetryError(`Unsupported change of basis in Hall symbol "${hall}".`);
    }
    shift = [v[0] / 12, v[1] / 12, v[2] / 12];
  }
  const tokens = text.split(/\s+/);
  let lattice = tokens[0];
  const centrosymmetric = lattice.startsWith('-');
  if (centrosymmetric) lattice = lattice.slice(1);
  const centring = CENTRING[lattice.toUpperCase()];
  if (!centring) throw new SymmetryError(`Unknown lattice symbol in Hall symbol "${hall}".`);

  const generators: SymOp[] = [];
  let previousOrder = 0;
  tokens.slice(1).forEach((token, k) => {
    const parsed = parseMatrixSymbol(token, k, previousOrder);
    generators.push(parsed.op);
    previousOrder = parsed.order;
  });
  if (centrosymmetric) {
    generators.push({
      R: [
        [-1, 0, 0],
        [0, -1, 0],
        [0, 0, -1],
      ],
      t: [0, 0, 0],
    });
  }
  for (const c of centring) generators.push({ R: ROT_Z[1], t: c });

  const group = closure(generators);
  if (shift.every((x) => x === 0)) return group;
  // Origin shift: conjugate every operation by the translation x -> x + shift.
  const there: SymOp = { R: ROT_Z[1], t: shift };
  const back: SymOp = { R: ROT_Z[1], t: [-shift[0], -shift[1], -shift[2]] };
  return closure(group.map((g) => composeOps(there, composeOps(g, back))));
}
