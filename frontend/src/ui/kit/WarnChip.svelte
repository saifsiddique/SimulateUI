<script lang="ts">
  // A warning or error as a small pill (context.md §7.MU kit). With `onclick` it is a button that
  // takes the user to the parameter it is about (the caller opens the sidebar tab and focuses it).
  let {
    text,
    level = 'warn',
    onclick,
    testid = '',
  }: {
    text: string;
    level?: 'warn' | 'err';
    onclick?: () => void;
    testid?: string;
  } = $props();

  const icon = $derived(level === 'err' ? '✕' : '⚠');
</script>

{#if onclick}
  <button
    type="button"
    class="chip-w"
    data-level={level}
    {onclick}
    title="Show the parameter"
    data-testid={testid || undefined}><span aria-hidden="true">{icon}</span> {text}</button
  >
{:else}
  <span class="chip-w" data-level={level} role="note" data-testid={testid || undefined}
    ><span aria-hidden="true">{icon}</span> {text}</span
  >
{/if}

<style>
  .chip-w {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.6rem;
    border: 1px solid var(--warn);
    border-radius: 999px;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: 0.8rem;
    line-height: 1.4;
    text-align: left;
  }
  .chip-w[data-level='err'] {
    border-color: var(--err);
    background: var(--err-soft);
    color: var(--err);
  }
  button.chip-w:hover:not(:disabled) {
    border-color: currentColor;
    background: var(--warn-soft);
    text-decoration: underline;
  }
  button.chip-w[data-level='err']:hover:not(:disabled) {
    background: var(--err-soft);
  }
</style>
