<script lang="ts" module>
  import type { BlochType } from '../state/simulation.svelte';

  export type BlochTab = 'beam' | 'specimen' | 'output';

  /** The sidebar tabs of a Bloch-wave type (the pattern pixel only matters for a convergent beam). */
  export function blochTabs(t: BlochType): { id: BlochTab; label: string }[] {
    return [
      { id: 'beam', label: 'Beam' },
      { id: 'specimen', label: 'Specimen' },
      ...(t === 'saed' ? [] : [{ id: 'output' as const, label: 'Output' }]),
    ];
  }
</script>

<script lang="ts">
  // ③ Simulation, Bloch wave: the sidebar (context.md §7.MU step U5). No sliders: every value is a
  // NumberField. k max is set here, by dragging in either view, or from the share of the kinematic
  // intensity the structure-factor plot shows. The thickness is not part of the solve (it only sets
  // the phases of the Bloch modes), so changing it alone is cheap: see Compute in ④.
  import {
    cumulative,
    discAlpha,
    fractionWithin,
    kMaxForFraction,
    countIncluded,
  } from '../core/bloch';
  import { MAX_VALUES, preview as listPreview, rangeCount } from '../core/series';
  import { blochDepths, simulation, wavelength } from '../state/simulation.svelte';
  import NumberField from './kit/NumberField.svelte';
  import RangeFields from './kit/RangeFields.svelte';
  import ThermalSigmas from './ThermalSigmas.svelte';
  import VoltageSection from './VoltageSection.svelte';

  let { tab }: { tab: BlochTab } = $props();

  const b = $derived(simulation.bloch);
  const pv = $derived(simulation.blochPreview);
  const f = $derived(simulation.factors);
  const lam = $derived(wavelength(simulation.ms.energy));
  const conv = $derived(b.type !== 'saed');
  const alpha = $derived(conv ? discAlpha(b.alpha, b.pixel, lam) : 0);
  const cum = $derived(f ? cumulative(f.refl, b.sgMax, alpha) : null);
  const share = $derived(cum ? fractionWithin(cum, b.kMax) : 0);
  const kept = $derived(f ? countIncluded(f.refl, b.kMax, b.sgMax, alpha) : 0);
  const depths = $derived(blochDepths(b));
  const alphaCap = $derived(b.type === 'lacbed' ? 60 : 40);
  const pixelMrad = $derived(b.pixel * lam * 1e3);

  function forShare(p: number) {
    if (cum && f) {
      const k = kMaxForFraction(cum, p, f.g_max);
      if (k !== null) simulation.bloch.kMax = k;
    }
  }
</script>

<div class="side" data-testid="bloch-side">
  {#if tab === 'beam'}
    <section><VoltageSection /></section>
    {#if conv}
      <section>
        <h4>Probe</h4>
        <NumberField
          label="Convergence semi-angle α"
          bind:value={simulation.bloch.alpha}
          unit="mrad"
          min={0.5}
          max={100}
          step={0.5}
          def={5}
          help="Radius of the condenser disc. Every direction in it is one Bloch solve. Usual range: up to 40 mrad, up to 60 for LACBED."
          testid="bloch-alpha"
        />
        {#if b.alpha > alphaCap}
          <p class="notice warn" data-testid="bloch-alpha-warning">
            ⚠ α = {b.alpha} mrad is above the usual {alphaCap} mrad for {b.type.toUpperCase()}.
          </p>
        {/if}
        {#if pv}
          <p class="muted small">
            {pv.n_tilts.toLocaleString('en')} incident directions at the pattern pixel size ({b.pixel}
            Å⁻¹).
          </p>
        {/if}
      </section>
    {:else}
      <section>
        <p class="muted small">A plane wave along the zone axis.</p>
      </section>
    {/if}
    <section>
      <h4>Beams</h4>
      <NumberField
        label="k max"
        bind:value={simulation.bloch.kMax}
        unit="Å⁻¹"
        min={0.2}
        max={5}
        step={0.05}
        def={2}
        help="Largest |g| kept. Drag the circle in Reciprocal space, or the line in the structure-factor plot."
        testid="k-max"
      />
      <p class="muted small" data-testid="kmax-mrad">
        = {(b.kMax * lam * 1e3).toFixed(1)} mrad at this voltage
      </p>
      <div class="row">
        <span class="muted small">k max for</span>
        <span class="seg" role="group" aria-label="Set k max from the kinematic intensity">
          {#each [0.9, 0.99, 0.999] as p (p)}
            <button
              type="button"
              disabled={!cum}
              onclick={() => forShare(p)}
              title={`The smallest k max that keeps ${p * 100} % of the kinematic intensity`}
              data-testid={`side-kmax-pct-${Math.round(p * 1000)}`}
              >{+(p * 100).toFixed(1)} %</button
            >
          {/each}
        </span>
      </div>
      <NumberField
        label="|s_g| max"
        bind:value={simulation.bloch.sgMax}
        unit="Å⁻¹"
        min={0.002}
        max={0.1}
        step={0.002}
        def={0.02}
        help="Largest excitation error kept: a reflection further off the Ewald sphere, for every direction of the beam, is dropped."
        testid="sg-max"
      />
      {#if f}
        <dl class="facts" data-testid="bloch-beams-facts">
          <dt>Reflections kept</dt>
          <dd data-testid="bloch-kept">{kept}</dd>
          <dt>Kinematic intensity inside</dt>
          <dd>{(share * 100).toFixed(1)} %</dd>
          <dt>Reflections listed</dt>
          <dd>{f.n}{f.truncated ? ' (strongest)' : ''}</dd>
        </dl>
      {/if}
      <p class="muted small">
        The structure-factor plot is kinematic (abTEM's Lobato factors for this zone axis): it ranks
        the reflections, it does not say how strong they are dynamically. Forbidden reflections gain
        intensity only in the dynamical solve.
      </p>
    </section>
  {:else if tab === 'specimen'}
    <section>
      <h4>Thickness</h4>
      <NumberField
        label="Thickness"
        bind:value={simulation.bloch.thickness}
        unit="Å"
        min={1}
        max={1e5}
        step={10}
        def={200}
        disabled={b.series.on}
        help="Thickness of the crystal. Changing only this does not need a new solve."
        testid="bloch-thickness"
      />
      <label class="check"
        ><input
          type="checkbox"
          bind:checked={simulation.bloch.series.on}
          data-testid="bloch-series-on"
        />
        Thickness series</label
      >
      <p class="muted small">
        A list of thicknesses in place of the single one: one result for each.
      </p>
      <RangeFields
        bind:range={simulation.bloch.series}
        unit="Å"
        testid="bloch-series"
        disabled={!b.series.on}
        min={0}
        max={1e5}
      />
      <p class="muted small" data-testid="bloch-depths">
        {depths.length}
        {depths.length === 1 ? 'depth' : 'depths'}: {listPreview(depths, 'Å')}
      </p>
      {#if b.series.on && rangeCount(b.series) > MAX_VALUES}
        <p class="notice warn">⚠ Only the first {MAX_VALUES} depths are kept.</p>
      {/if}
      <p class="muted small">
        The thickness only sets the phases of the Bloch modes, so a second run that changes nothing
        else reads the saved solve back (Compute in ④).
      </p>
    </section>
    <section>
      <label class="check"
        ><input
          type="checkbox"
          bind:checked={simulation.bloch.thermalOn}
          data-testid="thermal-on"
        />
        Thermal motion (Debye–Waller)</label
      >
      <ThermalSigmas disabled={!b.thermalOn} />
    </section>
  {:else if tab === 'output'}
    <section>
      <h4>Pattern</h4>
      <NumberField
        label="Pattern pixel size"
        bind:value={simulation.bloch.pixel}
        unit="Å⁻¹"
        min={0.002}
        max={0.2}
        step={0.005}
        def={0.02}
        help="One pixel of the recorded pattern. A coarser pixel means fewer incident directions in the disc, so a faster solve."
        testid="bloch-pixel"
      />
      <p class="muted small">
        = {pixelMrad.toFixed(3)} mrad per pixel; the disc of {b.alpha} mrad is
        {pv ? `${2 * pv.disc_radius_px + 1} pixels across` : '…'}.
      </p>
      {#if pv}
        <dl class="facts">
          <dt>Incident directions</dt>
          <dd data-testid="bloch-tilts">{pv.n_tilts.toLocaleString('en')}</dd>
          <dt>Beams per solve</dt>
          <dd>{pv.n_beams}</dd>
        </dl>
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
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
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
</style>
