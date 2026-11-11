<script lang="ts">
  // ③ Probe (context.md §7.MU step U4): the probe intensity at the entrance surface for the current
  // α, defocus and the aberrations, with its FWHM ring (solid) and the radius holding 99 % of the intensity
  // (dashed), on the same orientation and scale-bar rules as the real-space view.
  import { simulation } from '../state/simulation.svelte';
  import PlaneCard from './kit/PlaneCard.svelte';

  let { square = true }: { square?: boolean } = $props();

  const pv = $derived(simulation.preview);
  const e = $derived(pv?.extents.probe ?? null);
  const bounds = $derived(e ? { u0: -e[0] / 2, u1: e[0] / 2, v0: -e[1] / 2, v1: e[1] / 2 } : null);
  const image = $derived(
    pv?.images.probe && bounds
      ? {
          src: `data:image/png;base64,${pv.images.probe}`,
          bounds,
          testid: 'probe-preview',
          alt: 'Probe intensity',
        }
      : null,
  );
  const prof = $derived(pv?.probe_profile ?? null);
</script>

<PlaneCard
  title="Probe"
  {bounds}
  unit="Å"
  {image}
  dark
  {square}
  empty="Waiting for the probe…"
  testid="probe"
  exportName="probe"
>
  {#snippet overlay(m)}
    {@const o = m.s(0, 0)}
    {#if prof?.tail}
      <circle cx={o.x} cy={o.y} r={prof.tail * m.k} class="tail" />
    {/if}
    {#if prof?.fwhm}
      <circle
        cx={o.x}
        cy={o.y}
        r={(prof.fwhm / 2) * m.k}
        class="fwhm"
        data-testid="probe-fwhm-ring"
      />
    {/if}
  {/snippet}
  {#snippet hud()}
    {#if prof?.fwhm}
      <p data-testid="probe-fwhm">
        FWHM {prof.fwhm.toFixed(2)} Å{prof.tail ? ` · 99 % within ${prof.tail.toFixed(1)} Å` : ''}
      </p>
    {/if}
  {/snippet}
</PlaneCard>

<style>
  .fwhm,
  .tail {
    fill: none;
    stroke: #7dd3fc;
    stroke-width: 1.5;
    pointer-events: none;
  }
  .tail {
    stroke-dasharray: 5 4;
  }
</style>
