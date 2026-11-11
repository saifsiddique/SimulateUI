// The postprocessing settings of ④ (context.md M6.5): the pixel size by Fourier interpolation, a
// Gaussian blur, the dose and shot noise. They are applied after the simulation, to the selected
// run's saved results, so changing them never needs a new simulation.
import { postDetector, resetDetector, type DetectorSettings, type Job } from '../api/client';
import { jobs, refreshJobs } from './jobs.svelte';

export const output = $state({
  /** Target pixel size: Å for images, mrad for diffraction patterns. null = the native pixel. */
  targetA: null as number | null,
  targetMrad: null as number | null,
  /** Gaussian blur σ, in the unit of the pixel size. */
  smoothing: 0,
  doseOn: false,
  /** HRTEM: electrons per Å². */
  dosePerArea: 100,
  /** STEM, 4D-STEM, INCOSTEM: electrons per scan position. */
  electronsPerPosition: 1000,
  /** SAED, CBED: electrons in the pattern. */
  electronsPerPattern: 1e6,
  noiseOn: false,
  samples: 1,
  seed: 0,
  /** What the Results viewer shows. */
  view: 'native' as 'native' | 'processed',
  applying: false,
  error: '',
});

export type DoseKind = 'area' | 'scan' | 'pattern';
export interface OutputMode {
  dose: DoseKind;
  unit: 'Å' | 'mrad';
}

/** The dose and the pixel unit of a simulation type (`sim` is the job's type, or INCOSTEM's). */
export function outputMode(sim: string | null | undefined): OutputMode {
  if (sim === 'hrtem') return { dose: 'area', unit: 'Å' };
  if (sim === 'stem' || sim === 'incostem') return { dose: 'scan', unit: 'Å' };
  if (sim === '4dstem') return { dose: 'scan', unit: 'mrad' };
  return { dose: 'pattern', unit: 'mrad' };
}

/** The type of a job as the output settings see it (INCOSTEM has no type of its own). */
export const jobSim = (j: Job | null): string | null =>
  !j ? null : j.method === 'incostem' ? 'incostem' : j.sim_type;

/** The target pixel size of the unit, or null for the native pixel. */
export const targetOf = (m: OutputMode) => (m.unit === 'Å' ? output.targetA : output.targetMrad);

export function outputSettings(m: OutputMode): DetectorSettings {
  const target = targetOf(m);
  const dose = !output.doseOn
    ? null
    : m.dose === 'area'
      ? { dose_per_area: output.dosePerArea }
      : {
          electrons: m.dose === 'scan' ? output.electronsPerPosition : output.electronsPerPattern,
        };
  return {
    pixel_mode: target === null ? 'native' : 'target',
    target: target ?? 1,
    smoothing: output.smoothing,
    dose,
    noise: output.doseOn && output.noiseOn,
    samples: output.samples,
    seed: output.seed,
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Apply the settings to the selected, finished run, and show the result. */
export async function applyOutput(settings: DetectorSettings): Promise<void> {
  const j = jobs.current;
  if (!j || j.state !== 'done' || output.applying) return;
  output.applying = true;
  output.error = '';
  try {
    const updated = await postDetector(j.id, settings);
    if (jobs.current?.id === updated.id) {
      jobs.current = updated;
      output.view = 'processed';
    }
    void refreshJobs();
  } catch (e) {
    output.error = message(e);
  } finally {
    output.applying = false;
  }
}

/** Back to the defaults, and remove every processed file of the selected run. */
export async function resetOutput(): Promise<void> {
  output.targetA = output.targetMrad = null;
  output.smoothing = 0;
  output.doseOn = false;
  output.noiseOn = false;
  output.samples = 1;
  output.seed = 0;
  output.view = 'native';
  output.error = '';
  const j = jobs.current;
  if (!j || j.state !== 'done' || !j.results.some((r) => r.processed)) return;
  output.applying = true;
  try {
    const updated = await resetDetector(j.id);
    if (jobs.current?.id === updated.id) jobs.current = updated;
    void refreshJobs();
  } catch (e) {
    output.error = message(e);
  } finally {
    output.applying = false;
  }
}
