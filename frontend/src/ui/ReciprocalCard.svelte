<script lang="ts">
  // ③ Reciprocal space, Bloch wave (context.md §7.MU step U5): the reflections of the zone axis in
  // the pattern, down the beam (+x left, +y up), in 1/Å or mrad. The dashed circle is k max (drag
  // it); reflections the run keeps are coloured by their excitation error |s_g| (cyan at the Ewald
  // sphere, yellow at the cutoff), the others are grey. The marker size is the kinematic |F_g|; a
  // hollow ring is a forbidden reflection. For CBED and LACBED each kept reflection carries a disc
  // of the condenser radius.
  import { discAlpha, hklLabel, isIncluded, snapK, type Refl } from '../core/bloch';
  import { simulation, wavelength } from '../state/simulation.svelte';
  import PlaneCard, { type PlaneMap } from './kit/PlaneCard.svelte';

  let unit = $state<'inv' | 'mrad'>('inv');

  const f = $derived(simulation.factors);
  const b = $derived(simulation.bloch);
  const lam = $derived(wavelength(simulation.ms.energy));
  const conv = $derived(b.type !== 'saed');
  const alpha = $derived(conv ? discAlpha(b.alpha, b.pixel, lam) : 0);
  /** 1/Å -> plane units. */
  const c = (q: number) => (unit === 'inv' ? q : q * lam * 1e3);
  const half = 3;
  const bounds = $derived(f ? { u0: -c(half), u1: c(half), v0: -c(half), v1: c(half) } : null);

  const fMax = $derived(f?.f_max ?? 0);
  /** Weakest first, so the strong reflections are drawn on top. */
  const spots = $derived.by(() => {
    if (!f) return [];
    const out = f.refl.map((r) => {
      const inc = isIncluded(r, b.kMax, b.sgMax, alpha);
      const sEff = Math.max(0, Math.abs(r.sg) - Math.hypot(r.q[0], r.q[1]) * alpha);
      return {
        r,
        inc,
        t: Math.min(1, sEff / b.sgMax),
        w: fMax > 0 ? r.f / fMax : 0,
        dark: r.g > 0 && r.f < 1e-3 * fMax,
      };
    });
    return out.sort((a, z) => a.r.f - z.r.f);
  });
  const nIn = $derived(spots.filter((s) => s.inc).length);
  /** The few strongest kept reflections get their Miller indices. */
  const labelled = $derived(
    new Set(
      spots
        .filter((s) => s.inc && s.r.g > 0)
        .slice(-6)
        .map((s) => s.r),
    ),
  );
  const colour = (t: number) => `hsl(${190 - 150 * t} 85% 62%)`;
  const radius = (w: number) => 1.8 + 5.2 * Math.sqrt(w);

  let drag: { m: PlaneMap; rect: DOMRect } | null = null;
  function down(e: PointerEvent, m: PlaneMap) {
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { m, rect: svg.getBoundingClientRect() };
  }
  function move(e: PointerEvent) {
    if (!drag || !f) return;
    e.stopPropagation();
    const o = drag.m.s(0, 0);
    const px = Math.hypot(e.clientX - drag.rect.left - o.x, e.clientY - drag.rect.top - o.y);
    const plane = px / drag.m.k;
    simulation.bloch.kMax = snapK(unit === 'inv' ? plane : plane / (lam * 1e3), f.g_max);
  }
  function up(e: PointerEvent) {
    e.stopPropagation();
    drag = null;
  }
  const tip = (r: Refl) =>
    `${hklLabel(r.hkl)}  |g| ${r.g.toFixed(3)} Å⁻¹  |F| ${r.f.toFixed(4)} Å  s_g ${r.sg.toFixed(4)} Å⁻¹${r.zolz ? '' : '  (higher zone)'}`;
</script>

<PlaneCard
  title="Reciprocal space"
  {bounds}
  unit={unit === 'inv' ? 'Å⁻¹' : 'mrad'}
  axes={unit === 'inv' ? ['qx', 'qy'] : ['θx', 'θy']}
  dark
  empty="Waiting for the reflections of this zone axis…"
  testid="reciprocal"
  exportName="reciprocal_space"
>
  {#snippet titleExtra()}
    <span class="seg" role="group" aria-label="Reciprocal space units">
      <button type="button" aria-pressed={unit === 'inv'} onclick={() => (unit = 'inv')}>Å⁻¹</button
      ><button
        type="button"
        aria-pressed={unit === 'mrad'}
        onclick={() => (unit = 'mrad')}
        data-testid="reciprocal-mrad">mrad</button
      >
    </span>
  {/snippet}
  {#snippet overlay(m)}
    {@const o = m.s(0, 0)}
    <g class="spots" data-testid="reciprocal-diagram" data-count={nIn}>
      {#each spots as s (s.r.hkl.join(','))}
        {@const q = m.s(c(s.r.q[0]), c(s.r.q[1]))}
        {#if q.x > -12 && q.x < m.stage.w + 12 && q.y > -12 && q.y < m.stage.h + 12}
          {#if conv && s.inc && s.w > 0.05}
            <circle
              cx={q.x}
              cy={q.y}
              r={c(alpha / lam) * m.k}
              class="disc"
              style:stroke={colour(s.t)}
            />
          {/if}
          {#if s.dark}
            <circle cx={q.x} cy={q.y} r="2.6" class="dark"
              ><title>{tip(s.r)} (forbidden)</title></circle
            >
          {:else}
            <circle
              cx={q.x}
              cy={q.y}
              r={s.r.g === 0 ? 4.5 : radius(s.w)}
              class={s.inc ? (s.r.zolz ? 'on' : 'on holz') : 'off'}
              style:fill={s.inc ? (s.r.g === 0 ? '#f8fafc' : colour(s.t)) : undefined}
              data-testid={s.inc ? 'refl-in' : undefined}><title>{tip(s.r)}</title></circle
            >
          {/if}
          {#if labelled.has(s.r)}
            <text class="lbl" x={q.x + 6} y={q.y - 6}>{s.r.hkl.join(' ')}</text>
          {/if}
        {/if}
      {/each}
    </g>
    <circle cx={o.x} cy={o.y} r={c(b.kMax) * m.k} class="kmax" data-testid="kmax-circle" />
    <circle
      cx={o.x}
      cy={o.y}
      r={c(b.kMax) * m.k}
      class="hit"
      role="slider"
      tabindex="-1"
      aria-label="k max"
      aria-valuenow={b.kMax}
      data-testid="kmax-handle"
      onpointerdown={(e) => down(e, m)}
      onpointermove={move}
      onpointerup={up}
    />
    <text class="lbl k" x={o.x} y={o.y - c(b.kMax) * m.k - 6} text-anchor="middle"
      >k max {unit === 'inv'
        ? `${b.kMax.toFixed(2)} Å⁻¹`
        : `${(b.kMax * lam * 1e3).toFixed(1)} mrad`}</text
    >
  {/snippet}
  {#snippet hud()}
    {#if f}
      <p data-testid="reciprocal-count">
        {nIn} reflections inside k max · |s<sub>g</sub>| &lt; {b.sgMax}
      </p>
      {#if f.truncated}
        <p>Only the strongest {f.n} reflections are listed.</p>
      {/if}
    {/if}
  {/snippet}
  {#snippet controls()}
    <span class="legend" title="Excitation error of the kept reflections">
      <span>|s<sub>g</sub>| 0</span><span class="ramp"></span><span>{b.sgMax}</span>
    </span>
  {/snippet}
</PlaneCard>

<style>
  .spots circle {
    pointer-events: auto;
  }
  .on {
    stroke: rgba(11, 14, 22, 0.55);
    stroke-width: 0.6;
  }
  .holz {
    stroke: #fbbf24;
    stroke-width: 1.4;
  }
  .off {
    fill: #6b7280;
    fill-opacity: 0.28;
  }
  .dark {
    fill: none;
    stroke: #9ca3af;
    stroke-width: 1;
    stroke-opacity: 0.6;
  }
  .disc {
    fill: none;
    stroke-width: 0.8;
    stroke-opacity: 0.45;
    pointer-events: none;
  }
  .kmax {
    fill: none;
    stroke: #fde047;
    stroke-width: 1.8;
    stroke-dasharray: 6 4;
    pointer-events: none;
  }
  /* A wide transparent ring over the circle: easy to grab. */
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 14;
    cursor: ew-resize;
    pointer-events: stroke;
  }
  .hit:hover {
    stroke: rgba(255, 255, 255, 0.16);
  }
  .lbl {
    fill: #e5e7eb;
    font-size: 11px;
    pointer-events: none;
  }
  .lbl.k {
    fill: #fde047;
    font-size: 12px;
  }
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.1rem 0.45rem;
    border-radius: 6px;
    background: rgba(11, 14, 22, 0.7);
    color: #f1f3f8;
    font-size: 0.75rem;
  }
  .ramp {
    width: 3.5rem;
    height: 0.55rem;
    border-radius: 3px;
    background: linear-gradient(to right, hsl(190 85% 62%), hsl(115 85% 62%), hsl(40 85% 62%));
  }
</style>
