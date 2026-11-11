/**
 * Orientation control (context.md M7): the link between a viewing direction in Cartesian space and
 * crystallographic indices. Pure maths; the renderer only receives a direction and an up vector.
 *
 * Conventions: "view along [uvw]" means the line of sight (from the camera into the scene) is
 * M·uvw; "view normal to (hkl)" means it is B·hkl. For a screen frame (right, up, back) with
 * back = -direction, `rotateView` moves the crystal the way a mouse drag in that direction would.
 */
import {
  cartesianToNearestHkl,
  cartesianToNearestUvw,
  hklToCart,
  uvwToCart,
  type Lattice,
} from './lattice';
import { angleBetween, cross, dot, norm, normalize, type Vec3 } from './math/vec3';

export interface ViewFrame {
  /** Line of sight, from the camera into the scene (unit). */
  direction: Vec3;
  /** Screen-up direction (unit, perpendicular to `direction`). */
  up: Vec3;
}

/** Rodrigues rotation of `v` about the unit `axis` by `deg` (right-handed). */
function rotateAbout(v: Vec3, axis: Vec3, deg: number): Vec3 {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [
    v[0] * c + k[0] * s + axis[0] * d,
    v[1] * c + k[1] * s + axis[1] * d,
    v[2] * c + k[2] * s + axis[2] * d,
  ];
}

/** Unit `direction` and an `up` made exactly perpendicular to it; null for a zero direction. */
export function makeFrame(direction: Vec3, up: Vec3): ViewFrame | null {
  const d = normalize(direction);
  if (!d) return null;
  const along = dot(up, d);
  let u = normalize([up[0] - along * d[0], up[1] - along * d[1], up[2] - along * d[2]]);
  if (!u || norm(cross(up, d)) < 1e-3 * norm(up)) {
    // `up` is (anti)parallel to the view: any perpendicular will do.
    const trial: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    const a = dot(trial, d);
    u = normalize([trial[0] - a * d[0], trial[1] - a * d[1], trial[2] - a * d[2]]);
  }
  return u ? { direction: d, up: u } : null;
}

/**
 * Turn the crystal as seen on screen. `right` and `upward` (degrees) move the crystal to the right
 * and up, like dragging the mouse that way; `roll` (degrees) turns it clockwise on the screen.
 * Applied in this order, each about the frame's current axes.
 */
export function rotateView(
  frame: ViewFrame,
  turn: { right?: number; upward?: number; roll?: number },
): ViewFrame {
  let f = makeFrame(frame.direction, frame.up)!;
  if (turn.right) {
    // The camera moves to the left of the crystal: rotate the camera frame about screen-up.
    f = { direction: rotateAbout(f.direction, f.up, -turn.right), up: f.up };
    f = makeFrame(f.direction, f.up)!;
  }
  if (turn.upward) {
    const right = cross(f.direction, f.up); // screen-right = direction x up
    f = {
      direction: rotateAbout(f.direction, right, turn.upward),
      up: rotateAbout(f.up, right, turn.upward),
    };
    f = makeFrame(f.direction, f.up)!;
  }
  if (turn.roll) {
    // Crystal clockwise = camera frame anticlockwise about the line of sight.
    f = { direction: f.direction, up: rotateAbout(f.up, f.direction, -turn.roll) };
    f = makeFrame(f.direction, f.up)!;
  }
  return f;
}

/** Cartesian direction for "view along [uvw]". */
export const directionAlongUvw = (lat: Lattice, uvw: Vec3): Vec3 => uvwToCart(lat, uvw);

/** Cartesian direction for "view normal to (hkl)". */
export const directionNormalToHkl = (lat: Lattice, hkl: Vec3): Vec3 => hklToCart(lat, hkl);

/**
 * Default screen-up for a viewing direction: c projected onto the screen, or b when the view is
 * within 1 degree of c.
 */
export function defaultUp(lat: Lattice, direction: Vec3): Vec3 {
  const c: Vec3 = [lat.M[0][2], lat.M[1][2], lat.M[2][2]];
  if (angleBetween(direction, c) < 1 || angleBetween(direction, c) > 179) {
    return [lat.M[0][1], lat.M[1][1], lat.M[2][1]];
  }
  return c;
}

export interface IndexReading {
  indices: Vec3;
  angleDeg: number;
}

export interface OrientationReading {
  uvw: IndexReading;
  hkl: IndexReading;
}

/** Previous answers, kept so that the readout does not flicker between near-equal candidates. */
export interface ReadoutMemory {
  uvw?: Vec3;
  hkl?: Vec3;
}

/** A challenger must beat the previous answer by this much (degrees) to replace it. */
export const READOUT_HYSTERESIS = 0.05;

/**
 * The nearest low-index [uvw] and (hkl) to a viewing direction. `memory` (updated in place) makes
 * the answer sticky: the previous indices stay unless another candidate is closer by more than
 * `READOUT_HYSTERESIS` degrees.
 */
export function readOrientation(
  lat: Lattice,
  direction: Vec3,
  memory: ReadoutMemory = {},
  maxIndex = 6,
): OrientationReading {
  const pick = (
    kind: 'uvw' | 'hkl',
    best: IndexReading,
    toCart: (l: Lattice, v: Vec3) => Vec3,
  ): IndexReading => {
    const prev = memory[kind];
    if (prev) {
      const prevAngle = angleBetween(direction, toCart(lat, prev));
      if (prevAngle <= best.angleDeg + READOUT_HYSTERESIS) {
        return { indices: prev, angleDeg: prevAngle };
      }
    }
    memory[kind] = best.indices;
    return best;
  };
  return {
    uvw: pick('uvw', cartesianToNearestUvw(lat, direction, maxIndex), uvwToCart),
    hkl: pick('hkl', cartesianToNearestHkl(lat, direction, maxIndex), hklToCart),
  };
}

export interface SnapTarget {
  kind: 'uvw' | 'hkl';
  indices: Vec3;
  /** Exact Cartesian direction (sign as the line of sight). */
  direction: Vec3;
  angleDeg: number;
}

/**
 * The nearest zone axis [uvw] (a direction in the crystal; "zone axis" in the electron-diffraction
 * sense) if the line of sight is within `thresholdDeg` of it; otherwise null.
 */
export function snapToZoneAxis(
  lat: Lattice,
  direction: Vec3,
  thresholdDeg: number,
  maxIndex = 6,
): SnapTarget | null {
  const near = cartesianToNearestUvw(lat, direction, maxIndex);
  if (near.angleDeg > thresholdDeg) return null;
  return {
    kind: 'uvw',
    indices: near.indices,
    direction: uvwToCart(lat, near.indices),
    angleDeg: near.angleDeg,
  };
}
