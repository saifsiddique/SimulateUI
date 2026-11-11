/**
 * The aberration coefficients abTEM knows (context.md §7.MU step U4), in the order of a table in the
 * sidebar. Magnitudes are in angstrom, angles in degrees in the UI; C3 (C30) and all the fourth- and
 * fifth-order terms are shown in micrometres. The defocus (C10, with abTEM's sign flipped) has its
 * own field and is not listed here.
 */
export interface AberrationDef {
  /** abTEM's name of the magnitude; the angle is `phi` + the digits (phi12, phi21, ...). */
  id: string;
  /** Haider's notation (C1 = defocus, A1 = two-fold astigmatism, ...). */
  haider: string;
  label: string;
  /** Rotationally symmetric terms (C30, C50) have no angle. */
  angle: boolean;
  /** Unit shown in the UI. */
  unit: 'Å' | 'µm';
  /** Range of "Add random aberrations", in Å (the angle is 0 to 360 degrees). */
  random: [number, number];
}

const NM = 10;
const UM = 1e4;

export const ABERRATIONS: AberrationDef[] = [
  {
    id: 'C12',
    haider: 'A1',
    label: 'Two-fold astigmatism',
    angle: true,
    unit: 'Å',
    random: [0, 2 * NM],
  },
  { id: 'C21', haider: 'B2', label: 'Axial coma', angle: true, unit: 'Å', random: [0, 5 * NM] },
  {
    id: 'C23',
    haider: 'A2',
    label: 'Three-fold astigmatism',
    angle: true,
    unit: 'Å',
    random: [0, 5 * NM],
  },
  {
    id: 'C30',
    haider: 'C3',
    label: 'Spherical aberration, Cs',
    angle: false,
    unit: 'µm',
    random: [-500 * NM, 500 * NM],
  },
  {
    id: 'C32',
    haider: 'S3',
    label: 'Axial star aberration',
    angle: true,
    unit: 'Å',
    random: [0, 100 * NM],
  },
  {
    id: 'C34',
    haider: 'A3',
    label: 'Four-fold astigmatism',
    angle: true,
    unit: 'Å',
    random: [0, 100 * NM],
  },
  {
    id: 'C41',
    haider: 'B4',
    label: 'Fourth-order axial coma',
    angle: true,
    unit: 'µm',
    random: [0, 5 * UM],
  },
  {
    id: 'C43',
    haider: 'D4',
    label: 'Three-lobe aberration',
    angle: true,
    unit: 'µm',
    random: [0, 5 * UM],
  },
  {
    id: 'C45',
    haider: 'A4',
    label: 'Five-fold astigmatism',
    angle: true,
    unit: 'µm',
    random: [0, 5 * UM],
  },
  {
    id: 'C50',
    haider: 'C5',
    label: 'Fifth-order spherical, C5',
    angle: false,
    unit: 'µm',
    random: [0, 5 * UM],
  },
  {
    id: 'C52',
    haider: 'S5',
    label: 'Fifth-order, two-fold',
    angle: true,
    unit: 'µm',
    random: [0, 5 * UM],
  },
  {
    id: 'C54',
    haider: 'R5',
    label: 'Fifth-order, four-fold',
    angle: true,
    unit: 'µm',
    random: [0, 5 * UM],
  },
  {
    id: 'C56',
    haider: 'A5',
    label: 'Six-fold astigmatism',
    angle: true,
    unit: 'µm',
    random: [0, 5 * UM],
  },
];

export const phiName = (id: string) => `phi${id.slice(1)}`;

/** Value in the UI unit <-> abTEM's angstrom. */
export const toUi = (d: AberrationDef, angstrom: number) =>
  d.unit === 'µm' ? angstrom * 1e-4 : angstrom;
export const fromUi = (d: AberrationDef, ui: number) => (d.unit === 'µm' ? ui * 1e4 : ui);

/** Every coefficient at zero: magnitudes (Å) and angles (degrees), keyed by abTEM name. */
export const zeroAberrations = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const d of ABERRATIONS) {
    out[d.id] = 0;
    if (d.angle) out[phiName(d.id)] = 0;
  }
  return out;
};

/** The request's `aberrations`: non-zero magnitudes in Å, and their angles in radians. */
export function aberrationRequest(ab: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of ABERRATIONS) {
    const v = ab[d.id] ?? 0;
    if (!v) continue;
    out[d.id] = v;
    if (d.angle) out[phiName(d.id)] = ((ab[phiName(d.id)] ?? 0) * Math.PI) / 180;
  }
  return out;
}

/**
 * Random aberrations for a quick look at their effect: every coefficient in its range
 * (`AberrationDef.random`), every angle from 0 to 360 degrees. The defocus is left alone.
 */
export function randomAberrations(rng: () => number = Math.random): Record<string, number> {
  const draw = ([lo, hi]: [number, number]) => lo + (hi - lo) * rng();
  const ab = zeroAberrations();
  for (const d of ABERRATIONS) {
    ab[d.id] = draw(d.random);
    if (d.angle) ab[phiName(d.id)] = 360 * rng();
  }
  return ab;
}
