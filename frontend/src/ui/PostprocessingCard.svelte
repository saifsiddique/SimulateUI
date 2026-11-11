<script lang="ts">
  // ④ Postprocessing (context.md M6.5): what the detector does to the result, applied after the
  // simulation to the selected run: the target pixel size (Fourier interpolation), a Gaussian blur,
  // the dose and shot noise. The ideal result is never changed; the processed one is saved beside
  // it, and the Results viewer switches between them. Apply shows the processed result at once;
  // Reset removes every postprocessing of the run.
  import { jobs } from '../state/jobs.svelte';
  import {
    applyOutput,
    jobSim,
    output,
    outputMode,
    outputSettings,
    resetOutput,
    targetOf,
  } from '../state/output.svelte';
  import { simulation } from '../state/simulation.svelte';
  import NumberField from './kit/NumberField.svelte';

  const job = $derived(jobs.current);
  /** The type the fields are for: the selected run's, else the one chosen in ③. */
  const sim = $derived(
    job
      ? jobSim(job)
      : simulation.method === 'incostem'
        ? 'incostem'
        : simulation.method === 'bloch'
          ? simulation.bloch.type
          : simulation.ms.type,
  );
  const mode = $derived(outputMode(sim));
  const settings = $derived(outputSettings(mode));
  const done = $derived(job?.state === 'done');
  const first = $derived(job?.results.find((x) => x.pixel_mrad || x.pixel) ?? null);
  /** The native pixel of the unit (Å for images, mrad for patterns), x and y. */
  const native = $derived.by(() => {
    const p = mode.unit === 'mrad' ? first?.pixel_mrad : first?.pixel;
    return p && p.length === 2 ? p : null;
  });
  /** The real-space native pixel (Å): what a dose per position or per area refers to. */
  const real = $derived.by(() => {
    const p = mode.dose === 'pattern' ? null : mode.unit === 'Å' ? first?.pixel : first?.scan_pixel;
    return p && p.length === 2 ? p : null;
  });
  const fmt = (v: number) => +v.toPrecision(3);
  const pair = (p: number[]) =>
    `${fmt(p[0])}${Math.abs(p[0] - p[1]) > 1e-6 ? ` × ${fmt(p[1])}` : ''}`;

  // The target field shows the native pixel until it is changed; a value equal to the native one
  // means "native" again.
  const target = $derived(targetOf(mode));
  const shown = $derived(target ?? native?.[0] ?? 0);
  function setTarget(v: number) {
    // the box shows 4 decimals, so a value that reads the same as the native one is the native one
    const same =
      native && (v.toFixed(4) === native[0].toFixed(4) || Math.abs(v / native[0] - 1) < 1e-5);
    if (mode.unit === 'Å') output.targetA = same ? null : v;
    else output.targetMrad = same ? null : v;
  }

  /** The equivalent of the dose in the other unit, for the native pixel. */
  const equivalent = $derived.by(() => {
    if (!real) return null;
    const area = real[0] * real[1];
    if (mode.dose === 'area') return `= ${fmt(output.dosePerArea * area)} e⁻ per native pixel`;
    if (mode.dose === 'scan')
      return `= ${fmt(output.electronsPerPosition / area)} e⁻/Å² (native pixel ${pair(real)} Å)`;
    return null;
  });
  const processed = $derived(job?.results.find((r) => r.processed)?.processed ?? null);

  // Another run has another native pixel and its own processing.
  let lastId = '';
  $effect(() => {
    const id = jobs.current?.id ?? '';
    if (id === lastId) return;
    lastId = id;
    output.targetA = output.targetMrad = null;
    output.view = 'native';
    output.error = '';
  });
</script>

<section class="card post" data-testid="postprocessing-card">
  <h2>Postprocessing</h2>
  <p class="muted small" data-testid="post-target">
    {#if job}
      Applied after the simulation, to the selected run: {job.name}.
    {:else}
      Applied after the simulation, to the selected run. Start a run or pick an earlier one.
    {/if}
  </p>

  <div class="block">
    <h3>Target pixel size</h3>
    <NumberField
      label="Target"
      bind:value={() => shown, setTarget}
      unit={mode.unit}
      min={0.001}
      max={100}
      step={mode.unit === 'Å' ? 0.01 : 0.1}
      digits={4}
      def={native?.[0]}
      disabled={!native}
      help={mode.unit === 'Å'
        ? 'Real-space pixel of the saved image. The field of view is kept.'
        : 'Diffraction pixel of the saved pattern. The recorded angle is kept.'}
      testid="target-pixel"
    />
    {#if native}
      <p class="muted small" data-testid="native-pixel">
        {#if Math.abs(native[0] - native[1]) > 1e-6}
          Native pixel size (x × y): {fmt(native[0])}
          {mode.unit} × {fmt(native[1])}
          {mode.unit}.
        {:else}
          Native pixel size: {fmt(native[0])}
          {mode.unit}.
        {/if}{target === null ? ' (unchanged)' : ''}
      </p>
      {#if Math.abs(native[0] - native[1]) > 1e-6}
        <p class="muted small" data-testid="native-pixel-xy">
          Target pixel makes both x and y same.
        </p>
      {/if}
    {:else}
      <p class="muted small" data-testid="native-pixel">
        The native pixel size shows here once a run is selected.
      </p>
    {/if}
    {#if sim === 'saed' && target !== null && native && target < Math.min(native[0], native[1])}
      <p class="notice warn" data-testid="saed-interpolation-warning">
        ⚠ SAED spots are about one pixel wide. Interpolating to a finer pixel spreads them into
        streaks along x and y (sinc tails, clearly visible on a log scale). A coarser pixel, or the
        native one, is safer.
      </p>
    {/if}
    <p class="muted small">
      Fourier interpolation: a finer pixel is a smooth resampling, a coarser one a reduction;
      neither adds information.
      {mode.unit === 'mrad' ? 'Sharp spots ring a little when interpolated finer.' : ''}
    </p>
  </div>

  <div class="block">
    <h3>Gaussian smoothing</h3>
    <NumberField
      label="σ"
      bind:value={output.smoothing}
      unit={mode.unit}
      min={0}
      max={1000}
      step={mode.unit === 'Å' ? 0.05 : 0.1}
      def={0}
      help="Standard deviation of a Gaussian blur, applied after the pixel size and before the noise. 0 = off."
      testid="smoothing"
    />
  </div>

  <div class="block">
    <h3>Dose and noise</h3>
    <label class="check"
      ><input type="checkbox" bind:checked={output.doseOn} data-testid="dose-on" /> Dose</label
    >
    {#if mode.dose === 'area'}
      <NumberField
        label="Dose"
        bind:value={output.dosePerArea}
        unit="e⁻/Å²"
        min={0.001}
        max={1e8}
        step={10}
        def={100}
        disabled={!output.doseOn}
        testid="dose-area"
      />
    {:else if mode.dose === 'scan'}
      <NumberField
        label="Dose"
        bind:value={output.electronsPerPosition}
        unit="e⁻ per scan position"
        min={0.001}
        max={1e12}
        step={100}
        def={1000}
        disabled={!output.doseOn}
        help="The electrons of the probe at each scan position."
        testid="dose-electrons-input"
      />
    {:else}
      <NumberField
        label="Dose"
        bind:value={output.electronsPerPattern}
        unit="e⁻ per pattern"
        min={0.001}
        max={1e15}
        step={1000}
        def={1e6}
        disabled={!output.doseOn}
        help="The electrons in the whole pattern."
        testid="dose-electrons-input"
      />
    {/if}
    <p class="muted small" data-testid="dose-electrons">
      {#if equivalent}{equivalent}{:else if mode.dose !== 'pattern'}The equivalent in e⁻/Å² shows
        once a run is selected.{/if}
    </p>
    <label class="check"
      ><input
        type="checkbox"
        bind:checked={output.noiseOn}
        disabled={!output.doseOn}
        data-testid="noise-on"
      /> Shot noise (Poisson)</label
    >
    <div class="pair">
      <NumberField
        label="Noise samples"
        bind:value={output.samples}
        min={1}
        max={100}
        step={1}
        def={1}
        disabled={!output.doseOn || !output.noiseOn}
        help="Independent noisy copies of the result, for statistics."
        testid="noise-samples"
      />
      <NumberField
        label="Seed"
        bind:value={output.seed}
        min={0}
        max={2147483647}
        step={1}
        def={0}
        disabled={!output.doseOn || !output.noiseOn}
        help="The same seed gives the same noise."
        testid="noise-seed"
      />
    </div>
  </div>

  <div class="actions">
    <button
      type="button"
      class="primary"
      disabled={!done || output.applying}
      title={done ? 'Process the saved results of this run and show them' : 'Needs a finished run'}
      onclick={() => applyOutput(settings)}
      data-testid="output-apply">{output.applying ? 'Applying…' : 'Apply to this run'}</button
    >
    <button
      type="button"
      disabled={output.applying}
      title="Back to the default settings, and remove every postprocessing of this run"
      onclick={() => resetOutput()}
      data-testid="output-reset">Reset</button
    >
  </div>
  {#if output.error}<p class="err" role="alert" data-testid="output-error">✕ {output.error}</p>{/if}
  {#if processed}
    <p class="muted small" data-testid="output-done">
      Processed{processed.pixel
        ? `: pixel ${fmt(processed.pixel[0])} ${processed.unit}`
        : ''}{processed.electrons !== null
        ? `, ${fmt(processed.electrons)} e⁻`
        : ''}{processed.samples > 1 ? `, ${processed.samples} noise samples` : ''}. The ideal result
      is kept; see the toggle in the Results viewer.
    </p>
  {/if}
  {#if job?.state === 'done' && job.results.some((r) => r.processed_note)}
    <p class="muted small">
      {job.results.find((r) => r.processed_note)?.processed_note}
    </p>
  {/if}
</section>

<style>
  .post {
    padding: 1.2rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-h);
  }
  h3 {
    margin: 0;
    font-size: 0.85rem;
  }
  p {
    margin: 0;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid var(--border);
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.8rem;
  }
  .pair {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.84rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
  }
  .err {
    color: var(--err);
  }
</style>
