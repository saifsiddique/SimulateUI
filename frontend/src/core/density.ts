import type { Crystal } from './crystal';
import { atomicMass } from './scattering';

/** Atomic mass unit in grams. */
const AMU_G = 1.6605390666e-24;

/** Mass of the unit-cell content in u, weighted by occupancy (deuterium counted as 2.0141 u). */
export function cellMass(crystal: Crystal): number {
  let mass = 0;
  for (const atom of crystal.atoms) {
    mass += atom.occupancy * atomicMass(atom.element, crystal.sites[atom.site].isotope);
  }
  return mass;
}

/** Calculated density in g/cm^3. */
export function density(crystal: Crystal): number {
  return (cellMass(crystal) * AMU_G) / (crystal.lattice.volume * 1e-24);
}
