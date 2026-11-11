// Specimen step state (context.md M3): zone axis -> centre -> orthogonal periodic box, plus the
// STEM scan field of view. The backend builds the box; this holds the request and the result.
import {
  ApiError,
  postSpecimen,
  postStructure,
  type CenterMode,
  type OccupancyPolicy,
  type SpecimenResponse,
  type Triple,
} from '../api/client';
import { buildCrystal, type Crystal } from '../core/crystal';
import { orthogonalCifStructure, type StructurePayload } from '../core/payload';
import { clampFov, fovPreset, type Fov } from '../core/specimen';
import { project } from './project.svelte';

export interface SpecimenParams {
  zoneAxis: Triple<number>;
  /** Screen-up of the crystal view when the zone axis was taken from it (crystal Cartesian). */
  yDirection: Triple<number> | null;
  center: CenterMode;
  lateral: [number, number];
  thickness: number;
  /** Periodic cells along specimen x, y and the beam. Sent instead of the angstrom extents. */
  repeats: [number, number, number];
  vacuum: [number, number];
  strainTolerance: number;
  maxRepeatAtoms: number;
  maxLength: number;
  occupancy: OccupancyPolicy;
  seed: number;
  method: 'search' | 'abtem';
  abtemRepetitions: number;
  supercell: Triple<Triple<number>> | null;
  compareAbtem: boolean;
}

export const defaultParams = (): SpecimenParams => ({
  zoneAxis: [0, 0, 1],
  yDirection: null,
  center: 'cell',
  lateral: [40, 40],
  thickness: 100,
  repeats: [2, 2, 4],
  vacuum: [0, 0],
  strainTolerance: 0.002,
  maxRepeatAtoms: 2000,
  maxLength: 100,
  occupancy: 'dominant',
  seed: 0,
  method: 'search',
  abtemRepetitions: 5,
  supercell: null,
  compareAbtem: false,
});

export const specimen = $state<{
  params: SpecimenParams;
  status: 'idle' | 'pending' | 'ok' | 'error';
  result: SpecimenResponse | null;
  error: string | null;
  /** Scan field of view, specimen frame (A); null = not set yet. */
  fov: Fov | null;
  /** The settings the current result was built from (JSON); null before the first build. */
  builtKey: string | null;
}>({
  params: defaultParams(),
  status: 'idle',
  result: null,
  error: null,
  fov: null,
  builtKey: null,
});

let seq = 0;
let lastPayload: StructurePayload | null = null;

const paramsKey = () => JSON.stringify($state.snapshot(specimen.params));

/** A setting changed since the specimen was built: it has to be built again (by the user). */
export const needsRebuild = (): boolean =>
  !!specimen.result && specimen.builtKey !== null && specimen.builtKey !== paramsKey();

/** The beam the specimen will be built along: the crystal view's direction and its screen-up. */
export function setZone(axis: [number, number, number], up: [number, number, number]): void {
  const same =
    specimen.params.zoneAxis.every((v, i) => v === axis[i]) &&
    specimen.params.yDirection?.every((v, i) => Math.abs(v - up[i]) < 1e-6);
  if (same) return;
  specimen.params.zoneAxis = axis;
  specimen.params.yDirection = up;
  specimen.params.supercell = null;
}

export function rememberPayload(p: StructurePayload | null): void {
  lastPayload = p;
}

export function resetSpecimen(): void {
  seq++;
  // Mutate in place: the panel bound its inputs to this object, so replacing it would leave
  // the form editing a copy the build never reads.
  const fresh = defaultParams();
  for (const key of Object.keys(fresh) as (keyof SpecimenParams)[]) {
    specimen.params[key] = fresh[key] as never;
  }
  specimen.status = 'idle';
  specimen.result = null;
  specimen.error = null;
  specimen.fov = null;
  specimen.builtKey = null;
}

/** All settings back to their defaults except the beam direction, which stays as chosen. */
export function resetParams(): void {
  const fresh = defaultParams();
  for (const key of Object.keys(fresh) as (keyof SpecimenParams)[]) {
    if (key === 'zoneAxis' || key === 'yDirection') continue;
    specimen.params[key] = fresh[key] as never;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function buildSpecimen(): Promise<void> {
  const reg = project.registration.response;
  if (!reg) return;
  const mine = ++seq;
  const key = paramsKey();
  specimen.status = 'pending';
  specimen.error = null;
  const body = () => ({
    structureId: project.registration.response!.structureId,
    ...$state.snapshot(specimen.params),
  });
  try {
    let r: SpecimenResponse;
    try {
      r = await postSpecimen(body());
    } catch (e) {
      // The backend restarted and forgot the structure: register it again once.
      if (!(e instanceof ApiError && e.code === 'unknown_structure') || !lastPayload) throw e;
      const response = await postStructure(lastPayload);
      project.registration = { status: 'ok', response, error: null };
      r = await postSpecimen(body());
    }
    if (mine !== seq) return;
    specimen.result = r;
    specimen.builtKey = key;
    specimen.status = 'ok';
    const box: [number, number] = [r.box[0], r.box[1]];
    specimen.fov = specimen.fov
      ? clampFov(specimen.fov, box)
      : fovPreset('centre50', box, [r.repeat_cell[0], r.repeat_cell[1]]);
  } catch (e) {
    if (mine !== seq) return;
    specimen.status = 'error';
    specimen.error = message(e);
  }
}

/** The specimen as a viewable P1 crystal (box = cell, 90/90/90). */
export function specimenCrystal(r: SpecimenResponse): Crystal | null {
  const [Lx, Ly, Lz] = r.box;
  const atoms = r.species.map((s, i) => ({
    element: r.symbols[s],
    frac: [
      r.positions[3 * i] / Lx,
      r.positions[3 * i + 1] / Ly,
      r.positions[3 * i + 2] / Lz,
    ] as Triple<number>,
    occupancy: 1,
  }));
  try {
    return buildCrystal(
      orthogonalCifStructure('specimen', { cell: [Lx, Ly, Lz], atoms }) as Parameters<
        typeof buildCrystal
      >[0],
    ).crystal;
  } catch {
    return null;
  }
}
