/**
 * The structure payload sent to the backend (context.md 5.4, M2): the P1 unit cell exactly as
 * `buildCrystal` made it, plus the raw CIF text for the backend's cross-check. Pure: no DOM.
 */
import type { Cell, Crystal } from './crystal';
import type { Vec3 } from './math/vec3';

export interface PayloadAtom {
  element: string;
  frac: Vec3;
  occupancy: number;
  uiso?: number;
}

export interface StructurePayload {
  rawCif: string;
  fileName: string;
  cell: Cell;
  atoms: PayloadAtom[];
  spaceGroup: { number?: number; symbol?: string };
}

export function structurePayload(
  crystal: Crystal,
  rawCif: string,
  fileName: string,
): StructurePayload {
  const atoms = crystal.atoms.map((a) => {
    const out: PayloadAtom = {
      element: a.element,
      frac: [a.frac[0], a.frac[1], a.frac[2]],
      occupancy: a.occupancy,
    };
    if (a.uiso !== undefined) out.uiso = a.uiso;
    return out;
  });
  const sg: StructurePayload['spaceGroup'] = {};
  if (crystal.spaceGroup.number !== undefined) sg.number = crystal.spaceGroup.number;
  if (crystal.spaceGroup.symbol !== undefined) sg.symbol = crystal.spaceGroup.symbol;
  return { rawCif, fileName, cell: { ...crystal.cell }, atoms, spaceGroup: sg };
}

/** Sites (distinct positions) that are partially occupied or shared by several species. */
export interface PartialSite {
  frac: Vec3;
  species: { element: string; occupancy: number }[];
  total: number;
}

export function partialSites(crystal: Crystal): PartialSite[] {
  const out: PartialSite[] = [];
  for (const p of crystal.positions) {
    const atoms = p.atoms.map((i) => crystal.atoms[i]);
    const total = atoms.reduce((s, a) => s + a.occupancy, 0);
    if (atoms.length > 1 || total < 1 - 1e-6) {
      out.push({
        frac: p.frac,
        species: atoms.map((a) => ({ element: a.element, occupancy: a.occupancy })),
        total,
      });
    }
  }
  return out;
}

/**
 * A P1 `CifStructure`-shaped description of an orthogonal cell returned by the backend, so the
 * copied viewer can display it through `buildCrystal` like any other structure.
 */
export interface OrthogonalCellInput {
  cell: [number, number, number];
  atoms: { element: string; frac: Vec3; occupancy: number; uiso?: number | null }[];
}

export function orthogonalCifStructure(name: string, o: OrthogonalCellInput) {
  return {
    name,
    cell: { a: o.cell[0], b: o.cell[1], c: o.cell[2], alpha: 90, beta: 90, gamma: 90 },
    spaceGroup: { hm: 'P 1', number: 1 },
    symops: ['x, y, z'],
    ids: {},
    atoms: o.atoms.map((a, i) => ({
      label: `${a.element}${i + 1}`,
      element: a.element,
      x: a.frac[0],
      y: a.frac[1],
      z: a.frac[2],
      occupancy: a.occupancy,
      ...(a.uiso != null ? { uiso: a.uiso } : {}),
    })),
  };
}
