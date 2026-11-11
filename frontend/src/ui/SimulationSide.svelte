<script lang="ts" module>
  import type { SimType } from '../api/client';
  import { hasPattern, isProbe, isScan } from '../state/simulation.svelte';

  export type SimTab = 'beam' | 'potential' | 'scan' | 'detectors' | 'series' | 'output';

  /** The sidebar tabs that apply to a simulation type. */
  export function simTabs(t: SimType): { id: SimTab; label: string }[] {
    return [
      { id: 'beam', label: isProbe(t) ? 'Probe' : 'Plane wave' },
      { id: 'potential', label: 'Potential' },
      ...(isScan(t) ? [{ id: 'scan' as const, label: 'Scan' }] : []),
      ...(t === 'stem' ? [{ id: 'detectors' as const, label: 'Detectors' }] : []),
      { id: 'series', label: 'Series' },
      // Only the types that record a pattern have something to set here.
      ...(hasPattern(t) ? [{ id: 'output' as const, label: 'Output' }] : []),
    ];
  }
</script>

<script lang="ts">
  // ③ Simulation, multislice: the sidebar (context.md §7.MU step U4). Only the tabs that apply to
  // the type are offered; every value is a NumberField (exact value and unit), no sliders. The
  // overlays of Scan, Detectors and Output are drawn in the views only while that tab is open, and
  // each tab has a checkbox that switches its overlay off.
  import { postProbeFile } from '../api/client';
  import { downloadBlob, downloadText } from '../export/browser';
  import { clampDetector, detectorPreset, type DetectorPreset } from '../core/plane';
  import { clampFov, fovCells, fovMargin, fovPreset, type FovPreset } from '../core/specimen';
  import {
    MAX_VALUES,
    depthsFor,
    preview as listPreview,
    rangeCount,
    type Range,
  } from '../core/series';
  import {
    hasDefocusSeries,
    hasTiltSeries,
    previewBody,
    seriesValues,
    simulation,
  } from '../state/simulation.svelte';
  import { specimen } from '../state/specimen.svelte';
  import AberrationsTable from './AberrationsTable.svelte';
  import NumberField from './kit/NumberField.svelte';
  import RangeFields from './kit/RangeFields.svelte';
  import ThermalSigmas from './ThermalSigmas.svelte';
  import VoltageSection from './VoltageSection.svelte';

  let { tab }: { tab: SimTab } = $props();

  const p = simulation.ms;
  const pv = $derived(simulation.preview);
  const r = $derived(specimen.result);
  const probe = $derived(isProbe(p.type));

  // ---- probe downloads ---------------------------------------------------------------------------
  let downloadError = $state('');
  async function downloadProbe(fmt: 'npz' | 'csv') {
    const body = previewBody();
    if (!body) return;
    downloadError = '';
    try {
      downloadBlob(await postProbeFile(body, fmt), `probe.${fmt}`);
    } catch (e) {
      downloadError = e instanceof Error ? e.message : String(e);
    }
  }
  function downloadProfile() {
    const prof = pv?.probe_profile;
    if (!prof) return;
    const rows = prof.r.map((x, i) => `${x.toPrecision(6)},${prof.intensity[i].toPrecision(6)}`);
    downloadText(
      [
        `# azimuthally averaged probe intensity (peak = 1); ${p.energy} kV, alpha ${p.alpha} mrad, defocus ${p.defocus} A`,
        `# FWHM ${prof.fwhm?.toFixed(4) ?? 'n/a'} A, 99% of the intensity within ${prof.tail?.toFixed(3) ?? 'n/a'} A`,
        'radius_A,intensity',
        ...rows,
      ].join('\n') + '\n',
      'probe_profile.csv',
      'text/csv',
    );
  }

  // ---- scan ------------------------------------------------------------------------------------
  const probeFwhm = $derived(pv?.probe_profile?.fwhm ?? pv?.probe_fwhm ?? null);
  const tail = $derived(pv?.probe_profile?.tail ?? (pv?.probe_fwhm ? 2 * pv.probe_fwhm : 0));
  const margin = $derived(
    specimen.fov && r ? fovMargin(specimen.fov, [r.box[0], r.box[1]]) : Infinity,
  );
  function preset(name: FovPreset) {
    if (!r) return;
    specimen.fov = fovPreset(name, [r.box[0], r.box[1]], [r.repeat_cell[0], r.repeat_cell[1]]);
  }
  /** Whole repeat cells in the scan window (Scan tab): the image then tiles without a seam. */
  const cells = $state({ x: 2, y: 2 });
  function cellsPreset() {
    if (!r) return;
    specimen.fov = fovCells(
      [r.box[0], r.box[1]],
      [r.repeat_cell[0], r.repeat_cell[1]],
      [cells.x, cells.y],
    );
  }
  const maxCells = $derived(
    r
      ? ([
          Math.max(1, Math.floor(r.box[0] / r.repeat_cell[0] + 1e-6)),
          Math.max(1, Math.floor(r.box[1] / r.repeat_cell[1] + 1e-6)),
        ] as const)
      : ([1, 1] as const),
  );
  /** The scan step in use: the Nyquist step while the field is left at "automatic" (0). */
  const stepShown = $derived(p.scanStep > 0 ? p.scanStep : (pv?.scan_step ?? 0));
  function setStep(v: number) {
    const nyq = pv?.nyquist_step;
    p.scanStep = nyq && Math.abs(v - nyq) < 5e-4 ? 0 : v;
  }
  function setFov(key: 'x0' | 'y0' | 'w' | 'h', v: number) {
    if (!r || !specimen.fov) return;
    specimen.fov = clampFov({ ...specimen.fov, [key]: v }, [r.box[0], r.box[1]]);
  }
  const fovValue = (k: 'x0' | 'y0' | 'w' | 'h') => +(specimen.fov?.[k] ?? 0).toFixed(2);

  // ---- detectors -------------------------------------------------------------------------------
  const PRESETS: DetectorPreset[] = ['BF', 'ABF', 'ADF', 'HAADF'];
  function addDetector(name: DetectorPreset | 'custom') {
    p.detectors.push(
      name === 'custom'
        ? { name: `D${p.detectors.length + 1}`, inner: 30, outer: 60 }
        : detectorPreset(name, p.alpha),
    );
  }
  function setDetector(i: number, key: 'inner' | 'outer', v: number) {
    p.detectors[i] = clampDetector({ ...p.detectors[i], [key]: v });
  }

  // ---- series ----------------------------------------------------------------------------------
  const sv = $derived(seriesValues(p));
  const thick = $derived(r ? r.box[2] : 0);
  const capped = (rg: Range) => rangeCount(rg) > MAX_VALUES;
  /** Ticking the thickness series fits a range that goes past the specimen to its thickness. */
  function fitDepths() {
    const t = p.series.thickness;
    if (t.on && thick > 0 && Math.max(t.start, t.stop) > thick) Object.assign(t, depthsFor(thick));
  }
  const fmtTime = (s: number) =>
    s < 60
      ? `${s.toFixed(s < 10 ? 1 : 0)} s`
      : s < 3600
        ? `${(s / 60).toFixed(1)} min`
        : `${(s / 3600).toFixed(1)} h`;
</script>

<div class="side" data-testid="sim-side">
  {#if tab === 'beam'}
    <section><VoltageSection /></section>
    {#if probe}
      <section>
        <h4>Probe</h4>
        {#if probeFwhm}
          <p class="small" data-testid="probe-fwhm-side">Probe FWHM: {probeFwhm.toFixed(2)} Å</p>
        {/if}
        <NumberField
          label="Convergence semi-angle α"
          bind:value={p.alpha}
          unit="mrad"
          min={0.5}
          max={300}
          step={0.5}
          def={30}
          help="Probe semi-angle. Usual range: up to 40 mrad."
          testid="alpha"
        />
        <NumberField
          label="Defocus"
          bind:value={p.defocus}
          unit="Å"
          min={-1e6}
          max={1e6}
          step={10}
          def={0}
          help="Positive is underfocus (abTEM's defocus, = −C10)."
          testid="defocus"
        />
        {#if Math.abs(p.defocus) >= 1000}
          <p class="muted small">= {(p.defocus / 1e4).toFixed(3)} µm</p>
        {/if}
        {#if sv.defoci.length}
          <p class="muted small">
            A defocus series is on (Series tab): the run uses its {sv.defoci.length} values; the views
            show this defocus.
          </p>
        {/if}
      </section>
      <section><AberrationsTable params={p} /></section>
      <section>
        <h4>Download</h4>
        <div class="row">
          <button
            type="button"
            onclick={() => downloadProbe('npz')}
            disabled={!r}
            title="The probe intensity, sampling and parameters as a NumPy .npz file"
            data-testid="download-probe-npz">Probe (.npz)</button
          >
          <button
            type="button"
            onclick={() => downloadProbe('csv')}
            disabled={!r}
            title="The probe intensity as a comma-separated table (rows = x, columns = y)"
            data-testid="download-probe-csv">Probe (.csv)</button
          >
          <button
            type="button"
            onclick={downloadProfile}
            disabled={!pv?.probe_profile}
            title="The azimuthally averaged intensity against the radius"
            data-testid="download-profile">Probe profile (.csv)</button
          >
        </div>
        {#if downloadError}<p class="notice err" role="alert">✕ {downloadError}</p>{/if}
        <p class="muted small">The probe picture itself is saved with Export on its card.</p>
      </section>
    {:else}
      <section>
        <p class="muted small">
          A plane wave along the zone axis. {p.type === 'hrtem'
            ? 'The objective lens below forms the image (applied to the exit wave in M6).'
            : 'The pattern is recorded up to α max (Potential).'}
        </p>
        {#if p.type === 'hrtem'}
          <NumberField
            label="Objective aperture"
            bind:value={p.aperture}
            unit="mrad"
            min={0}
            max={300}
            step={1}
            def={0}
            help="0 = no aperture"
            testid="aperture"
          />
          <NumberField
            label="Defocus"
            bind:value={p.defocus}
            unit="Å"
            min={-1e5}
            max={1e5}
            step={10}
            def={0}
            testid="defocus"
          />
        {/if}
      </section>
      {#if p.type === 'hrtem'}<section><AberrationsTable params={p} /></section>{/if}
    {/if}
  {:else if tab === 'potential'}
    <NumberField
      label="Potential sampling"
      bind:value={p.sampling}
      unit="Å"
      min={0.005}
      max={1}
      step={0.005}
      def={0.04}
      help="Pixel size of the projected potential. It sets the grid of the wave, and α max = (2/3) λ / (2 × sampling)."
      testid="sampling"
    />
    <NumberField
      label="Slice thickness"
      bind:value={p.slice}
      unit="Å"
      min={0.1}
      max={20}
      step={0.1}
      def={1}
      testid="slice"
    />
    <div class="phonons">
      <label class="check"
        ><input type="checkbox" bind:checked={p.phononsOn} data-testid="phonons-on" /> Frozen phonons</label
      >
      <NumberField
        label="Configurations"
        bind:value={p.phonons}
        min={1}
        max={200}
        step={1}
        def={10}
        disabled={!p.phononsOn}
        help="Configurations averaged. Unchecked: static atoms (one configuration)."
        testid="phonons"
      />
      {#if p.phononsOn}
        <ThermalSigmas />
      {/if}
    </div>
    {#if pv}
      <dl class="facts">
        <dt>Grid</dt>
        <dd>{pv.gpts[0]} × {pv.gpts[1]}</dd>
        <dt>Slices</dt>
        <dd>{pv.n_slices}</dd>
        <dt>α max</dt>
        <dd>{pv.alpha_max_mrad.toFixed(1)} mrad</dd>
        <dt>λ</dt>
        <dd>{(pv.wavelength * 100).toFixed(3)} pm</dd>
      </dl>
    {/if}
  {:else if tab === 'scan'}
    {#if specimen.fov && r}
      <label class="check"
        ><input
          type="checkbox"
          bind:checked={simulation.overlays.scan}
          data-testid="overlay-scan"
        />
        Show the scan area, positions and edge band in Real space</label
      >
      <h4>Field of view</h4>
      <div class="grid2">
        {#each [['x0', 'x₀'], ['y0', 'y₀'], ['w', 'Width'], ['h', 'Height']] as const as [k, label] (k)}
          <NumberField
            {label}
            unit="Å"
            min={0}
            max={Math.max(r.box[0], r.box[1])}
            step={0.5}
            digits={2}
            testid={`fov-${k}`}
            bind:value={() => fovValue(k), (v) => setFov(k, v)}
          />
        {/each}
      </div>
      <div class="row">
        <button type="button" onclick={() => preset('repeat')}>One periodic cell</button>
        <button type="button" onclick={() => preset('centre50')}>Centre 50 %</button>
        <button type="button" onclick={() => preset('whole')}>Whole box</button>
      </div>
      <div class="grid2">
        <NumberField
          label="Cells in x"
          bind:value={cells.x}
          min={1}
          max={maxCells[0]}
          step={1}
          digits={0}
          testid="cells-x"
        />
        <NumberField
          label="Cells in y"
          bind:value={cells.y}
          min={1}
          max={maxCells[1]}
          step={1}
          digits={0}
          testid="cells-y"
        />
      </div>
      <div class="row">
        <button
          type="button"
          onclick={cellsPreset}
          title="A whole number of periodic cells, starting on a cell origin: the image tiles without a seam"
          data-testid="fov-cells">Larger periodic cell</button
        >
        <span class="muted small"
          >The box holds up to {maxCells[0]} × {maxCells[1]} cells of {r.repeat_cell[0].toFixed(2)} ×
          {r.repeat_cell[1].toFixed(2)} Å.</span
        >
      </div>
      {#if tail > 0 && margin < tail}
        <p class="notice warn" data-testid="fov-margin">
          ⚠ The scan area is {Math.max(margin, 0).toFixed(1)} Å from the box edge, less than the probe
          tail ({tail.toFixed(1)} Å, hatched in Real space). The tail wraps round the periodic box.
        </p>
      {/if}
      <p class="muted small">Drag the rectangle or its handles in Real space.</p>
      <h4>Step</h4>
      <NumberField
        label="Scan step"
        bind:value={() => stepShown, setStep}
        unit="Å"
        min={0.001}
        max={10}
        step={0.01}
        digits={3}
        def={pv?.nyquist_step ?? 0.1}
        help="Starts at the Nyquist step λ / (4 α) and follows α until you type a value of your own."
        testid="scan-step"
      />
      {#if pv?.nyquist_step}
        <p class="muted small" data-testid="scan-nyquist">
          {p.scanStep > 0
            ? `${p.scanStep.toFixed(3)} Å = ${(p.scanStep / pv.nyquist_step).toFixed(2)} × Nyquist (${pv.nyquist_step.toFixed(3)} Å)`
            : `Nyquist: ${pv.nyquist_step.toFixed(3)} Å`} · {pv.n_scan.toLocaleString('en')} positions
        </p>
      {/if}
    {:else}
      <p class="muted">Build the supercell first.</p>
    {/if}
  {:else if tab === 'detectors'}
    <label class="check"
      ><input
        type="checkbox"
        bind:checked={simulation.overlays.detectors}
        data-testid="overlay-detectors"
      /> Show the detectors in the diffraction plane</label
    >
    {#each p.detectors as d, i (i)}
      <div class="det" data-testid="detector">
        <div class="det-head">
          <input class="name" bind:value={d.name} aria-label="Detector name" />
          <button
            type="button"
            class="x"
            onclick={() => p.detectors.splice(i, 1)}
            aria-label={`Remove ${d.name}`}>✕</button
          >
        </div>
        <NumberField
          label="Inner"
          unit="mrad"
          min={0}
          max={1000}
          step={1}
          testid={`det-inner-${i}`}
          bind:value={() => d.inner, (v) => setDetector(i, 'inner', v)}
        />
        <NumberField
          label="Outer"
          unit="mrad"
          min={0.5}
          max={1000}
          step={1}
          testid={`det-outer-${i}`}
          bind:value={() => d.outer, (v) => setDetector(i, 'outer', v)}
        />
      </div>
    {/each}
    <div class="row">
      <span class="muted small">Add</span>
      {#each PRESETS as name (name)}
        <button type="button" onclick={() => addDetector(name)} data-testid={`add-${name}`}
          >{name}</button
        >
      {/each}
      <button type="button" onclick={() => addDetector('custom')}>Custom</button>
    </div>
    <p class="muted small">Drag an annulus edge in the diffraction plane to change it.</p>
  {:else if tab === 'series'}
    <p class="muted small">
      Each series is off until its box is ticked. A defocus or tilt series is one run per value; a
      thickness series saves more depths of the same run.
    </p>
    <section>
      <label class="check head"
        ><input
          type="checkbox"
          bind:checked={p.series.thickness.on}
          onchange={fitDepths}
          data-testid="series-thickness-on"
        /> Thickness series</label
      >
      <p class="muted small">
        The exit surface ({thick.toFixed(1)} Å) is always saved; these depths are saved as well.
      </p>
      <RangeFields
        bind:range={p.series.thickness}
        unit="Å"
        testid="series-thickness"
        disabled={!p.series.thickness.on}
        min={0}
        max={1e5}
      />
      {#if p.series.thickness.on}
        <p class="muted small" data-testid="series-thickness-values">
          {sv.thicknesses.length} depths: {listPreview(sv.thicknesses, 'Å')}
        </p>
        {#if sv.thicknesses.some((t) => t > thick + 1e-6)}
          <p class="notice warn">⚠ Some depths are beyond the specimen ({thick.toFixed(1)} Å).</p>
        {/if}
        {#if capped(p.series.thickness)}
          <p class="notice warn">⚠ Only the first {MAX_VALUES} depths are kept.</p>
        {/if}
      {/if}
    </section>
    {#if hasDefocusSeries(p.type)}
      <section>
        <label class="check head"
          ><input
            type="checkbox"
            bind:checked={p.series.defocus.on}
            data-testid="series-defocus-on"
          /> Defocus series</label
        >
        <p class="muted small">
          {p.type === 'hrtem' ? 'A focal series' : 'A through-focus series of the probe'}; replaces
          the defocus of the {probe ? 'Probe' : 'Plane wave'} tab. Positive is underfocus.
        </p>
        <RangeFields
          bind:range={p.series.defocus}
          unit="Å"
          testid="series-defocus"
          disabled={!p.series.defocus.on}
          min={-1e6}
          max={1e6}
        />
        {#if p.series.defocus.on}
          <p class="muted small" data-testid="series-defocus-values">
            {sv.defoci.length} runs: {listPreview(sv.defoci, 'Å')}
          </p>
        {/if}
      </section>
    {/if}
    {#if hasTiltSeries(p.type)}
      <section>
        <label class="check head"
          ><input type="checkbox" bind:checked={p.series.tilt.on} data-testid="series-tilt-on" /> Tilt
          series</label
        >
        <p class="muted small">Tilt of the incident beam from the zone axis, in mrad.</p>
        <span class="seg" role="group" aria-label="Tilt series pattern">
          <button
            type="button"
            aria-pressed={p.series.tilt.mode === 'line'}
            disabled={!p.series.tilt.on}
            onclick={() => (p.series.tilt.mode = 'line')}
            title="From (x from, y from) to (x to, y to) in a straight line"
            data-testid="series-tilt-line">Line</button
          ><button
            type="button"
            aria-pressed={p.series.tilt.mode === 'grid'}
            disabled={!p.series.tilt.on}
            onclick={() => (p.series.tilt.mode = 'grid')}
            title="Every x tilt with every y tilt"
            data-testid="series-tilt-grid">Grid</button
          >
        </span>
        <h5>Tilt x</h5>
        <RangeFields
          bind:range={p.series.tilt.x}
          unit="mrad"
          testid="series-tilt-x"
          disabled={!p.series.tilt.on}
          min={-500}
          max={500}
        />
        <h5>Tilt y</h5>
        <RangeFields
          bind:range={p.series.tilt.y}
          unit="mrad"
          testid="series-tilt-y"
          disabled={!p.series.tilt.on}
          min={-500}
          max={500}
        />
        {#if p.series.tilt.on}
          <p class="muted small" data-testid="series-tilt-values">
            {sv.tilts.length} runs{sv.tilts.length
              ? `: (${sv.tilts[0].join(', ')}) … (${sv.tilts[sv.tilts.length - 1].join(', ')}) mrad`
              : ''}
          </p>
        {/if}
      </section>
    {/if}
    {#if pv}
      <p class="small" data-testid="series-runs">
        <strong>{pv.series.runs}</strong>
        {pv.series.runs === 1 ? 'run' : 'runs'} · {pv.series.saved_depths} saved
        {pv.series.saved_depths === 1 ? 'depth' : 'depths'} each · {fmtTime(pv.memory.seconds)} in all
        (estimate)
      </p>
    {/if}
  {:else if tab === 'output'}
    <section>
      <h4>Pattern</h4>
      {#if hasPattern(p.type)}
        <NumberField
          label="Pattern size"
          bind:value={p.pattern}
          unit="px"
          min={16}
          max={1024}
          step={16}
          def={128}
          testid="pattern"
        />
        <NumberField
          label="Binning"
          bind:value={p.binning}
          unit="×"
          min={1}
          max={64}
          step={1}
          def={1}
          testid="binning"
        />
        {#if pv}
          {@const [dx, dy] = pv.diffraction_pixel_xy}
          {@const bin = pv.binning}
          <dl class="facts" data-testid="diffraction-pixel">
            <dt>Final pattern</dt>
            <dd data-testid="binned-size">{pv.binned_size} × {pv.binned_size} px</dd>
            <dt>Pixel size</dt>
            <dd data-testid="binned-pixel">
              {(dx * bin).toFixed(2)}{Math.abs(dx - dy) > 0.005
                ? ` (x) × ${(dy * bin).toFixed(2)} (y)`
                : ''} mrad
            </dd>
            <dt>Recorded</dt>
            <dd>±{((p.pattern / 2) * Math.min(dx, dy)).toFixed(0)} mrad</dd>
          </dl>
          <p class="muted small">
            Pixel size is set by the supercell size L and the acceleration voltage; the extent α max
            ({pv.alpha_max_mrad.toFixed(0)} mrad) is set by the potential sampling.
          </p>
        {/if}
        <label class="check"
          ><input
            type="checkbox"
            bind:checked={simulation.overlays.crop}
            data-testid="overlay-crop"
          /> Show the recorded region in the diffraction plane</label
        >
      {/if}
    </section>
  {/if}
</div>

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid var(--border);
  }
  section:last-child {
    border-bottom: none;
  }
  .side p,
  h4 {
    margin: 0;
  }
  h4 {
    font-size: 0.85rem;
  }
  .small {
    font-size: 0.8rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.84rem;
  }
  .check.head {
    font-weight: 600;
  }
  h5 {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .phonons {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .grid2 {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.2rem 0.8rem;
    margin: 0;
    font-size: 0.84rem;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .det {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .det-head {
    display: flex;
    gap: 0.4rem;
  }
  .name {
    flex: 1;
    font-weight: 600;
  }
  .x {
    padding: 0 0.5rem;
  }
</style>
