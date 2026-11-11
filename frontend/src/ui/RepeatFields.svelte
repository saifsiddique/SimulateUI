<script lang="ts">
  // The number of periodic cells along specimen x, y and the beam. Shown in the ribbon and, as a
  // copy, in the Supercell tab; both edit the same state. `prefix` keeps the test ids apart.
  import { specimen } from '../state/specimen.svelte';

  let { prefix = '' }: { prefix?: string } = $props();

  const p = specimen.params;
</script>

{#each ['x', 'y', 'z (beam)'] as axis, k (axis)}
  <label class="unit"
    >{axis}
    <input
      class="idx"
      type="number"
      min="1"
      max="40"
      value={p.repeats[k]}
      data-testid={prefix + (k === 2 ? 'thickness' : `ext-${axis}`)}
      oninput={(e) => {
        const n = Math.round(Number(e.currentTarget.value));
        if (n >= 1) p.repeats[k] = n;
      }}
    /></label
  >
{/each}

<style>
  .idx {
    width: 2.6rem;
    text-align: center;
  }
</style>
