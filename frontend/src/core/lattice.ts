/**
 * Unit-cell geometry in the standard frame of context.md 5.2: a || x, b in the xy-plane, c
 * completing the right-handed set.
 *
 *   M  columns a, b, c             r_cart = M r_frac
 *   B  = (M^-1)^T, columns a*, b*, c*   g_cart = B (h,k,l)      (no 2 pi: |g| = 1/d)
 *   G  = M^T M, G* = G^-1          metric tensors
 *
 * [uvw] is a direction (Cartesian M uvw); (hkl) is a plane, represented by its normal B hkl. The
 * two index sets coincide numerically only in cubic cells, so every function here says which one
 * it takes.
 */
import type { Cell } from './crystal';
import { LatticeError } from './errors';
import { canonicalSign, gcd, reduceIndices } from './math/integers';
import { det, inverse, mul, mulVec, transpose, type Mat3 } from './math/mat3';
import { cosDeg, sinDeg } from './math/trig';
import { angleBetween, dot, norm, type Vec3 } from './math/vec3';

export { canonicalSign, reduceIndices };

/** Everything derived from a cell, computed once. Treat it as immutable. */
export interface Lattice {
  readonly cell: Cell;
  /** Columns a, b, c in the Cartesian frame. */
  readonly M: Mat3;
  /** Inverse of M: Cartesian -> fractional. */
  readonly Minv: Mat3;
  /** Columns a*, b*, c* (reciprocal basis, without 2 pi). */
  readonly B: Mat3;
  /** Direct metric tensor M^T M. */
  readonly G: Mat3;
  /** Reciprocal metric tensor, the inverse of G. */
  readonly Gstar: Mat3;
  /** Cell volume in cubic angstrom. */
  readonly volume: number;
}

function validateCell(cell: Cell): void {
  const lengths = [cell.a, cell.b, cell.c];
  const angles = [cell.alpha, cell.beta, cell.gamma];
  if (![...lengths, ...angles].every(Number.isFinite)) {
    throw new LatticeError('Cell parameters must be finite numbers.');
  }
  if (lengths.some((x) => x <= 0)) {
    throw new LatticeError(
      `Cell lengths must be positive (a=${cell.a}, b=${cell.b}, c=${cell.c}).`,
    );
  }
  if (angles.some((x) => x <= 0 || x >= 180)) {
    throw new LatticeError(
      `Cell angles must lie strictly between 0 and 180 degrees (alpha=${cell.alpha}, beta=${cell.beta}, gamma=${cell.gamma}).`,
    );
  }
}

/** Cartesian matrix M (columns a, b, c) of a cell, in the standard frame. */
export function cellToMatrix(cell: Cell): Mat3 {
  validateCell(cell);
  const { a, b, c } = cell;
  const ca = cosDeg(cell.alpha);
  const cb = cosDeg(cell.beta);
  const cg = cosDeg(cell.gamma);
  const sg = sinDeg(cell.gamma);

  // V = a b c sqrt(radicand); it is positive only for three angles that can close a parallelepiped.
  const radicand = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg;
  if (!(radicand > 1e-12)) {
    throw new LatticeError(
      `Cell angles (${cell.alpha}, ${cell.beta}, ${cell.gamma}) cannot form a parallelepiped.`,
    );
  }
  const cx = c * cb;
  const cy = (c * (ca - cb * cg)) / sg;
  const cz = (c * Math.sqrt(radicand)) / sg;
  return [
    [a, b * cg, cx],
    [0, b * sg, cy],
    [0, 0, cz],
  ];
}

/** Reciprocal basis B = (M^-1)^T: columns a*, b*, c*. */
export const reciprocal = (M: Mat3): Mat3 => transpose(inverse(M));

/** Direct metric tensor G = M^T M. */
export const metric = (M: Mat3): Mat3 => mul(transpose(M), M);

/** Cell volume of the basis M (always positive). */
export const volume = (M: Mat3): number => Math.abs(det(M));

export function buildLattice(cell: Cell): Lattice {
  const M = cellToMatrix(cell);
  const Minv = inverse(M);
  const G = metric(M);
  return {
    cell,
    M,
    Minv,
    B: transpose(Minv),
    G,
    Gstar: inverse(G),
    volume: volume(M),
  };
}

// ---- coordinates -------------------------------------------------------------------------------

export const fracToCart = (lat: Lattice, frac: Vec3): Vec3 => mulVec(lat.M, frac);
export const cartToFrac = (lat: Lattice, cart: Vec3): Vec3 => mulVec(lat.Minv, cart);

/** Cartesian vector along the direction [uvw] (not normalised; length is |uvw| in angstrom). */
export const uvwToCart = (lat: Lattice, uvw: Vec3): Vec3 => mulVec(lat.M, uvw);

/** Cartesian reciprocal vector g = h a* + k b* + l c*, normal to the plane (hkl). |g| = 1/d. */
export const hklToCart = (lat: Lattice, hkl: Vec3): Vec3 => mulVec(lat.B, hkl);

// ---- index conversions -------------------------------------------------------------------------

/**
 * The plane (hkl) whose normal is parallel to the direction [uvw]: hkl ~ G uvw. The result is a
 * real vector, generally not integer (use `cartesianToNearestHkl` for the nearest integer plane).
 */
export const uvwToHkl = (lat: Lattice, uvw: Vec3): Vec3 => mulVec(lat.G, uvw);

/** The direction [uvw] parallel to the normal of the plane (hkl): uvw ~ G* hkl. Real-valued. */
export const hklToUvw = (lat: Lattice, hkl: Vec3): Vec3 => mulVec(lat.Gstar, hkl);

// ---- lengths and angles ------------------------------------------------------------------------

/** Interplanar spacing d(hkl) in angstrom. Throws for (0,0,0). */
export function dSpacing(lat: Lattice, hkl: Vec3): number {
  const g = norm(hklToCart(lat, hkl));
  if (g === 0) throw new RangeError('dSpacing is undefined for (0,0,0)');
  return 1 / g;
}

/** Length |uvw| of the lattice vector u a + v b + w c, in angstrom. */
export const directionLength = (lat: Lattice, uvw: Vec3): number => norm(uvwToCart(lat, uvw));

/** Angle in degrees between two directions [uvw]. */
export const angleBetweenDirections = (lat: Lattice, uvw1: Vec3, uvw2: Vec3): number =>
  angleBetween(uvwToCart(lat, uvw1), uvwToCart(lat, uvw2));

/** Angle in degrees between two planes (hkl), i.e. between their normals. */
export const angleBetweenPlanes = (lat: Lattice, hkl1: Vec3, hkl2: Vec3): number =>
  angleBetween(hklToCart(lat, hkl1), hklToCart(lat, hkl2));

/** Angle in degrees between the direction [uvw] and the normal of the plane (hkl); 0 = parallel. */
export const angleDirectionToPlaneNormal = (lat: Lattice, uvw: Vec3, hkl: Vec3): number =>
  angleBetween(uvwToCart(lat, uvw), hklToCart(lat, hkl));

/**
 * Weiss zone number hu + kv + lw (exact for integer indices). 0 means (hkl) lies in the zone
 * [uvw] (zero-order Laue zone); n > 0 is the n-th Laue zone (context.md 5.2).
 */
export const zoneNumber = (uvw: Vec3, hkl: Vec3): number => dot(uvw, hkl);

// ---- nearest low-index direction / plane -------------------------------------------------------

export interface NearestIndices {
  /** Smallest-integer indices (coprime), with the sign that points closest to the query vector. */
  indices: Vec3;
  /** Angle between the query vector and the exact direction / plane normal of `indices`, degrees. */
  angleDeg: number;
}

interface Candidate {
  indices: Vec3;
  unit: Vec3;
  indexNorm2: number;
}

const candidateCache = new WeakMap<Lattice, Map<string, Candidate[]>>();

/** All coprime integer triples with |index| <= maxIndex, lowest indices first, as unit vectors. */
function candidates(lat: Lattice, kind: 'uvw' | 'hkl', maxIndex: number): Candidate[] {
  let perLattice = candidateCache.get(lat);
  if (!perLattice) candidateCache.set(lat, (perLattice = new Map()));
  const key = `${kind}:${maxIndex}`;
  let list = perLattice.get(key);
  if (!list) {
    const basis = kind === 'uvw' ? lat.M : lat.B;
    list = [];
    for (let h = -maxIndex; h <= maxIndex; h++) {
      for (let k = -maxIndex; k <= maxIndex; k++) {
        for (let l = -maxIndex; l <= maxIndex; l++) {
          if (gcd(gcd(h, k), l) !== 1) continue; // skips (0,0,0) and non-primitive multiples
          const indices: Vec3 = [h, k, l];
          const v = mulVec(basis, indices);
          const length = norm(v);
          list.push({
            indices,
            unit: [v[0] / length, v[1] / length, v[2] / length],
            indexNorm2: h * h + k * k + l * l,
          });
        }
      }
    }
    list.sort((p, q) => p.indexNorm2 - q.indexNorm2);
    perLattice.set(key, list);
  }
  return list;
}

function nearest(lat: Lattice, kind: 'uvw' | 'hkl', v: Vec3, maxIndex: number): NearestIndices {
  if (!Number.isInteger(maxIndex) || maxIndex < 1) {
    throw new RangeError('maxIndex must be an integer >= 1');
  }
  const length = norm(v);
  if (length === 0 || !Number.isFinite(length)) {
    throw new LatticeError('Cannot find the nearest indices of a zero or non-finite vector.');
  }
  const unit: Vec3 = [v[0] / length, v[1] / length, v[2] / length];

  // Candidates are sorted by index size, so on an exact tie the lower-index triple wins.
  let best: Candidate | undefined;
  let bestCos = -2;
  for (const candidate of candidates(lat, kind, maxIndex)) {
    const c = dot(unit, candidate.unit);
    if (c > bestCos + 1e-14) {
      bestCos = c;
      best = candidate;
    }
  }
  return { indices: best!.indices, angleDeg: angleBetween(unit, best!.unit) };
}

/**
 * Lowest-index direction [uvw] (|u|,|v|,|w| <= maxIndex) closest to the Cartesian vector `v`,
 * e.g. the viewing direction of the camera. Exhaustive search, not rounding: rounding ratios of
 * the fractional components is what v6 did and it fails for skewed cells. The sign is kept.
 */
export const cartesianToNearestUvw = (lat: Lattice, v: Vec3, maxIndex = 6): NearestIndices =>
  nearest(lat, 'uvw', v, maxIndex);

/** Lowest-index plane (hkl) whose normal is closest to the Cartesian vector `v`. */
export const cartesianToNearestHkl = (lat: Lattice, v: Vec3, maxIndex = 6): NearestIndices =>
  nearest(lat, 'hkl', v, maxIndex);
