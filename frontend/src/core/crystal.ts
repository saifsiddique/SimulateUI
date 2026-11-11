/**
 * Shared crystal data model (context.md 5.4) and `buildCrystal`, which turns a parsed CIF
 * (`CifStructure`) into a de-duplicated unit cell with a verified symmetry description.
 */
import type { CifWarning } from './cif/tokenizer';
import type { AnisoU, CifStructure } from './cif/structure';
import { gcd } from './math/integers';
import { formulaRank } from './elements';
import { buildLattice, type Lattice } from './lattice';
import type { Mat3 } from './math/mat3';
import type { Vec3 } from './math/vec3';
import { orbit, PeriodicIndex } from './symmetry/expand';
import { hallToOps } from './symmetry/hall';
import {
  centringVectors,
  crystalSystemOf,
  findSpaceGroupByHall,
  findSpaceGroupsByHM,
  groupOrders,
  hasInversion,
  pointGroupRotations,
  standardSetting,
  type CrystalSystem,
} from './symmetry/spacegroup';
import { closure, IDENTITY_OP, parseSymop, uniqueOps, type SymOp } from './symmetry/symop';
import { SymmetryError } from './errors';

/** Unit-cell parameters: lengths in angstrom, angles in degrees (context.md 5.1). */
export interface Cell {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

/** One atom of the asymmetric unit, as listed in the CIF. */
export interface Site {
  index: number;
  label: string;
  element: string;
  isotope?: 'D' | 'T';
  /** Oxidation-state-bearing symbol from the CIF ('Fe3+'), only when it differs from `element`. */
  typeSymbol?: string;
  /** Fractional position as listed (not wrapped). */
  frac: Vec3;
  occupancy: number;
  uiso?: number;
  /** U_ij in the CIF axes' basis, as listed for this site (not rotated onto symmetry copies). */
  aniso?: AnisoU;
  disorderGroup?: string;
  /** Number of distinct unit-cell positions this site generates. */
  multiplicity: number;
}

/** One atom in the unit cell: a symmetry copy of a site. */
export interface Atom {
  site: number;
  element: string;
  /** Wrapped into [0, 1). */
  frac: Vec3;
  occupancy: number;
  uiso?: number;
}

/**
 * A distinct place in the unit cell. More than one atom here means a mixed-occupancy site
 * (e.g. Fe/Mg), which is how pymatgen and the fixtures count sites.
 */
export interface Position {
  frac: Vec3;
  /** Indices into `Crystal.atoms`. */
  atoms: number[];
}

export interface SpaceGroupInfo {
  /** IT number 1-230, when known. */
  number?: number;
  /** Short Hermann-Mauguin symbol of the standard setting, e.g. 'Fd-3m'. */
  symbol?: string;
  crystalSystem?: CrystalSystem;
  /** H-M and Hall symbols as declared in the CIF. */
  declared: { hm?: string; hall?: string; number?: number };
  /** Number of operations including lattice centring. */
  order: number;
  /** Lattice-centring translations (empty for a primitive cell). */
  centring: Vec3[];
  centrosymmetric: boolean;
  /** Where the operations came from. */
  source: 'cif-symops' | 'space-group-table' | 'p1-assumed';
}

export interface CrystalSummary {
  /** Number of atoms per element in the unit cell, weighted by occupancy. */
  counts: Record<string, number>;
  /** Hill-order formula of the unit-cell content divided by Z, e.g. 'Al Na O8 Si3'. */
  formula: string;
  /** Formula units per cell, when the counts are whole numbers. */
  Z?: number;
  volume: number;
}

export interface Crystal {
  name: string;
  title?: string;
  /** Mineral, common or systematic name from the CIF. */
  chemicalName?: string;
  ids: { cod?: string; icsd?: string };
  cell: Cell;
  lattice: Lattice;
  spaceGroup: SpaceGroupInfo;
  /** The complete operation list (R, t), translations in [0, 1). */
  ops: SymOp[];
  /** Distinct rotation parts of `ops` (the point group), acting on fractional coordinates. */
  rotations: Mat3[];
  sites: Site[];
  atoms: Atom[];
  positions: Position[];
  summary: CrystalSummary;
}

// ---- symmetry resolution -------------------------------------------------------------------------

interface Resolved {
  ops: SymOp[];
  info: SpaceGroupInfo;
}

function resolveSymmetry(s: CifStructure, warnings: CifWarning[]): Resolved {
  const warn = (message: string) => warnings.push({ line: 0, message });
  const declared = { ...s.spaceGroup };
  const byHall = declared.hall ? findSpaceGroupByHall(declared.hall) : undefined;
  const byHM = declared.hm ? findSpaceGroupsByHM(declared.hm) : [];
  const hmNumbers = new Set(byHM.map((t) => t.number));

  let number = declared.number;
  if (number !== undefined && (number < 1 || number > 230)) {
    warn(`Ignored the invalid space-group number ${number}.`);
    number = undefined;
  }
  if (number === undefined)
    number = byHall?.number ?? (hmNumbers.size === 1 ? byHM[0].number : undefined);
  else if (hmNumbers.size > 0 && !hmNumbers.has(number)) {
    warn(`The space-group number ${number} disagrees with the symbol "${declared.hm}".`);
  }

  let ops: SymOp[] | undefined;
  let source: SpaceGroupInfo['source'] = 'cif-symops';
  if (s.symops.length > 0) {
    try {
      const parsed = s.symops.map(parseSymop);
      const unique = uniqueOps(parsed);
      ops = unique;
      try {
        const full = closure(unique);
        if (full.length !== unique.length) {
          warn(
            `The CIF lists ${unique.length} distinct symmetry operations but they generate ${full.length}; using the full group.`,
          );
          ops = full;
        }
      } catch (e) {
        if (!(e instanceof SymmetryError)) throw e;
        warn(`${e.message} Using the operations as listed.`);
      }
    } catch (e) {
      if (!(e instanceof SymmetryError)) throw e;
      warn(`${e.message} Falling back to the space-group symbol.`);
    }
  }
  if (!ops && declared.hall && !byHall) {
    // A Hall symbol we do not tabulate (e.g. with a change of basis) can still be interpreted.
    try {
      ops = hallToOps(declared.hall);
      source = 'space-group-table';
    } catch (e) {
      if (!(e instanceof SymmetryError)) throw e;
      warn(`${e.message} Falling back to the Hermann-Mauguin symbol.`);
    }
  }
  if (!ops) {
    const setting =
      byHall ?? (byHM.length > 0 ? byHM[0] : number ? standardSetting(number) : undefined);
    if (setting) {
      ops = hallToOps(setting.hall);
      source = 'space-group-table';
      if (!byHall && byHM.length > 1 && !declared.hm?.includes(':')) {
        warn(
          `The symbol "${declared.hm}" does not fix the origin / axes choice; used ${setting.hall}.`,
        );
      }
      number ??= setting.number;
    } else {
      warn('The CIF gives no usable symmetry information; assuming P1.');
      ops = [IDENTITY_OP];
      source = 'p1-assumed';
      number = 1;
    }
  } else if (number !== undefined && !groupOrders(number).has(ops.length)) {
    // A centred cell of a primitive group (albite as 'C -1') has centring+1 times the order.
    const listed = ops.length;
    const factor = centringVectors(ops).length + 1;
    const centredCell = [...groupOrders(number)].some((n) => n * factor === listed);
    if (!centredCell) {
      warn(
        `Space group ${number} has ${[...groupOrders(number)].join(' or ')} operations but the CIF lists ${ops.length}.`,
      );
    }
  }

  const info: SpaceGroupInfo = {
    declared,
    order: ops.length,
    centring: centringVectors(ops),
    centrosymmetric: hasInversion(ops),
    source,
  };
  if (number !== undefined) {
    info.number = number;
    info.crystalSystem = crystalSystemOf(number);
    const std = standardSetting(number);
    if (std) info.symbol = std.short;
  }
  return { ops, info };
}

// ---- summary -------------------------------------------------------------------------------------

function hillFormula(counts: Record<string, number>, divisor: number): string {
  const elements = Object.keys(counts);
  const order = elements.includes('C')
    ? [
        'C',
        ...(elements.includes('H') ? ['H'] : []),
        ...elements.filter((e) => e !== 'C' && e !== 'H').sort(),
      ]
    : elements.sort();
  return order
    .map((e) => {
      const n = Math.round((counts[e] / divisor) * 1e3) / 1e3;
      return n === 1 ? e : `${e}${n}`;
    })
    .join(' ');
}

/**
 * A short formula without spaces for labels, e.g. 'TiO2', 'NaAlSi3O8', 'ErTe3': per formula unit,
 * the elements in the IUPAC sequence (Hill order, C then H first, when both are present).
 */
export function compactFormula(summary: Pick<CrystalSummary, 'counts' | 'Z'>): string {
  const counts = summary.counts;
  const elements = Object.keys(counts);
  const organic = elements.includes('C') && elements.includes('H');
  const order = organic
    ? ['C', 'H', ...elements.filter((e) => e !== 'C' && e !== 'H').sort()]
    : elements.sort((a, b) => formulaRank(a) - formulaRank(b) || a.localeCompare(b));
  const divisor = summary.Z && summary.Z > 0 ? summary.Z : 1;
  return order
    .map((e) => {
      const n = Math.round((counts[e] / divisor) * 1e3) / 1e3;
      return n === 1 ? e : `${e}${n}`;
    })
    .join('');
}

function summarize(atoms: Atom[], volume: number): CrystalSummary {
  const counts: Record<string, number> = {};
  for (const a of atoms) counts[a.element] = (counts[a.element] ?? 0) + a.occupancy;
  for (const el of Object.keys(counts)) counts[el] = Math.round(counts[el] * 1e6) / 1e6;
  const rounded = Object.values(counts).map(Math.round);
  const whole = Object.values(counts).every(
    (n, i) => Math.abs(n - rounded[i]) < 0.01 && rounded[i] > 0,
  );
  const Z = whole ? rounded.reduce((g, n) => gcd(g, n), 0) : undefined;
  return {
    counts,
    formula: hillFormula(counts, Z && Z > 0 ? Z : 1),
    ...(Z && Z > 0 ? { Z } : {}),
    volume,
  };
}

// ---- build ---------------------------------------------------------------------------------------

export interface CrystalResult {
  crystal: Crystal;
  warnings: CifWarning[];
}

/**
 * Build the full unit cell: parse and complete the symmetry operations (from the CIF, or from the
 * space-group symbol when it lists none), apply them to every asymmetric-unit atom, wrap into
 * [0, 1) and merge copies that coincide within 0.01 angstrom.
 */
export function buildCrystal(s: CifStructure): CrystalResult {
  const warnings: CifWarning[] = [];
  const lattice = buildLattice(s.cell);
  const { ops, info } = resolveSymmetry(s, warnings);

  const sites: Site[] = [];
  const atoms: Atom[] = [];
  const positionIndex = new PeriodicIndex(lattice);
  const positionAtoms: number[][] = [];

  s.atoms.forEach((a, index) => {
    const frac: Vec3 = [a.x, a.y, a.z];
    const images = orbit(lattice, ops, frac);
    const site: Site = {
      index,
      label: a.label,
      element: a.element,
      frac,
      occupancy: a.occupancy,
      multiplicity: images.length,
    };
    if (a.isotope) site.isotope = a.isotope;
    if (a.typeSymbol) site.typeSymbol = a.typeSymbol;
    if (a.uiso !== undefined) site.uiso = a.uiso;
    if (a.aniso) site.aniso = a.aniso;
    if (a.disorderGroup) site.disorderGroup = a.disorderGroup;
    sites.push(site);

    for (const f of images) {
      const atom: Atom = { site: index, element: a.element, frac: f, occupancy: a.occupancy };
      if (a.uiso !== undefined) atom.uiso = a.uiso;
      const atomIndex = atoms.push(atom) - 1;
      const near = positionIndex.near(f);
      if (near.length > 0) positionAtoms[near[0]].push(atomIndex);
      else {
        positionIndex.add(f);
        positionAtoms.push([atomIndex]);
      }
    }
  });

  const positions: Position[] = positionAtoms.map((list, i) => ({
    frac: positionIndex.points[i],
    atoms: list,
  }));

  let overfull = 0;
  for (const p of positions) {
    if (p.atoms.length > 1 && p.atoms.reduce((sum, i) => sum + atoms[i].occupancy, 0) > 1.02)
      overfull++;
  }
  if (overfull > 0) {
    warnings.push({
      line: 0,
      message: `${overfull} position${overfull === 1 ? '' : 's'} hold atoms with total occupancy above 1 (overlapping or disordered atoms).`,
    });
  }

  const crystal: Crystal = {
    name: s.name,
    ids: s.ids,
    cell: s.cell,
    lattice,
    spaceGroup: info,
    ops,
    rotations: pointGroupRotations(ops),
    sites,
    atoms,
    positions,
    summary: summarize(atoms, lattice.volume),
  };
  if (s.title) crystal.title = s.title;
  if (s.chemicalName) crystal.chemicalName = s.chemicalName;
  return { crystal, warnings };
}
