// Project state for the structure steps (context.md M2): the structure registered with the backend
// and its orthogonal cell. Later modules add the specimen, method and run parameters here.
import {
  ApiError,
  postOrthogonalize,
  postStructure,
  type OrthogonalizeResponse,
  type StructureResponse,
} from '../api/client';
import { buildCrystal, type Crystal } from '../core/crystal';
import { orthogonalCifStructure, type StructurePayload } from '../core/payload';

export type OrthoMode = 'auto' | 'manual';
export type ViewWhich = 'original' | 'orthogonal';

export const project = $state<{
  /** Registration with the backend: the structure the simulations will use. */
  registration: {
    status: 'idle' | 'pending' | 'ok' | 'error';
    response: StructureResponse | null;
    error: string | null;
  };
  ortho: {
    mode: OrthoMode;
    maxRepetitions: number;
    strainTolerance: number;
    status: 'idle' | 'pending' | 'ok' | 'error';
    result: OrthogonalizeResponse | null;
    error: string | null;
  };
  view: ViewWhich;
}>({
  registration: { status: 'idle', response: null, error: null },
  ortho: {
    mode: 'auto',
    maxRepetitions: 5,
    strainTolerance: 0.01,
    status: 'idle',
    result: null,
    error: null,
  },
  view: 'original',
});

let payload: StructurePayload | null = null;
let registerSeq = 0;
let orthoSeq = 0;

export function resetProject(): void {
  registerSeq++;
  orthoSeq++;
  payload = null;
  project.registration = { status: 'idle', response: null, error: null };
  project.ortho.status = 'idle';
  project.ortho.result = null;
  project.ortho.error = null;
  project.view = 'original';
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Send the loaded structure to the backend, then compute its orthogonal cell. */
export async function registerStructure(p: StructurePayload): Promise<void> {
  resetProject();
  payload = p;
  const seq = ++registerSeq;
  project.registration.status = 'pending';
  try {
    const response = await postStructure(p);
    if (seq !== registerSeq) return;
    project.registration = { status: 'ok', response, error: null };
  } catch (e) {
    if (seq !== registerSeq) return;
    project.registration = { status: 'error', response: null, error: message(e) };
    return;
  }
  await runOrthogonalize();
}

/** (Re)compute the orthogonal cell with the current settings. */
export async function runOrthogonalize(): Promise<void> {
  const reg = project.registration.response;
  if (!reg) return;
  const seq = ++orthoSeq;
  const o = project.ortho;
  o.status = 'pending';
  o.error = null;
  const body = () => ({
    structureId: project.registration.response!.structureId,
    maxRepetitions: o.mode === 'manual' ? o.maxRepetitions : null,
    strainTolerance: o.strainTolerance,
  });
  try {
    let result: OrthogonalizeResponse;
    try {
      result = await postOrthogonalize(body());
    } catch (e) {
      // The backend forgot the structure (it restarted): register it again once and retry.
      if (!(e instanceof ApiError && e.code === 'unknown_structure') || !payload) throw e;
      const response = await postStructure(payload);
      project.registration = { status: 'ok', response, error: null };
      result = await postOrthogonalize(body());
    }
    if (seq !== orthoSeq) return;
    o.result = result;
    o.status = 'ok';
  } catch (e) {
    if (seq !== orthoSeq) return;
    o.result = null;
    o.status = 'error';
    o.error = message(e);
    if (project.view === 'orthogonal') project.view = 'original';
  }
}

/** The orthogonal cell as a viewable `Crystal` (P1, 90/90/90), or null. */
export function orthogonalCrystal(name: string): Crystal | null {
  const r = project.ortho.result;
  if (!r) return null;
  try {
    return buildCrystal(
      orthogonalCifStructure(`${name} (orthogonal)`, r) as Parameters<typeof buildCrystal>[0],
    ).crystal;
  } catch {
    return null;
  }
}
