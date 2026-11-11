export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

const wrap360 = (deg: number): number => ((deg % 360) + 360) % 360;

/**
 * cos of an angle in degrees, exact at the angles crystallography is full of (0, 60, 90, 120, 180,
 * ...). `Math.cos(Math.PI / 2)` is 6e-17, which would put noise into cubic and hexagonal matrices
 * that should contain exact zeros.
 */
export function cosDeg(deg: number): number {
  switch (wrap360(deg)) {
    case 0:
      return 1;
    case 60:
    case 300:
      return 0.5;
    case 90:
    case 270:
      return 0;
    case 120:
    case 240:
      return -0.5;
    case 180:
      return -1;
    default:
      return Math.cos(degToRad(deg));
  }
}

/** sin of an angle in degrees; exact at multiples of 30 where the value is 0, ±0.5 or ±1. */
export function sinDeg(deg: number): number {
  switch (wrap360(deg)) {
    case 0:
    case 180:
      return 0;
    case 30:
    case 150:
      return 0.5;
    case 90:
      return 1;
    case 210:
    case 330:
      return -0.5;
    case 270:
      return -1;
    default:
      return Math.sin(degToRad(deg));
  }
}
