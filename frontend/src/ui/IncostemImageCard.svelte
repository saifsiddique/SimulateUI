<script lang="ts">
  // ③ INCOSTEM image (context.md §7.MU step U6): the incoherent ADF-STEM image of the field of view,
  // drawn in the specimen frame (Å, down the beam: +x left, +y up) inside the outline of the whole
  // periodic box. While the Image tab is open the field of view is a rectangle you drag (or resize
  // by its handles) to look elsewhere; the image follows. The grey scale runs from the darkest to
  // the brightest pixel.
  import { deltaToPlane } from '../core/plane';
  import { dragFov, type Fov, type FovHandle } from '../core/specimen';
  import { incostemFov, simulation } from '../state/simulation.svelte';
  import { specimen } from '../state/specimen.svelte';
  import PlaneCard, { type PlaneMap } from './kit/PlaneCard.svelte';

  /** The sidebar tab that is open: the field-of-view handles belong to Image. */
  let { tab = '', square = true }: { tab?: string; square?: boolean } = $props();

  const r = $derived(specimen.result);
  const res = $derived(simulation.incostemResult);
  const box = $derived<[number, number] | null>(r ? [r.box[0], r.box[1]] : null);
  const bounds = $derived(box ? { u0: 0, u1: box[0], v0: 0, v1: box[1] } : null);
  const fov = $derived(incostemFov());
  const image = $derived(
    res
      ? {
          src: `data:image/png;base64,${res.png}`,
          bounds: {
            u0: res.fov[0],
            u1: res.fov[0] + res.fov[2],
            v0: res.fov[1],
            v1: res.fov[1] + res.fov[3],
          },
          testid: 'incostem-preview',
          alt: 'Incoherent ADF-STEM image',
        }
      : null,
  );
  const showFov = $derived(tab === 'image' && simulation.overlays.incFov);

  let drag: { handle: FovHandle; x: number; y: number; start: Fov; m: PlaneMap } | null = null;
  function down(e: PointerEvent, handle: FovHandle, m: PlaneMap) {
    if (!fov) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { handle, x: e.clientX, y: e.clientY, start: { ...fov }, m };
  }
  function move(e: PointerEvent) {
    if (!drag || !box) return;
    e.stopPropagation();
    const [dx, dy] = deltaToPlane(
      drag.m.view,
      drag.m.stage,
      e.clientX - drag.x,
      e.clientY - drag.y,
    );
    simulation.incostem.fov = dragFov(drag.start, drag.handle, dx, dy, box);
  }
  function up(e: PointerEvent) {
    e.stopPropagation();
    drag = null;
  }

  type Edge = Exclude<FovHandle, 'move'>;
  const HANDLES: [Edge, number, number][] = [
    ['sw', 0, 0],
    ['se', 1, 0],
    ['ne', 1, 1],
    ['nw', 0, 1],
    ['n', 0.5, 1],
    ['s', 0.5, 0],
    ['e', 1, 0.5],
    ['w', 0, 0.5],
  ];
  const pts = (m: PlaneMap, c: [number, number][]) =>
    c
      .map(([u, v]) => {
        const q = m.s(u, v);
        return `${q.x},${q.y}`;
      })
      .join(' ');
  const rect = (f: { x0: number; y0: number; w: number; h: number }): [number, number][] => [
    [f.x0, f.y0],
    [f.x0 + f.w, f.y0],
    [f.x0 + f.w, f.y0 + f.h],
    [f.x0, f.y0 + f.h],
  ];
  const sci = (v: number) => v.toExponential(2).replace('e-', ' × 10⁻').replace('e+', ' × 10');
</script>

<PlaneCard
  title="Image (ADF)"
  {bounds}
  unit="Å"
  {image}
  dark
  empty="Build the supercell in ② to compute an image."
  testid="incostem"
  exportName="incostem_image"
  {square}
>
  {#snippet overlay(m)}
    {#if box}
      <polygon
        class="box"
        points={pts(m, rect({ x0: 0, y0: 0, w: box[0], h: box[1] }))}
        data-testid="incostem-box"
      />
      {#if res}
        <polygon
          class="frame"
          points={pts(m, rect({ x0: res.fov[0], y0: res.fov[1], w: res.fov[2], h: res.fov[3] }))}
        />
      {/if}
      {#if showFov && fov}
        <polygon
          class="fov"
          role="button"
          tabindex="-1"
          aria-label="Field of view: drag to move"
          data-testid="incostem-fov"
          points={pts(m, rect(fov))}
          onpointerdown={(e) => down(e, 'move', m)}
          onpointermove={move}
          onpointerup={up}
        />
        {#each HANDLES as [hname, a, b] (hname)}
          {@const q = m.s(fov.x0 + a * fov.w, fov.y0 + b * fov.h)}
          <rect
            class="handle"
            role="button"
            tabindex="-1"
            aria-label={`Field of view: drag the ${hname} handle`}
            data-testid={`incostem-fov-handle-${hname}`}
            x={q.x - 5}
            y={q.y - 5}
            width="10"
            height="10"
            onpointerdown={(e) => down(e, hname, m)}
            onpointermove={move}
            onpointerup={up}
          />
        {/each}
      {/if}
    {/if}
  {/snippet}
  {#snippet hud()}
    {#if res}
      <p data-testid="incostem-info">
        {res.shape[0]} × {res.shape[1]} px · {res.pixel[0].toFixed(3)} Å/px · {res.fov[2].toFixed(
          1,
        )} × {res.fov[3].toFixed(1)} Å
      </p>
      <p data-testid="incostem-range">
        {res.noisy ? 'electrons' : 'fraction of the beam'}: {sci(res.vmin)} to {sci(res.vmax)}
      </p>
    {/if}
  {/snippet}
</PlaneCard>

<style>
  .box {
    fill: none;
    stroke: #f1f3f8;
    stroke-width: 1.5;
    pointer-events: none;
  }
  .frame {
    fill: none;
    stroke: #9ca3af;
    stroke-width: 1;
    stroke-dasharray: 3 3;
    pointer-events: none;
  }
  .fov {
    fill: color-mix(in srgb, var(--ov-fov) 10%, transparent);
    stroke: var(--ov-fov);
    stroke-width: 2;
    stroke-dasharray: 6 4;
    cursor: move;
  }
  .handle {
    fill: #fff;
    stroke: var(--ov-fov);
    stroke-width: 2;
    cursor: crosshair;
  }
</style>
