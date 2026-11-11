<script lang="ts">
  // ③ INCOSTEM diffraction plane (context.md §7.MU step U6), in mrad: the bright-field disc of the
  // probe (radius α, green) and the ADF annulus (orange) whose inner and outer edges you drag while
  // the Detector tab is open. The scattering of the atoms into the annulus is what makes the image
  // (the partial cross sections in the Cross sections tab). The pattern itself is not simulated.
  import { detectorColour } from '../core/overlayColours';
  import { clampDetector } from '../core/plane';
  import { simulation } from '../state/simulation.svelte';
  import PlaneCard, { type PlaneMap } from './kit/PlaneCard.svelte';

  /** The sidebar tab that is open: the annulus handles belong to Detector. */
  let { tab = '', square = true }: { tab?: string; square?: boolean } = $props();

  const i = $derived(simulation.incostem);
  const reach = $derived(Math.max(i.adf.outer, i.alpha) * 1.2);
  const bounds = $derived({ u0: -reach, u1: reach, v0: -reach, v1: reach });
  const show = $derived(tab === 'detector' && simulation.overlays.incAdf);
  const colour = detectorColour('haadf');

  let drag: { edge: 'inner' | 'outer'; m: PlaneMap; rect: DOMRect } | null = null;
  function down(e: PointerEvent, edge: 'inner' | 'outer', m: PlaneMap) {
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { edge, m, rect: svg.getBoundingClientRect() };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    e.stopPropagation();
    const o = drag.m.s(0, 0);
    const px = Math.hypot(e.clientX - drag.rect.left - o.x, e.clientY - drag.rect.top - o.y);
    const mrad = Math.round((px / drag.m.k) * 2) / 2;
    const d = clampDetector({
      name: 'ADF',
      inner: i.adf.inner,
      outer: i.adf.outer,
      [drag.edge]: mrad,
    });
    simulation.incostem.adf = { inner: d.inner, outer: d.outer };
  }
  function up(e: PointerEvent) {
    e.stopPropagation();
    drag = null;
  }

  const ring = (m: PlaneMap, inner: number, outer: number) => {
    const o = m.s(0, 0);
    const a = outer * m.k;
    const b = inner * m.k;
    const circle = (r: number) =>
      `M${o.x - r},${o.y} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
    return circle(a) + (b > 0 ? ' ' + circle(b) : '');
  };
</script>

<PlaneCard
  title="Diffraction plane"
  {bounds}
  unit="mrad"
  axes={['θx', 'θy']}
  dark
  empty=""
  testid="incostem-diffraction"
  {square}
>
  {#snippet overlay(m)}
    {@const o = m.s(0, 0)}
    <circle cx={o.x} cy={o.y} r={i.alpha * m.k} class="bf" data-testid="incostem-bf-disc" />
    <text class="lbl" x={o.x} y={o.y - i.alpha * m.k - 6} text-anchor="middle"
      >α {i.alpha.toFixed(0)} mrad</text
    >
    {#if show}
      <path
        d={ring(m, i.adf.inner, i.adf.outer)}
        fill-rule="evenodd"
        class="ann"
        style:fill={colour}
        data-testid="incostem-adf"
      />
      {#each ['outer', 'inner'] as const as edge (edge)}
        {#if edge === 'outer' || i.adf.inner > 0}
          <circle cx={o.x} cy={o.y} r={i.adf[edge] * m.k} class="edge" style:stroke={colour} />
          <circle
            cx={o.x}
            cy={o.y}
            r={i.adf[edge] * m.k}
            class="hit"
            role="slider"
            tabindex="-1"
            aria-label={`ADF ${edge} angle`}
            aria-valuenow={i.adf[edge]}
            data-testid={`adf-${edge}-edge`}
            onpointerdown={(e) => down(e, edge, m)}
            onpointermove={move}
            onpointerup={up}
          />
        {/if}
      {/each}
      <text
        class="lbl"
        x={o.x + i.adf.outer * m.k * 0.71 + 4}
        y={o.y + i.adf.outer * m.k * 0.71 + 12}
        style:fill={colour}>ADF {i.adf.inner.toFixed(0)}–{i.adf.outer.toFixed(0)}</text
      >
    {/if}
  {/snippet}
  {#snippet hud()}
    <p data-testid="incostem-adf-text">ADF {i.adf.inner}–{i.adf.outer} mrad</p>
    <p>Detector geometry only; no pattern is simulated</p>
  {/snippet}
</PlaneCard>

<style>
  .bf {
    fill: none;
    stroke: var(--ov-bf);
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
