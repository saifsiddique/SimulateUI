import { describe, expect, it } from 'vitest';
import { parseFrame } from '../../src/api/client';
import {
  barLabel,
  lut,
  niceLength,
  normalise,
  toRgba,
  scaleRange,
  type ScaleOptions,
} from '../../src/plots/colormap';

const lin: ScaleOptions = { mode: 'linear', gamma: 1, vmin: null, vmax: null };

describe('colour maps', () => {
  it('have 256 entries and known end points', () => {
    expect(lut('gray').length).toBe(768);
    expect([...lut('gray').slice(0, 3)]).toEqual([0, 0, 0]);
    expect([...lut('gray').slice(765)]).toEqual([255, 255, 255]);
    expect([...lut('inferno').slice(0, 3)]).toEqual([0, 0, 4]);
    // the phase map is cyclic: both ends are the same light colour
    expect([...lut('twilight').slice(0, 3)]).toEqual([...lut('twilight').slice(765)]);
  });
});

describe('intensity scales', () => {
  it('linear maps the range to 0..1', () => {
    expect([...normalise([2, 4, 6], lin)]).toEqual([0, 0.5, 1]);
  });
  it('power lifts the dark values when gamma < 1', () => {
    const t = normalise([0, 0.25, 1], { ...lin, mode: 'power', gamma: 0.5 });
    expect(t[1]).toBeCloseTo(0.5, 6);
    expect(t[2]).toBe(1);
  });
  it('log spans the decades below the top, and a non-positive value is black', () => {
    const t = normalise([0, 1e-6, 1e-3, 1], { ...lin, mode: 'log' });
    expect(t[0]).toBe(0);
    expect(t[3]).toBe(1);
    expect(t[2]).toBeCloseTo(0.5, 2); // 1e-3 is half way from 1e-6 to 1
  });
  it('vmin and vmax set the darkest and the brightest value, and null is automatic', () => {
    const data = [0, 5, 10, 20];
    expect(scaleRange(data, { vmin: null, vmax: null })).toEqual({ lo: 0, hi: 20 });
    expect(scaleRange(data, { vmin: 5, vmax: 10 })).toEqual({ lo: 5, hi: 10 });
    expect([...normalise(data, { ...lin, vmin: 5, vmax: 15 })]).toEqual([0, 0, 0.5, 1]);
    expect([...normalise(data, { ...lin, vmax: 10 })]).toEqual([0, 0.5, 1, 1]);
  });
  it('log starts at vmin when it is above zero', () => {
    const t = normalise([1e-9, 1e-3, 1], { ...lin, mode: 'log', vmin: 1e-4, vmax: 1 });
    expect(t[0]).toBe(0);
    expect(t[1]).toBeCloseTo(0.25, 6); // 1e-3 is 1 of the 4 decades from 1e-4 to 1
  });
  it('a constant frame does not divide by zero', () => {
    expect([...normalise([3, 3, 3], lin)]).toEqual([0, 0, 0]);
    expect(Number.isFinite(normalise([0, 0], { ...lin, mode: 'log' })[0])).toBe(true);
  });
  it('toRgba gives opaque pixels and invert swaps the ends', () => {
    const a = toRgba([0, 1], lin, 'gray');
    expect([...a]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    const b = toRgba([0, 1], lin, 'gray', true);
    expect([...b]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
});

describe('scale bar', () => {
  it('uses 1, 2 or 5 times a power of ten, never longer than asked', () => {
    expect(niceLength(0.7)).toBe(0.5);
    expect(niceLength(1.9)).toBe(1);
    expect(niceLength(23)).toBe(20);
    expect(niceLength(870)).toBe(500);
    expect(niceLength(0)).toBe(1);
    expect(barLabel(0.5, 'Å')).toBe('0.5 Å');
    expect(barLabel(0.30000000000000004, 'mrad')).toBe('0.3 mrad');
  });
});

describe('frames from the backend', () => {
  it('are float32 bytes plus a description in a header', () => {
    const f = new Float32Array([1.5, -2, 0.25, 8]);
    const d = parseFrame(
      JSON.stringify({ shape: [2, 2], pixel: [0.1, 0.2], unit: 'Å', min: -2, max: 8 }),
      f.buffer,
    );
    expect([...d.values]).toEqual([1.5, -2, 0.25, 8]);
    expect(d.pixel).toEqual([0.1, 0.2]);
    expect(d.shape).toEqual([2, 2]);
  });
});
