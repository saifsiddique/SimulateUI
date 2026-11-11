// The live orientation of the structure viewer (context.md M7, task 5). Later modules read this
// to follow the view: the electron-diffraction pattern, the Kikuchi map and the stereogram. They
// should debounce what they compute from it (150 ms); the viewer updates it on every drawn frame.
import type { Vec3 } from '../core/math/vec3';
import type { IndexReading } from '../core/orientation';

export interface OrientationState {
  /** False until a structure has been drawn. */
  ready: boolean;
  /** Line of sight (unit, Cartesian), from the camera into the scene. */
  direction: Vec3;
  /** Screen-up direction (unit, Cartesian). */
  up: Vec3;
  /** Nearest low-index zone axis [uvw] and plane normal (hkl), with the angular deviation. */
  uvw: IndexReading | null;
  hkl: IndexReading | null;
}

export const orientation = $state<OrientationState>({
  ready: false,
  direction: [0, 0, -1],
  up: [0, 1, 0],
  uvw: null,
  hkl: null,
});
