// Colour maps and intensity scales of the results viewer (context.md M7). Pure functions: the
// canvas component feeds them a frame (float32 numbers) and draws the RGBA they return.

export type ColormapName = 'gray' | 'inferno' | 'magma' | 'viridis' | 'twilight';
export type ScaleMode = 'linear' | 'log' | 'power';

export const COLORMAPS: { id: ColormapName; label: string }[] = [
  { id: 'gray', label: 'Gray' },
  { id: 'inferno', label: 'Inferno' },
  { id: 'magma', label: 'Magma' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'twilight', label: 'Twilight (phase)' },
];

type RGB = [number, number, number];

// Anchor colours (matplotlib's maps, sampled evenly); the table is interpolated linearly.
const STOPS: Record<ColormapName, RGB[]> = {
  gray: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  inferno: [
    [0, 0, 4],
    [40, 11, 84],
    [101, 21, 110],
    [159, 42, 99],
    [212, 72, 66],
    [245, 125, 21],
    [250, 193, 39],
    [252, 255, 164],
  ],
  magma: [
    [0, 0, 4],
    [28, 16, 68],
    [79, 18, 123],
    [129, 37, 129],
    [181, 54, 122],
    [229, 80, 100],
    [251, 135, 97],
    [254, 194, 135],
    [252, 253, 191],
  ],
  viridis: [
    [68, 1, 84],
    [72, 40, 120],
    [62, 74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [109, 205, 89],
    [180, 222, 44],
    [253, 231, 37],
  ],
  // cyclic, light at both ends: for phases
  twilight: [
    [226, 217, 226],
    [152, 170, 210],
    [96, 110, 180],
    [60, 40, 110],
    [48, 20, 60],
    [110, 30, 60],
    [170, 70, 70],
    [210, 150, 130],
    [226, 217, 226],
  ],
};

const lutCache = new Map<ColormapName, Uint8ClampedArray>();

/** 256 RGB entries (768 bytes) of a colour map. */
export function lut(name: ColormapName): Uint8ClampedArray {
  const hit = lutCache.get(name);
  if (hit) return hit;
  const s = STOPS[name];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (s.length - 1);
    const k = Math.min(Math.floor(f), s.length - 2);
    const t = f - k;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = s[k][c] + (s[k + 1][c] - s[k][c]) * t;
  }
  lutCache.set(name, out);
  return out;
}

export interface ScaleOptions {
  mode: ScaleMode;
  /** The exponent of the power scale (1 = linear; below 1 lifts the dark values). */
  gamma: number;
  /** The values shown as the darkest and the brightest colour; null = the frame's own minimum / maximum. */
  vmin: number | null;
  vmax: number | null;
}

/** The smallest and largest finite value. */
export function dataRange(data: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 1 };
}

/** The range a scale really uses: the user's vmin and vmax, else the data's. */
export function scaleRange(
  data: ArrayLike<number>,
  o: Pick<ScaleOptions, 'vmin' | 'vmax'>,
  known?: { min: number; max: number },
): { lo: number; hi: number } {
  const r = o.vmin !== null && o.vmax !== null ? { min: 0, max: 0 } : (known ?? dataRange(data));
  const lo = o.vmin ?? r.min;
  const hi = o.vmax ?? r.max;
  return hi > lo ? { lo, hi } : { lo, hi: lo };
}

/** Map every value to 0…1 by the chosen scale. Log: from `vmin` (or, when that is not above zero,
 *  from 10⁻⁶ of the top value or the smallest positive one) up to `vmax`; values at or below the
 *  floor are 0. `known` is the data's minimum and maximum when the caller has them. */
export function normalise(
  data: ArrayLike<number>,
  o: ScaleOptions,
  known?: { min: number; max: number },
): Float32Array {
  const { lo, hi } = scaleRange(data, o, known);
  const out = new Float32Array(data.length);
  if (o.mode === 'log') {
    let floor = lo > 0 ? lo : Math.max(hi * 1e-6, 1e-30);
    if (!(lo > 0)) {
      let smallest = Infinity;
      for (let i = 0; i < data.length; i++)
        if (data[i] > 0 && data[i] < smallest) smallest = data[i];
      if (Number.isFinite(smallest)) floor = Math.max(floor, Math.min(smallest, hi));
    }
    const a = Math.log10(floor);
    const span = Math.log10(Math.max(hi, floor * 1.0000001)) - a;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      out[i] = v > floor ? Math.min(1, (Math.log10(v) - a) / span) : 0;
    }
    return out;
  }
  const span = hi - lo;
  const g = o.mode === 'power' ? Math.max(o.gamma, 0.01) : 1;
  for (let i = 0; i < data.length; i++) {
    const t = span > 0 ? (data[i] - lo) / span : 0;
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    out[i] = g === 1 ? c : Math.pow(c, g);
  }
  return out;
}

const packed = new Map<string, Uint32Array>();

/** The 256 colours of a map as packed little-endian RGBA words (opaque), reversed when `invert`. */
function packedLut(name: ColormapName, invert: boolean): Uint32Array {
  const key = `${name}:${invert}`;
  const hit = packed.get(key);
  if (hit) return hit;
  const t = lut(name);
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const j = (invert ? 255 - i : i) * 3;
    out[i] = (255 << 24) | (t[j + 2] << 16) | (t[j + 1] << 8) | t[j];
  }
  packed.set(key, out);
  return out;
}

/** RGBA pixels (row-major) of a frame, written through a 32-bit view (fast for a large frame). */
export function toRgba(
  data: ArrayLike<number>,
  o: ScaleOptions,
  map: ColormapName,
  invert = false,
  known?: { min: number; max: number },
): Uint8ClampedArray {
  const t = normalise(data, o, known);
  const table = packedLut(map, invert);
  const out = new Uint8ClampedArray(t.length * 4);
  const words = new Uint32Array(out.buffer);
  for (let i = 0; i < t.length; i++) words[i] = table[(t[i] * 255 + 0.5) | 0];
  return out;
}

/** A round length for a scale bar: 1, 2 or 5 × 10ⁿ, the largest that is at most `target`. */
export function niceLength(target: number): number {
  if (!(target > 0)) return 1;
  const e = Math.floor(Math.log10(target));
  const base = Math.pow(10, e);
  const m = target / base;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * base;
}

/** The label of a scale bar: the length, trimmed of floating-point noise, with its unit. */
export function barLabel(length: number, unit: string): string {
  const v = +length.toPrecision(6);
  return `${v} ${unit}`.trim();
}
