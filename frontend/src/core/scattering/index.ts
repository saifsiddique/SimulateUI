/**
 * Scattering factors and element data (context.md M4).
 *
 * Argument convention for every factor: `s = sin(theta)/lambda = 1/(2d) = |g|/2`, in 1/angstrom
 * (|g| = 1/d is how reciprocal vectors are stored everywhere else, see context.md 5.1). The
 * published parametrisations use different native variables; each is converted inside.
 *
 *   fx  X-ray, in electrons (Waasmaier & Kirfel 1995; ions included)
 *   fe  electron, in angstrom (Lobato & Van Dyck 2014; Peng et al. 1996 for ions)
 *   bn  neutron coherent scattering length, in fm (Sears 1992, real part)
 *
 * A *species* is an element optionally with a charge: 'Fe', 'Fe3+', 'Fe+3', 'O2-', 'O-2'.
 */
import { elementFromSymbol } from '../cif/structure';
import { CrystalLensError } from '../errors';
import { ELEMENT_ROWS, ISOTOPE_B, ISOTOPE_MASS, type ElementRow } from './data/elements';
import { LOBATO, PENG_HIGH, PENG_IONIC, PENG_LOW } from './data/electron';
import { WAASMAIER_KIRFEL } from './data/xray';

/** A species or element for which the requested data does not exist. */
export class ScatteringError extends CrystalLensError {}

export interface Species {
  /** Canonical element symbol. */
  element: string;
  /** Signed charge in elementary charges (0 for a neutral atom). */
  charge: number;
  isotope?: 'D' | 'T';
}

/** Read 'Fe3+', 'Fe+3', 'O2-', 'O-2', 'Fe++', 'D', 'cu' into a species. */
export function parseSpecies(text: string): Species {
  const raw = text.trim();
  const parsed = elementFromSymbol(raw, false);
  if (!parsed) throw new ScatteringError(`Not an element: "${text}".`);
  const rest = raw.slice(/^[A-Za-z]+/.exec(raw)![0].length);
  let charge = 0;
  const m = /^(?:(\d+)([+-])|([+-])(\d+)|([+-]+))?$/.exec(rest);
  if (!m) throw new ScatteringError(`Cannot read the charge in "${text}".`);
  if (m[1] !== undefined) charge = Number(m[1]) * (m[2] === '-' ? -1 : 1);
  else if (m[4] !== undefined) charge = Number(m[4]) * (m[3] === '-' ? -1 : 1);
  else if (m[5] !== undefined) charge = m[5].length * (m[5][0] === '-' ? -1 : 1);
  const species: Species = { element: parsed.element, charge };
  if (parsed.isotope) species.isotope = parsed.isotope;
  return species;
}

/** Table key of an ion: 'Fe', 'Fe+++', 'O--'. */
export const ionKey = (element: string, charge: number): string =>
  element + (charge > 0 ? '+'.repeat(charge) : '-'.repeat(-charge));

const asSpecies = (s: string | Species): Species => (typeof s === 'string' ? parseSpecies(s) : s);

const rowBySymbol = new Map<string, ElementRow>(ELEMENT_ROWS.map((r) => [r.symbol, r]));

function sumGaussians(a: readonly number[], b: readonly number[], s2: number): number {
  let f = 0;
  for (let i = 0; i < 5; i++) f += a[i] * Math.exp(-b[i] * s2);
  return f;
}

/**
 * X-ray scattering factor in electrons. Uses the ion's own table when it exists (Fe2+, O2-, ...)
 * and the neutral atom otherwise. The fit is made for s <= 6 1/A; beyond that it only decays.
 */
export function fx(species: string | Species, s: number): number {
  const { element, charge } = asSpecies(species);
  const row = WAASMAIER_KIRFEL[ionKey(element, charge)] ?? WAASMAIER_KIRFEL[element];
  if (!row) throw new ScatteringError(`No X-ray scattering factor for ${element}.`);
  return sumGaussians(row.slice(0, 5), row.slice(6, 11), s * s) + row[5];
}

/**
 * Electron scattering factor in angstrom (the amplitude f_e of the first Born approximation).
 * Neutral atoms: Lobato & Van Dyck, with q = 2s. Ions: Peng et al. for s < 2 when tabulated;
 * larger s, and ions without a table, use the neutral atom, which is accurate there since the
 * valence charge only matters at small s.
 */
export function fe(species: string | Species, s: number): number {
  const { element, charge } = asSpecies(species);
  if (charge !== 0 && s < 2) {
    const ion = PENG_IONIC[ionKey(element, charge)];
    if (ion) return sumGaussians(ion.slice(0, 5), ion.slice(5, 10), s * s);
  }
  const lobato = LOBATO[element];
  if (lobato) {
    const q2 = 4 * s * s;
    let f = 0;
    for (let i = 0; i < 5; i++) {
      const bq = lobato[5 + i] * q2;
      f += (lobato[i] * (2 + bq)) / ((1 + bq) * (1 + bq));
    }
    return f;
  }
  const peng = (s < 2 ? PENG_LOW : PENG_HIGH)[element];
  if (!peng) throw new ScatteringError(`No electron scattering factor for ${element}.`);
  return sumGaussians(peng.slice(0, 5), peng.slice(5, 10), s * s);
}

/**
 * Coherent neutron scattering length in fm (real part; absorbing isotopes' imaginary parts are
 * ignored). Deuterium and tritium have their own values; otherwise the natural mixture is used.
 */
export function bn(species: string | Species): number {
  const { element, isotope } = asSpecies(species);
  if (isotope) return ISOTOPE_B[isotope === 'D' ? '2H' : '3H'];
  const b = rowBySymbol.get(element)?.b;
  if (b === undefined || b === null)
    throw new ScatteringError(`No neutron scattering length for ${element}.`);
  return b;
}

export interface ElementInfo {
  Z: number;
  symbol: string;
  name: string;
  /** Standard atomic weight in u. */
  mass: number;
  /** Covalent radius in angstrom (Cordero 2008). */
  covalentRadius: number;
  /** van der Waals radius in angstrom (Alvarez 2013); undefined beyond Z = 96. */
  vdwRadius?: number;
  /** Jmol colour as '#rrggbb'. */
  color: string;
  /** Shannon ionic radii in angstrom by oxidation state (e.g. {2: 0.92, 3: 0.785} for Fe). */
  ionicRadii: Readonly<Record<number, number>>;
}

export function elementInfo(symbol: string): ElementInfo {
  const row = rowBySymbol.get(symbol);
  if (!row) throw new ScatteringError(`Unknown element "${symbol}".`);
  const info: ElementInfo = {
    Z: row.Z,
    symbol: row.symbol,
    name: row.name,
    mass: row.mass,
    covalentRadius: row.covalent,
    color: row.color,
    ionicRadii: row.ionic,
  };
  if (row.vdw !== null) info.vdwRadius = row.vdw;
  return info;
}

/** Mass in u of an element, or of its isotope (D = 2.0141, T = 3.0160) when given. */
export function atomicMass(element: string, isotope?: 'D' | 'T'): number {
  if (isotope) return ISOTOPE_MASS[isotope === 'D' ? '2H' : '3H'];
  return elementInfo(element).mass;
}

/** s = sin(theta)/lambda for a plane spacing d (angstrom). */
export const sFromD = (d: number): number => 1 / (2 * d);
/** s for a reciprocal-vector length |g| = 1/d (1/angstrom). */
export const sFromG = (g: number): number => g / 2;
