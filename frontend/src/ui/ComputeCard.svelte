<script lang="ts">
  // ④ Run · Compute: what the chosen method will use and cost (it used to be the Compute tab of the
  // ③ sidebars): the device, the peak memory against what is free, the time, and for Bloch waves the
  // saved solve. The device itself is chosen with the status pill at the top right.
  import { deleteBlochCache, getBlochCache, type BlochCacheInfo } from '../api/client';
  import { formatBytes } from '../core/memory';
  import { compute } from '../state/compute.svelte';
  import { jobs } from '../state/jobs.svelte';
  import { simulation } from '../state/simulation.svelte';

  const method = $derived(simulation.method);
  const pv = $derived(simulation.preview);
  const bp = $derived(simulation.blochPreview);
  const ir = $derived(simulation.incostemResult);
  const conv = $derived(simulation.bloch.type !== 'saed');

  const gpu = $derived(compute.choice === 'gpu' ? (compute.report?.gpu.devices[0] ?? null) : null);
  const budget = $derived(gpu ? gpu.memory_free : (compute.report?.cpu.ram_available ?? 0));
  const peak = $derived(pv?.memory.total_peak_bytes ?? 0);
  const fill = $derived(budget > 0 ? Math.min(1, peak / budget) : 0);
  const device = $derived(
    compute.choice === 'gpu'
      ? `GPU${gpu ? ` (${gpu.name})` : ''}`
      : compute.choice === 'cpu-single'
        ? 'CPU, one process'
        : `CPU, ${compute.workers} workers`,
  );
  const fmtTime = (s: number) =>
    s < 1
      ? `${Math.max(1, Math.round(s * 1000))} ms`
      : s < 90
        ? `${s.toFixed(s < 10 ? 1 : 0)} s`
        : s < 5400
          ? `${(s / 60).toFixed(1)} min`
          : `${(s / 3600).toFixed(1)} h`;

  // The temporary file of the last Bloch solve: read again when this card opens and when a job ends.
  let saved = $state<BlochCacheInfo | null>(null);
  let cacheError = $state('');
  async function refreshCache() {
    try {
      saved = await getBlochCache();
      cacheError = '';
    } catch (e) {
      cacheError = e instanceof Error ? e.message : String(e);
    }
  }
  async function removeCache() {
    try {
      saved = await deleteBlochCache();
      cacheError = '';
    } catch (e) {
      cacheError = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    void jobs.current?.state;
    if (method === 'bloch') void refreshCache();
  });
</script>

<section class="card compute" data-testid="compute-card">
  <h2>Compute</h2>
  {#if method === 'multislice'}
    <dl class="facts">
      <dt>Device</dt>
      <dd>{device}</dd>
      {#if pv}
        <dt>Peak memory</dt>
        <dd>{formatBytes(peak)}</dd>
        <dt>Output</dt>
        <dd>{formatBytes(pv.memory.output_bytes)}</dd>
        <dt>Runs</dt>
        <dd>{pv.series.runs}</dd>
        <dt>Time (estimate)</dt>
        <dd>{fmtTime(pv.memory.seconds)}</dd>
      {/if}
    </dl>
    {#if pv && budget > 0}
      <div
        class="mem"
        data-level={fill > 0.9 ? 'bad' : fill > 0.6 ? 'warn' : 'ok'}
        data-testid="memory-bar"
      >
        <div class="bar"><div style="width: {fill * 100}%"></div></div>
        <span class="small"
          >{formatBytes(peak)} of {formatBytes(budget)}
          {gpu ? 'free on the GPU' : 'RAM available'}</span
        >
      </div>
    {/if}
    {#if pv?.memory.note}<p class="muted small">{pv.memory.note}</p>{/if}
    {#if !pv}<p class="muted small">Set up the simulation in ③ to see its cost.</p>{/if}
  {:else if method === 'bloch'}
    <dl class="facts" data-testid="bloch-compute">
      <dt>Device</dt>
      <dd>CPU (Bloch jobs run on the CPU)</dd>
      {#if bp}
        <dt>Processes</dt>
        <dd data-testid="bloch-workers">{bp.workers}</dd>
        <dt>Beams</dt>
        <dd>{bp.n_beams}</dd>
        {#if conv}
          <dt>Incident directions</dt>
          <dd>{bp.n_tilts.toLocaleString('en')}</dd>
        {/if}
        <dt>Solve time (estimate)</dt>
        <dd data-testid="bloch-time">{fmtTime(bp.seconds)}</dd>
        <dt>Size once saved</dt>
        <dd data-testid="bloch-cache">
          {#if bp.cache_fits}
            {formatBytes(bp.cache_bytes)}, in a temporary file
          {:else}
            {formatBytes(bp.cache_bytes)}: too big to keep (limit {formatBytes(
              bp.cache_limit_bytes,
            )})
          {/if}
        </dd>
      {/if}
    </dl>
    <div class="cache" data-testid="bloch-cache-box">
      <span data-testid="bloch-cache-now">
        Saved solve on disk: {saved?.saved ? formatBytes(saved.bytes) : 'none'}
      </span>
      <button
        type="button"
        disabled={!saved?.saved}
        onclick={removeCache}
        title="Delete the temporary file of the last solve; the next run solves again"
        data-testid="bloch-cache-delete">Delete saved solve</button
      >
    </div>
    {#if cacheError}<p class="notice err" role="alert">✕ {cacheError}</p>{/if}
    <p class="muted small">
      The solve is saved temporarily, so changing only the thickness reruns quickly. Any other
      change discards it. Saved solves are also deleted when the program starts and exits.
    </p>
  {:else}
    <dl class="facts">
      <dt>Device</dt>
      <dd>CPU</dd>
      {#if ir}
        <dt>Time (last image)</dt>
        <dd>{fmtTime(ir.seconds)}</dd>
      {/if}
    </dl>
  {/if}
  <p class="muted small">Change the device with the status pill at the top right.</p>
</section>

<style>
  .compute {
    padding: 1.2rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
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
  .small {
    font-size: 0.8rem;
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.2rem 0.8rem;
    margin: 0;
    font-size: 0.84rem;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .cache {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.8rem;
    font-size: 0.84rem;
  }
  .mem {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bar {
    height: 0.6rem;
    background: var(--surface-2);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar > div {
    height: 100%;
    background: var(--ok);
  }
  [data-level='warn'] .bar > div {
    background: var(--warn);
  }
  [data-level='bad'] .bar > div {
    background: var(--err);
  }
</style>
