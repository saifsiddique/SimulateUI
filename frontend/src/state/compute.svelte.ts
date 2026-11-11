// Shared compute state (context.md M1): what the backend reported and what the user chose.
import { getSystem, type SystemReport } from '../api/client';

export type DeviceChoice = 'gpu' | 'cpu-parallel' | 'cpu-single';

export const compute = $state<{
  report: SystemReport | null;
  error: string | null;
  loading: boolean;
  choice: DeviceChoice;
  workers: number;
}>({ report: null, error: null, loading: false, choice: 'cpu-parallel', workers: 1 });

/** The `compute` block of SimulationProject (context.md 5.4). */
export function projectCompute(): { device: 'gpu' | 'cpu'; workers: number } {
  if (compute.choice === 'gpu') return { device: 'gpu', workers: 1 };
  return { device: 'cpu', workers: compute.choice === 'cpu-single' ? 1 : compute.workers };
}

export async function loadSystem(refresh = false): Promise<void> {
  compute.loading = true;
  compute.error = null;
  try {
    const r = await getSystem(refresh);
    compute.report = r;
    if (r.recommended.device === 'gpu') compute.choice = 'gpu';
    else compute.choice = 'cpu-parallel';
    compute.workers = r.recommended.workers;
  } catch (e) {
    compute.error = e instanceof Error ? e.message : String(e);
  } finally {
    compute.loading = false;
  }
}
