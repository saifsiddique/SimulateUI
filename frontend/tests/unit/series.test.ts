import { describe, expect, it } from 'vitest';
import {
  MAX_VALUES,
  depthsFor,
  preview,
  rangeCount,
  rangeValues,
  tiltPairs,
} from '../../src/core/series';

describe('series ranges', () => {
  it('includes both ends and rounds away float error', () => {
    expect(rangeValues({ start: 0, stop: 0.3, step: 0.1 })).toEqual([0, 0.1, 0.2, 0.3]);
    expect(rangeValues({ start: 50, stop: 200, step: 50 })).toEqual([50, 100, 150, 200]);
  });
  it('runs towards stop whatever the sign of the step', () => {
    expect(rangeValues({ start: 100, stop: -100, step: 100 })).toEqual([100, 0, -100]);
    expect(rangeValues({ start: 100, stop: -100, step: -100 })).toEqual([100, 0, -100]);
  });
  it('stops short of stop when the step does not divide the span', () => {
    expect(rangeValues({ start: 0, stop: 10, step: 4 })).toEqual([0, 4, 8]);
  });
  it('gives one value for a zero step or an empty span', () => {
    expect(rangeValues({ start: 5, stop: 20, step: 0 })).toEqual([5]);
    expect(rangeValues({ start: 5, stop: 5, step: 1 })).toEqual([5]);
  });
  it('caps the number of values', () => {
    const r = { start: 0, stop: 1e6, step: 1 };
    expect(rangeCount(r)).toBe(1e6 + 1);
    expect(rangeValues(r)).toHaveLength(MAX_VALUES);
  });
  it('makes tilt pairs on a grid or along a line', () => {
    const x = { start: 0, stop: 10, step: 5 };
    const y = { start: 0, stop: 2, step: 2 };
    expect(tiltPairs(x, y, 'grid')).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [0, 2],
      [5, 2],
      [10, 2],
    ]);
    expect(tiltPairs(x, y, 'line')).toEqual([
      [0, 0],
      [5, 1],
      [10, 2],
    ]);
    expect(
      tiltPairs({ start: 3, stop: 3, step: 0 }, { start: 1, stop: 1, step: 0 }, 'line'),
    ).toEqual([[3, 1]]);
  });
  it('fits a round thickness series inside the specimen', () => {
    expect(depthsFor(30.7)).toEqual({ start: 5, stop: 30, step: 5 });
    expect(depthsFor(30)).toEqual({ start: 5, stop: 25, step: 5 });
    expect(depthsFor(400)).toEqual({ start: 100, stop: 300, step: 100 });
    expect(depthsFor(3)).toEqual({ start: 0.5, stop: 2.5, step: 0.5 });
  });
  it('previews a long list with an ellipsis', () => {
    expect(preview([1, 2, 3], 'Å')).toBe('1, 2, 3 Å');
    expect(preview([0, 50, 100, 150, 200, 250, 300], 'Å')).toBe('0, 50, 100 … 300 Å');
  });
});
