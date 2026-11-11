<script lang="ts">
  // ③ Simulation (context.md §7.MU step U4). Ribbon: method and type. For multislice the views show
  // what the run will see: the planes (real space with the scan, and the diffraction plane with the
  // detectors and the kinematic pattern) in the first row and, for probe types, the beam (the probe
  // and its aberration phase χ(k)) in the second.
  // The sidebar holds the parameters that apply to the type (the acceleration voltage is in its
  // first tab), and the summary bar the numbers that decide the run. Overlays of the Scan, Detectors
  // and Output tabs are drawn only while that tab is open.
  //
  // Bloch wave (step U5) has the same frame: Type SAED, CBED or LACBED; two square views, the
  // reciprocal space of the zone axis (k max circle, kept reflections, condenser discs) and the
  // kinematic structure factors against |g| that help to choose k max; its own sidebar tabs.
  //
  // INCOSTEM (step U6): the incoherent ADF-STEM image of a thin specimen, computed live. Three
  // square views (the image with its draggable field of view, the diffraction plane with α and the
  // ADF annulus, the point-spread function) and the tabs Probe, Detector, Image, Noise and Cross
  // sections.
  import { formatBytes } from '../core/memory';
  import {
    BLOCH_TYPES,
    SIM_TYPES,
    blochBody,
    factorsBody,
    fetchBloch,
    fetchFactors,
    fetchIncostem,
    fetchPreview,
    incostemBody,
    isProbe,
    isScan,
    previewBody,
    simulation,
  } from '../state/simulation.svelte';
  import BlochSide, { blochTabs, type BlochTab } from './BlochSide.svelte';
  import ChiCard from './ChiCard.svelte';
  import DiffractionCard from './DiffractionCard.svelte';
  import FactorCard from './FactorCard.svelte';
  import IncostemDiffCard from './IncostemDiffCard.svelte';
  import IncostemImageCard from './IncostemImageCard.svelte';
  import IncostemPsfCard from './IncostemPsfCard.svelte';
  import IncostemSide, { INCOSTEM_TABS, type IncostemTab } from './IncostemSide.svelte';
  import ProbeCard from './ProbeCard.svelte';
  import ReciprocalCard from './ReciprocalCard.svelte';
  import RealSpaceCard from './RealSpaceCard.svelte';
  import SidePanel from './SidePanel.svelte';
  import SimulationSide, { simTabs, type SimTab } from './SimulationSide.svelte';
  import SummaryBar, { type SummaryItem, type SummaryWarning } from './kit/SummaryBar.svelte';

  const p = simulation.ms;
  const pv = $derived(simulation.preview);
  const probe = $derived(isProbe(p.type));
  const tabs = $derived(simTabs(p.type));
  let sideTab = $state<SimTab>('beam');
  // A tab that does not apply to the new type hands over to the first one.
  $effect(() => {
    if (!tabs.some((t) => t.id === sideTab)) sideTab = 'beam';
  });

  // The preview follows every change (debounced: dragging is not a request).
  let lastKey = '';
  $effect(() => {
    if (simulation.method !== 'multislice') return;
    const body = previewBody();
    if (!body) {
      simulation.preview = null;
      lastKey = '';
      return;
    }
    const key = JSON.stringify(body);
    if (key === lastKey) return;
    const timer = setTimeout(() => {
      lastKey = key;
      void fetchPreview(body);
    }, 250);
    return () => clearTimeout(timer);
  });

  // Bloch wave: the run's beams and time follow every change; the structure factors only the
  // structure, the zone axis, the voltage and the thermal motion.
  const bl = $derived(simulation.bloch);
  const blTabs = $derived(blochTabs(bl.type));
  let blochTab = $state<BlochTab>('beam');
  $effect(() => {
    if (!blTabs.some((t) => t.id === blochTab)) blochTab = 'beam';
  });
  let lastBlochKey = '';
  $effect(() => {
    if (simulation.method !== 'bloch') return;
    const body = blochBody();
    if (!body) {
      simulation.blochPreview = null;
      lastBlochKey = '';
      return;
    }
    const key = JSON.stringify(body);
    if (key === lastBlochKey) return;
    const timer = setTimeout(() => {
      lastBlochKey = key;
      void fetchBloch(body);
    }, 250);
    return () => clearTimeout(timer);
  });
  let lastFactorsKey = '';
  $effect(() => {
    if (simulation.method !== 'bloch') return;
    const body = factorsBody();
    if (!body) {
      simulation.factors = null;
      lastFactorsKey = '';
      return;
    }
    const key = JSON.stringify(body);
    if (key === lastFactorsKey) return;
    const timer = setTimeout(() => {
      lastFactorsKey = key;
      void fetchFactors(body);
    }, 250);
    return () => clearTimeout(timer);
  });
  const bp = $derived(simulation.blochPreview);
  const blochItems = $derived.by((): SummaryItem[] => {
    if (!bp) return [];
    const out: SummaryItem[] = [
      { label: 'Beams', value: bp.n_beams },
      { label: 'k max', value: bl.kMax.toFixed(2), unit: 'Å⁻¹' },
    ];
    if (bl.type !== 'saed')
      out.push({ label: 'Directions', value: bp.n_tilts.toLocaleString('en') });
    out.push({ label: 'Solve time', value: fmtTime(bp.seconds) });
    return out;
  });
  const blochWarnings = $derived<SummaryWarning[]>(
    [
      ...(bl.type !== 'saed' && bl.alpha > (bl.type === 'lacbed' ? 60 : 40)
        ? [
            `α = ${bl.alpha} mrad is above the usual ${bl.type === 'lacbed' ? 60 : 40} mrad for ${bl.type.toUpperCase()}.`,
          ]
        : []),
      ...(bp?.warnings ?? []),
    ].map((w) => ({
      text: w,
      onclick: () => {
        blochTab = /pixel/i.test(w) && bl.type !== 'saed' ? 'output' : 'beam';
      },
      testid: 'bloch-warning',
    })),
  );

  // INCOSTEM: the image follows every change, live (debounced: a drag is not a request).
  let incTab = $state<IncostemTab>('probe');
  let lastIncKey = '';
  $effect(() => {
    if (simulation.method !== 'incostem') return;
    const body = incostemBody();
    if (!body) {
      simulation.incostemResult = null;
      lastIncKey = '';
      return;
    }
    const key = JSON.stringify(body);
    if (key === lastIncKey) return;
    const timer = setTimeout(() => {
      lastIncKey = key;
      void fetchIncostem(body);
    }, 150);
    return () => clearTimeout(timer);
  });
  const ir = $derived(simulation.incostemResult);

  const fmtTime = (s: number) =>
    s < 1
      ? `${Math.max(1, Math.round(s * 1000))} ms`
      : s < 60
        ? `${s.toFixed(s < 10 ? 1 : 0)} s`
        : s < 3600
          ? `${(s / 60).toFixed(1)} min`
          : `${(s / 3600).toFixed(1)} h`;
  const items = $derived.by((): SummaryItem[] => {
    if (!pv) return [];
    const out: SummaryItem[] = [
      { label: 'Grid', value: `${pv.gpts[0]} × ${pv.gpts[1]}` },
      { label: 'Slices', value: pv.n_slices },
      { label: 'α max', value: pv.alpha_max_mrad.toFixed(1), unit: 'mrad' },
    ];
    if (isScan(p.type)) out.push({ label: 'Positions', value: pv.n_scan });
    if (probe && pv.probe_profile?.fwhm)
      out.push({ label: 'Probe FWHM', value: pv.probe_profile.fwhm.toFixed(2), unit: 'Å' });
    out.push({ label: 'Memory', value: formatBytes(pv.memory.total_peak_bytes) });
    out.push({ label: 'Time', value: fmtTime(pv.memory.seconds) });
    return out;
  });
  const incItems = $derived.by((): SummaryItem[] => {
    if (!ir) return [];
    const out: SummaryItem[] = [
      { label: 'Image', value: `${ir.shape[0]} × ${ir.shape[1]}`, unit: 'px' },
      { label: 'Pixel', value: ir.pixel[0].toFixed(3), unit: 'Å' },
      { label: 'Thickness', value: ir.thickness.toFixed(1), unit: 'Å' },
      { label: 'Atoms', value: ir.n_atoms },
      { label: 'Model', value: 'incoherent' },
    ];
    if (ir.psf.profile?.fwhm)
      out.push({ label: 'PSF FWHM', value: ir.psf.profile.fwhm.toFixed(2), unit: 'Å' });
    out.push({ label: 'Time', value: fmtTime(ir.seconds) });
    return out;
  });
  const incWarnings = $derived<SummaryWarning[]>([
    ...(ir?.warnings ?? []).map((w) => ({
      text: w,
      onclick: () => {
        incTab = /pixel/i.test(w) ? 'image' : 'probe';
      },
      testid: 'incostem-warning',
    })),
  ]);
  /** Each warning opens the sidebar tab of the parameter it is about. */
  function tabFor(w: string): SimTab {
    if (/series/i.test(w)) return 'series';
    if (/detector|beyond/i.test(w)) return p.type === 'stem' ? 'detectors' : 'potential';
    if (/Nyquist|scan area|tails/i.test(w)) return isScan(p.type) ? 'scan' : 'beam';
    if (/under-sampled|sampling/i.test(w)) return 'potential';
    return 'beam';
  }
  const warnings = $derived<SummaryWarning[]>(
    (pv?.warnings ?? []).map((w) => ({
      text: w,
      onclick: () => (sideTab = tabFor(w)),
      testid: 'abtem-warning',
    })),
  );
</script>

<div class="step" data-testid="simulation-step">
  <div class="ribbon card">
    <fieldset>
      <legend>Method</legend>
      <div class="ctl">
        <span class="seg" role="group" aria-label="Simulation method">
          <button
            type="button"
            aria-pressed={simulation.method === 'multislice'}
            onclick={() => (simulation.method = 'multislice')}
            data-testid="method-multislice">Multislice</button
          ><button
            type="button"
            aria-pressed={simulation.method === 'bloch'}
            onclick={() => (simulation.method = 'bloch')}
            data-testid="method-bloch">Bloch wave</button
          ><button
            type="button"
            aria-pressed={simulation.method === 'incostem'}
            onclick={() => (simulation.method = 'incostem')}
            title="Incoherent ADF-STEM images of very thin specimens"
            data-testid="method-incostem">INCOSTEM</button
          >
        </span>
      </div>
    </fieldset>
    {#if simulation.method === 'incostem'}
      <fieldset>
        <legend>Type</legend>
        <div class="ctl">
          <span class="seg" role="group" aria-label="INCOSTEM type">
            <button type="button" aria-pressed="true" data-testid="incostem-type">ADF-STEM</button>
          </span>
        </div>
      </fieldset>
      <span class="status muted">
        {#if simulation.incostemPending}updating…{/if}
      </span>
    {:else if simulation.method === 'bloch'}
      <fieldset>
        <legend>Type</legend>
        <div class="ctl">
          <span class="seg" role="group" aria-label="Bloch-wave type">
            {#each BLOCH_TYPES as t (t.id)}
              <button
                type="button"
                aria-pressed={bl.type === t.id}
                onclick={() => (simulation.bloch.type = t.id)}
                data-testid={`bloch-${t.id}`}>{t.label}</button
              >
            {/each}
          </span>
        </div>
      </fieldset>
      <span class="status muted">
        {#if simulation.blochPending}updating…{/if}
      </span>
    {:else if simulation.method === 'multislice'}
      <fieldset>
        <legend>Type</legend>
        <div class="ctl">
          <span class="seg" role="group" aria-label="Simulation type">
            {#each SIM_TYPES as t (t.id)}
              <button
                type="button"
                aria-pressed={p.type === t.id}
                onclick={() => (p.type = t.id)}
                data-testid={`sim-${t.id}`}>{t.label}</button
              >
            {/each}
          </span>
        </div>
      </fieldset>
      <span class="status muted">
        {#if simulation.pending}updating…{/if}
      </span>
    {/if}
  </div>

  {#if simulation.method === 'incostem'}
    {#if simulation.incostemError}
      <p class="notice err" role="alert">✕ {simulation.incostemError}</p>
    {/if}
    <div class="row">
      <div class="views three" data-testid="incostem-panel">
        <IncostemImageCard tab={incTab} />
        <IncostemDiffCard tab={incTab} />
        <IncostemPsfCard />
      </div>
      <SidePanel
        tabs={INCOSTEM_TABS}
        bind:tab={incTab}
        label="INCOSTEM settings"
        storageKey="emsim.simulationPanel.v2"
        idPrefix="incostem"
        testid="incostem-"
        defaultWidth={500}
      >
        <IncostemSide tab={incTab} />
      </SidePanel>
    </div>
    <SummaryBar items={incItems} warnings={incWarnings} testid="incostem-stats" />
    <p class="hint">
      <kbd>wheel</kbd> zoom · <kbd>drag</kbd> pan · the field of view (Image tab) and the ADF annulus
      (Detector tab) are drawn, and dragged, only while their tab is open. Down the beam: +x to the left,
      +y up. Incoherent model: right for a few atoms in a column, wrong for thick specimens.
    </p>
  {:else if simulation.method === 'bloch'}
    {#if simulation.blochError}
      <p class="notice err" role="alert">✕ {simulation.blochError}</p>
    {/if}
    <div class="row">
      <div class="views" data-testid="bloch-panel">
        <ReciprocalCard />
        <FactorCard />
      </div>
      <SidePanel
        tabs={blTabs}
        bind:tab={blochTab}
        label="Bloch-wave settings"
        storageKey="emsim.simulationPanel.v2"
        idPrefix="bloch"
        testid="bloch-"
        defaultWidth={500}
      >
        <BlochSide tab={blochTab} />
      </SidePanel>
    </div>
    <SummaryBar items={blochItems} warnings={blochWarnings} testid="bloch-stats" />
    <p class="hint">
      <kbd>wheel</kbd> zoom · <kbd>drag</kbd> pan · drag the dashed circle, or click or drag in the structure-factor
      plot, to set k max. The pattern is seen down the beam: +x to the left, +y up. The structure factors
      are kinematic; the solve itself is a job (M6).
    </p>
  {:else}
    {#if simulation.error}
      <p class="notice err" role="alert">✕ {simulation.error}</p>
    {/if}
    <div class="row">
      <div class="views" data-testid="abtem-panel">
        <RealSpaceCard tab={sideTab} />
        <DiffractionCard tab={sideTab} />
        {#if probe}
          <ProbeCard />
          <ChiCard />
        {/if}
      </div>
      <SidePanel
        {tabs}
        bind:tab={sideTab}
        label="Simulation settings"
        storageKey="emsim.simulationPanel.v2"
        idPrefix="sim"
        testid="sim-"
        defaultWidth={500}
        sticky
      >
        <SimulationSide tab={sideTab} />
      </SidePanel>
    </div>
    <SummaryBar {items} {warnings} testid="abtem-stats" />
    <p class="hint">
      <kbd>wheel</kbd> zoom · <kbd>drag</kbd> pan · the scan rectangle (Scan tab) and the detector edges
      (Detectors tab) are drawn, and dragged, only while their tab is open. Both planes are seen down
      the beam: +x to the left, +y up.
    </p>
  {/if}
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: stretch;
    min-width: 0;
  }
  .views {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem;
    align-content: start;
  }
  /* Two rows of two square views; the page scrolls, the sidebar stays in view. */
  .views.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .status {
    align-self: center;
    font-size: 0.82rem;
  }
  @media (max-width: 70rem) {
    .row {
      flex-direction: column;
      gap: 0.8rem;
    }
  }
  @media (max-width: 52rem) {
    .views.three {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 36rem) {
    .views,
    .views.three {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
