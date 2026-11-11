<script lang="ts" module>
  import type { PlaneView as View, Stage } from '../../core/plane';

  /** What an overlay needs to draw in screen pixels. */
  export interface PlaneMap {
    /** Plane (u, v) -> stage pixels. */
    s(u: number, v: number): { x: number; y: number };
    /** Screen pixels per plane unit. */
    k: number;
    stage: Stage;
    view: View;
  }
</script>

<script lang="ts">
  // A 2D view card of the Simulation tab (context.md §7.MU step U4): a picture placed in plane
  // coordinates (Å, mrad, 1/Å) with overlays drawn in screen pixels on top, wheel zoom about the
  // pointer, drag to pan (on the background; overlays that can be dragged stop the event), a scale
  // bar and an orientation mark. Like the specimen view, +x points left and +y up (`flipX`).
  import type { Snippet } from 'svelte';
  import {
    fitView,
    formatLength,
    panBy,
    scaleBar,
    toScreen,
    zoomAt,
    type Bounds,
  } from '../../core/plane';
  import { safeName } from '../../export/browser';
  import { svgImageRows, type ExportSection } from '../../export/rows';
  import ExportMenu from '../ExportMenu.svelte';
  import ViewCard from './ViewCard.svelte';

  let {
    title,
    bounds,
    unit,
    image = null,
    flipX = true,
    axes = ['x', 'y'],
    dark = false,
    empty = '',
    square = true,
    titleExtra: switches,
    overlay,
    hud,
    controls,
    exportName = '',
    testid = '',
  }: {
    title: string;
    /** What "Reset zoom" fits; null = nothing to show yet. */
    bounds: Bounds | null;
    /** Unit of the scale bar. */
    unit: string;
    image?: { src: string; bounds: Bounds; testid?: string; alt: string } | null;
    flipX?: boolean;
    /** Labels of the orientation mark (+u, +v). */
    axes?: [string, string];
    dark?: boolean;
    /** Shown when `bounds` is null. */
    empty?: string;
    square?: boolean;
    titleExtra?: Snippet;
    overlay?: Snippet<[PlaneMap]>;
    hud?: Snippet;
    /** Small controls in the bottom-right corner of the stage. */
    controls?: Snippet;
    /** File name (without extension) of the exported picture; no Export menu when empty. */
    exportName?: string;
    testid?: string;
  } = $props();

  let stageEl = $state<HTMLDivElement>();
  let svgEl = $state<SVGSVGElement>();
  const imageSections = $derived<ExportSection[]>([
    {
      title: 'Image of the view',
      image: true,
      rows: svgImageRows({
        get: () => svgEl,
        name: () => safeName(exportName, 'view'),
        background: dark ? '#0b0e16' : '#ffffff',
      }),
    },
  ]);
  let w = $state(0);
  let h = $state(0);
  let view = $state<View | null>(null);
  let fittedFor = '';

  $effect(() => {
    const el = stageEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      w = el.clientWidth;
      h = el.clientHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // A new extent (another specimen, unit or angle range) fits again; a resize keeps the zoom
  // relative to the stage.
  $effect(() => {
    const b = bounds;
    if (!b || !w || !h) return;
    const key = `${b.u0},${b.u1},${b.v0},${b.v1}`;
    if (key !== fittedFor || !view) {
      fittedFor = key;
      view = fitView(b, w, h);
    }
  });

  export function resetZoom(): void {
    if (bounds && w && h) view = fitView(bounds, w, h);
  }

  const stage = $derived<Stage>({ w, h, flipX });
  const map = $derived.by((): PlaneMap | null => {
    const v = view;
    if (!v || !w || !h) return null;
    return { s: (u, p) => toScreen(v, stage, u, p), k: v.scale, stage, view: v };
  });

  const img = $derived.by(() => {
    if (!image || !map) return null;
    const a = map.s(image.bounds.u0, image.bounds.v0);
    const b = map.s(image.bounds.u1, image.bounds.v1);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  });

  const bar = $derived(map ? scaleBar(map.k, Math.min(110, w * 0.28)) : null);

  function onWheel(e: WheelEvent) {
    if (!view) return;
    e.preventDefault();
    const r = stageEl!.getBoundingClientRect();
    view = zoomAt(view, stage, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }

  let pan = $state<{ x: number; y: number } | null>(null);
  function onDown(e: PointerEvent) {
    if (e.button !== 0 || !view) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pan = { x: e.clientX, y: e.clientY };
  }
  function onMove(e: PointerEvent) {
    if (!pan || !view) return;
    view = panBy(view, stage, e.clientX - pan.x, e.clientY - pan.y);
    pan = { x: e.clientX, y: e.clientY };
  }
  function onUp() {
    pan = null;
  }
</script>

<ViewCard {title} {square} {testid}>
  {#snippet titleExtra()}
    {#if exportName}
      <ExportMenu
        sections={imageSections}
        disabled={!bounds}
        imageSize={() => (svgEl ? { width: w, height: h } : null)}
        testid={testid ? `${testid}-export` : 'export'}
        compact
      />
    {/if}
    {#if switches}{@render switches()}{/if}
  {/snippet}
  {#snippet tools()}
    <button
      type="button"
      disabled={!bounds}
      onclick={resetZoom}
      title="Fit the view"
      data-testid={testid ? `${testid}-reset` : undefined}>Reset zoom</button
    >
  {/snippet}
  <div class="stage" class:dark bind:this={stageEl}>
    {#if !bounds}
      <p class="empty">{empty}</p>
    {:else}
      <svg
        bind:this={svgEl}
        role="application"
        aria-label={title}
        class:panning={!!pan}
        onwheel={onWheel}
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
        data-testid={testid ? `${testid}-svg` : undefined}
      >
        {#if image && img}
          <image
            href={image.src}
            x={img.x}
            y={img.y}
            width={img.w}
            height={img.h}
            preserveAspectRatio="none"
            data-testid={image.testid}
          >
            <title>{image.alt}</title>
          </image>
        {/if}
        {#if map}{@render overlay?.(map)}{/if}
        {#if bar && bar.px > 0}
          <g
            class="bar"
            transform="translate(14 {h - 16})"
            data-testid={testid ? `${testid}-scalebar` : undefined}
          >
            <rect x="-6" y="-20" width={bar.px + 12} height="28" rx="5" class="bar-bg" />
            <line class="ln" x1="0" y1="0" x2={bar.px} y2="0" />
            <line class="ln" x1="0" y1="-4" x2="0" y2="4" />
            <line class="ln" x1={bar.px} y1="-4" x2={bar.px} y2="4" />
            <text class="tx" x={bar.px / 2} y="-7" text-anchor="middle"
              >{formatLength(bar.value)} {unit}</text
            >
          </g>
        {/if}
        <g class="mark" transform="translate({w - 22} 46)">
          <line class="ln" x1="0" y1="0" x2={flipX ? -24 : 24} y2="0" />
          <line class="ln" x1="0" y1="0" x2="0" y2="-24" />
          <text class="tx" x={flipX ? -30 : 30} y="4" text-anchor={flipX ? 'end' : 'start'}
            >{axes[0]}</text
          >
          <text class="tx" x="0" y="-29" text-anchor="middle">{axes[1]}</text>
        </g>
      </svg>
    {/if}
    {#if hud}<div class="hud">{@render hud()}</div>{/if}
    {#if controls && bounds}<div class="controls">{@render controls()}</div>{/if}
  </div>
</ViewCard>

<style>
  .stage {
    position: absolute;
    inset: 0;
    background: #fff;
    overflow: hidden;
    --fg: #0d1220;
    --bar-bg: rgba(255, 255, 255, 0.82);
  }
  .stage.dark {
    background: #0b0e16;
    --fg: #f1f3f8;
    --bar-bg: rgba(11, 14, 22, 0.7);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  svg.panning {
    cursor: grabbing;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 1rem;
    text-align: center;
    color: #5b6578;
  }
  .bar line,
  .mark line {
    stroke: var(--fg);
    stroke-width: 2;
  }
  .bar-bg {
    fill: var(--bar-bg);
  }
  .bar text,
  .mark text {
    fill: var(--fg);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .mark line {
    stroke-width: 1.5;
  }
  .hud {
    position: absolute;
    left: 0.5rem;
    top: 0.45rem;
    max-width: calc(100% - 5rem);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    pointer-events: none;
  }
  .controls {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    display: flex;
    gap: 0.3rem;
  }
  .controls :global(button) {
    font-size: 0.78rem;
    padding: 0.05rem 0.45rem;
  }
  .hud :global(p) {
    margin: 0;
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    background: var(--bar-bg);
    color: var(--fg);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
</style>
