/**
 * Pure helpers for ③ Simulation, Bloch wave (context.md §7.MU step U5): which reflections of a zone
 * axis a run keeps for a k max, |s_g| max and condenser angle, and the cumulative kinematic
 * intensity used to choose k max. Positions are in the specimen frame, beam along +z.
 */

export interface Refl {
  hkl: [number, number, number];
  /** Position in the pattern, 1/Å (x, y). */
  q: [number, number];
  /** |g|, 1/Å. */
  g: number;
  /** Excitation error at the zone axis, 1/Å. */
  sg: number;
  /** In the zero-order Laue zone. */
  zolz: boolean;
  /** Kinematic structure factor |F_g| (abTEM's, Å). */
  f: number;
}

export interface Factors {
  wavelength: number;
  g_max: number;
  n: number;
  truncated: boolean;
  f_max: number;
  refl: Refl[];
}

/** k max moves in steps of this (1/Å). */
export const K_STEP = 0.05;
export const K_MIN = 0.2;

/** Radius of the condenser disc in rad as a run rounds it to the pattern pixel (1/Å). */
export function discAlpha(alphaMrad: number, pixel: number, lambda: number): number {
  if (!(alphaMrad > 0) || !(pixel > 0)) return 0;
  return Math.round((alphaMrad * 1e-3) / lambda / pixel) * pixel * lambda;
}

/**
 * Does the run keep this reflection at the zone axis or at some tilt of the disc? The excitation
 * error changes linearly with the tilt (s_g - g_xy . tilt), so the smallest |s_g| over a disc of
 * radius `alpha` (rad) is |s_g| - |g_xy| alpha.
 */
export function nearEwald(r: Refl, sgMax: number, alpha: number): boolean {
  if (r.g === 0) return true;
  return Math.abs(r.sg) - Math.hypot(r.q[0], r.q[1]) * alpha < sgMax;
}

export function isIncluded(r: Refl, kMax: number, sgMax: number, alpha: number): boolean {
  return r.g === 0 || (r.g < kMax && nearEwald(r, sgMax, alpha));
}

export const countIncluded = (refl: Refl[], kMax: number, sgMax: number, alpha: number) =>
  refl.reduce((n, r) => n + (isIncluded(r, kMax, sgMax, alpha) ? 1 : 0), 0);

export interface Cumulative {
  /** |g| of each step, ascending (1/Å). */
  g: number[];
  /** Fraction of the kinematic intensity (sum of |F|^2, direct beam left out) up to that |g|. */
  frac: number[];
  total: number;
}

/**
 * The cumulative kinematic intensity of the reflections the run can use (near the Ewald sphere for
 * the angle), against |g|. The curve flattens where more beams add little.
 */
export function cumulative(refl: Refl[], sgMax: number, alpha: number): Cumulative {
  const use = refl.filter((r) => r.g > 0 && nearEwald(r, sgMax, alpha)).sort((a, b) => a.g - b.g);
  const total = use.reduce((s, r) => s + r.f * r.f, 0);
  const g: number[] = [];
  const frac: number[] = [];
  let run = 0;
  for (const r of use) {
    run += r.f * r.f;
    g.push(r.g);
    frac.push(total > 0 ? run / total : 0);
  }
  return { g, frac, total };
}

/** Fraction of the cumulative intensity inside k max. */
export function fractionWithin(c: Cumulative, kMax: number): number {
  let out = 0;
  for (let i = 0; i < c.g.length && c.g[i] < kMax; i++) out = c.frac[i];
  return out;
}

/** The smallest k max (a multiple of 0.01) that keeps `fraction` of the cumulative intensity. */
export function kMaxForFraction(c: Cumulative, fraction: number, gMax: number): number | null {
  const i = c.frac.findIndex((f) => f >= fraction - 1e-12);
  if (i < 0) return null;
  const k = Math.ceil((c.g[i] + 1e-6) * 100) / 100;
  return Math.min(gMax, Math.max(K_MIN, k));
}

/** A drag position (1/Å) as a k max: whole steps, inside [K_MIN, gMax]. */
export const snapK = (g: number, gMax: number) =>
  Math.min(gMax, Math.max(K_MIN, Math.round(g / K_STEP) * K_STEP));

/** Log-scale position (0 at `floor`, 1 at 1) of a structure factor relative to the largest. */
export function logFrac(f: number, fMax: number, floor = 1e-4): number {
  if (!(f > 0) || !(fMax > 0)) return 0;
  const r = f / fMax;
  if (r <= floor) return 0;
  return Math.min(1, Math.log10(r / floor) / Math.log10(1 / floor));
}

/** "−1 1 0" -> "(-1 1 0)": the Miller indices of a reflection. */
export const hklLabel = (h: [number, number, number]) => `(${h.join(' ')})`;
