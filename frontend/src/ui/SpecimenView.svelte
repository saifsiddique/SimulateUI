<script lang="ts">
  // The supercell card (context.md M3, U3, U4): the orthogonal box as built by the backend, seen
  // along the zone axis (z, the beam) or from the side along x or y, with the x, y, z axes and the
  // atom count. ② and ③ both show it; the scan field of view is drawn in ③'s Real space view.
  // The specimen frame: beam along +z, y up the screen, so (looking along the beam) +x points to
  // the left, exactly as in the crystal view the zone axis was taken from.
  import { onMount, untrack } from 'svelte';
  import type { Crystal } from '../core/crystal';
  import {
    buildModel,
    defaultAppearance,
    resolveAppearance,
    type StructureModel,
  } from '../core/structure';
  import { rotateView } from '../core/orientation';
  import { safeName } from '../export/browser';
  import { structureImageRows, type ExportSection } from '../export/rows';
  import { StructureView } from '../render/structureView';
  import ExportMenu from './ExportMenu.svelte';
  import ViewCard from './kit/ViewCard.svelte';

  let {
    crystal,
    ns = 'specimen',
    name = '',
    title = 'Specimen',
    exportable = true,
  }: {
    crystal: Crystal | null;
    /** Prefix of the test ids (`<ns>-view`, `<ns>-canvas`, `<ns>-hud`): two cards share the page. */
    ns?: string;
    /** The file's name: the stem of the exported picture's name. */
    name?: string;
    title?: string;
    /** Show the Export menu (③ leaves it out: the card is a third of the width). */
    exportable?: boolean;
  } = $props();

  let stage = $state<HTMLDivElement>();
  let canvas: HTMLCanvasElement;
  let view: StructureView | null = null;
  let ready = $state(false);
  type Look = 'zone' | 'sidex' | 'sidey';
  let mode = $state<Look | null>('zone');
  const imageSections: ExportSection[] = [
    {
      title: 'Image of the view',
      image: true,
      rows: structureImageRows({
        view: () => view,
        background: () => '#ffffff',
        name: () => `${safeName(name || 'specimen')}_specimen`,
      }),
    },
  ];
  let model = $state.raw<StructureModel | null>(null);
  let error = $state('');
  const out = { x: 0, y: 0, visible: true };

  function project(x: number, y: number, z: number) {
    view!.project([x, y, z], out);
    return { x: out.x, y: out.y };
  }

  /** The specimen's x, y and z (the beam) as screen vectors; z is a dot when it points at the eye. */
  function axisTriad() {
    const o = project(0, 0, 0);
    const v = [project(1, 0, 0), project(0, 1, 0), project(0, 0, 1)].map((p) => ({
      x: p.x - o.x,
      y: p.y - o.y,
    }));
    const scale = 28 / (Math.max(...v.map((a) => Math.hypot(a.x, a.y))) || 1);
    const d = view!.viewDirection();
    return {
      v: v.map((a) => ({ x: a.x * scale, y: a.y * scale, len: Math.hypot(a.x, a.y) * scale })),
      into: [d[0] > 0, d[1] > 0, d[2] > 0],
    };
  }

  let triad = $state<ReturnType<typeof axisTriad> | null>(null);

  function onRender() {
    if (view && crystal) triad = axisTriad();
  }

  const LOOKS: { id: Look; label: string; title: string }[] = [
    { id: 'zone', label: 'Zone axis', title: 'Look down the beam (z)' },
    { id: 'sidex', label: 'Side x', title: 'Look along x, the beam (z) pointing down the screen' },
    { id: 'sidey', label: 'Side y', title: 'Look along y, the beam (z) pointing down the screen' },
  ];

  function look(m: Look) {
    mode = m;
    if (!view) return;
    if (m === 'zone') view.lookAlong([0, 0, 1], [0, 1, 0]);
    else if (m === 'sidey') view.lookAlong([0, 1, 0], [0, 0, -1]);
    else view.lookAlong([1, 0, 0], [0, 0, -1]);
    view.resetZoom();
  }

  /** Turn the specimen like a goniometer (degrees right, up, and clockwise about the view axis). */
  export function rotate(right: number, upward: number, roll: number): void {
    if (!view) return;
    const s = view.viewState();
    const f = rotateView({ direction: s.direction, up: s.up }, { right, upward, roll });
    view.lookAlong(f.direction, f.up);
    mode = null;
  }

  onMount(() => {
    view = new StructureView(canvas, { onRender });
    view.setPicking(false);
    view.setShowAxes(false); // the specimen's own x, y, z are drawn on top instead
    const observer = new ResizeObserver(() => {
      view?.resize();
      view?.requestRender();
    });
    observer.observe(stage!);
    ready = true;
    return () => {
      observer.disconnect();
      view?.dispose();
      view = null;
    };
  });

  $effect(() => {
    const c = crystal;
    if (!ready || !view || !c) return;
    try {
      const m = buildModel(c, {
        range: { min: [0, 0, 0], max: [1, 1, 1] },
        boundary: false,
        bonds: false,
      });
      model = m;
      view.setStructure(m, c.lattice, false);
      view.setAppearance(resolveAppearance(c, m, defaultAppearance(), [], []), true);
      view.setBondsDrawn(false);
      error = '';
      untrack(() => look(mode ?? 'zone'));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });
</script>

<ViewCard {title} square testid={`${ns}-view`}>
  {#snippet titleExtra()}
    {#if exportable}
      <ExportMenu
        sections={imageSections}
        disabled={!crystal}
        imageSize={() => view?.size ?? null}
        testid={`${ns}-export`}
        compact
      />
    {/if}
    <span class="seg" role="group" aria-label="Specimen view direction">
      {#each LOOKS as l (l.id)}
        <button
          type="button"
          aria-pressed={mode === l.id}
          title={l.title}
          onclick={() => look(l.id)}
          data-testid={`${ns}-look-${l.id}`}>{l.label}</button
        >
      {/each}
    </span>
  {/snippet}
  {#snippet tools()}
    <button
      type="button"
      disabled={!crystal}
      onclick={() => view?.resetZoom()}
      title="Magnification back to fit">Reset zoom</button
    >
  {/snippet}
  <div class="stage" bind:this={stage}>
    <canvas bind:this={canvas} data-testid={`${ns}-canvas`}></canvas>
    {#if !crystal}
      <p class="empty muted">Build the specimen to see it here.</p>
    {/if}
    {#if error}<p class="empty err" role="alert">✕ {error}</p>{/if}
    <svg class="overlay" aria-hidden="true">
      {#if triad && crystal}
        <g class="axes" transform="translate(40 {stage ? stage.clientHeight - 40 : 0})">
          {#each ['x', 'y', 'z'] as label, k (label)}
            {@const a = triad.v[k]}
            {#if a.len > 3}
              <line x1="0" y1="0" x2={a.x} y2={a.y} class={`ax-${label}`} />
              <text x={a.x * 1.35} y={a.y * 1.35 + 4}>{label}</text>
            {:else}
              <circle r="4" class={`dot ax-${label}`} />
              <text x="9" y="4">{label} {triad.into[k] ? '⊗' : '⊙'}</text>
            {/if}
          {/each}
        </g>
      {/if}
    </svg>
    {#if model}
      <p class="hud" data-testid={`${ns}-hud`}>{model.count.toLocaleString('en')} atoms</p>
    {/if}
  </div>
</ViewCard>

<style>
  .stage {
    position: absolute;
    inset: 0;
    background: #fff;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .axes line {
    stroke-width: 2;
  }
  .ax-x {
    stroke: #e5484d;
  }
  .ax-y {
    stroke: #30a46c;
  }
  .ax-z {
    stroke: #3b6fd4;
  }
  .axes .dot {
    fill: none;
    stroke-width: 2;
  }
  .axes text {
    font-size: 12px;
    fill: #0d1220;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: #5b6578;
  }
  .err {
    color: var(--err);
  }
  .hud {
    position: absolute;
    right: 0.5rem;
    bottom: 0.4rem;
    margin: 0;
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.85);
    color: #4f5566;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
</style>
