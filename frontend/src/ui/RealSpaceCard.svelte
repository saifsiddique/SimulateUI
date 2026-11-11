<script lang="ts">
  // ③ Real space (context.md §7.MU step U4): the projected potential of the supercell in the
  // specimen frame (Å, down the beam: +x left, +y up), with what the beam does in it:
  //   STEM / 4D-STEM  the scan field of view (drag it or its handles), the scan positions, the probe
  //                   footprint (FWHM and 99 % tail) and, shaded, the band along the box edge where
  //                   the probe's tail wraps round the periodic box;
  //   CBED            the probe at the box centre;
  //   HRTEM / SAED    the plane wave illuminates the whole periodic box.
  import { deltaToPlane, scanGrid } from '../core/plane';
  import { dragFov, type Fov, type FovHandle } from '../core/specimen';
  import { isProbe, isScan, simulation } from '../state/simulation.svelte';
  import { specimen } from '../state/specimen.svelte';
  import PlaneCard, { type PlaneMap } from './kit/PlaneCard.svelte';

  let { tab = '', square = true }: { tab?: string; square?: boolean } = $props();

  const r = $derived(specimen.result);
  const pv = $derived(simulation.preview);
  const p = $derived(simulation.ms);
  const box = $derived<[number, number] | null>(r ? [r.box[0], r.box[1]] : null);
  const bounds = $derived(box ? { u0: 0, u1: box[0], v0: 0, v1: box[1] } : null);
  const image = $derived(
    pv?.images.potential && pv.extents.potential
      ? {
          src: `data:image/png;base64,${pv.images.potential}`,
          bounds: { u0: 0, u1: pv.extents.potential[0], v0: 0, v1: pv.extents.potential[1] },
          testid: 'potential-preview',
          alt: 'Projected potential',
        }
      : null,
  );

  const scan = $derived(isScan(p.type));
  // The scan area, its positions and the edge band belong to the Scan tab: drawn only while it is
  // open, and only if its checkbox there is on.
  const showScan = $derived(scan && tab === 'scan' && simulation.overlays.scan);
  const fwhm = $derived(pv?.probe_profile?.fwhm ?? pv?.probe_fwhm ?? null);
  const tail = $derived(pv?.probe_profile?.tail ?? (fwhm ? 2 * fwhm : null));
  const step = $derived(pv?.scan_step ?? 0);
  const grid = $derived(showScan && specimen.fov && step > 0 ? scanGrid(specimen.fov, step) : null);

  let drag: { handle: FovHandle; x: number; y: number; start: Fov; m: PlaneMap } | null = null;
  function down(e: PointerEvent, handle: FovHandle, m: PlaneMap) {
    if (!specimen.fov) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { handle, x: e.clientX, y: e.clientY, start: { ...specimen.fov }, m };
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
    specimen.fov = dragFov(drag.start, drag.handle, dx, dy, box);
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
</script>

<PlaneCard
  title="Real space"
  {bounds}
  unit="Å"
  {image}
  dark
  empty="Build the supercell in ② to see it here."
  testid="realspace"
  {square}
>
  {#snippet overlay(m)}
    {#if box}
      {@const L = box}
      <polygon
        class="box"
        points={pts(m, [
          [0, 0],
          [L[0], 0],
          [L[0], L[1]],
          [0, L[1]],
        ])}
      />
      {#if !isProbe(p.type)}
        <polygon
          class="lit"
          points={pts(m, [
            [0, 0],
            [L[0], 0],
            [L[0], L[1]],
            [0, L[1]],
          ])}
          data-testid="illuminated"
        />
      {/if}
      <defs>
        <pattern
          id="wrap-hatch"
          class="hatch"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" />
        </pattern>
      </defs>
      {#if showScan && tail && tail > 0}
        {@const t = Math.min(tail, L[0] / 2, L[1] / 2)}
        <path
          class="wrap"
          fill-rule="evenodd"
          d={`M${pts(m, [
            [0, 0],
            [L[0], 0],
            [L[0], L[1]],
            [0, L[1]],
          ]).replaceAll(' ', ' L')} Z M${pts(m, [
            [t, t],
            [L[0] - t, t],
            [L[0] - t, L[1] - t],
            [t, L[1] - t],
          ]).replaceAll(' ', ' L')} Z`}
          data-testid="wrap-band"
          ><title
            >Closer to the box edge than the probe tail ({t.toFixed(1)} Å): the tail wraps round</title
          ></path
        >
      {/if}
      {#if showScan && specimen.fov}
        {@const f = specimen.fov}
        {#if grid}
          <g class="dots">
            {#each grid.points as [x, y], i (i)}
              {@const q = m.s(x, y)}
              <circle cx={q.x} cy={q.y} r="1.3" />
            {/each}
          </g>
        {/if}
        <polygon
          class="fov"
          role="button"
          tabindex="-1"
          aria-label="Scan field of view: drag to move"
          data-testid="fov-rect"
          points={pts(m, [
            [f.x0, f.y0],
            [f.x0 + f.w, f.y0],
            [f.x0 + f.w, f.y0 + f.h],
            [f.x0, f.y0 + f.h],
          ])}
          onpointerdown={(e) => down(e, 'move', m)}
          onpointermove={move}
          onpointerup={up}
        />
        {#each HANDLES as [hname, a, b] (hname)}
          {@const q = m.s(f.x0 + a * f.w, f.y0 + b * f.h)}
          <rect
            class="handle"
            role="button"
            tabindex="-1"
            aria-label={`Scan field of view: drag the ${hname} handle`}
            data-testid={`fov-handle-${hname}`}
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
      {#if isProbe(p.type) && fwhm && (!scan || showScan)}
        {@const c =
          showScan && specimen.fov
            ? [specimen.fov.x0 + specimen.fov.w / 2, specimen.fov.y0 + specimen.fov.h / 2]
            : [L[0] / 2, L[1] / 2]}
        {@const q = m.s(c[0], c[1])}
        <g class="probe" data-testid="probe-footprint">
          {#if tail}<circle cx={q.x} cy={q.y} r={tail * m.k} class="tail" />{/if}
          <circle cx={q.x} cy={q.y} r={Math.max(1.5, (fwhm / 2) * m.k)} class="core" />
        </g>
      {/if}
    {/if}
  {/snippet}
  {#snippet hud()}
    {#if box}
      <p>Box {box[0].toFixed(1)} × {box[1].toFixed(1)} Å</p>
    {/if}
    {#if grid}
      <p data-testid="scan-count">
        {grid.count.toLocaleString('en')} positions ({grid.nx} × {grid.ny}){grid.stride > 1
          ? ` · every ${grid.stride}th drawn`
          : ''}
      </p>
    {:else if box && !isProbe(p.type)}
      <p>Plane wave: the whole box is illuminated</p>
    {/if}
  {/snippet}
</PlaneCard>

<style>
  .box {
    fill: none;
    stroke: #f1f3f8;
    stroke-width: 1.5;
  }
  .lit {
    fill: color-mix(in srgb, var(--ov-fov) 12%, transparent);
    stroke: var(--ov-fov);
    stroke-width: 2;
    stroke-dasharray: 6 4;
    pointer-events: none;
  }
  .wrap {
    fill: url(#wrap-hatch);
    stroke: rgba(248, 113, 113, 0.7);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .hatch line {
    stroke: rgba(248, 113, 113, 0.55);
    stroke-width: 1.5;
  }
  .dots circle {
    fill: #e5e7eb;
    opacity: 0.85;
    pointer-events: none;
  }
  .fov {
    fill: color-mix(in srgb, var(--ov-fov) 14%, transparent);
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
  .probe circle {
    fill: none;
    pointer-events: none;
  }
  .probe .core {
    stroke: var(--ov-probe);
    stroke-width: 2;
    fill: color-mix(in srgb, var(--ov-probe) 35%, transparent);
  }
  .probe .tail {
    stroke: var(--ov-probe);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }
</style>
