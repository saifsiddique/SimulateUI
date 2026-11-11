/**
 * Pure helpers for ③ Simulation, INCOSTEM (context.md §7.MU step U6): the field of view and the pixel
 * size of the image. The backend makes the whole periodic box a whole number of pixels, so a pixel
 * size is adjusted a little; the numbers shown here follow the same rule.
 */

/** Pixels across `length` Å at a pixel size, at least 2. */
export const pixelsAcross = (length: number, pixel: number): number =>
  Math.max(2, Math.round(length / pixel));

/** The pixel size that gives `n` pixels across `length` Å. */
export const pixelFor = (length: number, n: number): number => length / Math.max(2, Math.round(n));

/** Pixels of the whole box in one direction for a requested pixel size (as the backend rounds). */
export const boxPixels = (box: number, pixel: number): number =>
  Math.max(8, Math.round(box / pixel));

/** The pixel size really used in one direction: the box divided into whole pixels. */
export const usedPixel = (box: number, pixel: number): number => box / boxPixels(box, pixel);

/** λ / (4 α) in Å: the coarsest pixel at which the probe intensity (band limit 2 α / λ) is sampled. */
export const nyquistPixel = (wavelength: number, alphaMrad: number): number =>
  wavelength / (4 * alphaMrad * 1e-3);

/** Electrons per pixel in a noisy image: the clean mean times current x dwell time x 6.24146. */
export const electronsPerPixel = (mean: number, currentPa: number, dwellUs: number): number =>
  mean * currentPa * dwellUs * 6.24146;
