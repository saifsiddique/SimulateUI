<script lang="ts">
  // The thermal displacement σ of each element (context.md §7.MU steps U4, U5), shared by the
  // multislice frozen phonons and the Bloch-wave Debye-Waller factor. The default is √U_iso of the
  // CIF; a value typed here replaces it for that element (↺ goes back).
  import { simulation, sigmaDefaults } from '../state/simulation.svelte';
  import NumberField from './kit/NumberField.svelte';

  let { disabled = false }: { disabled?: boolean } = $props();

  const rows = $derived(sigmaDefaults());
</script>

<div class="sigmas" data-testid="sigmas">
  <p class="muted small">
    Displacement σ of each element (root mean square along one axis). The start value is √U<sub
      >iso</sub
    > of the CIF.
  </p>
  {#each rows as r (r.element)}
    <NumberField
      label={r.element}
      unit="Å"
      min={0}
      max={1}
      step={0.005}
      def={r.sigma}
      {disabled}
      help={r.assumed
        ? 'The CIF has no Uiso for this element: 0.08 Å is assumed.'
        : 'From the Uiso of the CIF.'}
      testid={`sigma-${r.element}`}
      bind:value={
        () => simulation.sigmas[r.element] ?? r.sigma, (v) => (simulation.sigmas[r.element] = v)
      }
    />
    {#if r.assumed}
      <p class="muted small assumed" data-testid={`sigma-${r.element}-assumed`}>
        {r.element}: no U<sub>iso</sub> in the CIF, 0.08 Å assumed.
      </p>
    {/if}
  {/each}
</div>

<style>
  .sigmas {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  p {
    margin: 0;
  }
  .small {
    font-size: 0.8rem;
  }
  .assumed {
    margin-top: -0.15rem;
  }
</style>
