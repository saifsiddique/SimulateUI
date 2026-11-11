<script lang="ts">
  // ② "Crystal · beam": the crystal, turnable, with the periodic cell of the specimen outlined and
  // the beam along the zone axis. The zone axis lives in the specimen state: this view looks along
  // it, and turning the view sets it (a mouse drag, the arrow keys, or the ribbon's "Use the
  // crystal view").
  import { onMount, untrack } from 'svelte';
  import type { Crystal } from '../core/crystal';
  import {
    defaultUp,
    directionAlongUvw,
    directionNormalToHkl,
    readOrientation,
    rotateView,
    type ReadoutMemory,
  } from '../core/orientation';
  import type { Vec3 } from '../core/math/vec3';
  import {
    buildModel,
    defaultAppearance,
    defaultViewSettings,
    resolveAppearance,
    type StructureModel,
  } from '../core/structure';
  import { safeName } from '../export/browser';
  import { structureImageRows, type ExportSection } from '../export/rows';
  import { StructureView } from '../render/structureView';
  import { setZone, specimen } from '../state/specimen.svelte';
  import ExportMenu from './ExportMenu.svelte';
  import ViewCard from './kit/ViewCard.svelte';

  let {
    crystal,
    overlay = null,
    name = '',
  }: {
    crystal: Crystal | null;
    /** The periodic cell and beam arrow, as line segments in the crystal frame. */
    overlay?: Float32Array | null;
    /** The file's name: the stem of the exported picture's name. */
    name?: string;
  } = $props();

  let stage = $state<HTMLDivElement>();
  let canvas: HTMLCanvasElement;
  let view: StructureView | null = null;
  let ready = $state(false);
  let model = $state.raw<StructureModel | null>(null);
  let error = $state('');
  let readout = $state<{ indices: readonly number[]; angleDeg: number } | null>(null);

  const memory: ReadoutMemory = {};
  let readLattice: unknown = null;
  // The zone the view was last sent to or read from; a different value in the state is a request.
  let syncedKey = '';
  const zoneKey = (axis: readonly number[], up: readonly number[] | null) =>
    `${axis.join(',')}|${up ? up.map((x) => x.toFixed(5)).join(',') : ''}`;

  function updateReadout() {
    if (!view || !crystal) {
      readout = null;
      return;
    }
    const { direction } = view.viewState();
    if (crystal.lattice !== readLattice) {
      delete memory.uvw;
      delete memory.hkl;
      readLattice = crystal.lattice;
    }
    const r = readOrientation(crystal.lattice, direction, memory);
    const next = { indices: r.uvw.indices, angleDeg: r.uvw.angleDeg };
    if (
      !readout ||
      readout.indices.join() !== next.indices.join() ||
      readout.angleDeg !== next.angleDeg
    )
      readout = next;
  }

  /** The view's direction becomes the specimen's zone axis. */
  export function useView(): void {
    if (!view || !crystal) return;
    updateReadout();
    if (!readout || readout.indices.every((n) => n === 0)) return;
    const { up } = view.viewState();
    const axis = readout.indices.map((n) => Math.round(n)) as [number, number, number];
    syncedKey = zoneKey(axis, up);
    setZone(axis, [...up] as [number, number, number]);
  }

  /** Look along the lattice direction [uvw] and make it the zone axis. */
  export function lookAlongUvw(uvw: Vec3): void {
    if (!view || !crystal) return;
    view.lookAlong(
      directionAlongUvw(crystal.lattice, uvw),
      defaultUp(crystal.lattice, directionAlongUvw(crystal.lattice, uvw)),
    );
    useView();
  }

  /** Look along the normal of the plane (hkl); the nearest lattice direction becomes the zone axis. */
  export function lookNormalToHkl(hkl: Vec3): void {
    if (!view || !crystal) return;
    const direction = directionNormalToHkl(crystal.lattice, hkl);
    view.lookAlong(direction, defaultUp(crystal.lattice, direction));
    useView();
  }

  function lookAlongZone() {
    if (!view || !crystal) return;
    const axis = specimen.params.zoneAxis;
    const direction = directionAlongUvw(crystal.lattice, axis);
    const up = specimen.params.yDirection ?? defaultUp(crystal.lattice, direction);
    syncedKey = zoneKey(axis, specimen.params.yDirection);
    view.lookAlong(direction, up);
    updateReadout();
  }

  function turn(right: number, upward: number, roll: number) {
    if (!view) return;
    const s = view.viewState();
    const f = rotateView({ direction: s.direction, up: s.up }, { right, upward, roll });
    view.lookAlong(f.direction, f.up);
    useView();
  }

  /** Turn the crystal like a goniometer; the new direction becomes the zone axis. */
  export function rotate(right: number, upward: number, roll: number): void {
    turn(right, upward, roll);
  }

  const ARROWS: Record<string, [number, number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };

  function onKeydown(e: KeyboardEvent) {
    const a = ARROWS[e.key];
    if (!a || e.metaKey || !view || !crystal) return;
    e.preventDefault();
    const size = e.shiftKey ? 1 : e.ctrlKey ? 15 : 5;
    if (e.altKey) turn(0, 0, a[0] * size);
    else turn(a[0] * size, a[1] * size, 0);
  }

  onMount(() => {
    view = new StructureView(canvas, {
      onRender: updateReadout,
      onGestureEnd: (rotated) => {
        if (rotated) useView();
      },
    });
    const observer = new ResizeObserver(() => {
      view?.resize();
      view?.requestRender();
    });
    observer.observe(stage!);
    (window as unknown as Record<string, unknown>).__beamview = {
      overlayCount: () => view!.overlayCount,
      viewState: () => view!.viewState(),
    };
    ready = true;
    return () => {
      observer.disconnect();
      view?.dispose();
      view = null;
    };
  });

  let builtFor: Crystal | null = null;

  $effect(() => {
    if (!ready || !view) return;
    const c = crystal;
    if (builtFor === c) return;
    builtFor = c;
    untrack(() => {
      if (!c) {
        model = null;
        return;
      }
      try {
        const { range, bonds } = defaultViewSettings(null);
        const m = buildModel(c, { range, boundary: range.boundary, bonds });
        model = m;
        view!.setStructure(m, c.lattice, false);
        view!.setAppearance(resolveAppearance(c, m, defaultAppearance(), m.rules, []), true);
        lookAlongZone();
        error = '';
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    });
  });

  // A zone axis set elsewhere (the Structure tab, the ribbon) turns this view.
  $effect(() => {
    const key = zoneKey(specimen.params.zoneAxis, specimen.params.yDirection);
    if (!ready || !view || !crystal || key === syncedKey) return;
    untrack(lookAlongZone);
  });

  $effect(() => {
    if (ready) view?.setOverlayLines(overlay);
  });

  const imageSections: ExportSection[] = [
    {
      title: 'Image of the view',
      image: true,
      rows: structureImageRows({
        view: () => view,
        background: () => '#ffffff',
        name: () => `${safeName(name || crystal?.name || 'crystal')}_crystal_beam`,
      }),
    },
  ];
</script>

<ViewCard title="Crystal · beam" square testid="crystal-card">
  {#snippet titleExtra()}
    <ExportMenu
      sections={imageSections}
      disabled={!crystal}
      imageSize={() => view?.size ?? null}
      testid="crystal-export"
      compact
    />
  {/snippet}
  {#snippet tools()}
    <button
      type="button"
      disabled={!crystal}
      onclick={() => view?.resetZoom()}
      title="Magnification back to fit; the orientation stays">Reset zoom</button
    >
  {/snippet}
  <!-- The stage takes arrow keys to tilt the crystal, so it has to be focusable. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="stage"
    role="application"
    aria-label="Crystal and beam. Arrow keys tilt the crystal."
    bind:this={stage}
    tabindex="0"
    onkeydown={onKeydown}
    onpointerdown={() => stage?.focus({ preventScroll: true })}
    data-testid="crystal-view"
  >
    <canvas bind:this={canvas} class:off={!crystal} data-testid="crystal-canvas"></canvas>
    {#if crystal && readout}
      <span class="readout" data-testid="beam-readout">
        Beam along [{readout.indices.join(' ')}] · {readout.angleDeg.toFixed(2)}° off
      </span>
    {/if}
    {#if error}<p class="empty err" role="alert">✕ {error}</p>{/if}
    {#if model}
      <p class="hud" data-testid="crystal-hud">{model.count.toLocaleString('en')} atoms</p>
    {/if}
  </div>
</ViewCard>

<style>
  .stage {
    position: absolute;
    inset: 0;
    background: #fff;
    outline: none;
    touch-action: none;
  }
  .stage:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }
  canvas.off {
    visibility: hidden;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
  }
  .err {
    color: var(--err);
  }
  .readout,
  .hud {
    position: absolute;
    margin: 0;
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.85);
    color: #0d1220;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .readout {
    left: 0.5rem;
    top: 0.5rem;
  }
  .hud {
    right: 0.5rem;
    bottom: 0.4rem;
    color: #4f5566;
  }
</style>
