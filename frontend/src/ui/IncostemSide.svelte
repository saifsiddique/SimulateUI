<script lang="ts" module>
  export type IncostemTab = 'probe' | 'detector' | 'image' | 'noise' | 'cross';

  export const INCOSTEM_TABS: { id: IncostemTab; label: string }[] = [
    { id: 'probe', label: 'Probe' },
    { id: 'detector', label: 'Detector' },
    { id: 'image', label: 'Image' },
    { id: 'noise', label: 'Noise' },
    { id: 'cross', label: 'Cross sections' },
  ];
</script>

<script lang="ts">
  // ③ Simulation, INCOSTEM: the sidebar (context.md §7.MU step U6). No sliders. The overlays of the
  // Detector (the ADF annulus) and Image (the field of view) tabs are drawn only while the tab is
  // open, each with a checkbox.
  import { electronsPerPixel, nyquistPixel, pixelFor, pixelsAcross } from '../core/incostem';
  import { clampDetector, detectorPreset } from '../core/plane';
  import { clampFov, fovPreset, type FovPreset } from '../core/specimen';
  import { incostemFov, simulation, wavelength } from '../state/simulation.svelte';
  import { specimen } from '../state/specimen.svelte';
  import AberrationsTable from './AberrationsTable.svelte';
  import NumberField from './kit/NumberField.svelte';
  import VoltageSection from './VoltageSection.svelte';

  let { tab }: { tab: IncostemTab } = $props();

  const i = $derived(simulation.incostem);
  const res = $derived(simulation.incostemResult);
  const r = $derived(specimen.result);
  const lam = $derived(wavelength(simulation.ms.energy));
  const fov = $derived(incostemFov());
  const box = $derived<[number, number] | null>(r ? [r.box[0], r.box[1]] : null);
  const maxSigma = $derived(Math.max(1e-12, ...(res?.sigmas ?? []).map((s) => s.sigma)));
  const total = $derived((res?.sigmas ?? []).reduce((s, e) => s + e.sigma * e.atoms, 0));

  // ---- detector ---------------------------------------------------------------------------------
  function setAdf(key: 'inner' | 'outer', v: number) {
    const d = clampDetector({ name: 'ADF', ...simulation.incostem.adf, [key]: v });
    simulation.incostem.adf = { inner: d.inner, outer: d.outer };
  }
  function adfPreset(name: 'ADF' | 'HAADF') {
    const d = detectorPreset(name, i.alpha);
    simulation.incostem.adf = { inner: Math.round(d.inner), outer: Math.round(d.outer) };
  }

  // ---- image ------------------------------------------------------------------------------------
  function setFov(key: 'x0' | 'y0' | 'w' | 'h', v: number) {
    if (!box || !fov) return;
    simulation.incostem.fov = clampFov({ ...fov, [key]: v }, box);
  }
  const fovValue = (k: 'x0' | 'y0' | 'w' | 'h') => +(fov?.[k] ?? 0).toFixed(2);
  function preset(name: FovPreset) {
    if (!box || !r) return;
    simulation.incostem.fov = fovPreset(name, box, [r.repeat_cell[0], r.repeat_cell[1]]);
  }
  const nx = $derived(fov ? pixelsAcross(fov.w, i.pixel) : 0);
  const ny = $derived(fov ? pixelsAcross(fov.h, i.pixel) : 0);
  const pNyq = $derived(nyquistPixel(lam, i.alpha));
</script>

<div class="side" data-testid="incostem-side">
  {#if tab === 'probe'}
    <section><VoltageSection /></section>
    <section>
      <h4>Probe</h4>
      <NumberField
        label="Convergence semi-angle α"
        bind:value={simulation.incostem.alpha}
        unit="mrad"
        min={0.5}
        max={300}
        step={0.5}
        def={30}
        help="Semi-angle of the probe-forming aperture. The probe intensity cannot be finer than λ / (2 α)."
        testid="inc-alpha"
      />
      <NumberField
        label="Defocus"
        bind:value={simulation.incostem.defocus}
        unit="Å"
        min={-1e5}
        max={1e5}
        step={10}
        def={0}
        help="Positive is underfocus (abTEM's defocus, = −C10)."
        testid="inc-defocus"
      />
      <NumberField
        label="Source size (FWHM)"
        bind:value={simulation.incostem.source}
        unit="Å"
        min={0}
        max={20}
        step={0.05}
        def={0}
        help="The electron source projected on the specimen: a Gaussian that blurs the probe."
        testid="inc-source"
      />
      <NumberField
        label="Defocus spread (FWHM)"
        bind:value={simulation.incostem.dfSpread}
        unit="Å"
        min={0}
        max={2000}
        step={5}
        def={0}
        help="Chromatic aberration: the image is averaged over a Gaussian spread of defocus."
        testid="inc-spread"
      />
    </section>
    <section><AberrationsTable params={simulation.incostem} /></section>
  {:else if tab === 'detector'}
    <label class="check"
      ><input type="checkbox" bind:checked={simulation.overlays.incAdf} data-testid="overlay-adf" />
      Show the ADF annulus in the diffraction plane</label
    >
    <section>
      <h4>ADF detector</h4>
      <NumberField
        label="Inner angle"
        unit="mrad"
        min={0}
        max={3000}
        step={1}
        testid="adf-inner"
        bind:value={() => i.adf.inner, (v) => setAdf('inner', v)}
      />
      <NumberField
        label="Outer angle"
        unit="mrad"
        min={0.5}
        max={3000}
        step={1}
        testid="adf-outer"
        bind:value={() => i.adf.outer, (v) => setAdf('outer', v)}
      />
      <div class="row">
        <span class="muted small">Preset</span>
        <button type="button" onclick={() => adfPreset('ADF')} data-testid="adf-preset-ADF"
          >ADF</button
        ><button type="button" onclick={() => adfPreset('HAADF')} data-testid="adf-preset-HAADF"
          >HAADF</button
        >
      </div>
      <p class="muted small">Drag an edge of the annulus in the diffraction plane to change it.</p>
    </section>
    <section>
      <h4>Atomic potential</h4>
      <label class="col"
        >Parametrization of the atoms
        <select bind:value={simulation.incostem.parametrization} data-testid="parametrization">
          <option value="kirkland">Kirkland (the book's, the original INCOSTEM)</option>
          <option value="lobato">Lobato</option>
        </select></label
      >
      <p class="muted small">
        The partial cross section of each element is the integral of its scattering amplitude over
        the annulus (Cross sections tab).
      </p>
    </section>
  {:else if tab === 'image'}
    {#if fov && box}
      <label class="check"
        ><input
          type="checkbox"
          bind:checked={simulation.overlays.incFov}
          data-testid="overlay-incfov"
        />
        Show the field of view in the image view</label
      >
      <section>
        <h4>Field of view</h4>
        <div class="grid2">
          {#each [['x0', 'x₀'], ['y0', 'y₀'], ['w', 'Width'], ['h', 'Height']] as const as [k, label] (k)}
            <NumberField
              {label}
              unit="Å"
              min={0}
              max={Math.max(box[0], box[1])}
              step={0.5}
              digits={2}
              testid={`inc-fov-${k}`}
              bind:value={() => fovValue(k), (v) => setFov(k, v)}
            />
          {/each}
        </div>
        <div class="row">
          <button type="button" onclick={() => preset('whole')} data-testid="inc-fov-whole"
            >Whole box</button
          >
          <button type="button" onclick={() => preset('centre50')}>Centre 50 %</button>
          <button type="button" onclick={() => preset('repeat')}>One periodic cell</button>
        </div>
        <p class="muted small">
          The specimen is periodic: the box is {box[0].toFixed(1)} × {box[1].toFixed(1)} Å. Drag the rectangle
          in the image view to look elsewhere.
        </p>
      </section>
      <section>
        <h4>Pixels</h4>
        <NumberField
          label="Pixel size"
          bind:value={simulation.incostem.pixel}
          unit="Å"
          min={0.01}
          max={2}
          step={0.01}
          def={0.1}
          help="The box is divided into a whole number of pixels, so the pixel size is adjusted slightly."
          testid="inc-pixel"
        />
        <NumberField
          label="Pixels across"
          min={2}
          max={4096}
          step={16}
          testid="inc-nx"
          bind:value={
            () => nx, (v) => (simulation.incostem.pixel = +pixelFor(fov.w, v).toPrecision(5))
          }
        />
        <p class="muted small" data-testid="inc-pixels">
          {nx} × {ny} pixels{res ? ` (the whole box: ${res.grid[0]} × ${res.grid[1]})` : ''}
        </p>
        {#if i.pixel > pNyq * 1.001}
          <p class="notice warn" data-testid="inc-nyquist">
            ⚠ The pixel is coarser than λ / (4 α) = {pNyq.toFixed(3)} Å: the probe intensity is under-sampled.
          </p>
        {:else}
          <p class="muted small">
            The probe intensity is sampled (λ / (4 α) = {pNyq.toFixed(3)} Å).
          </p>
        {/if}
      </section>
    {:else}
      <p class="muted">Build the supercell first.</p>
    {/if}
  {:else if tab === 'noise'}
    <section>
      <label class="check"
        ><input type="checkbox" bind:checked={simulation.incostem.noiseOn} data-testid="noise-on" />
        Add electron counting noise</label
      >
      <p class="muted small">
        Each pixel becomes a Poisson count: its fraction of the beam times the electrons per pixel
        (probe current × dwell time).
      </p>
      <NumberField
        label="Probe current"
        bind:value={simulation.incostem.current}
        unit="pA"
        min={0.001}
        max={1e5}
        step={1}
        def={20}
        disabled={!i.noiseOn}
        testid="noise-current"
      />
      <NumberField
        label="Dwell time"
        bind:value={simulation.incostem.dwell}
        unit="µs"
        min={0.001}
        max={1e6}
        step={1}
        def={10}
        disabled={!i.noiseOn}
        testid="noise-dwell"
      />
      <NumberField
        label="Random seed"
        bind:value={simulation.incostem.seed}
        min={0}
        max={1e9}
        step={1}
        def={1}
        disabled={!i.noiseOn}
        help="The same seed gives the same noise."
        testid="noise-seed"
      />
      {#if res}
        <p class="muted small" data-testid="noise-dose">
          {electronsPerPixel(res.mean, i.current, i.dwell).toFixed(2)} detected electrons per pixel on
          average; {(i.current * i.dwell * 6.24146).toFixed(0)} electrons in each probe position.
        </p>
      {/if}
    </section>
  {:else}
    <section>
      <h4>Partial cross sections</h4>
      <p class="muted small">
        σ of one atom for the ADF annulus {i.adf.inner}–{i.adf.outer} mrad at {simulation.ms.energy} kV
        ({i.parametrization === 'kirkland' ? 'Kirkland' : 'Lobato'}). The image is the sum of the
        atoms weighted by σ, each blurred by the point-spread function.
      </p>
      {#if res}
        <table class="sig" data-testid="cross-sections">
          <thead><tr><th>Element</th><th>σ (Å²)</th><th></th><th>Atoms</th></tr></thead>
          <tbody>
            {#each res.sigmas as s (s.symbol)}
              <tr data-testid={`cross-${s.symbol}`}>
                <td>{s.symbol} <span class="muted">Z = {s.z}</span></td>
                <td class="num">{s.sigma.toPrecision(4)}</td>
                <td class="barcell"
                  ><span class="bar" style:width={`${(100 * s.sigma) / maxSigma}%`}></span></td
                >
                <td class="num">{s.atoms}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="muted small" data-testid="cross-total">
          Total Σ σ over the {res.n_atoms} atoms: {total.toFixed(4)} Å². The mean of the image is that
          over the area of the box.
        </p>
      {:else}
        <p class="muted small">Waiting for the first image…</p>
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
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.84rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.84rem;
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
  .sig {
    border-collapse: collapse;
    font-size: 0.84rem;
    width: 100%;
  }
  .sig th {
    text-align: left;
    font-weight: 600;
    color: var(--muted);
    padding: 0 0.5rem 0.25rem 0;
  }
  .sig td {
    padding: 0.2rem 0.5rem 0.2rem 0;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .barcell {
    width: 40%;
  }
  .bar {
    display: block;
    height: 0.6rem;
    border-radius: 3px;
    background: var(--accent);
    min-width: 2px;
  }
</style>
