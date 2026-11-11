<script lang="ts">
  // The acceleration voltage (context.md §7.MU step U4): presets, an exact value and λ. Shared by
  // the multislice and Bloch-wave sidebars; both read the same `simulation.ms.energy`.
  import { KV_PRESETS, simulation, wavelength } from '../state/simulation.svelte';
  import NumberField from './kit/NumberField.svelte';

  const lam = $derived(wavelength(simulation.ms.energy));
</script>

<h4>Acceleration voltage</h4>
<div class="row">
  <span class="seg" role="group" aria-label="Accelerating voltage presets">
    {#each KV_PRESETS as kv (kv)}
      <button
        type="button"
        aria-pressed={simulation.ms.energy === kv}
        onclick={() => (simulation.ms.energy = kv)}
        data-testid={`kv-${kv}`}>{kv}</button
      >
    {/each}
  </span>
</div>
<NumberField
  label="Voltage"
  bind:value={simulation.ms.energy}
  unit="kV"
  min={10}
  max={2000}
  step={10}
  def={300}
  testid="kv"
/>
<p class="muted small" data-testid="wavelength">λ = {(lam * 100).toFixed(3)} pm</p>

<style>
  h4,
  p {
    margin: 0;
  }
  h4 {
    font-size: 0.85rem;
  }
  .small {
    font-size: 0.8rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
</style>
