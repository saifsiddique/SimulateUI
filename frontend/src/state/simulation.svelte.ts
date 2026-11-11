// ③ Simulation state (context.md §7.MU step U4): the method, the type and the multislice parameters,
// shared by the ribbon, the views and the sidebar, and the latest preview from the backend. The
// preview is a description of the run (sampling, angles, pictures); it never starts a simulation.
import {
  postAbtemPreview,
  postBlochFactors,
  postBlochPreview,
  postIncostem,
  type AbtemPreview,
  type BlochPreview,
  type IncostemResult,
  type SimType,
} from '../api/client';
import { aberrationRequest, zeroAberrations } from '../core/aberrations';
import type { Factors } from '../core/bloch';
import { detectorPreset, type Detector } from '../core/plane';
import { rangeValues, tiltPairs, type Range, type TiltMode } from '../core/series';
import { defaultSigmas, effectiveSigmas, type ElementSigma } from '../core/thermal';
import { fovMargin, type Fov } from '../core/specimen';
import { compute, projectCompute } from './compute.svelte';
import { project } from './project.svelte';
import { specimen } from './specimen.svelte';

export type Method = 'multislice' | 'bloch' | 'incostem';

export const SIM_TYPES: { id: SimType; label: string }[] = [
  { id: 'hrtem', label: 'HRTEM' },
  { id: 'saed', label: 'SAED' },
  { id: 'cbed', label: 'CBED' },
  { id: 'stem', label: 'STEM' },
  { id: '4dstem', label: '4D-STEM' },
];

export const KV_PRESETS = [60, 80, 120, 200, 300] as const;

export const isProbe = (t: SimType) => t === 'cbed' || t === 'stem' || t === '4dstem';
export const isScan = (t: SimType) => t === 'stem' || t === '4dstem';
export const hasPattern = (t: SimType) => t === 'cbed' || t === '4dstem';

/** The Series tab: a thickness series (saved depths, Å), a defocus series (Å) and a tilt series (mrad). */
export interface Series {
  thickness: { on: boolean } & Range;
  defocus: { on: boolean } & Range;
  tilt: { on: boolean; x: Range; y: Range; mode: TiltMode };
}

export interface MultisliceParams {
  type: SimType;
  energy: number;
  sampling: number;
  slice: number;
  alpha: number;
  /** Å; positive is underfocus (abTEM's `defocus`, = -C10). */
  defocus: number;
  /** Aberration coefficients by abTEM name: magnitudes in Å, angles (phi..) in degrees. */
  ab: Record<string, number>;
  /** HRTEM objective aperture in mrad; 0 = none. */
  aperture: number;
  /** Å; 0 = the Nyquist step. */
  scanStep: number;
  pattern: number;
  /** Pattern pixels summed into one (1 = none). */
  binning: number;
  /** Frozen phonon configurations, used only when `phononsOn`. */
  phonons: number;
  phononsOn: boolean;
  series: Series;
  detectors: Detector[];
}

export const defaultMultislice = (): MultisliceParams => ({
  type: 'stem',
  energy: 300,
  sampling: 0.04,
  slice: 1,
  alpha: 30,
  defocus: 0,
  ab: zeroAberrations(),
  aperture: 0,
  scanStep: 0,
  pattern: 128,
  binning: 1,
  phonons: 10,
  phononsOn: false,
  series: {
    thickness: { on: false, start: 50, stop: 200, step: 50 },
    defocus: { on: false, start: -100, stop: 100, step: 50 },
    tilt: {
      on: false,
      x: { start: 0, stop: 10, step: 2 },
      y: { start: 0, stop: 0, step: 0 },
      mode: 'line',
    },
  },
  detectors: [detectorPreset('BF', 30), detectorPreset('HAADF', 30)],
});

export type BlochType = 'saed' | 'cbed' | 'lacbed';

export const BLOCH_TYPES: { id: BlochType; label: string }[] = [
  { id: 'saed', label: 'SAED' },
  { id: 'cbed', label: 'CBED' },
  { id: 'lacbed', label: 'LACBED' },
];

/** Bloch-wave parameters. The acceleration voltage is shared with the multislice (`ms.energy`). */
export interface BlochParams {
  type: BlochType;
  /** Condenser semi-angle in mrad (CBED, LACBED). */
  alpha: number;
  /** Largest |g| kept, 1/Å. */
  kMax: number;
  /** Largest excitation error kept, 1/Å. */
  sgMax: number;
  /** Pattern pixel in 1/Å (CBED, LACBED). */
  pixel: number;
  /** The crystal thickness (Å). */
  thickness: number;
  /** A thickness series (Å) in place of the single thickness, used only when `on`. */
  series: { on: boolean } & Range;
  /** Debye-Waller damping with the element sigmas (`simulation.sigmas`), used only when on. */
  thermalOn: boolean;
}

export const defaultBloch = (): BlochParams => ({
  type: 'saed',
  alpha: 5,
  kMax: 2,
  sgMax: 0.02,
  pixel: 0.02,
  thickness: 200,
  series: { on: false, start: 100, stop: 400, step: 100 },
  thermalOn: false,
});

/** The depths (Å) a Bloch run reports: the series when it is on, else the one thickness. */
export const blochDepths = (b: BlochParams): number[] =>
  b.series.on ? rangeValues(b.series).filter((x) => x > 0) : b.thickness > 0 ? [b.thickness] : [];

/** INCOSTEM: the incoherent ADF-STEM image of a thin specimen. The voltage is shared (`ms.energy`). */
export interface IncostemParams {
  /** Convergence semi-angle, mrad. */
  alpha: number;
  /** Å, positive is underfocus. */
  defocus: number;
  /** Aberration coefficients by abTEM name (magnitudes Å, angles degrees), as the multislice. */
  ab: Record<string, number>;
  /** Gaussian source and defocus spread, FWHM in Å. */
  source: number;
  dfSpread: number;
  /** The ADF annulus, mrad. */
  adf: { inner: number; outer: number };
  parametrization: 'kirkland' | 'lobato';
  /** Pixel size of the image, Å. */
  pixel: number;
  /** The field of view in Å; null = the whole box. */
  fov: Fov | null;
  noiseOn: boolean;
  /** Probe current (pA), dwell time (µs), random seed. */
  current: number;
  dwell: number;
  seed: number;
}

export const defaultIncostem = (): IncostemParams => ({
  alpha: 30,
  defocus: 0,
  ab: zeroAberrations(),
  source: 0,
  dfSpread: 0,
  adf: { inner: 80, outer: 200 },
  parametrization: 'kirkland',
  pixel: 0.1,
  fov: null,
  noiseOn: false,
  current: 20,
  dwell: 10,
  seed: 1,
});

export const simulation = $state<{
  method: Method;
  ms: MultisliceParams;
  bloch: BlochParams;
  incostem: IncostemParams;
  /** Thermal sigma (Å) typed by the user, by element; an element not here uses its default. */
  sigmas: Record<string, number>;
  /** Overlays that can be switched off; each is drawn only while its sidebar tab is open. */
  overlays: {
    scan: boolean;
    crop: boolean;
    detectors: boolean;
    /** INCOSTEM: the field of view (Image tab) and the ADF annulus (Detector tab). */
    incFov: boolean;
    incAdf: boolean;
  };
  preview: AbtemPreview | null;
  pending: boolean;
  error: string;
  /** Bloch wave: the run's beam count and time, and the kinematic structure factors of the zone. */
  blochPreview: BlochPreview | null;
  factors: Factors | null;
  blochPending: boolean;
  blochError: string;
  incostemResult: IncostemResult | null;
  incostemPending: boolean;
  incostemError: string;
}>({
  method: 'multislice',
  ms: defaultMultislice(),
  bloch: defaultBloch(),
  incostem: defaultIncostem(),
  sigmas: {},
  overlays: { scan: true, crop: true, detectors: true, incFov: true, incAdf: true },
  preview: null,
  pending: false,
  error: '',
  blochPreview: null,
  factors: null,
  blochPending: false,
  blochError: '',
  incostemResult: null,
  incostemPending: false,
  incostemError: '',
});

/** Relativistic wavelength in Å (the same formula as abTEM's energy2wavelength). */
export function wavelength(kv: number): number {
  const h = 6.62607015e-34;
  const m = 9.1093837015e-31;
  const e = 1.602176634e-19;
  const c = 299792458;
  const E = kv * 1e3 * e;
  return (h / Math.sqrt(2 * m * E * (1 + E / (2 * m * c * c)))) * 1e10;
}

/** Default σ of every element of the specimen (√Uiso of the CIF), for the thermal table. */
export function sigmaDefaults(): ElementSigma[] {
  const r = specimen.result;
  return r ? defaultSigmas(r.symbols, r.species, r.uiso) : [];
}

/** σ (Å) by element, as the backend takes it. */
export const currentSigmas = (): Record<string, number> =>
  effectiveSigmas(sigmaDefaults(), simulation.sigmas);

/** Defocus series: every type but SAED (defocus does not change a parallel-beam pattern). */
export const hasDefocusSeries = (t: SimType) => t !== 'saed';
/** Tilt series: the diffraction types. */
export const hasTiltSeries = (t: SimType) => t === 'saed' || t === 'cbed';

/** The values of each series that is switched on and applies to the type (empty otherwise). */
export function seriesValues(p: MultisliceParams): {
  thicknesses: number[];
  defoci: number[];
  tilts: [number, number][];
} {
  const s = p.series;
  return {
    thicknesses: s.thickness.on ? rangeValues(s.thickness).filter((t) => t > 0) : [],
    defoci: s.defocus.on && hasDefocusSeries(p.type) ? rangeValues(s.defocus) : [],
    tilts: s.tilt.on && hasTiltSeries(p.type) ? tiltPairs(s.tilt.x, s.tilt.y, s.tilt.mode) : [],
  };
}

/** The request body for /api/abtem/preview, or null without a specimen. */
export function previewBody(): Record<string, unknown> | null {
  const r = specimen.result;
  if (!r) return null;
  const p = simulation.ms;
  const fov = specimen.fov;
  const series = seriesValues(p);
  return {
    specimenId: r.specimenId,
    sim_type: p.type,
    energy_kv: p.energy,
    sampling: p.sampling,
    slice_thickness: p.slice,
    semiangle_mrad: p.alpha,
    defocus: p.defocus,
    aberrations: aberrationRequest(p.ab),
    objective_aperture_mrad: p.type === 'hrtem' && p.aperture > 0 ? p.aperture : null,
    scan_step: p.scanStep > 0 ? p.scanStep : null,
    scan_fov: fov ? [fov.x0, fov.y0, fov.w, fov.h] : null,
    fov_margin: fov && isScan(p.type) ? fovMargin(fov, [r.box[0], r.box[1]]) : null,
    pattern_size: p.pattern,
    binning: p.binning,
    phonons: p.phononsOn ? p.phonons : 1,
    phonon_sigmas: p.phononsOn ? currentSigmas() : {},
    thicknesses: series.thicknesses,
    defocus_series: series.defoci,
    tilt_series: series.tilts,
    detectors: p.type === 'stem' ? p.detectors.map((d) => ({ ...d })) : [],
    ...projectCompute(),
  };
}

let seq = 0;

export async function fetchPreview(body: Record<string, unknown>): Promise<void> {
  const mine = ++seq;
  simulation.pending = true;
  try {
    const out = await postAbtemPreview(body);
    if (mine !== seq) return;
    simulation.preview = out;
    simulation.error = '';
  } catch (e) {
    if (mine !== seq) return;
    simulation.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === seq) simulation.pending = false;
  }
}

// ---- Bloch wave ---------------------------------------------------------------------------------

/** Where a Bloch run looks along: the registered crystal and the zone axis chosen in ②. */
const blochTarget = () => {
  const id = project.registration.response?.structureId;
  return id ? { structureId: id, zoneAxis: [...specimen.params.zoneAxis] } : null;
};

/** The request of /api/bloch/preview, or null without a structure. */
export function blochBody(): Record<string, unknown> | null {
  const t = blochTarget();
  if (!t) return null;
  const b = simulation.bloch;
  return {
    ...t,
    energy_kv: simulation.ms.energy,
    k_max: b.kMax,
    sg_max: b.sgMax,
    sim_type: b.type,
    alpha_mrad: b.type === 'saed' ? 0 : b.alpha,
    pixel_size: b.pixel,
    thermal_sigma: b.thermalOn ? currentSigmas() : null,
    // the thickness is not here: it does not change the solve, so changing it asks for nothing
    workers: compute.choice === 'cpu-single' ? 1 : Math.max(1, compute.workers),
  };
}

/** The request of /api/bloch/factors: it does not depend on k max, |s_g| max or the angle. */
export function factorsBody(): Record<string, unknown> | null {
  const t = blochTarget();
  if (!t) return null;
  const b = simulation.bloch;
  return {
    ...t,
    energy_kv: simulation.ms.energy,
    thermal_sigma: b.thermalOn ? currentSigmas() : null,
  };
}

let blochSeq = 0;
let factorsSeq = 0;

export async function fetchBloch(body: Record<string, unknown>): Promise<void> {
  const mine = ++blochSeq;
  simulation.blochPending = true;
  try {
    const out = await postBlochPreview(body);
    if (mine !== blochSeq) return;
    simulation.blochPreview = out;
    simulation.blochError = '';
  } catch (e) {
    if (mine !== blochSeq) return;
    simulation.blochError = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === blochSeq) simulation.blochPending = false;
  }
}

export async function fetchFactors(body: Record<string, unknown>): Promise<void> {
  const mine = ++factorsSeq;
  try {
    const out = await postBlochFactors(body);
    if (mine !== factorsSeq) return;
    simulation.factors = out;
    simulation.blochError = '';
  } catch (e) {
    if (mine !== factorsSeq) return;
    simulation.blochError = e instanceof Error ? e.message : String(e);
  }
}

// ---- INCOSTEM -----------------------------------------------------------------------------------

/** The field of view in use: the user's, else the whole box. */
export function incostemFov(): Fov | null {
  const r = specimen.result;
  if (!r) return null;
  return simulation.incostem.fov ?? { x0: 0, y0: 0, w: r.box[0], h: r.box[1] };
}

/** The request of /api/incostem, or null without a specimen. */
export function incostemBody(): Record<string, unknown> | null {
  const r = specimen.result;
  const fov = incostemFov();
  if (!r || !fov) return null;
  const i = simulation.incostem;
  return {
    specimenId: r.specimenId,
    energy_kv: simulation.ms.energy,
    semiangle_mrad: i.alpha,
    defocus: i.defocus,
    aberrations: aberrationRequest(i.ab),
    source_fwhm: i.source,
    defocus_spread_fwhm: i.dfSpread,
    adf_min_mrad: i.adf.inner,
    adf_max_mrad: i.adf.outer,
    parametrization: i.parametrization,
    pixel_size: i.pixel,
    fov: [fov.x0, fov.y0, fov.w, fov.h],
    noise: i.noiseOn
      ? { current_pa: i.current, dwell_us: i.dwell, seed: Math.round(i.seed) }
      : null,
    device: 'cpu',
  };
}

let incSeq = 0;

export async function fetchIncostem(body: Record<string, unknown>): Promise<void> {
  const mine = ++incSeq;
  simulation.incostemPending = true;
  try {
    const out = await postIncostem(body);
    if (mine !== incSeq) return;
    simulation.incostemResult = out;
    simulation.incostemError = '';
  } catch (e) {
    if (mine !== incSeq) return;
    simulation.incostemError = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === incSeq) simulation.incostemPending = false;
  }
}

/** Forget every preview and result (another structure is shown), and ignore the ones on the way. */
export function clearSimulationResults(): void {
  seq++;
  blochSeq++;
  factorsSeq++;
  incSeq++;
  simulation.preview = null;
  simulation.blochPreview = null;
  simulation.factors = null;
  simulation.incostemResult = null;
  simulation.pending = false;
  simulation.blochPending = false;
  simulation.incostemPending = false;
  simulation.error = '';
  simulation.blochError = '';
  simulation.incostemError = '';
}

/** How the chosen method's parameters stand: its last preview's warnings, or its error. */
export function parameterState(): {
  warnings: string[] | null;
  error: string;
  pending: boolean;
} {
  const m = simulation.method;
  if (m === 'bloch')
    return {
      warnings: simulation.blochPreview?.warnings ?? null,
      error: simulation.blochError,
      pending: simulation.blochPending,
    };
  if (m === 'incostem')
    return {
      warnings: simulation.incostemResult?.warnings ?? null,
      error: simulation.incostemError,
      pending: simulation.incostemPending,
    };
  return {
    warnings: simulation.preview?.warnings ?? null,
    error: simulation.error,
    pending: simulation.pending,
  };
}
