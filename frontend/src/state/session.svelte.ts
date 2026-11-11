// What belongs to each open structure (context.md §7.MU step U7). The live stores (`project`,
// `specimen`, `simulation`) hold the structure that is shown; switching to another card saves
// them here and writes the other card's settings back, so every file keeps its own specimen,
// simulation settings and tab. The same snapshot, with the file's text, is the saved setup.
import { type Fov } from '../core/specimen';
import {
  APP_ID,
  SCHEMA_VERSION,
  fillDefaults,
  replaceInPlace,
  type FileState,
  type SetupDocument,
} from '../core/setup';
import { type TabId } from '../core/workflow';
import { project } from './project.svelte';
import {
  buildSpecimen,
  defaultParams,
  needsRebuild,
  resetSpecimen,
  specimen,
} from './specimen.svelte';
import {
  clearSimulationResults,
  defaultBloch,
  defaultIncostem,
  defaultMultislice,
  SIM_TYPES,
  simulation,
  type Method,
} from './simulation.svelte';

type Plain = Record<string, unknown>;

export const session = $state({
  /** A line to show the user after a setup was opened (a rebuild that did not match). */
  notice: '',
});

const kept: Record<number, FileState> = {};
/** Keep the settings of an open card (or of a setup that was just opened) under its id. */
export const keep = (id: number, state: FileState): void => void (kept[id] = state);
export const recall = (id: number): FileState | null => kept[id] ?? null;

const snap = <T>(v: T): T => $state.snapshot(v) as T;
const asPlain = (v: unknown) => v as Plain;

const DEFAULT_ORTHO = { mode: 'auto', maxRepetitions: 5, strainTolerance: 0.01 };

/** The live stores as a snapshot of the shown structure. */
export function capture(tab: TabId): FileState {
  const built = !!specimen.result;
  return {
    tab,
    ortho: {
      mode: project.ortho.mode,
      maxRepetitions: project.ortho.maxRepetitions,
      strainTolerance: project.ortho.strainTolerance,
    },
    specimen: {
      params: asPlain(snap(specimen.params)),
      built,
      builtParams:
        built && needsRebuild() && specimen.builtKey
          ? (JSON.parse(specimen.builtKey) as Plain)
          : null,
      specimenId: specimen.result?.specimenId ?? null,
    },
    simulation: {
      method: simulation.method,
      ms: { ...asPlain(snap(simulation.ms)), scanFov: snap(specimen.fov) },
      bloch: asPlain(snap(simulation.bloch)),
      incostem: asPlain(snap(simulation.incostem)),
      sigmas: snap(simulation.sigmas),
    },
  };
}

export function toDocument(
  state: FileState,
  structure: { fileName: string; rawCif: string },
): SetupDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: APP_ID,
    name: structure.fileName,
    structure,
    ...state,
  };
}

/** What `applyState` leaves for after the structure is registered. */
export interface RestorePlan {
  tab: TabId;
  build: boolean;
  /** Settings to build from when the saved specimen was stale, then `params` go back. */
  builtParams: Plain | null;
  params: Plain;
  specimenId: string | null;
}

/**
 * Write a snapshot into the live stores (in place: the panels hold these objects), or the
 * defaults when there is none. The specimen is not built here.
 */
export function applyState(state: FileState | null): RestorePlan {
  const s = state;
  const ortho = fillDefaults(DEFAULT_ORTHO, s?.ortho);
  project.ortho.mode = ortho.mode === 'manual' ? 'manual' : 'auto';
  project.ortho.maxRepetitions = ortho.maxRepetitions;
  project.ortho.strainTolerance = ortho.strainTolerance;

  resetSpecimen();
  const params = fillDefaults(asPlain(defaultParams()), s?.specimen.params);
  replaceInPlace(asPlain(specimen.params), params);

  const { scanFov, ...ms } = fillDefaults(
    { ...asPlain(defaultMultislice()), scanFov: null as unknown },
    s?.simulation.ms,
  );
  replaceInPlace(asPlain(simulation.ms), ms);
  // A setup saved when multislice LACBED existed: the type is gone, CBED is the nearest.
  if (!SIM_TYPES.some((t) => t.id === simulation.ms.type)) simulation.ms.type = 'cbed';
  replaceInPlace(
    asPlain(simulation.bloch),
    fillDefaults(asPlain(defaultBloch()), s?.simulation.bloch),
  );
  replaceInPlace(
    asPlain(simulation.incostem),
    fillDefaults(asPlain(defaultIncostem()), s?.simulation.incostem),
  );
  replaceInPlace(simulation.sigmas, fillDefaults({}, s?.simulation.sigmas));
  const method = s?.simulation.method;
  simulation.method = (
    ['multislice', 'bloch', 'incostem'].includes(method ?? '') ? method : 'multislice'
  ) as Method;
  clearSimulationResults();
  specimen.fov = (scanFov as Fov | null) ?? null;

  return {
    tab: s?.tab ?? 'structure',
    build: !!s?.specimen.built,
    builtParams: s?.specimen.builtParams ?? null,
    params,
    specimenId: s?.specimen.specimenId ?? null,
  };
}

/**
 * After the structure is registered: build the saved specimen again (the same settings give the
 * same id) and put a stale one's newer settings back. Returns false when `current()` says the
 * user moved on to another structure meanwhile.
 */
export async function restoreSpecimen(plan: RestorePlan, current: () => boolean): Promise<boolean> {
  if (!plan.build || project.registration.status !== 'ok') return current();
  if (plan.builtParams) replaceInPlace(asPlain(specimen.params), plan.builtParams);
  await buildSpecimen();
  if (!current()) return false;
  if (plan.builtParams) replaceInPlace(asPlain(specimen.params), plan.params);
  const id = specimen.result?.specimenId ?? null;
  if (plan.specimenId && id && id !== plan.specimenId)
    session.notice =
      'The rebuilt specimen is not identical to the saved one (the software may have changed). Check ② Specimen.';
  return true;
}
