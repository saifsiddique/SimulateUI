/**
 * Everything the renderer draws, as flat arrays: the atoms in a range with their Cartesian
 * positions and the bonds between them. Pure data, no three.js. Appearance (colours, radii,
 * visibility) is separate, see `styles.ts`, so changing it never repeats the bond search.
 */
import type { Crystal } from '../crystal';
import { fracToCart } from '../lattice';
import { elementInfo } from '../scattering';
import { MANUAL_RULE, defaultBondRules, findBonds, limitsFromRules, type BondRule } from './bonds';
import { extendBonded, getBondGraph } from './graph';
import {
  UNIT_CELL_RANGE,
  atomKey,
  placeAtoms,
  type PlacedAtoms,
  type PlaceOptions,
  type Range,
} from './range';

export type DisplayStyle = 'ballStick' | 'spaceFill' | 'stick';

/** A specific atom: a unit-cell atom (index into `Crystal.atoms`) in a lattice cell. */
export interface AtomRef {
  atom: number;
  cell: [number, number, number];
}

export interface ManualBonds {
  add: [AtomRef, AtomRef][];
  remove: [AtomRef, AtomRef][];
}

export interface BondOptions {
  /** Undefined: the default rules of the crystal. */
  rules?: readonly BondRule[];
  /** Also show atoms outside the range that are bonded to atoms inside it. */
  beyondRange?: boolean;
  /** Add atoms until every shown atom's bonded neighbours are shown (whole molecules). */
  completeMolecules?: boolean;
  manual?: ManualBonds;
}

export interface ModelOptions extends PlaceOptions {
  range?: Range;
  /** false skips the bond search. */
  bonds?: BondOptions | false;
}

export interface StructureModel {
  count: number;
  /** Cartesian positions in angstrom, 3 per atom. */
  cart: Float64Array;
  /** Distinct elements shown, in first-seen order. */
  elements: string[];
  /** Index into `elements` for every atom. */
  species: Uint16Array;
  /** `Crystal.atoms` index and lattice translation for every atom. */
  placed: PlacedAtoms;
  /** 1 for atoms inside the range, 0 for atoms added because they are bonded to one. */
  inRange: Uint8Array;
  /** Bonded pairs, two atom indices per bond. */
  bonds: Uint32Array;
  /** Rule index (into `rules`) of each bond, or `MANUAL_RULE`. */
  bondRule: Uint16Array;
  /** The rules the bonds were made with. */
  rules: BondRule[];
  /** Per element: covalent and van der Waals radius, colour. */
  info: { covalent: number; vdw: number; color: string }[];
  /** Axis-aligned bounds of the atom positions. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Things the user should know (a molecule that never closes, a cap that was hit). */
  warnings: string[];
}

export function buildModel(crystal: Crystal, options: ModelOptions = {}): StructureModel {
  const warnings: string[] = [];
  const bondOptions = options.bonds === false ? null : (options.bonds ?? {});
  const rules = bondOptions ? [...(bondOptions.rules ?? defaultBondRules(crystal))] : [];

  let placed = placeAtoms(crystal, options.range ?? UNIT_CELL_RANGE, options);
  const nCore = placed.count;

  if (bondOptions && (bondOptions.beyondRange || bondOptions.completeMolecules) && nCore > 0) {
    try {
      const graph = getBondGraph(crystal, rules);
      const members = new Set<number>();
      for (let i = 0; i < nCore; i++) {
        members.add(
          atomKey(
            placed.atom[i],
            placed.cell[3 * i],
            placed.cell[3 * i + 1],
            placed.cell[3 * i + 2],
          ),
        );
      }
      const ext = extendBonded(graph, members, placed, !!bondOptions.completeMolecules);
      if (bondOptions.completeMolecules && !ext.closed) {
        warnings.push(
          'This structure is bonded in all directions (a framework), so it has no finite molecules to complete; showing the bonded atoms just beyond the range instead.',
        );
      }
      const extra = ext.atom.length;
      const atom = new Uint32Array(nCore + extra);
      const cell = new Int16Array(3 * (nCore + extra));
      const frac = new Float64Array(3 * (nCore + extra));
      atom.set(placed.atom);
      cell.set(placed.cell);
      frac.set(placed.frac);
      for (let e = 0; e < extra; e++) {
        const i = nCore + e;
        const f = crystal.atoms[ext.atom[e]].frac;
        atom[i] = ext.atom[e];
        for (let k = 0; k < 3; k++) {
          cell[3 * i + k] = ext.cell[3 * e + k];
          frac[3 * i + k] = f[k] + ext.cell[3 * e + k];
        }
      }
      placed = { count: nCore + extra, atom, cell, frac };
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : String(e));
    }
  }

  const count = placed.count;
  const cart = new Float64Array(3 * count);
  const elements: string[] = [];
  const index = new Map<string, number>();
  const species = new Uint16Array(count);
  const inRange = new Uint8Array(count);
  inRange.fill(1, 0, nCore);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const p = fracToCart(crystal.lattice, [
      placed.frac[3 * i],
      placed.frac[3 * i + 1],
      placed.frac[3 * i + 2],
    ]);
    for (let k = 0; k < 3; k++) {
      cart[3 * i + k] = p[k];
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
    const el = crystal.atoms[placed.atom[i]].element;
    let s = index.get(el);
    if (s === undefined) {
      s = elements.length;
      elements.push(el);
      index.set(el, s);
    }
    species[i] = s;
  }
  if (count === 0) {
    min.fill(0);
    max.fill(0);
  }

  const info = elements.map((el) => {
    const e = elementInfo(el);
    return {
      covalent: e.covalentRadius,
      vdw: e.vdwRadius ?? e.covalentRadius * 1.6,
      color: e.color,
    };
  });

  let pairs: Uint32Array = new Uint32Array(0);
  let bondRule: Uint16Array = new Uint16Array(0);
  if (bondOptions) {
    const found = findBonds({
      cart,
      count,
      species,
      nSpecies: elements.length,
      ...limitsFromRules(elements, rules),
    });
    pairs = found.pairs;
    bondRule = found.rule;
    // Beyond the range only atoms bonded to an atom inside it are wanted: drop bonds between two
    // added atoms (whole molecules keep all of theirs).
    if (count > nCore && !bondOptions.completeMolecules) {
      const keep: number[] = [];
      for (let b = 0; b < bondRule.length; b++) {
        if (pairs[2 * b] < nCore || pairs[2 * b + 1] < nCore) keep.push(b);
      }
      if (keep.length !== bondRule.length) {
        const p2 = new Uint32Array(2 * keep.length);
        const r2 = new Uint16Array(keep.length);
        keep.forEach((b, q) => {
          p2[2 * q] = pairs[2 * b];
          p2[2 * q + 1] = pairs[2 * b + 1];
          r2[q] = bondRule[b];
        });
        pairs = p2;
        bondRule = r2;
      }
    }
    if (bondOptions.manual) {
      ({ pairs, bondRule } = applyManualBonds(placed, pairs, bondRule, bondOptions.manual));
    }
  }
  return {
    count,
    cart,
    elements,
    species,
    placed,
    inRange,
    bonds: pairs,
    bondRule,
    rules,
    info,
    bounds: { min, max },
    warnings,
  };
}

/** Remove the bonds the user deleted and add the ones the user drew (when both atoms are shown). */
function applyManualBonds(
  placed: PlacedAtoms,
  pairs: Uint32Array,
  bondRule: Uint16Array,
  manual: ManualBonds,
): { pairs: Uint32Array; bondRule: Uint16Array } {
  if (manual.add.length === 0 && manual.remove.length === 0) return { pairs, bondRule };
  const where = new Map<number, number>();
  for (let i = 0; i < placed.count; i++) {
    where.set(
      atomKey(placed.atom[i], placed.cell[3 * i], placed.cell[3 * i + 1], placed.cell[3 * i + 2]),
      i,
    );
  }
  const indexOf = (r: AtomRef): number | undefined =>
    where.get(atomKey(r.atom, r.cell[0], r.cell[1], r.cell[2]));
  const pairKey = (i: number, j: number): number =>
    i < j ? i * placed.count + j : j * placed.count + i;

  const removed = new Set<number>();
  for (const [a, b] of manual.remove) {
    const i = indexOf(a);
    const j = indexOf(b);
    if (i !== undefined && j !== undefined) removed.add(pairKey(i, j));
  }
  const outPairs: number[] = [];
  const outRule: number[] = [];
  const present = new Set<number>();
  for (let b = 0; b < bondRule.length; b++) {
    const k = pairKey(pairs[2 * b], pairs[2 * b + 1]);
    if (removed.has(k)) continue;
    present.add(k);
    outPairs.push(pairs[2 * b], pairs[2 * b + 1]);
    outRule.push(bondRule[b]);
  }
  for (const [a, b] of manual.add) {
    const i = indexOf(a);
    const j = indexOf(b);
    if (i === undefined || j === undefined || i === j) continue;
    const k = pairKey(i, j);
    if (present.has(k)) continue;
    present.add(k);
    outPairs.push(Math.min(i, j), Math.max(i, j));
    outRule.push(MANUAL_RULE);
  }
  return { pairs: Uint32Array.from(outPairs), bondRule: Uint16Array.from(outRule) };
}
