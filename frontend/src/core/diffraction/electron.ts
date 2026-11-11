/**
 * Kinematic electron diffraction (context.md M8).
 *
 * Geometry: the beam travels along the unit vector `direction` (the structure viewer's line of
 * sight), so k0 = direction / lambda. A reflection g = B·hkl has the excitation error
 *   s_g = (k0² − |k0 + g|²) / (2 |k0 + g|)
 * and the kinematic intensity |F_e(g)|² · P(s_g), where P is the shape factor of a slab of
 * thickness t (sinc², its oscillation-free envelope, or 1 for the zone-axis |F|² approximation).
 * Spots are placed on the detector plane in the viewer's screen frame: x = g·right, y = g·up with
 * right = direction × up, so the pattern is drawn in the same orientation as the projection.
 *
 * Laue zones are counted against an integer zone axis [uvw] (the one typed, or the nearest one to
 * the view): reflection hkl is in zone n = hu + kv + lw (context.md 5.2). Only the zones with
 * |n| <= `maxZone` are enumerated; 0 is the zero-order Laue zone alone.
 *
 * Structure factors (in angstrom) use the M4 electron factors of the neutral atoms, occupancies and
 * an isotropic Debye-Waller factor (U_iso, or U_eq from the U_ij). They depend only on hkl, so
 * they are cached per crystal and a new orientation costs only the geometry.
 */
import type { Crystal } from '../crystal';
import { CrystalLensError } from '../errors';
import type { Lattice } from '../lattice';
import { reduceIndices } from '../math/integers';
import { cross, dot, norm, normalize, type Vec3 } from '../math/vec3';
import { fe } from '../scattering';

export class DiffractionError extends CrystalLensError {}

// ---- electron optics ----------------------------------------------------------------------------

const PLANCK = 6.62607015e-34; // J s
const ELECTRON_MASS = 9.1093837015e-31; // kg
const ELEMENTARY_CHARGE = 1.602176634e-19; // C
const LIGHT_SPEED = 299792458; // m/s
const REST_ENERGY_KEV = (ELECTRON_MASS * LIGHT_SPEED * LIGHT_SPEED) / ELEMENTARY_CHARGE / 1000;

/** Relativistic electron wavelength in angstrom for an accelerating voltage in kV (context.md 5.5). */
export function electronWavelength(kV: number): number {
  if (!(kV > 0) || !Number.isFinite(kV))
    throw new DiffractionError(`The accelerating voltage must be positive (got ${kV} kV).`);
  const eE = ELEMENTARY_CHARGE * kV * 1000;
  const p = Math.sqrt(
    2 * ELECTRON_MASS * eE * (1 + eE / (2 * ELECTRON_MASS * LIGHT_SPEED * LIGHT_SPEED)),
  );
  return (PLANCK / p) * 1e10;
}

/** Relativistic factor gamma = 1 + eE / m0c². */
export const relativisticGamma = (kV: number): number => 1 + kV / REST_ENERGY_KEV;

// ---- structure factors --------------------------------------------------------------------------

interface ScatteringModel {
  lattice: Lattice;
  elements: string[];
  /** Per atom: element index, occupancy, fractional position, U (angstrom², 0 = no DW). */
  species: Uint16Array;
  occ: Float64Array;
  frac: Float64Array;
  u: Float64Array;
  /** Summed occupancy per element (for the upper bound of |F|). */
  elementOcc: Float64Array;
  /** Scratch space: f_e of each element at the current s. */
  feBuffer: Float64Array;
  /** Rotations (row-major, 9 per operation) and translations (3 per operation) of the space group. */
  opR: Int8Array;
  opT: Float64Array;
  /** |F|² by packed hkl, one map per thermal setting (`thermalKey`). */
  cache: Map<string, Map<number, number>>;
  /** Systematic absence by packed hkl. */
  absences: Map<number, boolean>;
  /** "Forbidden" (absence or |F| ~ 0) by packed hkl, one map per thermal setting. */
  forbidden: Map<string, Map<number, boolean>>;
  /** |F|² used as intensity 1, per thermal setting. */
  reference: Map<string, number>;
}

/**
 * How atoms vibrate: `false` none, `true` each atom's own U from the CIF (U_iso, or the equivalent
 * isotropic U_eq of the U_ij), a number one uniform B (angstrom², B = 8π²U) for every atom.
 */
export type Thermal = boolean | number;

const thermalKey = (t: Thermal): string => String(t);

const models = new WeakMap<Crystal, ScatteringModel>();

/** U_eq = (1/3) Σ U^ij a*_i a*_j (a_i · a_j) for U_ij given on the crystal axes. */
function uEquivalent(
  lat: Lattice,
  u: { U11: number; U22: number; U33: number; U12: number; U13: number; U23: number },
): number {
  const U = [
    [u.U11, u.U12, u.U13],
    [u.U12, u.U22, u.U23],
    [u.U13, u.U23, u.U33],
  ];
  const astar = [0, 1, 2].map((i) => Math.sqrt(lat.Gstar[i][i]));
  let sum = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) sum += U[i][j] * astar[i] * astar[j] * lat.G[i][j];
  return sum / 3;
}

function scatteringModel(crystal: Crystal): ScatteringModel {
  const cached = models.get(crystal);
  if (cached) return cached;
  const n = crystal.atoms.length;
  const elements: string[] = [];
  const index = new Map<string, number>();
  const species = new Uint16Array(n);
  const occ = new Float64Array(n);
  const frac = new Float64Array(3 * n);
  const u = new Float64Array(n);
  crystal.atoms.forEach((a, i) => {
    let e = index.get(a.element);
    if (e === undefined) {
      e = elements.length;
      elements.push(a.element);
      index.set(a.element, e);
    }
    species[i] = e;
    occ[i] = a.occupancy;
    frac.set(a.frac, 3 * i);
    const site = crystal.sites[a.site];
    const uiso = a.uiso ?? (site?.aniso ? uEquivalent(crystal.lattice, site.aniso) : 0);
    u[i] = Number.isFinite(uiso) && uiso > 0 ? uiso : 0;
  });
  const elementOcc = new Float64Array(elements.length);
  for (let i = 0; i < n; i++) elementOcc[species[i]] += occ[i];
  const model: ScatteringModel = {
    lattice: crystal.lattice,
    elements,
    species,
    occ,
    frac,
    u,
    elementOcc,
    feBuffer: new Float64Array(elements.length),
    opR: Int8Array.from(crystal.ops.flatMap((o) => o.R.flatMap((row) => [...row]))),
    opT: Float64Array.from(crystal.ops.flatMap((o) => [...o.t])),
    cache: new Map(),
    absences: new Map(),
    forbidden: new Map(),
    reference: new Map(),
  };
  models.set(crystal, model);
  return model;
}

const OFFSET = 1 << 10;
/** One number per hkl, for |h|, |k|, |l| < 1024. */
const packHkl = (h: number, k: number, l: number): number =>
  ((h + OFFSET) * 2 * OFFSET + (k + OFFSET)) * 2 * OFFSET + (l + OFFSET);

/** Isotropic U (angstrom²) of every atom of `crystal.atoms`: U_iso, or U_eq of the U_ij, else 0. */
export function atomicU(crystal: Crystal): Float64Array {
  return scatteringModel(crystal).u;
}

/**
 * The mean isotropic B = 8π²U (angstrom²) of the CIF, weighted by occupancy over the atoms that
 * have a displacement parameter; 0 when the CIF gives none.
 */
export function meanB(crystal: Crystal): number {
  const m = scatteringModel(crystal);
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < m.u.length; i++) {
    if (!(m.u[i] > 0)) continue;
    sum += m.occ[i] * 8 * Math.PI * Math.PI * m.u[i];
    weight += m.occ[i];
  }
  return weight > 0 ? sum / weight : 0;
}

/** Complex F_e(hkl) in angstrom: Σ occ f_e(s) T(s) exp(2πi h·x) over the unit-cell atoms. */
function computeF(
  m: ScatteringModel,
  h: number,
  k: number,
  l: number,
  dw: Thermal,
): [number, number] {
  const B = m.lattice.B;
  const gx = B[0][0] * h + B[0][1] * k + B[0][2] * l;
  const gy = B[1][0] * h + B[1][1] * k + B[1][2] * l;
  const gz = B[2][0] * h + B[2][1] * k + B[2][2] * l;
  const s = Math.sqrt(gx * gx + gy * gy + gz * gz) / 2;
  const s2 = s * s;
  const f = m.feBuffer;
  for (let e = 0; e < m.elements.length; e++) f[e] = fe(m.elements[e], s);
  let re = 0;
  let im = 0;
  const n = m.occ.length;
  for (let i = 0; i < n; i++) {
    let w = m.occ[i] * f[m.species[i]];
    if (dw === true) {
      if (m.u[i] > 0) w *= Math.exp(-8 * Math.PI * Math.PI * m.u[i] * s2);
    } else if (typeof dw === 'number') w *= Math.exp(-dw * s2);
    const phase = 2 * Math.PI * (h * m.frac[3 * i] + k * m.frac[3 * i + 1] + l * m.frac[3 * i + 2]);
    re += w * Math.cos(phase);
    im += w * Math.sin(phase);
  }
  return [re, im];
}

/** |F|² from the cache, computing it on first use. */
function f2(m: ScatteringModel, h: number, k: number, l: number, dw: Thermal): number {
  let cache = m.cache.get(thermalKey(dw));
  if (!cache) m.cache.set(thermalKey(dw), (cache = new Map()));
  const key = packHkl(h, k, l);
  let v = cache.get(key);
  if (v === undefined) {
    const [re, im] = computeF(m, h, k, l, dw);
    v = re * re + im * im;
    cache.set(key, v);
  }
  return v;
}

/**
 * True when the space group forbids hkl: some operation (R, t) maps h onto itself (h R = h) with a
 * non-integer phase h·t (glides, screws, centring). Exact, unlike |F| ≈ 0, which also depends on
 * how precisely the CIF gives special coordinates (0.3333 for 1/3).
 */
function systematicallyAbsent(m: ScatteringModel, h: number, k: number, l: number): boolean {
  const key = packHkl(h, k, l);
  const known = m.absences.get(key);
  if (known !== undefined) return known;
  let absent = false;
  const R = m.opR;
  const t = m.opT;
  for (let o = 0; o < t.length / 3 && !absent; o++) {
    const r = 9 * o;
    // row vector h times R: (hR)_j = sum_i h_i R_ij
    if (
      h * R[r] + k * R[r + 3] + l * R[r + 6] !== h ||
      h * R[r + 1] + k * R[r + 4] + l * R[r + 7] !== k ||
      h * R[r + 2] + k * R[r + 5] + l * R[r + 8] !== l
    )
      continue;
    const phase = h * t[3 * o] + k * t[3 * o + 1] + l * t[3 * o + 2];
    absent = Math.abs(phase - Math.round(phase)) > 1e-6;
  }
  m.absences.set(key, absent);
  return absent;
}

/** Upper bound of |F(s)|: all atoms in phase, no Debye-Waller damping. */
function fBound(m: ScatteringModel, s: number): number {
  let b = 0;
  for (let e = 0; e < m.elements.length; e++) b += m.elementOcc[e] * Math.abs(fe(m.elements[e], s));
  return b;
}

/**
 * Reflections whose |F| is below this fraction of the in-phase bound are also "forbidden": absences
 * that come from the atoms' special positions rather than the space group (Si 222, graphite
 * 3 -3 1). It is this large because CIFs round special coordinates: graphite's 0.33333 for 1/3
 * leaves |F| at 1e-5 of the bound. It cannot be much larger: albite's real (-3 3 3) is at 1e-3.
 */
export const FORBIDDEN_FRACTION = 1e-4;

/** |g| range (1/angstrom) over which the strongest reflection defines intensity 1. */
export const REFERENCE_G = 1;

/**
 * The strongest |F|² among the reflections with 0 < |g| <= REFERENCE_G (independent of orientation,
 * so intensities do not jump as the crystal turns).
 */
function referenceF2(m: ScatteringModel, dw: Thermal): number {
  const slot = thermalKey(dw);
  const known = m.reference.get(slot);
  if (known !== undefined) return known;
  const lat = m.lattice;
  const bounds = [0, 1, 2].map((i) => Math.floor(REFERENCE_G * Math.sqrt(lat.G[i][i]) + 1e-9));
  let best = 0;
  for (let h = -bounds[0]; h <= bounds[0]; h++)
    for (let k = -bounds[1]; k <= bounds[1]; k++)
      for (let l = -bounds[2]; l <= bounds[2]; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        const g = norm([
          lat.B[0][0] * h + lat.B[0][1] * k + lat.B[0][2] * l,
          lat.B[1][0] * h + lat.B[1][1] * k + lat.B[1][2] * l,
          lat.B[2][0] * h + lat.B[2][1] * k + lat.B[2][2] * l,
        ]);
        if (g > REFERENCE_G) continue;
        best = Math.max(best, f2(m, h, k, l, dw));
      }
  const value = best > 0 ? best : 1;
  m.reference.set(slot, value);
  return value;
}

/** Electron structure factor F_e(hkl) in angstrom, as [real, imaginary]. */
export function electronStructureFactor(
  crystal: Crystal,
  hkl: Vec3,
  options: { debyeWaller?: Thermal } = {},
): [number, number] {
  return computeF(scatteringModel(crystal), hkl[0], hkl[1], hkl[2], options.debyeWaller ?? true);
}

// ---- the pattern --------------------------------------------------------------------------------

/** Shape factor of the excitation error: thin-slab sinc², its smooth envelope, or none. */
export type ExcitationProfile = 'sinc' | 'smooth' | 'none';

export interface PatternGeometry {
  /** Beam direction (Cartesian, any length): from the source into the specimen. */
  direction: Vec3;
  /** Screen-up direction of the detector frame (Cartesian; made perpendicular to the beam). */
  up: Vec3;
  /** Integer zone axis the Laue zones are counted from. */
  zoneAxis: Vec3;
  voltage: number;
  /** Specimen thickness in angstrom. */
  thickness: number;
  /** Largest |g| (1/angstrom). */
  gMax: number;
  /** Laue zones |n| <= maxZone are included; 0 = zero-order Laue zone only. */
  maxZone: number;
  profile: ExcitationProfile;
  /** Atomic vibration: off, the CIF's own values, or one uniform B (angstrom²). */
  debyeWaller: Thermal;
  /** Spots weaker than this (relative intensity) are left out. */
  minIntensity: number;
  /** Keep kinematically forbidden reflections (flagged) if their shape factor is at least 1e-3. */
  includeForbidden: boolean;
}

export interface Spot {
  hkl: Vec3;
  /** Position on the detector plane, 1/angstrom (x right, y up). */
  x: number;
  y: number;
  /** |g| in 1/angstrom and d = 1/|g| in angstrom. */
  g: number;
  d: number;
  /** |F_e| in angstrom. */
  F: number;
  /** Relative intensity: |F|² P(s) / reference |F|² (see REFERENCE_G). */
  I: number;
  /** Excitation error, 1/angstrom. */
  s: number;
  /** Laue zone hu + kv + lw. */
  zone: number;
  forbidden: boolean;
  /** Dynamical patterns (M11) only: I_g as a fraction of the incident beam. */
  fraction?: number;
  /** Dynamical patterns only: the reflection is kinematically forbidden (lit by double diffraction). */
  kinematicallyForbidden?: boolean;
}

export interface Pattern {
  spots: Spot[];
  lambda: number;
  /** The zone axis the Laue zones were counted from (reduced). */
  zoneAxis: Vec3;
  /** Unit beam direction and detector axes (Cartesian). */
  beam: Vec3;
  right: Vec3;
  up: Vec3;
  /** Number of reflections whose |F| was looked up (a measure of the work done). */
  evaluated: number;
}

/** Shape factor for excitation error `s` (1/angstrom) in a slab `t` angstrom thick. */
export function shapeFactor(profile: ExcitationProfile, t: number, s: number): number {
  if (profile === 'none') return 1;
  const x = Math.PI * t * s;
  if (profile === 'smooth') return 1 / (1 + x * x);
  if (Math.abs(x) < 1e-8) return 1;
  const sinc = Math.sin(x) / x;
  return sinc * sinc;
}

/** Excitation error for reflection `g` with incident wave vector k0 = beam / lambda. */
export function excitationError(beam: Vec3, lambda: number, g: Vec3): number {
  const k = 1 / lambda;
  const kg: Vec3 = [beam[0] * k + g[0], beam[1] * k + g[1], beam[2] * k + g[2]];
  const len = norm(kg);
  return (k * k - len * len) / (2 * len);
}

/** Unit beam direction and the detector axes (x right, y up) for a viewing direction and up. */
export function detectorFrame(
  direction: Vec3,
  upHint: Vec3,
): { beam: Vec3; right: Vec3; up: Vec3 } {
  const beam = normalize(direction);
  if (!beam) throw new DiffractionError('The beam direction is zero.');
  const along = dot(upHint, beam);
  let up = normalize([
    upHint[0] - along * beam[0],
    upHint[1] - along * beam[1],
    upHint[2] - along * beam[2],
  ]);
  if (!up) {
    const trial: Vec3 = Math.abs(beam[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    const a = dot(trial, beam);
    up = normalize([trial[0] - a * beam[0], trial[1] - a * beam[1], trial[2] - a * beam[2]])!;
  }
  return { beam, right: cross(beam, up), up };
}

/** A zone axis as reduced integer indices; throws for [0 0 0]. */
export function reducedZoneAxis(zoneAxis: Vec3): Vec3 {
  const raw = zoneAxis.map(Math.round) as unknown as Vec3;
  if (raw.every((x) => x === 0)) throw new DiffractionError('The zone axis is [0 0 0].');
  return reduceIndices(raw);
}

/**
 * Visit every reflection hkl (not 000) of the Laue zones nMin..nMax of the zone axis `uvw` with
 * |g| <= gMax, where g = B·hkl (unstrained). The zone equation hu + kv + lw = n is solved for the
 * index with the largest coefficient, so each layer is a 2D loop.
 */
export function forEachLaue(
  lat: Lattice,
  uvw: Vec3,
  nMin: number,
  nMax: number,
  gMax: number,
  visit: (h: number, k: number, l: number, n: number, g: number) => void,
): void {
  const B = lat.B;
  const bound = [0, 1, 2].map((i) => Math.floor(gMax * Math.sqrt(lat.G[i][i]) + 1e-9));
  const p = [0, 1, 2].reduce((best, i) => (Math.abs(uvw[i]) > Math.abs(uvw[best]) ? i : best), 0);
  const q = (p + 1) % 3;
  const r = (p + 2) % 3;
  const cp = uvw[p];
  const idx = [0, 0, 0];
  for (let n = nMin; n <= nMax; n++) {
    for (let iq = -bound[q]; iq <= bound[q]; iq++) {
      for (let ir = -bound[r]; ir <= bound[r]; ir++) {
        const rest = n - uvw[q] * iq - uvw[r] * ir;
        if (rest % cp !== 0) continue;
        const ip = rest / cp + 0; // + 0 turns -0 into 0
        if (Math.abs(ip) > bound[p]) continue;
        idx[p] = ip;
        idx[q] = iq;
        idx[r] = ir;
        const [h, k, l] = idx;
        if (h === 0 && k === 0 && l === 0) continue;
        const gx = B[0][0] * h + B[0][1] * k + B[0][2] * l;
        const gy = B[1][0] * h + B[1][1] * k + B[1][2] * l;
        const gz = B[2][0] * h + B[2][1] * k + B[2][2] * l;
        const g = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (g > gMax) continue;
        visit(h, k, l, n + 0, g);
      }
    }
  }
}

export interface Strength {
  /** |F_e| in angstrom. */
  F: number;
  /** |F|² relative to the strongest reflection with |g| <= REFERENCE_G (0 when forbidden). */
  I: number;
  forbidden: boolean;
}

/** |F|, relative intensity and the forbidden flag of one reflection (cached per crystal). */
export function reflectionStrength(crystal: Crystal, hkl: Vec3, debyeWaller: Thermal): Strength {
  const m = scatteringModel(crystal);
  const [h, k, l] = hkl;
  const B = m.lattice.B;
  const g = Math.hypot(
    B[0][0] * h + B[0][1] * k + B[0][2] * l,
    B[1][0] * h + B[1][1] * k + B[1][2] * l,
    B[2][0] * h + B[2][1] * k + B[2][2] * l,
  );
  const F2 = f2(m, h, k, l, debyeWaller);
  const key = packHkl(h, k, l);
  let byHkl = m.forbidden.get(thermalKey(debyeWaller));
  if (!byHkl) m.forbidden.set(thermalKey(debyeWaller), (byHkl = new Map()));
  let forbidden = byHkl.get(key);
  if (forbidden === undefined) {
    forbidden =
      systematicallyAbsent(m, h, k, l) || Math.sqrt(F2) < FORBIDDEN_FRACTION * fBound(m, g / 2);
    byHkl.set(key, forbidden);
  }
  return {
    F: Math.sqrt(F2),
    I: forbidden ? 0 : F2 / referenceF2(m, debyeWaller),
    forbidden,
  };
}

/** The kinematic spot pattern for one orientation. */
export function kinematicPattern(crystal: Crystal, geometry: PatternGeometry): Pattern {
  const { beam, right, up } = detectorFrame(geometry.direction, geometry.up);
  const uvw = reducedZoneAxis(geometry.zoneAxis);

  const lambda = electronWavelength(geometry.voltage);
  const m = scatteringModel(crystal);
  const lat = m.lattice;
  const B = lat.B;
  const dw = geometry.debyeWaller;
  const ref = referenceF2(m, dw);
  const t = Math.max(0, geometry.thickness);
  const gMax = Math.max(0, geometry.gMax);
  const maxZone = Math.max(0, Math.floor(geometry.maxZone));
  const k = 1 / lambda;

  const spots: Spot[] = [];
  let evaluated = 0;
  forEachLaue(lat, uvw, -maxZone || 0, maxZone, gMax, (h, kk, l, n, g) => {
    const gx = B[0][0] * h + B[0][1] * kk + B[0][2] * l;
    const gy = B[1][0] * h + B[1][1] * kk + B[1][2] * l;
    const gz = B[2][0] * h + B[2][1] * kk + B[2][2] * l;
    const kgx = beam[0] * k + gx;
    const kgy = beam[1] * k + gy;
    const kgz = beam[2] * k + gz;
    const kg = Math.sqrt(kgx * kgx + kgy * kgy + kgz * kgz);
    const s = (k * k - kg * kg) / (2 * kg);
    const P = shapeFactor(geometry.profile, t, s);
    // Cheap rejection before the structure factor: even all atoms in phase are too weak.
    const boundF = fBound(m, g / 2);
    if (
      (boundF * boundF * P) / ref < geometry.minIntensity &&
      !(geometry.includeForbidden && P >= 1e-3)
    )
      return;
    evaluated++;
    const F2 = f2(m, h, kk, l, dw);
    const forbidden =
      systematicallyAbsent(m, h, kk, l) || Math.sqrt(F2) < FORBIDDEN_FRACTION * boundF;
    const I = forbidden ? 0 : (F2 * P) / ref;
    if (forbidden ? !(geometry.includeForbidden && P >= 1e-3) : I < geometry.minIntensity) return;
    spots.push({
      hkl: [h, kk, l],
      x: gx * right[0] + gy * right[1] + gz * right[2],
      y: gx * up[0] + gy * up[1] + gz * up[2],
      g,
      d: 1 / g,
      F: Math.sqrt(F2),
      I,
      s,
      zone: n,
      forbidden,
    });
  });
  return { spots, lambda, zoneAxis: uvw, beam, right, up, evaluated };
}
