// The setup document (context.md §5.4, §7.MU step U7): everything the user chose for one structure,
// as plain JSON that can be saved and opened again. Pure: the stores read and write it
// (state/session.svelte.ts), this file only describes, migrates and checks it.
import type { TabId } from './workflow';

export const SCHEMA_VERSION = 2;
export const APP_ID = 'SimulateUI';

type Plain = Record<string, unknown>;

/** What is kept per open structure (and, with the structure itself, in a saved setup). */
export interface FileState {
  /** The tab that was open. */
  tab: TabId;
  ortho: { mode: string; maxRepetitions: number; strainTolerance: number };
  specimen: {
    params: Plain;
    /** A specimen had been built (it is built again when the setup is opened). */
    built: boolean;
    /** The settings that specimen was built from, when they differ from `params` (stale). */
    builtParams: Plain | null;
    /** The backend's id of the built specimen: a rebuild must give the same one. */
    specimenId: string | null;
  };
  simulation: {
    method: string;
    /** `scanFov` (the STEM field of view, Å) lives here from schema 2 on. */
    ms: Plain;
    bloch: Plain;
    incostem: Plain;
    sigmas: Record<string, number>;
  };
}

export interface SetupDocument extends FileState {
  schemaVersion: typeof SCHEMA_VERSION;
  app: typeof APP_ID;
  name: string;
  structure: { fileName: string; rawCif: string };
}

export class SetupError extends Error {}

export const isPlain = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

/**
 * Make `target` hold what `source` holds without replacing it: the panels bound their inputs to
 * these objects, so a new object would leave them editing a copy. Keys not in `source` go.
 */
export function replaceInPlace(target: Plain, source: Plain): void {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isPlain(current) && isPlain(value)) replaceInPlace(current, value);
    else target[key] = clone(value);
  }
}

/**
 * `given` laid over `defaults`: a setting that is missing or has the wrong type takes its default,
 * so a setup written by an older version opens with the newer settings at their defaults. An
 * empty default object (the element sigmas) takes whatever it is given.
 */
export function fillDefaults<T>(defaults: T, given: unknown): T {
  if (isPlain(defaults)) {
    if (!isPlain(given)) return clone(defaults);
    if (Object.keys(defaults).length === 0) return clone(given) as T;
    const out: Plain = {};
    for (const [key, d] of Object.entries(defaults)) out[key] = fillDefaults(d, given[key]);
    return out as T;
  }
  if (Array.isArray(defaults)) return (Array.isArray(given) ? clone(given) : clone(defaults)) as T;
  if (defaults === null) return (given === undefined ? null : clone(given)) as T;
  return (typeof given === typeof defaults ? given : defaults) as T;
}

const TABS: TabId[] = ['structure', 'specimen', 'simulation', 'run'];

/** A setup written by this version, or an older one brought up to date. Throws `SetupError`. */
export function migrateSetup(raw: unknown): SetupDocument {
  if (!isPlain(raw)) throw new SetupError('This is not a SimulateUI setup file.');
  const version = raw.schemaVersion;
  if (typeof version !== 'number')
    throw new SetupError('This is not a SimulateUI setup file (no schema version).');
  if (version > SCHEMA_VERSION)
    throw new SetupError(
      `This setup was saved by a newer version of ${APP_ID} (schema ${version}); this one reads up to ${SCHEMA_VERSION}.`,
    );
  const doc = version === 1 ? fromV1(raw) : raw;
  const s = doc.structure;
  if (!isPlain(s) || typeof s.rawCif !== 'string' || s.rawCif.trim() === '')
    throw new SetupError('The setup has no structure in it.');
  const fileName = typeof s.fileName === 'string' && s.fileName ? s.fileName : 'structure.cif';
  const sim = isPlain(doc.simulation) ? doc.simulation : {};
  const spec = isPlain(doc.specimen) ? doc.specimen : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    app: APP_ID,
    name: typeof doc.name === 'string' ? doc.name : fileName,
    structure: { fileName, rawCif: s.rawCif },
    tab: TABS.includes(doc.tab as TabId) ? (doc.tab as TabId) : 'structure',
    ortho: (isPlain(doc.ortho) ? doc.ortho : {}) as FileState['ortho'],
    specimen: {
      params: isPlain(spec.params) ? spec.params : {},
      built: spec.built === true,
      builtParams: isPlain(spec.builtParams) ? spec.builtParams : null,
      specimenId: typeof spec.specimenId === 'string' ? spec.specimenId : null,
    },
    simulation: {
      method: typeof sim.method === 'string' ? sim.method : 'multislice',
      ms: isPlain(sim.ms) ? sim.ms : {},
      bloch: isPlain(sim.bloch) ? sim.bloch : {},
      incostem: isPlain(sim.incostem) ? sim.incostem : {},
      sigmas: (isPlain(sim.sigmas) ? sim.sigmas : {}) as Record<string, number>,
    },
  };
}

/**
 * Schema 1 is the plan's first layout (context.md §5.4): the specimen settings in one object with
 * `lateral`, `thickness` and `vacuum` in sections, the method as 'abtem' | 'bloch' | 'incostem',
 * the STEM field of view in `specimen.scanFov`. Schema 2 moves the field of view to `ms.scanFov`.
 */
function fromV1(raw: Plain): Plain {
  const sp = isPlain(raw.specimen) ? raw.specimen : {};
  const params: Plain = {};
  if (Array.isArray(sp.zoneAxis)) params.zoneAxis = sp.zoneAxis;
  if (typeof sp.strainTolerance === 'number') params.strainTolerance = sp.strainTolerance;
  if (typeof sp.occupancyPolicy === 'string') params.occupancy = sp.occupancyPolicy;
  const lat = sp.lateral;
  if (isPlain(lat) && lat.mode === 'angstrom') params.lateral = [lat.x, lat.y];
  const th = sp.thickness;
  if (isPlain(th) && th.mode === 'angstrom') params.thickness = th.value;
  const vac = sp.vacuum;
  if (isPlain(vac)) params.vacuum = [vac.top, vac.bottom];
  const ms: Plain = { ...(isPlain(raw.abtem) ? raw.abtem : {}) };
  if (typeof raw.simType === 'string') ms.type = raw.simType;
  if (isPlain(sp.scanFov)) ms.scanFov = sp.scanFov;
  return {
    name: raw.name,
    structure: raw.structure,
    specimen: { params, built: false },
    simulation: {
      method: raw.method === 'abtem' ? 'multislice' : raw.method,
      ms,
      bloch: raw.bloch,
      incostem: raw.incostem,
    },
  };
}

export function serializeSetup(doc: SetupDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** `Si.cif` → `Si.simulateui.json` */
export const setupFileName = (fileName: string): string =>
  `${fileName.replace(/\.[^./\\]+$/, '') || 'setup'}.simulateui.json`;

// ---- the "ready to run" list of step ④ ----------------------------------------------------------

export type ReadyState = 'ok' | 'warn' | 'fail';

export interface ReadyItem {
  id: 'structure' | 'specimen' | 'parameters' | 'memory';
  label: string;
  state: ReadyState;
  /** One line per warning, or the reason for a failure. */
  details: string[];
  /** The tab that fixes it. */
  tab: TabId;
}

export interface ReadyInput {
  registration: 'idle' | 'pending' | 'ok' | 'error';
  registrationError?: string | null;
  specimen: { hasResult: boolean; changed: boolean; warnings: string[] };
  /** The warnings of the method's last preview; null = no preview yet (③ not opened). */
  parameterWarnings: string[] | null;
  parameterError?: string;
  /** Multislice: the estimated peak memory and what is free where it runs (bytes). */
  memory?: { needed: number; available: number; where: string } | null;
}

export function readiness(w: ReadyInput): ReadyItem[] {
  const structure: ReadyItem =
    w.registration === 'ok'
      ? { id: 'structure', label: 'Structure', state: 'ok', details: [], tab: 'structure' }
      : {
          id: 'structure',
          label: 'Structure',
          state: 'fail',
          details: [
            w.registration === 'error'
              ? `The backend could not take the structure: ${w.registrationError ?? 'unknown error'}`
              : w.registration === 'pending'
                ? 'Registering the structure…'
                : 'Open a CIF or XYZ file.',
          ],
          tab: 'structure',
        };

  const s = w.specimen;
  const specimen: ReadyItem = !s.hasResult
    ? {
        id: 'specimen',
        label: 'Specimen',
        state: 'fail',
        details: ['Build the specimen in ② Specimen.'],
        tab: 'specimen',
      }
    : s.changed
      ? {
          id: 'specimen',
          label: 'Specimen',
          state: 'fail',
          details: ['A setting changed after the specimen was built: build it again.'],
          tab: 'specimen',
        }
      : {
          id: 'specimen',
          label: 'Specimen',
          state: s.warnings.length ? 'warn' : 'ok',
          details: s.warnings,
          tab: 'specimen',
        };

  const parameters: ReadyItem = w.parameterError
    ? {
        id: 'parameters',
        label: 'Parameters',
        state: 'fail',
        details: [w.parameterError],
        tab: 'simulation',
      }
    : w.parameterWarnings === null
      ? {
          id: 'parameters',
          label: 'Parameters',
          state: s.hasResult ? 'warn' : 'fail',
          details: ['Open ③ Simulation to check the parameters.'],
          tab: 'simulation',
        }
      : {
          id: 'parameters',
          label: 'Parameters',
          state: w.parameterWarnings.length ? 'warn' : 'ok',
          details: w.parameterWarnings,
          tab: 'simulation',
        };
  const items = [structure, specimen, parameters];
  const m = w.memory;
  if (m && m.available > 0 && m.needed > 0) {
    const f = m.needed / m.available;
    const gb = (b: number) => `${(b / 1e9).toFixed(b < 1e9 ? 2 : 1)} GB`;
    items.push({
      id: 'memory',
      label: 'Memory',
      // the estimate is rough (within about 2×), so a run is never blocked by it, only warned
      state: f < 0.6 ? 'ok' : 'warn',
      details:
        f < 0.6
          ? []
          : [
              f >= 1
                ? `The run needs about ${gb(m.needed)} but only ${gb(m.available)} is free ${m.where}: it will probably fail. Use a coarser sampling, a smaller scan or fewer frozen phonons.`
                : `The run needs about ${gb(m.needed)} of the ${gb(m.available)} free ${m.where} (${Math.round(f * 100)} %); close the other programs or reduce the run.`,
            ],
      tab: 'simulation',
    });
  }
  return items;
}

/** Ready when nothing fails; warnings are listed but do not stop a run. */
export const isReady = (items: ReadyItem[]): boolean => items.every((i) => i.state !== 'fail');
