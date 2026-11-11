/**
 * Maps a CIF data block to a plain structure description (`CifStructure`): the cell, the declared
 * space group and symmetry operations as written, and the asymmetric-unit atoms. Nothing is
 * expanded or de-duplicated here; `buildCrystal` (M3) does that.
 */
import type { Cell } from '../crystal';
import { atomicNumber } from '../elements';
import { CifError, CrystalLensError } from '../errors';
import { buildLattice, cartToFrac, cellToMatrix, volume } from '../lattice';
import type { Vec3 } from '../math/vec3';
import {
  columnIndex,
  findLoop,
  isKnown,
  item,
  num,
  parseCifBlocks,
  type CifBlock,
  type CifLoop,
  type CifValue,
  type CifWarning,
} from './parse';

/** Anisotropic displacement parameters U_ij in square angstrom, in the CIF axes' basis. */
export interface AnisoU {
  U11: number;
  U22: number;
  U33: number;
  U12: number;
  U13: number;
  U23: number;
}

export interface CifAtom {
  label: string;
  /** Canonical element symbol ('Fe'); deuterium is 'H' with `isotope: 'D'`. */
  element: string;
  isotope?: 'D' | 'T';
  /** `_atom_site_type_symbol` as written (e.g. 'Fe3+'), when it differs from `element`. */
  typeSymbol?: string;
  /** Fractional coordinates, uncertainties dropped. */
  x: number;
  y: number;
  z: number;
  occupancy: number;
  /** Isotropic displacement U in square angstrom (from U_iso_or_equiv, or B_iso / 8 pi^2). */
  uiso?: number;
  adpType?: string;
  aniso?: AnisoU;
  disorderGroup?: string;
}

export interface CifStructure {
  /** Data block name, e.g. '9008565' or '631185-ICSD'. */
  name: string;
  title?: string;
  /** Mineral, common or systematic name, the first one given. */
  chemicalName?: string;
  formula?: string;
  cell: Cell;
  spaceGroup: { hm?: string; hall?: string; number?: number };
  /** Symmetry operations as written ('-x+1/2, y, z'); empty when the CIF has none. */
  symops: string[];
  atoms: CifAtom[];
  ids: { cod?: string; icsd?: string };
}

export interface StructureResult {
  structure: CifStructure;
  warnings: CifWarning[];
}

const EIGHT_PI_SQ = 8 * Math.PI * Math.PI;

/** Collapse runs of whitespace (CIF text fields carry line breaks and indentation). */
const clean = (v: CifValue | undefined): string | undefined => {
  const t = v?.text.replace(/\s+/g, ' ').trim();
  return t ? t : undefined;
};

/**
 * Element of an `_atom_site_type_symbol` ('Fe3+', 'O2-', 'CU') or, failing that, a label ('Fe1',
 * 'O1W'). Type symbols are matched case-insensitively. For labels a two-letter element needs a
 * lower-case second letter ('Co1' is cobalt; 'CO1' is read as carbon).
 */
export function elementFromSymbol(
  raw: string,
  fromLabel: boolean,
): { element: string; isotope?: 'D' | 'T' } | undefined {
  const run = /^[A-Za-z]+/.exec(raw.trim())?.[0];
  if (!run) return undefined;
  if (run === 'D' || run === 'T') return { element: 'H', isotope: run };
  const one = run[0].toUpperCase();
  const two = run.length >= 2 ? one + run[1].toLowerCase() : '';
  const secondIsLower = run.length >= 2 && run[1] === run[1].toLowerCase();
  if (two && atomicNumber(two) && (!fromLabel || secondIsLower)) return { element: two };
  if (atomicNumber(one)) return { element: one };
  if (two && atomicNumber(two)) return { element: two };
  return undefined;
}

/** A loop for `prefix` tags, or a one-row loop built from plain items (single-atom CIFs). */
function loopOrItems(
  block: CifBlock,
  anchor: string,
  prefix: string,
  exclude?: string,
): CifLoop | undefined {
  const loop = findLoop(block, anchor);
  if (loop) return loop;
  if (!block.items.has(anchor)) return undefined;
  const tags = [...block.items.keys()].filter(
    (t) => t.startsWith(prefix) && !(exclude && t.startsWith(exclude)),
  );
  return { tags, rows: [tags.map((t) => block.items.get(t)!)] };
}

function readCell(block: CifBlock): Cell {
  const get = (tag: string, fallback?: number): number => {
    const v = num(item(block, tag));
    if (v !== undefined) return v;
    if (fallback !== undefined) return fallback;
    throw new CifError(`Missing or invalid ${tag.replace(/^_/, '')}.`);
  };
  return {
    a: get('_cell_length_a'),
    b: get('_cell_length_b'),
    c: get('_cell_length_c'),
    alpha: get('_cell_angle_alpha', 90),
    beta: get('_cell_angle_beta', 90),
    gamma: get('_cell_angle_gamma', 90),
  };
}

function readSymops(block: CifBlock): string[] {
  const loop =
    findLoop(block, '_space_group_symop_operation_xyz') ??
    findLoop(block, '_symmetry_equiv_pos_as_xyz');
  if (loop) {
    const col = columnIndex(loop, '_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz');
    return loop.rows.map((r) => r[col].text.trim()).filter((s) => s !== '' && s !== '?');
  }
  const single = item(block, '_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz');
  return single ? [single.text.trim()] : [];
}

function readAniso(block: CifBlock, warnings: CifWarning[]): Map<string, AnisoU> {
  const out = new Map<string, AnisoU>();
  const loop = loopOrItems(block, '_atom_site_aniso_label', '_atom_site_aniso_');
  if (!loop) return out;
  const idx = (kind: 'u' | 'b', ij: string) => columnIndex(loop, `_atom_site_aniso_${kind}_${ij}`);
  const kind: 'u' | 'b' = idx('u', '11') !== -1 ? 'u' : 'b';
  const scale = kind === 'u' ? 1 : 1 / EIGHT_PI_SQ;
  const cols = ['11', '22', '33', '12', '13', '23'].map((ij) => idx(kind, ij));
  const label = columnIndex(loop, '_atom_site_aniso_label');
  if (cols.some((c) => c === -1)) {
    warnings.push({
      line: 0,
      message: 'Anisotropic loop has no complete U_ij / B_ij set; ignored.',
    });
    return out;
  }
  for (const row of loop.rows) {
    const v = cols.map((c) => num(row[c]));
    if (v.some((x) => x === undefined)) continue;
    const [U11, U22, U33, U12, U13, U23] = v.map((x) => x! * scale);
    out.set(row[label].text, { U11, U22, U33, U12, U13, U23 });
  }
  return out;
}

function readAtoms(block: CifBlock, cell: Cell, warnings: CifWarning[]): CifAtom[] {
  const fractAnchor = '_atom_site_fract_x';
  const cartAnchor = '_atom_site_cartn_x';
  const loop =
    loopOrItems(block, fractAnchor, '_atom_site_', '_atom_site_aniso_') ??
    loopOrItems(block, cartAnchor, '_atom_site_', '_atom_site_aniso_');
  if (!loop) throw new CifError('No atom sites: the CIF has no _atom_site_fract_x column.');
  const cartesian = columnIndex(loop, fractAnchor) === -1;
  if (cartesian) {
    warnings.push({
      line: 0,
      message: 'Atom positions are Cartesian; converted assuming a || x, c* || z.',
    });
  }

  const col = (...tags: string[]) => columnIndex(loop, ...tags);
  const cLabel = col('_atom_site_label');
  const cType = col('_atom_site_type_symbol');
  const cX = col(cartesian ? cartAnchor : fractAnchor);
  const cY = col(cartesian ? '_atom_site_cartn_y' : '_atom_site_fract_y');
  const cZ = col(cartesian ? '_atom_site_cartn_z' : '_atom_site_fract_z');
  const cOcc = col('_atom_site_occupancy');
  const cU = col('_atom_site_u_iso_or_equiv');
  const cB = col('_atom_site_b_iso_or_equiv');
  const cAdp = col('_atom_site_adp_type');
  const cDis = col('_atom_site_disorder_group');
  const cCalc = col('_atom_site_calc_flag');
  if (cY === -1 || cZ === -1) throw new CifError('Atom site loop lacks y or z coordinates.');
  if (cLabel === -1 && cType === -1) {
    throw new CifError('Atom site loop has neither a label nor a type symbol.');
  }

  const lat = cartesian ? buildLattice(cell) : undefined;
  const aniso = readAniso(block, warnings);
  const atoms: CifAtom[] = [];
  for (const row of loop.rows) {
    const label = cLabel !== -1 ? row[cLabel].text : row[cType].text;
    if (cCalc !== -1 && row[cCalc].text.toLowerCase() === 'dum') continue;

    const typeSymbol = cType !== -1 && isKnown(row[cType]) ? row[cType].text : undefined;
    const parsed =
      (typeSymbol ? elementFromSymbol(typeSymbol, false) : undefined) ??
      elementFromSymbol(label, true);
    if (!parsed) {
      warnings.push({ line: 0, message: `Skipped atom "${label}": cannot determine its element.` });
      continue;
    }

    const px = num(row[cX]);
    const py = num(row[cY]);
    const pz = num(row[cZ]);
    if (px === undefined || py === undefined || pz === undefined) {
      warnings.push({ line: 0, message: `Skipped atom "${label}": coordinates are not numbers.` });
      continue;
    }
    const pos: Vec3 = [px, py, pz];
    const [x, y, z] = lat ? cartToFrac(lat, pos) : pos;

    const occ = cOcc !== -1 ? num(row[cOcc]) : undefined;
    let uiso = cU !== -1 ? num(row[cU]) : undefined;
    if (uiso === undefined && cB !== -1) {
      const b = num(row[cB]);
      if (b !== undefined) uiso = b / EIGHT_PI_SQ;
    }
    const atom: CifAtom = { label, element: parsed.element, x, y, z, occupancy: occ ?? 1 };
    if (parsed.isotope) atom.isotope = parsed.isotope;
    if (typeSymbol && typeSymbol !== parsed.element) atom.typeSymbol = typeSymbol;
    if (uiso !== undefined) atom.uiso = uiso;
    if (cAdp !== -1 && isKnown(row[cAdp])) atom.adpType = row[cAdp].text;
    if (cDis !== -1 && isKnown(row[cDis])) atom.disorderGroup = row[cDis].text;
    const an = aniso.get(label);
    if (an) atom.aniso = an;
    atoms.push(atom);
  }
  if (atoms.length === 0) throw new CifError('The CIF has an atom-site loop but no usable atoms.');
  return atoms;
}

/** Map one data block to a structure. Throws `CifError` when the essentials are missing. */
export function blockToStructure(block: CifBlock): StructureResult {
  const warnings: CifWarning[] = [...block.warnings];
  const cell = readCell(block);
  const M = cellToMatrix(cell); // validates, throwing LatticeError for impossible cells

  const declaredVolume = num(item(block, '_cell_volume'));
  if (declaredVolume !== undefined && declaredVolume > 0) {
    const v = volume(M);
    if (Math.abs(v - declaredVolume) / declaredVolume > 0.01) {
      warnings.push({
        line: 0,
        message: `Declared cell volume ${declaredVolume} differs from the one computed from the cell (${v.toFixed(2)}).`,
      });
    }
  }

  const sg: CifStructure['spaceGroup'] = {};
  const hm = clean(
    item(
      block,
      '_space_group_name_h-m_alt',
      '_symmetry_space_group_name_h-m',
      '_space_group_name_h-m',
    ),
  );
  const hall = clean(item(block, '_space_group_name_hall', '_symmetry_space_group_name_hall'));
  const number = num(item(block, '_space_group_it_number', '_symmetry_int_tables_number'));
  if (hm) sg.hm = hm;
  if (hall) sg.hall = hall;
  if (number !== undefined) sg.number = Math.round(number);

  const structure: CifStructure = {
    name: block.name,
    cell,
    spaceGroup: sg,
    symops: readSymops(block),
    atoms: readAtoms(block, cell, warnings),
    ids: {},
  };
  const title = clean(
    item(
      block,
      '_publ_section_title',
      '_chemical_name_mineral',
      '_chemical_name_common',
      '_chemical_name_systematic',
    ),
  );
  if (title) structure.title = title;
  const chemicalName = clean(
    item(block, '_chemical_name_mineral', '_chemical_name_common', '_chemical_name_systematic'),
  );
  if (chemicalName) structure.chemicalName = chemicalName;
  const formula = clean(item(block, '_chemical_formula_sum', '_chemical_formula_moiety'));
  if (formula) structure.formula = formula;
  const cod = clean(item(block, '_cod_database_code'));
  if (cod) structure.ids.cod = cod;
  const icsd = clean(item(block, '_database_code_icsd'));
  if (icsd) structure.ids.icsd = icsd;
  return { structure, warnings };
}

export interface BlockOutcome {
  name: string;
  /** Present on success. */
  structure?: CifStructure;
  /** Present on failure. */
  error?: string;
  warnings: CifWarning[];
}

/**
 * Parse CIF text and map every data block. A block that cannot be mapped (no atoms, bad cell)
 * reports an `error` instead of aborting the others. Throws `CifError` only when the text has no
 * data block at all.
 */
export function parseCif(text: string): BlockOutcome[] {
  const doc = parseCifBlocks(text);
  return doc.blocks.map((block) => {
    try {
      const { structure, warnings } = blockToStructure(block);
      return { name: block.name, structure, warnings };
    } catch (e) {
      if (e instanceof CrystalLensError) {
        return { name: block.name, error: e.message, warnings: block.warnings };
      }
      throw e;
    }
  });
}

/** Parse a CIF expected to hold one structure: the first block that maps successfully. */
export function parseFirstStructure(text: string): StructureResult {
  const outcomes = parseCif(text);
  const ok = outcomes.find((o) => o.structure);
  if (ok?.structure) return { structure: ok.structure, warnings: ok.warnings };
  throw new CifError(outcomes[0]?.error ?? 'No structure found.');
}
