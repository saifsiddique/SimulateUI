/**
 * Bond search by distance with a cell list, O(N) in the number of atoms (context.md M6 task 2).
 *
 * A bond rule says that atoms of two elements are bonded when their distance lies between `min`
 * and `max`. The default rules come from covalent radii: max = 1.15 (r1 + r2), min = 0.5 angstrom,
 * for every element pair that actually bonds in the structure. One rule per unordered element
 * pair; it also carries how its bonds look (visibility, colour, stick radius).
 */
import type { Crystal } from '../crystal';
import { elementInfo } from '../scattering';
import { placeAtoms, type Range } from './range';
import { fracToCart } from '../lattice';

export const BOND_TOLERANCE = 1.15;
export const MIN_BOND_LENGTH = 0.5;
export const DEFAULT_BOND_RADIUS = 0.12;
/** Rule index of a bond added by hand. */
export const MANUAL_RULE = 0xffff;

export interface BondRule {
  a: string;
  b: string;
  min: number;
  max: number;
  visible: boolean;
  /** '#rrggbb'; undefined colours each half of the bond like its end atom. */
  color?: string;
  /** Stick radius in angstrom. */
  radius: number;
}

/** The key of an unordered element pair: 'Cl-Na'. */
export const ruleKey = (a: string, b: string): string => (a <= b ? `${a}-${b}` : `${b}-${a}`);

export const defaultBondMax = (a: string, b: string): number =>
  Math.round(
    (elementInfo(a).covalentRadius + elementInfo(b).covalentRadius) * BOND_TOLERANCE * 100,
  ) / 100;

export const newBondRule = (a: string, b: string): BondRule => ({
  a: a <= b ? a : b,
  b: a <= b ? b : a,
  min: MIN_BOND_LENGTH,
  max: defaultBondMax(a, b),
  visible: true,
  radius: DEFAULT_BOND_RADIUS,
});

export interface BondInput {
  /** Cartesian positions, 3 per atom. */
  cart: ArrayLike<number>;
  count: number;
  /** Species index of each atom, into the nSpecies x nSpecies tables below. */
  species: ArrayLike<number>;
  nSpecies: number;
  /** Upper and lower limits in angstrom per species pair (max 0: never bond). Symmetric. */
  maxDistance: Float64Array;
  minDistance: Float64Array;
  /** Rule index per species pair (default: all 0). */
  ruleIndex?: Uint16Array;
}

export interface BondList {
  /** Two atom indices (i < j) per bond. */
  pairs: Uint32Array;
  /** The rule that made each bond. */
  rule: Uint16Array;
}

/** Limit tables for the elements of a structure from a rule list. */
export function limitsFromRules(
  elements: readonly string[],
  rules: readonly BondRule[],
): { maxDistance: Float64Array; minDistance: Float64Array; ruleIndex: Uint16Array } {
  const n = elements.length;
  const maxDistance = new Float64Array(n * n);
  const minDistance = new Float64Array(n * n);
  const ruleIndex = new Uint16Array(n * n);
  const at = new Map(elements.map((e, i) => [e, i]));
  rules.forEach((r, ri) => {
    const i = at.get(r.a);
    const j = at.get(r.b);
    if (i === undefined || j === undefined) return;
    for (const p of [i * n + j, j * n + i]) {
      maxDistance[p] = r.max;
      minDistance[p] = r.min;
      ruleIndex[p] = ri;
    }
  });
  return { maxDistance, minDistance, ruleIndex };
}

export function findBonds(input: BondInput): BondList {
  const { cart, count, species, maxDistance, minDistance, nSpecies, ruleIndex } = input;
  const empty = { pairs: new Uint32Array(0), rule: new Uint16Array(0) };
  if (count < 2) return empty;

  let cutoff = 0;
  for (let i = 0; i < maxDistance.length; i++) cutoff = Math.max(cutoff, maxDistance[i]);
  if (cutoff <= 0) return empty;

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++) {
      const v = cart[3 * i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  // Bins of one cutoff each, but never more than ~4 million of them (sparse, huge ranges).
  let size = cutoff;
  const dims = (): number[] => [0, 1, 2].map((k) => Math.floor((hi[k] - lo[k]) / size) + 1);
  let d = dims();
  while (d[0] * d[1] * d[2] > 4_000_000) {
    size *= 1.5;
    d = dims();
  }
  const [nx, ny, nz] = d;

  const cellOf = new Int32Array(count);
  const head = new Int32Array(nx * ny * nz).fill(-1);
  const next = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const cx = Math.floor((cart[3 * i] - lo[0]) / size);
    const cy = Math.floor((cart[3 * i + 1] - lo[1]) / size);
    const cz = Math.floor((cart[3 * i + 2] - lo[2]) / size);
    const c = (cx * ny + cy) * nz + cz;
    cellOf[i] = c;
    next[i] = head[c];
    head[c] = i;
  }

  let out = new Uint32Array(Math.max(64, count * 4));
  let rules = new Uint16Array(out.length / 2);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const c = cellOf[i];
    const cz = c % nz;
    const cy = ((c - cz) / nz) % ny;
    const cx = (c - cz - cy * nz) / (ny * nz);
    const xi = cart[3 * i];
    const yi = cart[3 * i + 1];
    const zi = cart[3 * i + 2];
    const si = species[i] * nSpecies;
    for (let x = Math.max(0, cx - 1); x <= Math.min(nx - 1, cx + 1); x++)
      for (let y = Math.max(0, cy - 1); y <= Math.min(ny - 1, cy + 1); y++)
        for (let z = Math.max(0, cz - 1); z <= Math.min(nz - 1, cz + 1); z++) {
          for (let j = head[(x * ny + y) * nz + z]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const pair = si + species[j];
            const dx = cart[3 * j] - xi;
            const dy = cart[3 * j + 1] - yi;
            const dz = cart[3 * j + 2] - zi;
            const r2 = dx * dx + dy * dy + dz * dz;
            const max = maxDistance[pair];
            const min = minDistance[pair];
            if (max <= 0 || r2 > max * max || r2 < min * min) continue;
            if (n + 2 > out.length) {
              const grown = new Uint32Array(out.length * 2);
              grown.set(out);
              out = grown;
              const grownRules = new Uint16Array(out.length / 2);
              grownRules.set(rules);
              rules = grownRules;
            }
            rules[n / 2] = ruleIndex ? ruleIndex[pair] : 0;
            out[n++] = i;
            out[n++] = j;
          }
        }
  }
  return { pairs: out.slice(0, n), rule: rules.slice(0, n / 2) };
}

/** Non-metals and metalloids; everything else counts as a metal here. */
const NONMETALS = new Set(
  'H He B C N O F Ne Si P S Cl Ar Ge As Se Br Kr Sb Te I Xe At Rn'.split(' '),
);
/** Elements that form anions with metals. */
const ANIONS = new Set('N O F S Cl Se Br Te I'.split(' '));

/**
 * The element pairs that bond in a structure, with default limits: a bond search over the unit
 * cell and its surroundings, collecting the pairs that occur. These make up the initial rule
 * table (so an Na-Cl crystal starts with one rule, Na-Cl, and not with Na-Na and Cl-Cl).
 *
 * One refinement: in a compound that contains an anion-forming element (O, S, Cl, ...), pairs of
 * two metals are left out. Their covalent radii are large enough that neighbouring cations (Ti-Ti
 * across a shared octahedron edge) would otherwise be drawn bonded, which is rarely what is meant.
 * They can be added back in the rule table.
 */
export function defaultBondRules(crystal: Crystal): BondRule[] {
  const elements = [...new Set(crystal.atoms.map((a) => a.element))];
  if (elements.length === 0) return [];
  // Every pair, with default limits, only to find which pairs occur.
  const all: BondRule[] = [];
  const hasAnion = elements.some((e) => ANIONS.has(e));
  for (let i = 0; i < elements.length; i++)
    for (let j = i; j < elements.length; j++) {
      const metalPair = !NONMETALS.has(elements[i]) && !NONMETALS.has(elements[j]);
      if (hasAnion && metalPair) continue;
      all.push(newBondRule(elements[i], elements[j]));
    }
  const lim = limitsFromRules(elements, all);
  const big = crystal.atoms.length > 2000;
  const range: Range = big
    ? { min: [0, 0, 0], max: [1, 1, 1] }
    : { min: [-1, -1, -1], max: [2, 2, 2] };
  const placed = placeAtoms(crystal, range);
  const cart = new Float64Array(3 * placed.count);
  const species = new Uint16Array(placed.count);
  const at = new Map(elements.map((e, i) => [e, i]));
  for (let i = 0; i < placed.count; i++) {
    const p = fracToCart(crystal.lattice, [
      placed.frac[3 * i],
      placed.frac[3 * i + 1],
      placed.frac[3 * i + 2],
    ]);
    cart[3 * i] = p[0];
    cart[3 * i + 1] = p[1];
    cart[3 * i + 2] = p[2];
    species[i] = at.get(crystal.atoms[placed.atom[i]].element)!;
  }
  const bonds = findBonds({
    cart,
    count: placed.count,
    species,
    nSpecies: elements.length,
    ...lim,
  });
  const used = new Set<number>(bonds.rule);
  return all.filter((_, ri) => used.has(ri));
}
