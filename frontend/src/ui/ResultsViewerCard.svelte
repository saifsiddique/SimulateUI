<script lang="ts">
  // ④ Results viewer card (context.md M7): the viewer of the selected run (ResultPane). The
  // Native | Processed switch is shared with the Postprocessing card: Apply switches to the
  // processed result.
  import { jobs } from '../state/jobs.svelte';
  import { output } from '../state/output.svelte';
  import ResultPane from './ResultPane.svelte';

  const job = $derived(jobs.current);
  const done = $derived(job?.state === 'done');
</script>

<section class="card viewer" data-testid="results-viewer">
  <h2>Results viewer</h2>
  {#if job && done}
    <ResultPane {job} view={output.view} onview={(v) => (output.view = v)} />
  {:else}
    <p class="muted">Run a simulation, or pick an earlier run, to see its results here.</p>
  {/if}
</section>

<style>
  .viewer {
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
  .muted {
    color: var(--muted);
  }
</style>
