<script lang="ts">
  // The status pill at the top right (strFac_app's pattern): the device simulations will run on, or
  // why the backend cannot be reached. Its popover holds the compute choice and the hardware report
  // (context.md §7.MU U1; it replaces the M1 device badge and the folded Compute panel).
  import { onMount } from 'svelte';
  import { getHealth } from '../api/client';
  import { formatBytes } from '../core/memory';
  import { compute, loadSystem } from '../state/compute.svelte';
  import NumberField from './kit/NumberField.svelte';

  let open = $state(false);
  let root = $state<HTMLDetailsElement>();
  let versions = $state<Record<string, string | null> | null>(null);

  const rep = $derived(compute.report);
  const gpu = $derived(rep?.gpu.devices[0] ?? null);
  const gpuOk = $derived(rep?.gpu_usable ?? false);
  const smoke = $derived(rep?.gpu.abtem_smoke_test ?? null);

  const pill = $derived.by(() => {
    if (compute.error) return { state: 'error', text: 'Backend offline' };
    if (!rep) return { state: 'pending', text: 'Detecting…' };
    if (compute.choice === 'gpu') return { state: 'ok', text: gpu?.name ?? 'GPU' };
    const n = compute.choice === 'cpu-single' ? 1 : compute.workers;
    return { state: 'ok', text: `CPU × ${n}` };
  });

  async function refreshHealth() {
    try {
      versions = (await getHealth()).versions;
    } catch {
      versions = null;
    }
  }

  onMount(() => {
    void loadSystem();
    void refreshHealth();
    const away = (e: PointerEvent) => {
      if (open && root && !root.contains(e.target as Node)) open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        open = false;
        root?.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  });

  const platformText = $derived.by(() => {
    const p = rep?.platform;
    if (!p) return '';
    const cpu = p.apple_silicon ? 'Apple silicon' : p.machine;
    return `${p.system} ${p.release} · ${cpu} · Python ${p.python}`;
  });
</script>

<details class="status" bind:this={root} bind:open aria-label="Compute status">
  <summary data-state={pill.state} title="Backend and compute device" data-testid="device-badge">
    <span class="dot" aria-hidden="true"></span>{pill.text}
  </summary>
  <div class="pop card" data-testid="status-pop">
    {#if compute.error}
      <h2>Backend offline</h2>
      <p class="notice err">✕ The backend is not reachable: {compute.error}</p>
      <p class="small">
        Start it with <code>./run.ps1</code> (Windows) or <code>./run.sh</code> (macOS, Linux) from
        an activated <code>em-sim</code> environment, then retry.
      </p>
      <button type="button" onclick={() => loadSystem()} disabled={compute.loading}>Retry</button>
    {:else if !rep}
      <h2>Detecting hardware…</h2>
      <p class="small">
        The first check runs a small abTEM simulation on the GPU, if there is one.
      </p>
    {:else}
      <h2>Compute</h2>
      <div class="device" role="radiogroup" aria-label="Compute device">
        <span class="seg">
          <button
            type="button"
            role="radio"
            aria-checked={compute.choice === 'gpu'}
            class:on={compute.choice === 'gpu'}
            disabled={!gpuOk}
            onclick={() => (compute.choice = 'gpu')}
            title={gpuOk ? 'Run on the GPU' : 'No usable GPU'}
            data-testid="device-gpu">GPU</button
          ><button
            type="button"
            role="radio"
            aria-checked={compute.choice === 'cpu-parallel'}
            class:on={compute.choice === 'cpu-parallel'}
            onclick={() => (compute.choice = 'cpu-parallel')}
            data-testid="device-cpu-parallel">CPU parallel</button
          ><button
            type="button"
            role="radio"
            aria-checked={compute.choice === 'cpu-single'}
            class:on={compute.choice === 'cpu-single'}
            onclick={() => (compute.choice = 'cpu-single')}
            data-testid="device-cpu-single">CPU single</button
          >
        </span>
      </div>
      {#if compute.choice === 'cpu-parallel'}
        <NumberField
          label="Workers"
          bind:value={compute.workers}
          min={1}
          max={rep.cpu.logical_cores}
          def={rep.recommended.workers}
          help="Parallel CPU worker processes (default: one per physical core)"
          testid="workers"
        />
      {/if}
      <p class="small reason">{rep.recommended.reason}</p>

      <dl>
        <dt>Platform</dt>
        <dd data-testid="status-platform">{platformText}</dd>
        <dt>CPU</dt>
        <dd>
          {rep.cpu.physical_cores} cores ({rep.cpu.logical_cores} threads) · {formatBytes(
            rep.cpu.ram_total,
          )} RAM
        </dd>
        <dt>GPU</dt>
        <dd data-state={gpuOk ? 'ok' : 'off'} data-testid="status-gpu">
          {#if gpu}
            {gpu.name} · {formatBytes(gpu.memory_total)} · CC {gpu.compute_capability}
          {:else}
            none usable
          {/if}
        </dd>
        {#if gpu}
          <dt>abTEM on GPU</dt>
          <dd data-state={smoke?.ok ? 'ok' : 'error'}>
            {#if !smoke}
              not tested yet
            {:else if smoke.ok}
              ✓ smoke test passed{smoke.seconds ? ` (${smoke.seconds.toFixed(1)} s)` : ''}
            {:else}
              ✕ {smoke.error ?? 'smoke test failed'}
            {/if}
          </dd>
        {:else if rep.gpu.reason}
          <dt>Why</dt>
          <dd class="wrap" data-testid="gpu-reason">{rep.gpu.reason}</dd>
        {/if}
        {#if versions}
          <dt>Versions</dt>
          <dd class="wrap">
            {Object.entries(versions)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ')}
          </dd>
        {/if}
      </dl>
      <button type="button" onclick={() => loadSystem(true)} disabled={compute.loading}>
        {compute.loading ? 'Testing…' : 'Re-test GPU'}
      </button>
    {/if}
  </div>
</details>

<style>
  .status {
    justify-self: end;
    position: relative;
  }
  .status summary {
    list-style: none;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    font-size: 0.82rem;
    color: var(--text-h);
    user-select: none;
    white-space: nowrap;
  }
  .status summary::-webkit-details-marker {
    display: none;
  }
  .status summary:hover {
    border-color: var(--accent);
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: #f59e0b;
  }
  summary[data-state='ok'] .dot {
    background: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
  }
  summary[data-state='error'] .dot {
    background: #ef4444;
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 0.4rem);
    z-index: 30;
    width: min(26rem, calc(100vw - 2rem));
    box-sizing: border-box;
    padding: 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    align-items: flex-start;
  }
  h2 {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-h);
  }
  .small {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .reason {
    color: var(--text);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 1rem;
    margin: 0;
    font-size: 0.82rem;
    width: 100%;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--text-h);
    min-width: 0;
  }
  dd.wrap {
    overflow-wrap: anywhere;
  }
  dd[data-state='ok'] {
    color: var(--ok);
  }
  dd[data-state='error'] {
    color: var(--err);
  }
  code {
    font-family: var(--mono);
    font-size: 0.9em;
  }
</style>
