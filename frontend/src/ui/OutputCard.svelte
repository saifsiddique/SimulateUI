<script lang="ts">
  // ④ Output (context.md M6): the job being followed (progress, elapsed and remaining time, the
  // folder with Open run folder, each result with its picture) and the earlier runs stored on disk
  // (open, delete). The selected run is the one the Postprocessing card and the Results viewer show.
  import { onMount } from 'svelte';
  import { jobFileUrl, type Job } from '../api/client';
  import { formatBytes } from '../core/memory';
  import {
    deleteRun,
    isActive,
    jobs,
    openFolder,
    refreshJobs,
    showRun,
  } from '../state/jobs.svelte';

  onMount(() => void refreshJobs());
  const clock = (s: number | null) => {
    if (s === null || !Number.isFinite(s)) return '–';
    const t = Math.round(s);
    return t < 60
      ? `${t} s`
      : t < 3600
        ? `${Math.floor(t / 60)} min ${t % 60} s`
        : `${(t / 3600).toFixed(1)} h`;
  };
  const STATE: Record<Job['state'], string> = {
    queued: 'Waiting',
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  const job = $derived(jobs.current);
  const active = $derived(isActive(job));
  const older = $derived(jobs.list.filter((j) => j.id !== job?.id));
</script>

<section class="card results-card" data-testid="output-card">
  <h2>Output</h2>
  {#if !job && !older.length}
    <p class="muted">No runs yet.</p>
  {/if}
  {#if job}
    <div class="job" data-testid="job" data-state={job.state}>
      <div class="head">
        <strong>{job.name}</strong>
        <span class="state" data-testid="job-state">{STATE[job.state]}</span>
      </div>
      {#if active}
        <progress max="1" value={job.fraction} data-testid="job-progress"></progress>
      {/if}
      <p class="muted">
        {#if job.state === 'queued'}Position {job.queue_position ?? '–'} in the queue.
        {:else}
          {job.message}
          · elapsed {clock(job.elapsed)}{#if job.state === 'running'}
            · remaining {clock(job.eta)}{/if}
        {/if}
      </p>
      {#if job.error}<p class="err" data-testid="job-error">✕ {job.error}</p>{/if}
      {#if job.state === 'done'}
        <div class="folder">
          <p class="muted small" data-testid="job-folder">Saved in {job.directory}</p>
          <button type="button" onclick={() => openFolder(job.id)} data-testid="job-open-folder"
            >Open run folder</button
          >
        </div>
        <ul class="results" data-testid="job-results">
          {#each job.results as r (r.name)}
            <li data-testid={`result-${r.name}`}>
              <img src={jobFileUrl(job.id, r.preview)} alt={`${r.name} preview`} />
              <div>
                <strong>{r.name}</strong>
                <p class="small muted">
                  {r.kind}{r.shape ? ` · ${r.shape.join(' × ')}` : ''} · {formatBytes(r.bytes)}
                </p>
                <p class="small muted">{r.file}</p>
                {#if r.note}<p class="small" data-testid={`result-note-${r.name}`}>{r.note}</p>{/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  {#if older.length}
    <div class="older">
      <h3>Earlier runs <span class="muted small">({older.length})</span></h3>
      <!-- every stored run, in a list that scrolls -->
      <ul data-testid="job-list">
        {#each older as j (j.id)}
          <li>
            <button type="button" class="link" onclick={() => showRun(j)}>{j.name}</button>
            <span class="muted small">{STATE[j.state]} · {j.project} · {j.id}</span>
            <button
              type="button"
              class="link"
              aria-label={`Delete ${j.name}`}
              onclick={() => deleteRun(j.id)}>Delete</button
            >
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .results-card {
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
    font-weight: 400;
    color: var(--muted);
    font-size: 0.85rem;
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
  .job {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.7rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .job[data-state='failed'] {
    border-color: var(--err);
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .state {
    font-weight: 600;
  }
  progress {
    width: 100%;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .results li {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  .results img {
    width: 96px;
    height: 96px;
    object-fit: contain;
    background: #000;
  }
  .folder {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.8rem;
    word-break: break-all;
  }
  .err {
    color: var(--err);
  }
  .small {
    font-size: 0.8rem;
  }
  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.9rem;
    color: var(--text-h);
  }
  .older ul {
    max-height: 16rem;
    overflow-y: auto;
    padding-right: 0.3rem !important;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .older li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
  }
</style>
