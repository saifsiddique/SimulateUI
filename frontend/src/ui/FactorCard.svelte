<script lang="ts">
  // ③ Structure factors, Bloch wave (context.md §7.MU step U5): the kinematic |F_g| of every
  // reflection of the zone axis against |g|, on a log scale relative to the strongest one. Together
  // with the cumulative share of the kinematic intensity (right axis) it shows where more beams stop
  // adding anything: that is where k max can be set. Drag in the plot, or use the buttons, to set it.
  // Filled markers are kept by the run (circle: zero-order zone, diamond: a higher zone), grey ones
  // lie outside k max or too far off the Ewald sphere; a tick on the floor is a forbidden reflection.
  import {
    cumulative,
    discAlpha,
    fractionWithin,
    hklLabel,
    isIncluded,
    kMaxForFraction,
    logFrac,
    snapK,
  } from '../core/bloch';
  import { safeName } from '../export/browser';
  import { svgImageRows, type ExportSection } from '../export/rows';
  import { simulation, wavelength } from '../state/simulation.svelte';
  import ExportMenu from './ExportMenu.svelte';
  import ViewCard from './kit/ViewCard.svelte';

  const f = $derived(simulation.factors);
  const b = $derived(simulation.bloch);
  const lam = $derived(wavelength(simulation.ms.energy));
  const alpha = $derived(b.type === 'saed' ? 0 : discAlpha(b.alpha, b.pixel, lam));

  let stageEl = $state<HTMLDivElement>();
  let svgEl = $state<SVGSVGElement>();
  let w = $state(0);
  let h = $state(0);
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

  const L = 54;
  const R = 46;
  const T = 58;
  const B = 46;
  const pw = $derived(Math.max(10, w - L - R));
  const ph = $derived(Math.max(10, h - T - B));
  const gMax = $derived(f?.g_max ?? 5);
  const x = (g: number) => L + (g / gMax) * pw;
  const y = (frac: number) => T + (1 - frac) * ph;

  const fMax = $derived(f?.f_max ?? 0);
  const cum = $derived(f ? cumulative(f.refl, b.sgMax, alpha) : null);
  const share = $derived(cum ? fractionWithin(cum, b.kMax) : 0);

  type Cat = 'inZ' | 'inH' | 'offZ' | 'offH';
  /** One path per kind of reflection: stems from the floor and the markers, so thousands are cheap. */
  const paths = $derived.by(() => {
    const out: Record<Cat | 'dark', { stem: string; mark: string }> = {
      inZ: { stem: '', mark: '' },
      inH: { stem: '', mark: '' },
      offZ: { stem: '', mark: '' },
      offH: { stem: '', mark: '' },
      dark: { stem: '', mark: '' },
    };
    if (!f || !(fMax > 0)) return out;
    for (const r of f.refl) {
      if (r.g === 0) continue;
      const px = x(r.g);
      const floor = y(0);
      if (r.f < 1e-3 * fMax) {
        out.dark.mark += `M${px.toFixed(1)},${floor.toFixed(1)}v-5`;
        continue;
      }
      const py = y(logFrac(r.f, fMax));
      const inc = isIncluded(r, b.kMax, b.sgMax, alpha);
      const cat: Cat = inc ? (r.zolz ? 'inZ' : 'inH') : r.zolz ? 'offZ' : 'offH';
      out[cat].stem += `M${px.toFixed(1)},${floor.toFixed(1)}V${py.toFixed(1)}`;
      const s = 3.4;
      out[cat].mark += r.zolz
        ? `M${(px - s).toFixed(1)},${py.toFixed(1)}a${s},${s} 0 1,0 ${2 * s},0a${s},${s} 0 1,0 ${-2 * s},0`
        : `M${px.toFixed(1)},${(py - s - 1).toFixed(1)}l${s + 1},${s + 1}l${-(s + 1)},${s + 1}l${-(s + 1)},${-(s + 1)}z`;
    }
    return out;
  });

  /** The strongest reflections inside k max get their Miller indices. */
  const top = $derived.by(() => {
    if (!f) return [];
    const seen: string[] = [];
    const out: typeof f.refl = [];
    const strongest = f.refl
      .filter((r) => r.g > 0 && isIncluded(r, b.kMax, b.sgMax, alpha) && r.f >= 1e-3 * fMax)
      .sort((a, z) => z.f - a.f);
    for (const r of strongest) {
      const key = r.g.toFixed(3);
      if (seen.includes(key) || out.length >= 5) continue;
      seen.push(key);
      if (out.every((o) => Math.abs(x(o.g) - x(r.g)) > 34)) out.push(r);
    }
    return out;
  });

  const curve = $derived.by(() => {
    if (!cum || !cum.g.length) return '';
    let d = `M${x(0)},${y(0)}`;
    let prev = 0;
    for (let i = 0; i < cum.g.length; i++) {
      d += `L${x(cum.g[i]).toFixed(1)},${y(prev).toFixed(1)}L${x(cum.g[i]).toFixed(1)},${y(cum.frac[i]).toFixed(1)}`;
      prev = cum.frac[i];
    }
    return d + `L${x(gMax)},${y(prev)}`;
  });

  const xTicks = $derived(
    Array.from({ length: Math.floor(gMax / 0.5) + 1 }, (_, i) => i * 0.5).filter(
      (g) => g <= gMax + 1e-9,
    ),
  );
  const yTicks = [
    { frac: 1, label: '1' },
    { frac: 0.75, label: '0.1' },
    { frac: 0.5, label: '0.01' },
    { frac: 0.25, label: '10⁻³' },
    { frac: 0, label: '10⁻⁴' },
  ];

  function setFromPointer(e: PointerEvent) {
    if (!f || !svgEl) return;
    const r = svgEl.getBoundingClientRect();
    simulation.bloch.kMax = snapK(((e.clientX - r.left - L) / pw) * gMax, gMax);
  }
  function down(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setFromPointer(e);
  }
  function move(e: PointerEvent) {
    if (e.buttons === 1) setFromPointer(e);
  }
  function key(e: KeyboardEvent) {
    const d = e.shiftKey ? 0.25 : 0.05;
    if (e.key === 'ArrowRight') simulation.bloch.kMax = snapK(b.kMax + d, gMax);
    else if (e.key === 'ArrowLeft') simulation.bloch.kMax = snapK(b.kMax - d, gMax);
    else return;
    e.preventDefault();
  }
  function forShare(p: number) {
    if (!cum || !f) return;
    const k = kMaxForFraction(cum, p, f.g_max);
    if (k !== null) simulation.bloch.kMax = k;
  }

  const sections = $derived<ExportSection[]>([
    {
      title: 'Image of the plot',
      image: true,
      rows: svgImageRows({
        get: () => svgEl,
        name: () => safeName('structure_factors', 'plot'),
        background: '#ffffff',
      }),
    },
  ]);
</script>

<ViewCard title="Structure factors" square testid="factors">
  {#snippet titleExtra()}
    <ExportMenu
      {sections}
      disabled={!f}
      imageSize={() => (svgEl ? { width: w, height: h } : null)}
      testid="factors-export"
      compact
    />
    <span class="lead">k max for</span>
    <span class="seg" role="group" aria-label="Set k max from the kinematic intensity">
      {#each [0.9, 0.99, 0.999] as p (p)}
        <button
          type="button"
          disabled={!cum}
          onclick={() => forShare(p)}
          title={`The smallest k max that keeps ${p * 100} % of the kinematic intensity`}
          data-testid={`kmax-pct-${Math.round(p * 1000)}`}>{+(p * 100).toFixed(1)} %</button
        >
      {/each}
    </span>
  {/snippet}
  <div class="stage" bind:this={stageEl}>
    {#if !f}
      <p class="empty">Waiting for the structure factors of this zone axis…</p>
    {:else}
      <svg
        bind:this={svgEl}
        role="img"
        aria-label="Kinematic structure factors against |g|"
        data-testid="factors-svg"
      >
        <rect x="0" y="0" width={w} height={h} class="paper" data-export-bg />
        <text class="head" x={L} y="20" data-testid="factors-head"
          >k max {b.kMax.toFixed(2)} Å⁻¹ keeps {(share * 100).toFixed(1)} % of the kinematic intensity</text
        >
        <text class="sub" x={L} y="36" data-testid="factors-note"
          >Kinematic |F| of {f.n} reflections, relative to the strongest (log scale)</text
        >
        {#each yTicks as t (t.frac)}
          <line class="grid" x1={L} x2={L + pw} y1={y(t.frac)} y2={y(t.frac)} />
          <text class="tick" x={L - 6} y={y(t.frac) + 4} text-anchor="end">{t.label}</text>
        {/each}
        {#each xTicks as g (g)}
          <line class="grid v" x1={x(g)} x2={x(g)} y1={T} y2={T + ph} />
          <text class="tick" x={x(g)} y={T + ph + 16} text-anchor="middle">{g}</text>
        {/each}
        {#each [0, 0.25, 0.5, 0.75, 1] as t (t)}
          <text class="tick cum" x={L + pw + 6} y={y(t) + 4}>{t * 100}</text>
        {/each}
        <text class="axis" x={L + pw / 2} y={h - 8} text-anchor="middle">|g| (Å⁻¹)</text>
        <text
          class="axis"
          x="14"
          y={T + ph / 2}
          text-anchor="middle"
          transform={`rotate(-90 14 ${T + ph / 2})`}>|F| / |F|max</text
        >
        <text
          class="axis cum"
          x={w - 12}
          y={T + ph / 2}
          text-anchor="middle"
          transform={`rotate(90 ${w - 12} ${T + ph / 2})`}>cumulative intensity (%)</text
        >
        <path d={curve} class="curve" data-testid="factors-cumulative" />
        <path d={paths.offZ.stem + paths.offH.stem} class="stem off" />
        <path d={paths.offZ.mark} class="mark off" />
        <path d={paths.offH.mark} class="mark off" />
        <path d={paths.dark.mark} class="dark" />
        <path d={paths.inZ.stem + paths.inH.stem} class="stem on" />
        <path d={paths.inZ.mark} class="mark on" data-testid="factors-in" />
        <path d={paths.inH.mark} class="mark on holz" />
        {#each top as r (r.hkl.join(','))}
          <text class="lbl" x={x(r.g)} y={y(logFrac(r.f, fMax)) - 9} text-anchor="middle"
            >{hklLabel(r.hkl).slice(1, -1)}</text
          >
        {/each}
        <line class="kline" x1={x(b.kMax)} x2={x(b.kMax)} y1={T - 4} y2={T + ph} />
        <path class="khandle" d={`M${x(b.kMax) - 6},${T - 10}h12l-6,8z`} />
        <rect
          x={L}
          y={T - 12}
          width={pw}
          height={ph + 12}
          class="hit"
          role="slider"
          tabindex="0"
          aria-label="k max"
          aria-valuemin="0.2"
          aria-valuemax={gMax}
          aria-valuenow={b.kMax}
          data-testid="factors-hit"
          onpointerdown={down}
          onpointermove={move}
          onkeydown={key}
        />
      </svg>
    {/if}
  </div>
</ViewCard>

<style>
  .stage {
    position: absolute;
    inset: 0;
    background: #fff;
    overflow: hidden;
    color: #0d1220;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    user-select: none;
    touch-action: none;
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
  .lead {
    padding: 0 0.4rem;
    color: var(--muted);
    font-size: 0.78rem;
    align-self: center;
  }
  .paper {
    fill: #fff;
  }
  .head {
    fill: #0d1220;
    font-size: 12.5px;
    font-weight: 600;
  }
  .sub,
  .axis {
    fill: #5b6578;
    font-size: 11px;
  }
  .tick {
    fill: #5b6578;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .cum {
    fill: #b45309;
  }
  .grid {
    stroke: #e3e7ee;
    stroke-width: 1;
  }
  .grid.v {
    stroke: #f0f2f6;
  }
  .curve {
    fill: none;
    stroke: #d97706;
    stroke-width: 1.8;
  }
  .stem {
    fill: none;
    stroke-width: 1;
  }
  .stem.on {
    stroke: #1f6f66;
  }
  .stem.off {
    stroke: #dde1e9;
  }
  .mark.on {
    fill: #1f6f66;
  }
  .mark.on.holz {
    fill: #fff;
    stroke: #1f6f66;
    stroke-width: 1.4;
  }
  .mark.off {
    fill: #d3d8e1;
  }
  .dark {
    fill: none;
    stroke: #8a93a3;
    stroke-width: 1.2;
  }
  .lbl {
    fill: #0d1220;
    font-size: 10.5px;
  }
  .kline {
    stroke: #be123c;
    stroke-width: 1.8;
    stroke-dasharray: 6 4;
  }
  .khandle {
    fill: #be123c;
  }
  .hit {
    fill: transparent;
    cursor: ew-resize;
  }
  .hit:focus-visible {
    outline: none;
    stroke: #be123c;
    stroke-width: 1;
  }
</style>
