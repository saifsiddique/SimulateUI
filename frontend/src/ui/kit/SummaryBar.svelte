<script lang="ts" module>
  export interface SummaryItem {
    label: string;
    value: string | number;
    unit?: string;
    level?: 'ok' | 'warn' | 'err';
  }
  export interface SummaryWarning {
    text: string;
    level?: 'warn' | 'err';
    onclick?: () => void;
    testid?: string;
  }
</script>

<script lang="ts">
  // The strip under the simulation views (context.md §7.MU kit): the numbers that decide whether a
  // run is sensible (grid, slices, positions, memory, time), the warnings as chips, and a slot on the
  // right for the action (M6: Run).
  import type { Snippet } from 'svelte';
  import Stat from './Stat.svelte';
  import WarnChip from './WarnChip.svelte';

  let {
    items,
    warnings = [],
    action,
    testid = '',
  }: {
    items: SummaryItem[];
    warnings?: SummaryWarning[];
    action?: Snippet;
    testid?: string;
  } = $props();
</script>

<div class="summary card" data-testid={testid || undefined}>
  <div class="stats">
    {#each items as it (it.label)}
      <Stat label={it.label} value={it.value} unit={it.unit} level={it.level} />
    {/each}
  </div>
  {#if warnings.length}
    <div class="warns">
      {#each warnings as w, i (i)}
        <WarnChip text={w.text} level={w.level} onclick={w.onclick} testid={w.testid} />
      {/each}
    </div>
  {/if}
  {#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
    padding: 0.5rem 0.7rem;
  }
  .stats,
  .warns {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .action {
    margin-left: auto;
  }
</style>
