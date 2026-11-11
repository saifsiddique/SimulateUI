<script lang="ts">
  // A readout tile: a value with its unit over a small label (context.md §7.MU kit). A level other
  // than 'ok' adds an icon, so the state is not told by colour alone.
  let {
    label,
    value,
    unit = '',
    level = 'ok',
    help = '',
    testid = '',
  }: {
    label: string;
    value: string | number;
    unit?: string;
    level?: 'ok' | 'warn' | 'err';
    help?: string;
    testid?: string;
  } = $props();

  const text = $derived(typeof value === 'number' ? value.toLocaleString('en') : value);
</script>

<div class="stat" data-level={level} title={help || undefined} data-testid={testid || undefined}>
  <span class="value"
    >{#if level === 'warn'}<span aria-label="warning">⚠ </span>{:else if level === 'err'}<span
        aria-label="error"
        >✕
      </span>{/if}{text}{#if unit}<span class="unit"> {unit}</span>{/if}</span
  >
  <span class="label">{label}</span>
</div>

<style>
  .stat {
    display: inline-flex;
    flex-direction: column;
    min-width: 0;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
  }
  .value {
    font-weight: 600;
    color: var(--text-h);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    font-weight: 400;
    color: var(--muted);
    font-size: 0.85em;
  }
  .label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .stat[data-level='warn'] {
    border-color: var(--warn);
    background: var(--warn-soft);
  }
  .stat[data-level='warn'] .value {
    color: var(--warn);
  }
  .stat[data-level='err'] {
    border-color: var(--err);
    background: var(--err-soft);
  }
  .stat[data-level='err'] .value {
    color: var(--err);
  }
</style>
