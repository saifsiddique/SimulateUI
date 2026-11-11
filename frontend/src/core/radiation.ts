/**
 * Characteristic X-ray lines and the Bragg relations between d, s and 2-theta.
 * Wavelengths in angstrom: Hölzer et al., Phys. Rev. A 56, 4554 (1997), as used by the
 * International Tables Vol. C (Kalpha1). M9 adds Kalpha2 and the doublet ratio.
 */
import { degToRad, radToDeg } from './math/trig';

export interface XrayLine {
  id: string;
  label: string;
  /** Wavelength in angstrom. */
  lambda: number;
}

export const XRAY_LINES: readonly XrayLine[] = [
  { id: 'CuKa1', label: 'Cu Kα₁', lambda: 1.5405929 },
  { id: 'MoKa1', label: 'Mo Kα₁', lambda: 0.7093171 },
  { id: 'CoKa1', label: 'Co Kα₁', lambda: 1.788996 },
  { id: 'FeKa1', label: 'Fe Kα₁', lambda: 1.936041 },
  { id: 'CrKa1', label: 'Cr Kα₁', lambda: 2.289726 },
  { id: 'AgKa1', label: 'Ag Kα₁', lambda: 0.5594075 },
];

/** A Kα doublet: both wavelengths (angstrom) of an anode. */
export interface XrayDoublet {
  id: string;
  label: string;
  /** Kα₁ (Hölzer et al. 1997, as in XRAY_LINES) and Kα₂ in angstrom. */
  lambda1: number;
  lambda2: number;
}

/**
 * Kα₁ and Kα₂ of the common anodes. Kα₂ is from the standard tables (Bearden 1967, as in the
 * International Tables Vol. C); the two sources differ by less than 1e-4 angstrom, i.e. 0.005° in
 * 2θ at Cu, which is far below any peak width. The intensity ratio I(Kα₂)/I(Kα₁) is about 0.5.
 */
export const XRAY_DOUBLETS: readonly XrayDoublet[] = [
  { id: 'CuKa', label: 'Cu Kα', lambda1: 1.5405929, lambda2: 1.54439 },
  { id: 'CoKa', label: 'Co Kα', lambda1: 1.788996, lambda2: 1.79285 },
  { id: 'MoKa', label: 'Mo Kα', lambda1: 0.7093171, lambda2: 0.71359 },
  { id: 'CrKa', label: 'Cr Kα', lambda1: 2.289726, lambda2: 2.29361 },
  { id: 'FeKa', label: 'Fe Kα', lambda1: 1.936041, lambda2: 1.93998 },
  { id: 'AgKa', label: 'Ag Kα', lambda1: 0.5594075, lambda2: 0.563798 },
];

/** I(Kα₂) / I(Kα₁), the usual value. */
export const KALPHA_RATIO = 0.5;

/** The default everywhere a wavelength is needed: Cu Kalpha1. */
export const DEFAULT_XRAY_LINE: XrayLine = XRAY_LINES[0];

/** 2-theta in degrees for a plane spacing d, or NaN when lambda > 2d (no reflection). */
export function twoThetaFromD(d: number, lambda: number): number {
  const sinTheta = lambda / (2 * d);
  return sinTheta > 1 ? NaN : 2 * radToDeg(Math.asin(sinTheta));
}

/** s = sin(theta)/lambda for a scattering angle 2-theta in degrees. */
export const sFromTwoTheta = (twoTheta: number, lambda: number): number =>
  Math.sin(degToRad(twoTheta / 2)) / lambda;

/** 2-theta in degrees for s = sin(theta)/lambda, or NaN when lambda s > 1. */
export function twoThetaFromS(s: number, lambda: number): number {
  const sinTheta = s * lambda;
  return sinTheta > 1 ? NaN : 2 * radToDeg(Math.asin(sinTheta));
}
