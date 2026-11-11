/**
 * Series of runs set up in ③ Simulation's Series tab (context.md §7.MU step U4): a thickness series
 * (more saved depths of one run), a defocus series and a tilt series (one run per value). Each is a
 * range: from `start` to `stop` in steps of `step`, both ends included.
 */
export interface Range {
  start: number;
  stop: number;
  step: number;
}

/** No range gives more values than this; the rest are dropped (and `rangeCount` says so). */
export const MAX_VALUES = 1000;

/** Number of values of a range before the cap; 1 for a zero step or start = stop. */
export function rangeCount(r: Range): number {
  const span = r.stop - r.start;
  if (!(Math.abs(r.step) > 0) || !Number.isFinite(span) || span === 0) return 1;
  return Math.floor(Math.abs(span) / Math.abs(r.step) + 1e-9) + 1;
}

/** The values of a range, at most `MAX_VALUES`; the step runs towards `stop` whatever its sign. */
export function rangeValues(r: Range): number[] {
  const n = Math.min(MAX_VALUES, rangeCount(r));
  const d = Math.sign(r.stop - r.start) * Math.abs(r.step);
  // round away the float error of repeated addition (0.1 + 0.2 ...)
  return Array.from({ length: n }, (_, i) => +(r.start + i * d).toPrecision(12));
}

export type TiltMode = 'line' | 'grid';

/**
 * The tilts (x, y) of a tilt series, in mrad. `grid`: every x with every y. `line`: from
 * (x start, y start) to (x stop, y stop) in as many points as the longer of the two ranges.
 */
export function tiltPairs(x: Range, y: Range, mode: TiltMode): [number, number][] {
  const xs = rangeValues(x);
  const ys = rangeValues(y);
  if (mode === 'grid') {
    const out: [number, number][] = [];
    for (const ty of ys) for (const tx of xs) out.push([tx, ty]);
    return out.slice(0, MAX_VALUES * 10);
  }
  const n = Math.max(xs.length, ys.length);
  const at = (r: Range, i: number) =>
    n === 1 ? r.start : +(r.start + ((r.stop - r.start) * i) / (n - 1)).toPrecision(12);
  return Array.from({ length: n }, (_, i) => [at(x, i), at(y, i)]);
}

/**
 * A thickness series that fits a specimen `thickness` Å thick: a round step (1, 2 or 5 × 10ⁿ) of
 * about a quarter of it, from one step to the last multiple short of the exit surface (which is
 * always saved anyway).
 */
export function depthsFor(thickness: number): Range {
  const target = thickness / 4;
  const p = 10 ** Math.floor(Math.log10(target));
  const step = [5, 2, 1].map((m) => m * p).find((s) => s <= target) ?? p;
  const stop = Math.max(step, Math.ceil(thickness / step - 1 - 1e-9) * step);
  return { start: step, stop: +stop.toPrecision(12), step: +step.toPrecision(12) };
}

/** A short list of values for the sidebar: "0, 50, 100 … 500". */
export function preview(values: number[], unit: string): string {
  const f = (v: number) => `${+v.toPrecision(6)}`;
  const body =
    values.length <= 6
      ? values.map(f).join(', ')
      : `${values.slice(0, 3).map(f).join(', ')} … ${f(values[values.length - 1])}`;
  return `${body} ${unit}`;
}
