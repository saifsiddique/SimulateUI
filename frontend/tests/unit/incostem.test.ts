import { describe, expect, it } from 'vitest';
import {
  boxPixels,
  electronsPerPixel,
  nyquistPixel,
  pixelFor,
  pixelsAcross,
  usedPixel,
} from '../../src/core/incostem';

describe('INCOSTEM image grid', () => {
  it('counts pixels across a field, at least two', () => {
    expect(pixelsAcross(7.68, 0.2)).toBe(38);
    expect(pixelsAcross(0.1, 1)).toBe(2);
  });
  it('turns a pixel count back into the pixel size', () => {
    expect(pixelFor(7.68, 40)).toBeCloseTo(0.192);
    expect(pixelFor(7.68, 1)).toBeCloseTo(3.84); // at least two pixels
    const p = pixelFor(10, 77);
    expect(pixelsAcross(10, p)).toBe(77);
  });
  it('makes the whole box a whole number of pixels, as the backend does', () => {
    expect(boxPixels(30.7167, 0.25)).toBe(123);
    expect(usedPixel(30.7167, 0.25)).toBeCloseTo(30.7167 / 123);
    expect(boxPixels(1, 0.5)).toBe(8); // never fewer than 8
  });
  it('gives λ / (4 α) as the coarsest pixel that samples the probe intensity', () => {
    expect(nyquistPixel(0.019687, 30)).toBeCloseTo(0.1641, 3);
    expect(nyquistPixel(0.025079, 10)).toBeCloseTo(0.627, 2);
  });
  it('gives the electrons per pixel of a dose', () => {
    // 1 pA for 1 µs is 6.24146 electrons; a pixel that holds 2 % of the beam
    expect(electronsPerPixel(0.02, 1, 1)).toBeCloseTo(0.02 * 6.24146);
    expect(electronsPerPixel(1e-3, 20, 10)).toBeCloseTo(1.248, 2);
  });
});
