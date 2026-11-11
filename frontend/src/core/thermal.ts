/**
 * Thermal displacement of the atoms (context.md §7.MU step U4/U5): the root-mean-square
 * displacement σ (Å, along one axis) of each element. abTEM's frozen phonons displace every atom
 * by a Gaussian of this width, and the Bloch structure factors are damped by the Debye-Waller
 * factor exp(-2 π² σ² g²). The default is √U_iso of the CIF; an element without U_iso starts at
 * `ASSUMED_SIGMA`, a typical room-temperature value, and is marked as assumed.
 */
export const ASSUMED_SIGMA = 0.08;

export interface ElementSigma {
  element: string;
  /** σ in Å. */
  sigma: number;
  /** True when the CIF gave no U_iso for this element and `ASSUMED_SIGMA` stands in. */
  assumed: boolean;
}

/**
 * The default σ of every element of a specimen: `symbols` are the element names, `species[i]` the
 * index in `symbols` of atom i, and `uiso[i]` its U_iso (Å², null or missing when unknown). An
 * element's σ is the square root of the mean U_iso of its atoms that have one.
 */
export function defaultSigmas(
  symbols: string[],
  species: number[],
  uiso: (number | null)[] | null,
): ElementSigma[] {
  return symbols.map((element, k) => {
    let sum = 0;
    let n = 0;
    if (uiso) {
      for (let i = 0; i < species.length; i++) {
        const u = uiso[i];
        if (species[i] === k && u !== null && u !== undefined && u > 0) {
          sum += u;
          n++;
        }
      }
    }
    return n > 0
      ? { element, sigma: +Math.sqrt(sum / n).toPrecision(4), assumed: false }
      : { element, sigma: ASSUMED_SIGMA, assumed: true };
  });
}

/** The σ to use for each element: the user's value where there is one, else the default. */
export function effectiveSigmas(
  defaults: ElementSigma[],
  overrides: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defaults) out[d.element] = overrides[d.element] ?? d.sigma;
  return out;
}
