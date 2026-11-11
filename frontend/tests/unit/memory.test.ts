import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, memoryLevel } from '../../src/core/memory';

describe('memory helpers', () => {
  it('colours the memory bar', () => {
    expect(memoryLevel(50, 100)).toBe('ok');
    expect(memoryLevel(70, 100)).toBe('warn');
    expect(memoryLevel(95, 100)).toBe('bad');
    expect(memoryLevel(1, 0)).toBe('bad');
  });
  it('formats sizes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatDuration(0.2)).toBe('< 1 s');
    expect(formatDuration(120)).toBe('2 min');
  });
});
