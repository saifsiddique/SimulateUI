/**
 * Space-group identification and lookup: the 530 Hall settings (generated from spglib's database),
 * lookup by Hall symbol / Hermann-Mauguin symbol / IT number, and helpers describing an operation
 * set (point-group rotations, lattice centring).
 *
 * What this does NOT do: find the true symmetry of a structure whose CIF declares none or a wrong
 * one (that needs a tolerance-based search such as spglib's). The declared group is checked for
 * consistency instead; see `buildCrystal`.
 */
import type { Mat3 } from '../math/mat3';
import type { Vec3 } from '../math/vec3';
import { SPACE_GROUP_ROWS } from './data/spacegroups';
import { hallToOps } from './hall';
import { opKey, uniqueOps, type SymOp } from './symop';

export interface SpaceGroupType {
  /** Index into spglib's list of 530 settings (1-based). */
  hallNumber: number;
  /** International Tables number, 1-230. */
  number: number;
  hall: string;
  /** Short Hermann-Mauguin symbol, e.g. 'Pnma'. */
  short: string;
  /** Full symbol with spaces, e.g. 'P 2_1/n 2_1/m 2_1/a'. */
  full: string;
  /** Setting / origin / axes choice ('', 'b', '1', '2', 'H', 'R', 'cab', ...). */
  choice: string;
}

export const SPACE_GROUP_TYPES: readonly SpaceGroupType[] = SPACE_GROUP_ROWS.map(
  ([hallNumber, number, hall, short, full, choice]) => ({
    hallNumber,
    number,
    hall,
    short,
    full,
    choice,
  }),
);

export const spaceGroupByHallNumber = (hallNumber: number): SpaceGroupType | undefined =>
  SPACE_GROUP_TYPES[hallNumber - 1];

/** All settings of an IT number; the first is spglib's default (standard) setting. */
export const spaceGroupsByNumber = (number: number): SpaceGroupType[] =>
  SPACE_GROUP_TYPES.filter((t) => t.number === number);

export const standardSetting = (number: number): SpaceGroupType | undefined =>
  spaceGroupsByNumber(number)[0];

const normalizeHall = (s: string): string => s.trim().replace(/\s+/g, ' ');
const normalizeHM = (s: string): string => s.replace(/[\s_~]+/g, '');

export function findSpaceGroupByHall(hall: string): SpaceGroupType | undefined {
  const h = normalizeHall(hall).toLowerCase();
  return SPACE_GROUP_TYPES.find((t) => t.hall.toLowerCase() === h);
}

let hmIndex: Map<string, SpaceGroupType[]> | undefined;
function hmEntries(): Map<string, SpaceGroupType[]> {
  if (hmIndex) return hmIndex;
  hmIndex = new Map();
  for (const t of SPACE_GROUP_TYPES) {
    for (const name of new Set([normalizeHM(t.short), normalizeHM(t.full)])) {
      const key = name.toLowerCase();
      hmIndex.set(key, [...(hmIndex.get(key) ?? []), t]);
    }
  }
  return hmIndex;
}

/**
 * Settings whose Hermann-Mauguin symbol matches: 'P 1 21/c 1', 'P 21/c', 'Pbnm', 'F d -3 m :1'
 * (a ':choice' suffix selects the origin / axes choice). Spaces, underscores and case are ignored.
 * More than one result means the symbol alone does not fix the setting.
 */
export function findSpaceGroupsByHM(hm: string): SpaceGroupType[] {
  const [base, suffix] = hm.split(':');
  const matches = hmEntries().get(normalizeHM(base).toLowerCase()) ?? [];
  const choice = suffix?.trim();
  if (!choice) return matches;
  const narrowed = matches.filter((t) => t.choice === choice || t.choice.startsWith(choice));
  return narrowed.length > 0 ? narrowed : matches;
}

export type CrystalSystem =
  'triclinic' | 'monoclinic' | 'orthorhombic' | 'tetragonal' | 'trigonal' | 'hexagonal' | 'cubic';

export function crystalSystemOf(number: number): CrystalSystem {
  if (number <= 2) return 'triclinic';
  if (number <= 15) return 'monoclinic';
  if (number <= 74) return 'orthorhombic';
  if (number <= 142) return 'tetragonal';
  if (number <= 167) return 'trigonal';
  if (number <= 194) return 'hexagonal';
  return 'cubic';
}

const orderCache = new Map<number, Set<number>>();
/** The group orders (counting lattice centring) the settings of an IT number can have. */
export function groupOrders(number: number): Set<number> {
  let orders = orderCache.get(number);
  if (!orders) {
    orders = new Set(spaceGroupsByNumber(number).map((t) => hallToOps(t.hall).length));
    orderCache.set(number, orders);
  }
  return orders;
}

/** Distinct rotation parts: the point group's matrices (acting on fractional coordinates). */
export function pointGroupRotations(ops: readonly SymOp[]): Mat3[] {
  const seen = new Map<string, Mat3>();
  for (const op of ops) seen.set(op.R.flat().join(), op.R);
  return [...seen.values()];
}

/** Non-trivial lattice centring translations (operations with R = identity), in [0, 1)^3. */
export function centringVectors(ops: readonly SymOp[]): Vec3[] {
  return uniqueOps(
    ops.filter((op) => op.R.every((row, i) => row.every((v, j) => v === +(i === j)))),
  )
    .map((op) => op.t)
    .filter((t) => t.some((x) => x > 1e-9));
}

export const hasInversion = (ops: readonly SymOp[]): boolean =>
  ops.some((op) => op.R.every((row, i) => row.every((v, j) => v === (i === j ? -1 : 0))));

/** True when two operation lists describe the same set of operations (modulo lattice translations). */
export function sameOps(a: readonly SymOp[], b: readonly SymOp[]): boolean {
  const keys = new Set(a.map(opKey));
  return a.length === b.length && b.every((op) => keys.has(opKey(op)));
}
