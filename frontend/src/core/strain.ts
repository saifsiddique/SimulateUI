/** Pure helpers for presenting the strain of an orthogonalised cell (context.md M2). */

export type StrainLevel = 'ok' | 'warn' | 'bad';

/** <= tolerance green, up to 5% amber, beyond red (multislice results become unreliable). */
export function strainLevel(maxAbs: number, tolerance = 0.01): StrainLevel {
  if (maxAbs <= tolerance + 1e-12) return 'ok';
  return maxAbs <= 0.05 ? 'warn' : 'bad';
}

export function formatStrain(x: number): string {
  const p = x * 100;
  if (Math.abs(p) < 1e-4) return '0 %';
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(Math.abs(p) < 0.1 ? 3 : 2)} %`;
}
