<script lang="ts">
  // The workflow tabs: ① Structure · ② Specimen · ③ Simulation · ④ Run · Results (context.md §7.MU).
  // Each tab shows its state with an icon and a word (never colour alone); the bar under them fills
  // with the tabs that are set up. Any tab that is not locked can be opened again and changed.
  import {
    TAB_IDS,
    TAB_LABELS,
    workflowProgress,
    type TabId,
    type TabState,
    type TabStatus,
  } from '../core/workflow';

  let {
    tab = $bindable(),
    states,
    panelId,
  }: {
    tab: TabId;
    states: Record<TabId, TabStatus>;
    /** The id of the tab panel these tabs control. */
    panelId: string;
  } = $props();

  const ICON: Record<TabState, string> = {
    locked: '🔒',
    todo: '○',
    busy: '◌',
    done: '✓',
    warn: '⚠',
    stale: '↻',
  };
  const WORD: Record<TabState, string> = {
    locked: 'locked',
    todo: 'to do',
    busy: 'working',
    done: 'done',
    warn: 'check',
    stale: 'changed',
  };

  const progress = $derived(workflowProgress(states));
  const open = $derived(TAB_IDS.filter((id) => states[id].state !== 'locked'));

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = open.indexOf(tab);
    const next = open[(i + (e.key === 'ArrowRight' ? 1 : open.length - 1)) % open.length];
    tab = next;
    document.getElementById(`tab-${next}`)?.focus();
  }
</script>

<nav class="workflow card" aria-label="Workflow">
  <div class="tabs" role="tablist" aria-label="Workflow steps">
    {#each TAB_IDS as id, i (id)}
      {@const s = states[id]}
      <button
        type="button"
        role="tab"
        id={`tab-${id}`}
        aria-selected={tab === id}
        aria-controls={panelId}
        aria-disabled={s.state === 'locked'}
        aria-describedby={`tab-${id}-why`}
        tabindex={tab === id ? 0 : -1}
        class:active={tab === id}
        data-state={s.state}
        title={s.reason}
        onclick={() => {
          if (s.state !== 'locked') tab = id;
        }}
        onkeydown={onKey}
        data-testid={`tab-${id}`}
      >
        <span class="num" aria-hidden="true">{i + 1}</span>
        <span class="label">{TAB_LABELS[id]}</span>
        <span class="state" data-testid={`tab-${id}-state`}
          ><span aria-hidden="true">{ICON[s.state]}</span> {WORD[s.state]}</span
        >
        <span class="sr" id={`tab-${id}-why`}>{s.reason}</span>
      </button>
      {#if i < TAB_IDS.length - 1}<span class="sep" aria-hidden="true">›</span>{/if}
    {/each}
  </div>
  <div
    class="progress"
    role="progressbar"
    aria-label="Set-up progress"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(progress * 100)}
    data-testid="workflow-progress"
  >
    <div class="fill" style:width={`${progress * 100}%`}></div>
  </div>
</nav>

<style>
  .workflow {
    overflow: hidden;
  }
  .tabs {
    display: flex;
    align-items: stretch;
    flex-wrap: wrap;
    gap: 0.1rem;
    padding: 0.3rem 0.4rem 0.25rem;
  }
  .sep {
    align-self: center;
    color: var(--border-strong);
    font-size: 1.1rem;
  }
  [role='tab'] {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.8rem;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--text);
    font-weight: 600;
  }
  [role='tab']:hover:not([aria-disabled='true']) {
    background: var(--surface-2);
    border-color: var(--border);
  }
  [role='tab'].active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  [role='tab'][aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .num {
    display: inline-grid;
    place-items: center;
    width: 1.45rem;
    height: 1.45rem;
    border-radius: 50%;
    border: 1.5px solid var(--border-strong);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
    background: var(--surface);
  }
  .active .num {
    border-color: var(--accent);
    color: var(--accent);
  }
  [data-state='done'] .num {
    border-color: var(--ok);
    background: var(--ok);
    color: #fff;
  }
  .state {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    background: var(--surface-2);
    color: var(--muted);
    white-space: nowrap;
  }
  [data-state='done'] .state {
    background: var(--ok-soft);
    color: var(--ok);
  }
  [data-state='warn'] .state {
    background: var(--warn-soft);
    color: var(--warn);
  }
  [data-state='stale'] .state {
    background: var(--warn-soft);
    color: var(--warn);
  }
  [data-state='busy'] .state {
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .progress {
    height: 3px;
    background: var(--surface-2);
  }
  .fill {
    height: 100%;
    background: var(--title-grad);
    transition: width 0.3s ease;
  }
  @media (max-width: 48rem) {
    .sep {
      display: none;
    }
    [role='tab'] {
      padding: 0.35rem 0.5rem;
    }
  }
</style>
