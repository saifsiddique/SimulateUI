/** Pure helpers for the memory bar (context.md M1). */

export type MemoryLevel = 'ok' | 'warn' | 'bad';

/** Fraction of the available memory a run needs: < 60% ok, < 90% amber, otherwise red. */
export function memoryLevel(needed: number, available: number): MemoryLevel {
  if (available <= 0) return 'bad';
  const f = needed / available;
  return f < 0.6 ? 'ok' : f < 0.9 ? 'warn' : 'bad';
}

export function formatBytes(n: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return '< 1 s';
  if (seconds < 90) return `${seconds.toFixed(0)} s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(0)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
