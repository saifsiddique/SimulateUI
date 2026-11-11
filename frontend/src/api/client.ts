/** Typed client for the Python backend (context.md section 2). */
import type { Factors } from '../core/bloch';
import type { StructurePayload } from '../core/payload';

export interface CpuInfo {
  physical_cores: number;
  logical_cores: number;
  ram_total: number;
  ram_available: number;
}

export interface GpuDevice {
  index: number;
  name: string;
  memory_total: number;
  memory_free: number;
  compute_capability: string;
}

export interface SmokeTest {
  ok: boolean;
  seconds?: number;
  error?: string | null;
  abtem?: string;
}

export interface GpuInfo {
  cupy_installed: boolean;
  cupy_version: string | null;
  available: boolean;
  reason: string | null;
  cuda_runtime: number | null;
  cuda_driver: number | null;
  devices: GpuDevice[];
  abtem_smoke_test: SmokeTest | null;
}

export interface PlatformInfo {
  /** 'Windows' | 'macOS' | 'Linux' (or another platform.system() name). */
  system: string;
  release: string;
  machine: string;
  python: string;
  apple_silicon: boolean;
}

export interface SystemReport {
  platform: PlatformInfo;
  cpu: CpuInfo;
  gpu: GpuInfo;
  gpu_usable: boolean;
  recommended: { device: 'gpu' | 'cpu'; workers: number; reason: string };
}

export interface EstimateRequest {
  gpts: [number, number];
  n_slices: number;
  frozen_phonons?: number;
  scan_positions?: number;
  detector_shape?: [number, number] | null;
  n_detectors?: number;
  save_exit_wave?: boolean;
  device: 'gpu' | 'cpu';
  workers: number;
  batch?: number | null;
}

export interface EstimateResponse {
  wave_bytes: number;
  batch: number;
  peak_bytes: number;
  total_peak_bytes: number;
  output_bytes: number;
  seconds: number;
  note: string;
}

// ---- structure (M2) ---------------------------------------------------------------------------

export interface StructureSummary {
  natoms: number;
  formula: string;
  cell: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
  volume: number;
  density: number;
  orthogonal: boolean;
  partial_sites: number;
}

export interface StructureResponse {
  structureId: string;
  summary: StructureSummary;
  warnings: string[];
}

export interface OrthogonalizeRequest {
  structureId: string;
  /** abTEM `max_repetitions`; omit for the automatic choice. */
  maxRepetitions?: number | null;
  strainTolerance?: number;
  maxAtoms?: number;
}

export interface StrainInfo {
  principal: [number, number, number];
  max_abs: number;
  rotation_deg: number;
  volume_change: number;
}

export interface OrthogonalAtom {
  element: string;
  frac: [number, number, number];
  occupancy: number;
  uiso: number | null;
  source: number;
}

export interface OrthogonalizeResponse {
  structureId: string;
  already_orthogonal: boolean;
  max_repetitions: number;
  volume_ratio: number;
  cell: [number, number, number];
  natoms: number;
  strain: StrainInfo;
  atoms: OrthogonalAtom[];
  candidates: { max_repetitions: number; natoms: number; strain: number }[];
  warnings: string[];
}

// ---- specimen (M3) ----------------------------------------------------------------------------

export type CenterMode = 'cell' | 'atom' | 'origin';
export type OccupancyPolicy = 'dominant' | 'random' | 'keep';
export type Triple<T> = [T, T, T];

export interface SpecimenRequest {
  structureId: string;
  zoneAxis: Triple<number>;
  yDirection?: Triple<number> | null;
  center?: CenterMode;
  lateral?: [number, number];
  thickness?: number;
  repeats?: [number, number, number] | null;
  vacuum?: [number, number];
  strainTolerance?: number;
  maxRepeatAtoms?: number;
  maxLength?: number;
  maxAtoms?: number;
  occupancy?: OccupancyPolicy;
  seed?: number;
  method?: 'search' | 'abtem';
  abtemRepetitions?: number;
  supercell?: Triple<Triple<number>> | null;
  compareAbtem?: boolean;
}

export interface SpecimenCandidate {
  supercell: Triple<Triple<number>>;
  natoms: number;
  strain: number;
  repeat_cell: Triple<number>;
}

export interface SpecimenResponse {
  specimenId: string;
  structureId: string;
  zone_axis: Triple<number>;
  rotation: Triple<Triple<number>>;
  method: string;
  supercell: Triple<Triple<number>> | null;
  repeat_cell: Triple<number>;
  natoms_repeat: number;
  strain: { max_abs: number; principal: number[]; within_tolerance: boolean };
  repeats: Triple<number>;
  crystal_extent: Triple<number>;
  box: Triple<number>;
  vacuum: [number, number];
  natoms: number;
  symbols: string[];
  species: number[];
  positions: number[];
  uiso: (number | null)[] | null;
  box_corners_crystal: Triple<number>[];
  centre_crystal: Triple<number>;
  centre_point_crystal: Triple<number>;
  beam_crystal: Triple<number>;
  candidates: SpecimenCandidate[];
  abtem:
    | {
        max_repetitions: number;
        natoms?: number;
        strain?: number;
        zone_axis_tilt_deg?: number;
        error?: string;
      }[]
    | null;
  warnings: string[];
}

export type SimType = 'hrtem' | 'saed' | 'cbed' | 'stem' | '4dstem';

export interface AbtemDetector {
  name: string;
  inner: number;
  outer: number | null;
}

export interface AbtemPreview {
  wavelength: number;
  gpts: [number, number];
  sampling: number;
  n_slices: number;
  alpha_max_mrad: number;
  nyquist_step: number | null;
  scan_step: number;
  n_scan: number;
  diffraction_pixel_mrad: number;
  /** λ / L along x and y (mrad): set by the box and the voltage, not the potential sampling. */
  diffraction_pixel_xy: [number, number];
  bf_disk_pixels: number | null;
  probe_fwhm: number | null;
  pattern_size: number;
  binning: number;
  binned_size: number;
  memory: EstimateResponse;
  /** PNGs in the down-the-beam orientation (+x left, +y up). */
  images: { potential?: string; probe?: string };
  /** Width and height of each picture in Å (the potential covers the box from (0, 0)). */
  extents: { potential?: [number, number]; probe?: [number, number] };
  /** Kinematic zero-order-zone reflections [qx, qy, I] in 1/Å; the direct beam first. */
  discs: [number, number, number][];
  probe_profile: {
    r: number[];
    intensity: number[];
    fwhm: number | null;
    tail: number | null;
  } | null;
  warnings: string[];
  /** Runs (defoci × tilts) and saved outputs per run (thickness series + the exit surface). */
  series: { runs: number; saved_depths: number; defoci: number; tilts: number };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      const d = body?.detail;
      if (d && typeof d === 'object' && 'message' in d) {
        message = String(d.message);
        code = d.code;
      } else if (typeof d === 'string') message = d;
      else if (Array.isArray(d)) message = d.map((x) => x.msg ?? JSON.stringify(x)).join('; ');
    } catch {
      /* keep the status line */
    }
    throw new ApiError(message, code);
  }
  return (await res.json()) as T;
}

const post = <T>(url: string, body: unknown) =>
  request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const getSystem = (refresh = false) =>
  request<SystemReport>(`/api/system${refresh ? '?refresh=true' : ''}`);

export const postEstimate = (body: EstimateRequest) =>
  post<EstimateResponse>('/api/estimate', body);

export const postStructure = (payload: StructurePayload) =>
  post<StructureResponse>('/api/structure', payload);

export const postOrthogonalize = (body: OrthogonalizeRequest) =>
  post<OrthogonalizeResponse>('/api/structure/orthogonalize', body);

export const postSpecimen = (body: SpecimenRequest) =>
  post<SpecimenResponse>('/api/specimen/build', body);

export const postAbtemPreview = (body: Record<string, unknown>) =>
  post<AbtemPreview>('/api/abtem/preview', body);

export interface BlochBeam {
  hkl: [number, number, number];
  q: [number, number];
  g: number;
  sg: number;
  kinematic: number;
}

export interface BlochPreview {
  n_beams: number;
  k_max: number;
  sg_max: number;
  wavelength: number;
  n_tilts: number;
  /** Radius of the condenser disc in pattern pixels (the run's rounding of alpha). */
  disc_radius_px: number;
  /** Processes that share the incident directions (never more than there are directions). */
  workers: number;
  seconds: number;
  /** Size of the saved solve that lets a change of thickness skip the eigen-solve. */
  cache_bytes: number;
  cache_limit_bytes: number;
  cache_fits: boolean;
  warnings: string[];
  thicknesses: number[];
  beams: BlochBeam[];
}

export const postBlochPreview = (body: Record<string, unknown>) =>
  post<BlochPreview>('/api/bloch/preview', body);

export const postBlochFactors = (body: Record<string, unknown>) =>
  post<Factors>('/api/bloch/factors', body);

// ---- INCOSTEM (MU step U6) ----------------------------------------------------------------------

export interface IncostemSigma {
  symbol: string;
  z: number;
  /** Partial cross section of one atom for the detector, Å². */
  sigma: number;
  atoms: number;
}

export interface IncostemResult {
  wavelength: number;
  /** Pixels of the image (the field of view) and of the whole periodic box. */
  shape: [number, number];
  grid: [number, number];
  /** Pixel size (Å) in x and y. */
  pixel: [number, number];
  /** The field really imaged, [x0, y0, w, h] in Å, and the box. */
  fov: [number, number, number, number];
  box: [number, number];
  extent: [number, number];
  /** float32 little endian, [x][y] row-major: the fraction of the beam on the detector per pixel. */
  image: string;
  png: string;
  vmin: number;
  vmax: number;
  mean: number;
  sigmas: IncostemSigma[];
  psf: {
    png: string;
    extent: [number, number];
    profile: { r: number[]; intensity: number[]; fwhm: number | null; tail: number | null } | null;
  };
  thickness: number;
  n_atoms: number;
  /** Electrons per unit of the image when noise is on. */
  counts_scale: number | null;
  noisy: boolean;
  warnings: string[];
  seconds: number;
}

export const postIncostem = (body: Record<string, unknown>) =>
  post<IncostemResult>('/api/incostem', body);

export interface BlochCacheInfo {
  /** A solve is saved in the temporary folder. */
  saved: boolean;
  bytes: number;
  directory: string;
}

export const getBlochCache = () => request<BlochCacheInfo>('/api/bloch/cache');

/** Delete the saved solve (the temporary file). */
export const deleteBlochCache = () =>
  request<BlochCacheInfo>('/api/bloch/cache', { method: 'DELETE' });

export const getHealth = () =>
  request<{ status: string; versions: Record<string, string | null> }>('/api/health');

/** The probe intensity as a data file (`npz` or `csv`) for the preview's parameters. */
export async function postProbeFile(
  body: Record<string, unknown>,
  fmt: 'npz' | 'csv',
): Promise<Blob> {
  const res = await fetch(`/api/abtem/probe?fmt=${fmt}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const d = (await res.json())?.detail;
      if (d && typeof d === 'object' && 'message' in d) message = String(d.message);
    } catch {
      /* keep the status line */
    }
    throw new ApiError(message);
  }
  return res.blob();
}

// ---- Jobs (context.md M6) ---------------------------------------------------------------------

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobResult {
  name: string;
  kind: string;
  file: string;
  preview: string;
  shape?: number[];
  depths?: number[];
  runs?: string[];
  bytes: number;
  /** A line about the files (for example which beam the picture shows). */
  note?: string;
  sim_type?: string;
  pixel?: number[];
  pixel_mrad?: number[];
  /** 4D-STEM: the real-space (scan) pixel in Å. */
  scan_pixel?: number[];
  /** 4D-STEM: the convergence semiangle, the first virtual detector's size. */
  semiangle_mrad?: number;
  axes?: string[];
  /** LACBED: how many beams, and the range of each index. */
  beams?: number;
  ranges?: Beams['ranges'];
  unit?: string;
  /** What the detector settings made of this result (M6.5); null when it is not processed. */
  processed?: ProcessedResult | null;
  processed_note?: string;
}

export interface ProcessedResult {
  file: string;
  noisy: string | null;
  preview: string;
  shape: number[];
  /** The pixel size reached, in `unit` (Å for images, mrad for patterns). */
  pixel: number[] | null;
  unit: string;
  electrons: number | null;
  /** When it was written: added to the picture's address so a new picture is fetched. */
  stamp: number;
  samples: number;
  counts_max: number | null;
}

/** The detector settings sent to `POST /api/jobs/{id}/detector` (models/jobs.py). */
export interface DetectorSettings {
  pixel_mode: 'native' | 'target';
  target: number;
  smoothing: number;
  dose: { dose_per_area?: number; electrons?: number } | null;
  noise: boolean;
  samples: number;
  seed: number;
}

export interface Job {
  id: string;
  name: string;
  project: string;
  method: 'multislice' | 'bloch' | 'incostem';
  sim_type: string | null;
  state: JobState;
  fraction: number;
  message: string;
  created: number;
  started: number | null;
  finished: number | null;
  elapsed: number;
  eta: number | null;
  error: string | null;
  directory: string;
  results: JobResult[];
  device: string;
  queue_position: number | null;
}

export const postJob = (body: {
  method: Job['method'];
  body: Record<string, unknown>;
  project: string;
  name: string;
}) => post<Job>('/api/jobs', body);

export const getJobs = () => request<Job[]>('/api/jobs');
export const getJob = (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`);
export const cancelJob = (id: string) =>
  request<Job>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const removeJob = (id: string) =>
  request<{ removed: boolean }>(`/api/jobs/${encodeURIComponent(id)}?remove=true`, {
    method: 'DELETE',
  });
/** Show the job's folder in the file manager of the computer the server runs on. */
export const openJobFolder = (id: string, exports = false) =>
  post<{ directory: string }>(
    `/api/jobs/${encodeURIComponent(id)}/open${exports ? '?exports=true' : ''}`,
    {},
  );
/** Apply the detector settings to a finished job; the ideal results stay as they are. */
export const postDetector = (id: string, settings: DetectorSettings) =>
  post<Job>(`/api/jobs/${encodeURIComponent(id)}/detector`, settings);
/** Remove every processed file of a finished job (the ideal results stay). */
export const resetDetector = (id: string) =>
  request<Job>(`/api/jobs/${encodeURIComponent(id)}/detector`, { method: 'DELETE' });
/** `v` is added to the address of a file that can be written again (a processed picture). */
export const jobFileUrl = (id: string, name: string, v?: number) =>
  `/api/jobs/${encodeURIComponent(id)}/files/${name}${v ? `?v=${v}` : ''}`;

// ---- the results viewer (context.md M7) ----------------------------------------------------------

/** One 2D frame: float32 numbers, row 0 at the top, +y up. The backend sends the numbers as raw
 *  bytes and the rest in an `X-Frame` header. */
export interface Frame {
  shape: [number, number];
  pixel: number[] | null;
  unit: string;
  min: number;
  max: number;
  values: Float32Array;
  /** 4D-STEM pattern: the clicked pixel of the real-space picture (null = the mean pattern). */
  position?: [number, number] | null;
  scan_shape?: [number, number];
  /** LACBED: the indices of the disc shown. */
  hkl?: number[];
  label?: string;
  pixels_in_detector?: number;
}

/** A frame from its description (the `X-Frame` header) and its bytes (float32, little endian). */
export function parseFrame(header: string, bytes: ArrayBuffer): Frame {
  const meta = JSON.parse(header);
  return { ...meta, values: new Float32Array(bytes) };
}

export interface SpotsReply {
  hkl: number[][];
  qxy: number[][];
  intensity: number[];
  depth: number | null;
  unit: string;
}

/** Which array of a result to look at. `source` is the ideal simulation or the postprocessed one. */
export interface FrameQuery {
  result: string;
  source?: 'native' | 'processed';
  run?: number;
  depth?: number;
  sample?: number;
  /** The stamp of the processed result: a new one is a new request (the backend ignores it). */
  v?: number;
  /** An exit wave: 'phase' | 'amplitude' | 'intensity'. */
  part?: string;
  /** LACBED: the indices of the disc. */
  h?: number;
  k?: number;
  l?: number;
}

export interface VirtualQuery extends FrameQuery {
  shape: 'disk' | 'annulus';
  inner: number;
  outer: number;
}

export interface PatternQuery extends FrameQuery {
  row?: number;
  col?: number;
}

function query(q: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) s.set(k, String(v));
  return s.toString();
}

const jobUrl = (id: string, what: string, q: object) =>
  `/api/jobs/${encodeURIComponent(id)}/${what}?${query(q)}`;

/** The address of a frame (also what the viewer shows as its source, and what a test can read). */
export const frameUrl = (id: string, q: FrameQuery) => jobUrl(id, 'frame', q);

// Frames already fetched, newest last, so that a slider moved back is instant. A frame of a
// processed result has the stamp in its address, so a rewritten file is a new entry.
const cache = new Map<string, Frame>();
const CACHE_BYTES = 128e6;
function remember(url: string, f: Frame): void {
  cache.set(url, f);
  let total = 0;
  for (const v of cache.values()) total += v.values.byteLength;
  for (const k of cache.keys()) {
    if (total <= CACHE_BYTES || cache.size <= 1) break;
    total -= cache.get(k)!.values.byteLength;
    cache.delete(k);
  }
}

async function fetchFrame(url: string, signal?: AbortSignal): Promise<Frame> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url); // most recent last
    cache.set(url, hit);
    return hit;
  }
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const d = (await res.json())?.detail;
      if (d && typeof d === 'object' && 'message' in d) message = String(d.message);
    } catch {
      /* keep the status line */
    }
    throw new ApiError(message);
  }
  const f = parseFrame(res.headers.get('X-Frame') ?? '{}', await res.arrayBuffer());
  remember(url, f);
  return f;
}

export const getFrame = (id: string, q: FrameQuery, signal?: AbortSignal) =>
  fetchFrame(frameUrl(id, q), signal);
export const getPattern = (id: string, q: PatternQuery, signal?: AbortSignal) =>
  fetchFrame(jobUrl(id, 'pattern', q), signal);
export const getVirtual = (id: string, q: VirtualQuery, signal?: AbortSignal) =>
  fetchFrame(jobUrl(id, 'virtual', q), signal);
export interface Beams {
  hkl: number[][];
  ranges: { h: [number, number]; k: [number, number]; l: [number, number] };
}
/** LACBED: every beam that has a disc, and the range of h, k and l. */
export const getBeams = (id: string, q: FrameQuery) => request<Beams>(jobUrl(id, 'beams', q));
export const getSpots = (id: string, q: FrameQuery) => request<SpotsReply>(jobUrl(id, 'spots', q));

export interface SavedExport {
  path: string;
  name: string;
  folder: string;
}
/** Save an export in the run's `Exports` folder: `tiff` and `npy` are the frame, `h5` the whole result. */
export const postExport = (id: string, q: FrameQuery & { format: 'tiff' | 'npy' | 'h5' }) =>
  request<SavedExport>(jobUrl(id, 'export', q), { method: 'POST' });
/** Save the PNG the browser drew in the run's `Exports` folder. */
export const postExportPng = (id: string, name: string, png: Blob) =>
  request<SavedExport>(jobUrl(id, 'export-png', { name }), { method: 'POST', body: png });

/** Follow a job over its WebSocket; calls back with every update. Returns a function that stops. */
export function followJob(id: string, onUpdate: (job: Job) => void, onEnd: () => void): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    if (stopped) return;
    try {
      const job = await getJob(id);
      onUpdate(job);
      if (job.state === 'queued' || job.state === 'running') timer = setTimeout(poll, 500);
      else onEnd();
    } catch {
      timer = setTimeout(poll, 1500);
    }
  };
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/api/jobs/${encodeURIComponent(id)}`);
    let ended = false;
    socket.onmessage = (e) => {
      const job = JSON.parse(e.data) as Job;
      if (!job.id) return;
      onUpdate(job);
      if (job.state !== 'queued' && job.state !== 'running') {
        ended = true;
        onEnd();
      }
    };
    socket.onerror = () => {
      socket = null;
      void poll();
    };
    socket.onclose = () => {
      if (!ended && !stopped && socket) void poll();
    };
  } catch {
    void poll();
  }
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
