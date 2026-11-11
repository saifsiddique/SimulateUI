/**
 * Exact picking: nearest ray-sphere intersection over all atoms. This is O(N) per query with no
 * allocation, which is fast enough for 10^5 atoms and, unlike raycasting instanced triangle
 * meshes, exact for the sphere the user sees.
 */
export interface PickResult {
  index: number;
  /** Distance along the ray to the entry point. */
  t: number;
}

/**
 * @param centres 3 numbers per atom (Cartesian)
 * @param radii   one radius per atom; 0 (or less) means hidden and unpickable
 * @param dir     must be a unit vector
 */
export function pickSphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  centres: ArrayLike<number>,
  radii: ArrayLike<number>,
  count: number,
): PickResult | null {
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < count; i++) {
    const r = radii[i];
    if (r <= 0) continue;
    const lx = centres[3 * i] - ox;
    const ly = centres[3 * i + 1] - oy;
    const lz = centres[3 * i + 2] - oz;
    const tca = lx * dx + ly * dy + lz * dz; // distance to the point of closest approach
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    const h2 = r * r - d2;
    if (h2 < 0) continue;
    const h = Math.sqrt(h2);
    let t = tca - h;
    if (t < 0) t = tca + h; // ray starts inside the sphere
    if (t < 0) continue; // sphere behind the ray
    if (t < bestT) {
      bestT = t;
      best = i;
    }
  }
  return best < 0 ? null : { index: best, t: bestT };
}
