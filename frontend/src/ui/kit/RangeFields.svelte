<script lang="ts">
  // From, To and Step for a series (context.md §7.MU step U4): three exact values with a unit.
  // The test ids are `<testid>-start`, `-stop` and `-step`.
  import type { Range } from '../../core/series';
  import NumberField from './NumberField.svelte';

  let {
    range = $bindable(),
    unit,
    testid,
    disabled = false,
    min,
    max,
  }: {
    range: Range;
    unit: string;
    testid: string;
    disabled?: boolean;
    min: number;
    max: number;
  } = $props();
</script>

<div class="range">
  <NumberField
    label="From"
    bind:value={range.start}
    {unit}
    {min}
    {max}
    {disabled}
    testid={`${testid}-start`}
  />
  <NumberField
    label="To"
    bind:value={range.stop}
    {unit}
    {min}
    {max}
    {disabled}
    testid={`${testid}-stop`}
  />
  <NumberField
    label="Step"
    bind:value={range.step}
    {unit}
    min={0}
    max={max - min}
    {disabled}
    help="0 = the 'From' value only"
    testid={`${testid}-step`}
  />
</div>

<style>
  .range {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
</style>
