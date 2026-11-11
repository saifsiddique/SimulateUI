/**
 * The periodic bond graph of a crystal: for every atom of the unit cell, the atoms it is bonded
 * to as (unit-cell atom, lattice translation). Bonds never need to be searched for again after
 * this: the neighbours of the image of atom a in cell s are the neighbours of a, shifted by s.
 * That makes "search beyond the range", "complete molecules" and coordination polyhedra O(N).
 */
import type { Crystal } from '../crystal';
import { fracToCart } from '../lattice';
import { findBonds, limitsFromRules, type BondRule } from './bonds';
import { RangeError, atomKey, placeAtoms } from './range';

export interface BondGraph {
  /** Neighbours of unit-cell atom a are entries start[a] .. start[a+1]-1. */
  start: Uint32Array;
  /** Unit-cell atom index of each neighbour. */
  atom: Uint32Array;
  /** Lattice translation of each neighbour relative to the atom, 3 per entry. */
  shift: Int16Array;
  /** Index of the rule that made each bond. */
  rule: Uint16Array;
}

const MAX_PATCH_ATOMS = 4_000_000;

export function buildBondGraph(crystal: Crystal, rules: readonly BondRule[]): BondGraph {
  const n = crystal.atoms.length;
  const elements = [...new Set(crystal.atoms.map((a) => a.element))];
  const lim = limitsFromRules(elements, rules);
  let cutoff = 0;
  for (const m of lim.maxDistance) cutoff = Math.max(cutoff, m);
  const empty: BondGraph = {
    start: new Uint32Array(n + 1),
    atom: new Uint32Array(0),
    shift: new Int16Array(0),
    rule: new Uint16Array(0),
  };
  if (cutoff <= 0 || n === 0) return empty;

  // How many cells away a bonded neighbour can be along each axis: cutoff / (plane spacing).
  const B = crystal.lattice.B;
  const m = [0, 1, 2].map((k) => Math.ceil(cutoff * Math.hypot(B[0][k], B[1][k], B[2][k])));
  if (n * (2 * m[0] + 1) * (2 * m[1] + 1) * (2 * m[2] + 1) > MAX_PATCH_ATOMS) {
    throw new RangeError('The unit cell is too large to search for bonded neighbours.');
  }
  const placed = placeAtoms(
    crystal,
    {
      min: [-m[0], -m[1], -m[2]],
      max: [m[0] + 1, m[1] + 1, m[2] + 1],
    },
    { boundary: false },
  );
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

  // Collect, per unit-cell atom, the bonds whose one end is that atom in the central cell (0,0,0).
  const lists: number[][] = Array.from({ length: n }, () => []);
  const inCentre = (i: number) =>
    placed.cell[3 * i] === 0 && placed.cell[3 * i + 1] === 0 && placed.cell[3 * i + 2] === 0;
  for (let b = 0; b < bonds.rule.length; b++) {
    const i = bonds.pairs[2 * b];
    const j = bonds.pairs[2 * b + 1];
    const r = bonds.rule[b];
    if (inCentre(i)) {
      lists[placed.atom[i]].push(
        placed.atom[j],
        placed.cell[3 * j],
        placed.cell[3 * j + 1],
        placed.cell[3 * j + 2],
        r,
      );
    }
    if (inCentre(j)) {
      lists[placed.atom[j]].push(
        placed.atom[i],
        placed.cell[3 * i],
        placed.cell[3 * i + 1],
        placed.cell[3 * i + 2],
        r,
      );
    }
  }
  let total = 0;
  for (const l of lists) total += l.length / 5;
  const graph: BondGraph = {
    start: new Uint32Array(n + 1),
    atom: new Uint32Array(total),
    shift: new Int16Array(3 * total),
    rule: new Uint16Array(total),
  };
  let e = 0;
  for (let a = 0; a < n; a++) {
    graph.start[a] = e;
    const l = lists[a];
    for (let q = 0; q < l.length; q += 5) {
      graph.atom[e] = l[q];
      graph.shift[3 * e] = l[q + 1];
      graph.shift[3 * e + 1] = l[q + 2];
      graph.shift[3 * e + 2] = l[q + 3];
      graph.rule[e] = l[q + 4];
      e++;
    }
  }
  graph.start[n] = e;
  return graph;
}

let cached: { crystal: Crystal; key: string; graph: BondGraph } | null = null;

/** `buildBondGraph` with a one-entry cache, since the same graph serves model and polyhedra. */
export function getBondGraph(crystal: Crystal, rules: readonly BondRule[]): BondGraph {
  const key = rules.map((r) => `${r.a}-${r.b}:${r.min}:${r.max}`).join('|');
  if (cached && cached.crystal === crystal && cached.key === key) return cached.graph;
  const graph = buildBondGraph(crystal, rules);
  cached = { crystal, key, graph };
  return graph;
}

export interface Extension {
  /** Atoms to add, as (unit-cell atom, translation), in discovery order. */
  atom: number[];
  cell: number[];
  /** False when `complete` was asked for but the bonding never closes (a framework). */
  closed: boolean;
}

/**
 * Atoms bonded to a set of shown atoms but not in it. With `complete` the search repeats from the
 * new atoms until nothing is added (whole molecules); it gives up past `limit` additions, since a
 * framework structure never closes, and then returns `closed: false` with just one shell.
 *
 * @param members the shown atoms as keys from `atomKey`
 */
export function extendBonded(
  graph: BondGraph,
  members: Set<number>,
  start: { atom: ArrayLike<number>; cell: ArrayLike<number>; count: number },
  complete: boolean,
  limit = 50_000,
): Extension {
  const run = (all: boolean): Extension => {
    const seen = new Set(members);
    const out: Extension = { atom: [], cell: [], closed: true };
    let frontierAtom: number[] = [];
    let frontierCell: number[] = [];
    for (let i = 0; i < start.count; i++) {
      frontierAtom.push(start.atom[i]);
      frontierCell.push(start.cell[3 * i], start.cell[3 * i + 1], start.cell[3 * i + 2]);
    }
    while (frontierAtom.length > 0) {
      const nextAtom: number[] = [];
      const nextCell: number[] = [];
      for (let f = 0; f < frontierAtom.length; f++) {
        const a = frontierAtom[f];
        const ci = frontierCell[3 * f];
        const cj = frontierCell[3 * f + 1];
        const ck = frontierCell[3 * f + 2];
        for (let e = graph.start[a]; e < graph.start[a + 1]; e++) {
          const ni = ci + graph.shift[3 * e];
          const nj = cj + graph.shift[3 * e + 1];
          const nk = ck + graph.shift[3 * e + 2];
          const key = atomKey(graph.atom[e], ni, nj, nk);
          if (seen.has(key)) continue;
          seen.add(key);
          out.atom.push(graph.atom[e]);
          out.cell.push(ni, nj, nk);
          if (out.atom.length > limit) {
            out.closed = false;
            return out;
          }
          nextAtom.push(graph.atom[e]);
          nextCell.push(ni, nj, nk);
        }
      }
      if (!all) break;
      frontierAtom = nextAtom;
      frontierCell = nextCell;
    }
    return out;
  };
  if (!complete) return run(false);
  const full = run(true);
  return full.closed ? full : { ...run(false), closed: false };
}
