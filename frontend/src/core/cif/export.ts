import type { Crystal } from '../crystal';
import type { CifStructure } from './structure';

/**
 * The unit-cell content as a P1 `CifStructure`: every symmetry copy listed explicitly with the
 * single operation 'x, y, z', ready for `writeCif`. Labels are made unique per copy.
 */
export function toP1Structure(crystal: Crystal): CifStructure {
  const count = new Map<number, number>();
  const structure: CifStructure = {
    name: crystal.name,
    cell: crystal.cell,
    spaceGroup: { hm: 'P 1', number: 1 },
    symops: ['x, y, z'],
    ids: crystal.ids,
    atoms: crystal.atoms.map((a) => {
      const site = crystal.sites[a.site];
      const n = (count.get(a.site) ?? 0) + 1;
      count.set(a.site, n);
      const atom: CifStructure['atoms'][number] = {
        label: `${site.label}_${n}`,
        element: a.element,
        x: a.frac[0],
        y: a.frac[1],
        z: a.frac[2],
        occupancy: a.occupancy,
      };
      if (site.isotope) atom.isotope = site.isotope;
      if (site.typeSymbol) atom.typeSymbol = site.typeSymbol;
      if (a.uiso !== undefined) atom.uiso = a.uiso;
      return atom;
    }),
  };
  if (crystal.title) structure.title = crystal.title;
  if (crystal.chemicalName) structure.chemicalName = crystal.chemicalName;
  return structure;
}
