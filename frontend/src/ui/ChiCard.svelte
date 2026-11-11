<script lang="ts">
  // ③ Aberration phase χ(k) (context.md §7.MU step U4): the phase the probe-forming lens adds at
  // each angle, for the defocus and the Aberrations table, up to 1.25 α. Computed here, so it follows
  // every keystroke. The colours wrap every 2π (a cyclic map); outside the aperture α it is dimmed.
  // The dashed circle is where |χ| first reaches π/4, the usual limit of a "flat" phase.
  import { chiMap, chiTerms, phaseColor } from '../core/chi';
  import { simulation, wavelength } from '../state/simulation.svelte';
  import PlaneCard from './kit/PlaneCard.svelte';

  let { square = true }: { square?: boolean } = $props();

  const p = simulation.ms;
  const half = $derived(Math.max(1, 1.25 * p.alpha));
  const map = $derived(chiMap(chiTerms(p.ab, p.defocus), wavelength(p.energy), p.alpha, half, 192));
  const bounds = $derived({ u0: -half, u1: half, v0: -half, v1: half });

  const src = $derived.by(() => {
    if (typeof document === 'undefined') return '';
    const { n, values } = map;
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(n, n);
    const step = (2 * half) / (n - 1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const [r, g, b] = phaseColor(values[k]);
        const inside = Math.hypot(half - i * step, half - j * step) <= p.alpha;
        const f = inside ? 1 : 0.4;
        img.data[4 * k] = r * f;
        img.data[4 * k + 1] = g * f;
        img.data[4 * k + 2] = b * f;
        img.data[4 * k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  });
  const image = $derived(
    src ? { src, bounds, testid: 'chi-preview', alt: 'Aberration phase χ(k)' } : null,
  );
  const piText = (v: number) => `${(v / Math.PI).toFixed(v < Math.PI ? 2 : 1)} π`;
</script>

<PlaneCard
  title="Aberration phase"
  {bounds}
  unit="mrad"
  axes={['θx', 'θy']}
  {image}
  dark
  {square}
  testid="chi"
  exportName="aberration_phase"
>
  {#snippet overlay(m)}
    {@const o = m.s(0, 0)}
    <circle cx={o.x} cy={o.y} r={p.alpha * m.k} class="ap" data-testid="chi-aperture" />
    {#if map.flatRadius !== null && map.flatRadius < p.alpha}
      <circle cx={o.x} cy={o.y} r={map.flatRadius * m.k} class="flat" data-testid="chi-flat" />
    {/if}
  {/snippet}
  {#snippet hud()}
    <p data-testid="chi-max">
      {map.maxInside === 0
        ? 'χ = 0: no aberrations, no defocus'
        : `|χ| up to ${piText(map.maxInside)} inside α`}
    </p>
    {#if map.flatRadius !== null && map.flatRadius < p.alpha}
      <p data-testid="chi-flat-text">|χ| &lt; π/4 within {map.flatRadius.toFixed(1)} mrad</p>
    {/if}
  {/snippet}
  {#snippet controls()}
    <span class="legend" title="The colours repeat every 2π">
      <span class="ramp"></span><span>0 → 2π</span>
    </span>
  {/snippet}
</PlaneCard>

<style>
  .ap,
  .flat {
    fill: none;
    stroke: #f1f3f8;
    stroke-width: 1.5;
    pointer-events: none;
  }
  .flat {
    stroke: #fde047;
    stroke-dasharray: 5 4;
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
    width: 4rem;
    height: 0.55rem;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      rgb(226 217 226),
      rgb(94 134 193),
      rgb(47 20 54),
      rgb(178 86 82),
      rgb(226 217 226)
    );
  }
</style>
