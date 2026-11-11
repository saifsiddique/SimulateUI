<script lang="ts">
  // ④ Run (context.md §7.MU step U7, M6): Run simulation starts the chosen method as a job on the
  // backend, and under it the "ready to run" list built from the checks the earlier steps already
  // make: the structure is registered, the specimen is built and current, and the warnings of the
  // chosen method's last preview. The job itself and the earlier runs are in the next card.
  import { isReady, readiness, type ReadyState } from '../core/setup';
  import type { TabId } from '../core/workflow';
  import { compute } from '../state/compute.svelte';
  import { project } from '../state/project.svelte';
  import { cancelRun, isActive, jobs, runBody, startRun } from '../state/jobs.svelte';
  import { parameterState, simulation } from '../state/simulation.svelte';
  import { needsRebuild, specimen } from '../state/specimen.svelte';

  let {
    onGo,
    name = '',
    spaceGroup = '',
  }: { onGo: (tab: TabId) => void; name?: string; spaceGroup?: string } = $props();

  /** The runs are stored under <material>_<space group>: the file name without its extension. */
  const projectName = $derived(
    [name.replace(/\.[^.]+$/, '') || 'default', spaceGroup].filter(Boolean).join('_'),
  );
  const job = $derived(jobs.current);
  const active = $derived(isActive(job));

  const parameters = $derived(parameterState());

  /** Multislice: the estimate of the last preview against the memory free where it runs. */
  const memory = $derived.by(() => {
    const pv = simulation.method === 'multislice' ? simulation.preview : null;
    if (!pv) return null;
    const gpu = compute.choice === 'gpu' ? (compute.report?.gpu.devices[0] ?? null) : null;
    const available = gpu ? gpu.memory_free : (compute.report?.cpu.ram_available ?? 0);
    return {
      needed: pv.memory.total_peak_bytes,
      available,
      where: gpu ? 'on the GPU' : 'in RAM',
    };
  });

  const items = $derived(
    readiness({
      registration: project.registration.status,
      registrationError: project.registration.error,
      specimen: {
        hasResult: !!specimen.result,
        changed: needsRebuild(),
        warnings: specimen.result?.warnings ?? [],
      },
      parameterWarnings: parameters.warnings,
      parameterError: parameters.error,
      memory: memory,
    }),
  );
  const ready = $derived(isReady(items));
  const canRun = $derived(ready && !active && !jobs.starting && !!runBody());
  const ICON: Record<ReadyState, string> = { ok: '✓', warn: '⚠', fail: '✕' };
  const METHOD = { multislice: 'Multislice', bloch: 'Bloch wave', incostem: 'INCOSTEM' } as const;
  const warnCount = $derived(items.reduce((n, i) => n + (i.state === 'warn' ? 1 : 0), 0));
</script>

<section class="card run" data-testid="run-card">
  <h2>Run</h2>
  <div class="actions">
    <button
      type="button"
      class="primary"
      disabled={!canRun}
      title={ready ? 'Run the simulation chosen in ③' : 'Fix the items marked ✕ first'}
      onclick={() => startRun(projectName)}
      data-testid="run-start">Run simulation</button
    >
    {#if active}
      <button type="button" onclick={cancelRun} data-testid="run-cancel">Cancel</button>
    {/if}
    {#if !active}<span class="muted">Runs one at a time; stored in the projects folder.</span>{/if}
  </div>
  {#if jobs.error}<p class="err" role="alert">✕ {jobs.error}</p>{/if}
  <p class="verdict" data-ready={ready} data-testid="run-verdict">
    {#if !ready}
      Not ready to run: fix the items marked ✕.
    {:else if warnCount}
      Ready to run, with {warnCount === 1 ? 'a warning' : `${warnCount} warnings`} to look at.
    {:else}
      Ready to run.
    {/if}
    <span class="muted">Method: {METHOD[simulation.method]}.</span>
  </p>
  <ul class="list" data-testid="run-checklist">
    {#each items as item (item.id)}
      <li data-state={item.state} data-testid={`ready-${item.id}`}>
        <span class="icon" aria-hidden="true">{ICON[item.state]}</span>
        <div>
          <strong>{item.label}</strong>
          {#each item.details as d, i (i)}<p>{d}</p>{/each}
          {#if item.state !== 'ok'}
            <button type="button" class="link" onclick={() => onGo(item.tab)}>Go there</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .run {
    padding: 1.2rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-h);
  }
  p {
    margin: 0;
  }
  .verdict {
    font-weight: 600;
    color: var(--text-h);
  }
  .verdict[data-ready='false'] {
    color: var(--err);
  }
  .muted {
    font-weight: 400;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  li {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  li > div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  li p {
    font-size: 0.86rem;
    color: var(--text);
  }
  .icon {
    width: 1.2rem;
    text-align: center;
    font-weight: 700;
  }
  li[data-state='ok'] .icon {
    color: var(--ok, #2f7d4f);
  }
  li[data-state='warn'] .icon {
    color: var(--warn);
  }
  li[data-state='fail'] .icon {
    color: var(--err);
  }
  .link {
    align-self: flex-start;
    border: none;
    background: none;
    padding: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    font-size: 0.84rem;
  }
  .err {
    color: var(--err);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }
</style>
