<script lang="ts">
  // ③ INCOSTEM point-spread function (context.md §7.MU step U6): the probe intensity (with all the
  // aberrations) blurred by the source and the defocus spread: what every atom is convolved with.
  // The solid ring is its FWHM, the dashed one the radius holding 99 % of the intensity.
  import { simulation } from '../state/simulation.svelte';
  import PlaneCard from './kit/PlaneCard.svelte';

  let { square = true }: { square?: boolean } = $props();

  const res = $derived(simulation.incostemResult);
  const psf = $derived(res?.psf ?? null);
  const bounds = $derived(
    psf
      ? {
          u0: -psf.extent[0] / 2,
          u1: psf.extent[0] / 2,
          v0: -psf.extent[1] / 2,
          v1: psf.extent[1] / 2,
        }
      : null,
  );
  const image = $derived(
    psf && bounds
      ? {
          src: `data:image/png;base64,${psf.png}`,
          bounds,
          testid: 'psf-preview',
          alt: 'Point-spread function',
        }
      : null,
  );
  const prof = $derived(psf?.profile ?? null);
</script>

<PlaneCard
  title="Point-spread function"
  {bounds}
  unit="Å"
  {image}
  dark
  empty="Waiting for the probe…"
  testid="psf"
  exportName="psf"
  {square}
>
  {#snippet overlay(m)}
    {@const o = m.s(0, 0)}
    {#if prof?.tail}
      <circle cx={o.x} cy={o.y} r={prof.tail * m.k} class="tail" />
    {/if}
    {#if prof?.fwhm}
      <circle cx={o.x} cy={o.y} r={(prof.fwhm / 2) * m.k} class="fwhm" data-testid="psf-ring" />
    {/if}
  {/snippet}
  {#snippet hud()}
    {#if prof?.fwhm}
      <p data-testid="psf-fwhm">
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
