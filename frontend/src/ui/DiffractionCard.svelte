<script lang="ts">
  // ③ Diffraction plane (context.md §7.MU step U4), in mrad or 1/Å, oriented like the real-space
  // view (+x left, +y up). Underneath: the kinematic zero-order-zone reflections of the supercell
  // (discs of radius α for a convergent probe, spots for a plane wave), so the angles are chosen
  // against the real pattern. On top: the bright-field disc, the largest simulated angle α max
  // (dashed), the STEM detector annuli (drag an edge to change it), the recorded pattern of
  // CBED / 4D-STEM, and the HRTEM objective aperture.
  import { detectorColour } from '../core/overlayColours';
  import { clampDetector } from '../core/plane';
  import { hasPattern, isProbe, simulation, wavelength } from '../state/simulation.svelte';
  import { specimen } from '../state/specimen.svelte';
  import PlaneCard, { type PlaneMap } from './kit/PlaneCard.svelte';

  /** The sidebar tab that is open: the crop belongs to Output, the annuli to Detectors. */
  let { tab = '', square = true }: { tab?: string; square?: boolean } = $props();

  let unit = $state<'mrad' | 'inv'>('mrad');
  /** Convergent probes: draw each reflection as a disc of radius α, or as a spot. */
  let spots = $state(false);

  const pv = $derived(simulation.preview);
  const p = $derived(simulation.ms);
  const lam = $derived(wavelength(p.energy));
  /** mrad -> plane units. */
  const c = (mrad: number) => (unit === 'mrad' ? mrad : mrad / (lam * 1e3));
  const probe = $derived(isProbe(p.type));
  const amax = $derived(pv?.alpha_max_mrad ?? 0);
  const crop = $derived(pv && hasPattern(p.type) ? (p.pattern / 2) * pv.diffraction_pixel_mrad : 0);
  const reach = $derived(
    Math.max(
      amax,
      p.type === 'stem' ? Math.max(0, ...p.detectors.map((d) => d.outer)) : 0,
      Math.min(crop, amax * 1.2),
      p.type === 'hrtem' ? p.aperture : 0,
      probe ? p.alpha * 1.5 : 0,
    ) * 1.08,
  );
  const bounds = $derived(
    specimen.result && pv && reach > 0
      ? { u0: -c(reach), u1: c(reach), v0: -c(reach), v1: c(reach) }
      : null,
  );
  // q (1/Å) -> plane units; the strongest reflections are drawn last (on top).
  const discs = $derived(
    (pv?.discs ?? [])
      .map(([qx, qy, I]) => {
        const k = unit === 'mrad' ? lam * 1e3 : 1;
        return { u: qx * k, v: qy * k, I };
      })
      .reverse(),
  );

  let drag: { i: number; edge: 'inner' | 'outer'; m: PlaneMap; rect: DOMRect } | null = null;
  function down(e: PointerEvent, i: number, edge: 'inner' | 'outer', m: PlaneMap) {
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { i, edge, m, rect: svg.getBoundingClientRect() };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    e.stopPropagation();
    const o = drag.m.s(0, 0);
    const px = Math.hypot(e.clientX - drag.rect.left - o.x, e.clientY - drag.rect.top - o.y);
    const plane = px / drag.m.k;
    const mrad = unit === 'mrad' ? plane : plane * lam * 1e3;
    const d = simulation.ms.detectors[drag.i];
    const next = clampDetector({ ...d, [drag.edge]: Math.round(mrad * 2) / 2 });
    simulation.ms.detectors[drag.i] = next;
  }
  function up(e: PointerEvent) {
    e.stopPropagation();
    drag = null;
  }

  const ring = (m: PlaneMap, inner: number, outer: number) => {
    const o = m.s(0, 0);
    const a = c(outer) * m.k;
    const b = c(inner) * m.k;
    const circle = (r: number) =>
      `M${o.x - r},${o.y} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
    return circle(a) + (b > 0 ? ' ' + circle(b) : '');
  };
</script>

<PlaneCard
  title="Diffraction plane"
  {bounds}
  unit={unit === 'mrad' ? 'mrad' : 'Å⁻¹'}
  axes={unit === 'mrad' ? ['θx', 'θy'] : ['qx', 'qy']}
  dark
  empty="Build the supercell in ② to see its diffraction pattern."
  testid="diffraction"
  {square}
>
  {#snippet titleExtra()}
    <span class="seg" role="group" aria-label="Diffraction units">
      <button type="button" aria-pressed={unit === 'mrad'} onclick={() => (unit = 'mrad')}
        >mrad</button
      ><button
        type="button"
        aria-pressed={unit === 'inv'}
        onclick={() => (unit = 'inv')}
        data-testid="diffraction-inv">Å⁻¹</button
      >
    </span>
  {/snippet}
  {#snippet overlay(m)}
    {@const o = m.s(0, 0)}
    <g data-testid="diffraction-diagram">
      <g class="discs" data-testid="bragg-discs" data-count={discs.length}>
        {#each discs as d, i (i)}
          {@const q = m.s(d.u, d.v)}
          {#if probe && !spots}
            <circle
              cx={q.x}
              cy={q.y}
              r={c(p.alpha) * m.k}
              fill-opacity={0.02 + 0.3 * Math.sqrt(d.I)}
              stroke-opacity={0.1 + 0.5 * Math.sqrt(d.I)}
            />
          {:else}
            <circle
              cx={q.x}
              cy={q.y}
              r={1.5 + 4.5 * Math.sqrt(d.I)}
              fill-opacity={0.35 + 0.65 * Math.sqrt(d.I)}
            />
          {/if}
        {/each}
      </g>
      {#if amax > 0}
        <circle cx={o.x} cy={o.y} r={c(amax) * m.k} class="limit" />
        <text class="lbl" x={o.x} y={o.y + c(amax) * m.k + 14} text-anchor="middle"
          >α max {amax.toFixed(0)} mrad{p.type === 'saed' ? ' (recorded)' : ''}</text
        >
      {/if}
      {#if probe}
        <circle cx={o.x} cy={o.y} r={c(p.alpha) * m.k} class="bf" data-testid="bf-disc" />
      {/if}
      {#if crop > 0 && tab === 'output' && simulation.overlays.crop}
        {@const s = c(crop) * m.k}
        <rect x={o.x - s} y={o.y - s} width={2 * s} height={2 * s} class="crop" />
        <text class="lbl" x={o.x - s + 4} y={o.y + s - 6}
          >pattern {p.pattern} px · {pv!.diffraction_pixel_mrad.toFixed(2)} mrad/px</text
        >
      {/if}
      {#if p.type === 'hrtem' && p.aperture > 0}
        <circle
          cx={o.x}
          cy={o.y}
          r={c(p.aperture) * m.k}
          class="aperture"
          data-testid="aperture-circle"
        />
      {/if}
      {#if p.type === 'stem' && tab === 'detectors' && simulation.overlays.detectors}
        {#each p.detectors as d, i (i)}
          {@const col = detectorColour(d.name)}
          <path d={ring(m, d.inner, d.outer)} fill-rule="evenodd" class="ann" style:fill={col} />
          {#each ['outer', 'inner'] as const as edge (edge)}
            {#if edge === 'outer' || d.inner > 0}
              <circle cx={o.x} cy={o.y} r={c(d[edge]) * m.k} class="edge" style:stroke={col} />
              <circle
                cx={o.x}
                cy={o.y}
                r={c(d[edge]) * m.k}
                class="hit"
                role="slider"
                tabindex="-1"
                aria-label={`${d.name} ${edge} angle`}
                aria-valuenow={d[edge]}
                data-testid={`det-${i}-${edge}-edge`}
                onpointerdown={(e) => down(e, i, edge, m)}
                onpointermove={move}
                onpointerup={up}
              />
            {/if}
          {/each}
          <text
            class="lbl"
            x={o.x + c(d.outer) * m.k * 0.71 + 4}
            y={o.y + c(d.outer) * m.k * 0.71 + 12}
            style:fill={col}>{d.name} {d.inner.toFixed(0)}–{d.outer.toFixed(0)}</text
          >
        {/each}
      {/if}
    </g>
  {/snippet}
  {#snippet controls()}
    {#if probe}
      <span class="seg" role="group" aria-label="Reflections drawn as">
        <button type="button" aria-pressed={!spots} onclick={() => (spots = false)}>discs</button
        ><button
          type="button"
          aria-pressed={spots}
          onclick={() => (spots = true)}
          data-testid="diffraction-spots">spots</button
        >
      </span>
    {/if}
  {/snippet}
  {#snippet hud()}
    {#if pv}
      <p>
        {Math.max(0, discs.length - 1)} reflections (kinematic, ZOLZ)
      </p>
    {/if}
    {#if probe}
      <p data-testid="bf-note">Green Circle: Bright field disk</p>
    {/if}
  {/snippet}
</PlaneCard>

<style>
  .discs circle {
    fill: #f1f3f8;
    stroke: #f1f3f8;
    stroke-width: 1;
    pointer-events: none;
  }
  .limit {
    fill: none;
    stroke: #9ca3af;
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
    pointer-events: none;
  }
  .bf {
    fill: none;
    stroke: var(--ov-bf);
    stroke-width: 2;
    pointer-events: none;
  }
  .crop {
    fill: none;
    stroke: #fbbf24;
    stroke-width: 1.5;
    stroke-dasharray: 3 3;
    pointer-events: none;
  }
  .aperture {
    fill: none;
    stroke: #38bdf8;
    stroke-width: 2;
    pointer-events: none;
  }
  .ann {
    fill-opacity: 0.22;
    pointer-events: none;
  }
  .edge {
    fill: none;
    stroke-width: 2.5;
    pointer-events: none;
  }
  /* A wide transparent ring over each edge: easy to grab. */
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 12;
    cursor: ew-resize;
    pointer-events: stroke;
  }
  .hit:hover {
    stroke: rgba(255, 255, 255, 0.18);
  }
  .lbl {
    fill: #e5e7eb;
    font-size: 11px;
    pointer-events: none;
  }
</style>
