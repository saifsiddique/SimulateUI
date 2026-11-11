/**
 * The aberration phase χ(k) of the probe-forming lens (context.md §7.MU step U4), in abTEM's polar
 * form: χ(α, φ) = 2π/λ Σ C_nm α^(n+1)/(n+1) cos(m(φ − φ_nm)), with C10 = −defocus. Magnitudes in Å,
 * angles in radians; α is the scattering angle in radians and φ its azimuth from +x.
 */
import { ABERRATIONS, phiName } from './aberrations';

interface Term {
  n: number;
  m: number;
  c: number;
  phi: number;
}

/** The non-zero terms: `ab` in Å with angles in degrees (the sidebar's units), and the defocus. */
export function chiTerms(ab: Record<string, number>, defocus: number): Term[] {
  const out: Term[] = [];
  if (defocus) out.push({ n: 1, m: 0, c: -defocus, phi: 0 });
  for (const d of ABERRATIONS) {
    const c = ab[d.id] ?? 0;
    if (!c) continue;
    const n = Number(d.id[1]);
    const m = Number(d.id[2]);
    const phi = d.angle ? ((ab[phiName(d.id)] ?? 0) * Math.PI) / 180 : 0;
    out.push({ n, m, c, phi });
  }
  return out;
}

/** χ in radians at the angle (ax, ay) (radians), for wavelength `lam` (Å). */
export function chi(terms: Term[], lam: number, ax: number, ay: number): number {
  const a = Math.hypot(ax, ay);
  const phi = Math.atan2(ay, ax);
  let s = 0;
  for (const t of terms) s += (t.c * a ** (t.n + 1) * Math.cos(t.m * (phi - t.phi))) / (t.n + 1);
  return ((2 * Math.PI) / lam) * s;
}

export interface ChiMap {
  /** χ on an n × n grid, row-major from the top-left corner of the down-the-beam picture. */
  values: Float64Array;
  n: number;
  /** Half width of the map in mrad (it covers −half … +half in x and y). */
  half: number;
  /** Largest |χ − χ(0)| inside α, in radians. */
  maxInside: number;
  /**
   * Radius (mrad) of the largest centred disc in which |χ| stays below π/4, the usual limit of a
   * "flat" phase; null when that holds up to the edge of the map.
   */
  flatRadius: number | null;
}

/**
 * χ over the angles up to `half` mrad, in the orientation of the other planes seen down the beam:
 * +x to the LEFT (`flipX`) and +y up, so the first column is θx = +half and the first row θy = +half.
 */
export function chiMap(
  terms: Term[],
  lam: number,
  alphaMrad: number,
  half: number,
  n = 192,
  flipX = true,
): ChiMap {
  const values = new Float64Array(n * n);
  const step = (2 * half) / (n - 1);
  let maxInside = 0;
  let flat = Infinity;
  for (let j = 0; j < n; j++) {
    const ty = half - j * step;
    for (let i = 0; i < n; i++) {
      const tx = flipX ? half - i * step : -half + i * step;
      const v = chi(terms, lam, tx * 1e-3, ty * 1e-3);
      values[j * n + i] = v;
      const r = Math.hypot(tx, ty);
      if (r <= alphaMrad) maxInside = Math.max(maxInside, Math.abs(v));
      if (Math.abs(v) > Math.PI / 4 && r < flat) flat = r;
    }
  }
  return { values, n, half, maxInside, flatRadius: Number.isFinite(flat) ? flat : null };
}

/** A cyclic colour map (twilight-like) for a phase in radians, wrapping every 2π. */
export function phaseColor(v: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [226, 217, 226],
    [94, 134, 193],
    [47, 20, 54],
    [178, 86, 82],
    [226, 217, 226],
  ];
  let t = (v / (2 * Math.PI)) % 1;
  if (t < 0) t += 1;
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}
