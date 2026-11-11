<script lang="ts">
  // Orthogonal cell for multislice (context.md M2): abTEM needs an orthogonal, periodic cell, and
  // making a non-orthogonal one orthogonal costs a strain that must be small. The backend does the
  // work with abtem.orthogonalize_cell; this panel shows the result and lets the user steer it.
  import type { Crystal } from '../core/crystal';
  import { formatStrain, strainLevel } from '../core/strain';
  import { project, runOrthogonalize } from '../state/project.svelte';

  let { crystal }: { crystal: Crystal | null } = $props();

  const o = project.ortho;
  const r = $derived(project.ortho.result);
  const reg = $derived(project.registration);
  const level = $derived(r ? strainLevel(r.strain.max_abs, project.ortho.strainTolerance) : 'ok');
  const fmt = (x: number, d = 3) => x.toFixed(d);

  // Typing a number should not fire a request per keystroke.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function changed() {
    clearTimeout(timer);
    timer = setTimeout(() => void runOrthogonalize(), 350);
  }
</script>

<section class="card ortho" aria-label="Orthogonal cell" data-testid="ortho-panel">
  <header>
    <h2>Orthogonal cell</h2>
    <span class="muted">for abTEM multislice (periodic, orthogonal)</span>
  </header>

  {#if !crystal}
    <p class="muted">Open a CIF to build its orthogonal cell.</p>
  {:else if reg.status === 'error'}
    <p class="err" role="alert" data-testid="ortho-offline">
      Backend unavailable: {reg.error}. The 3D view and crystal data still work; simulations need
      the backend.
    </p>
  {:else if reg.status === 'pending' || o.status === 'pending'}
    <p class="muted" data-testid="ortho-pending">Working…</p>
  {:else if o.status === 'error'}
    <p class="err" role="alert">{o.error}</p>
  {:else if r}
    <div class="view" role="group" aria-label="Structure shown in the 3D view">
      <button
        type="button"
        class:active={project.view === 'original'}
        onclick={() => (project.view = 'original')}
        data-testid="view-original">Unit cell</button
      >
      <button
        type="button"
        class:active={project.view === 'orthogonal'}
        onclick={() => (project.view = 'orthogonal')}
        data-testid="view-orthogonal">Orthogonal cell</button
      >
    </div>

    {#if r.already_orthogonal}
      <p class="ok" data-testid="ortho-status">
        The cell is already orthogonal: nothing to repeat or strain.
      </p>
    {:else}
      <p data-testid="ortho-status">
        {r.natoms} atoms in a {fmt(r.cell[0], 2)} × {fmt(r.cell[1], 2)} × {fmt(r.cell[2], 2)} Å box ({fmt(
          r.volume_ratio,
          0,
        )}× the unit cell, abTEM max repetitions = {r.max_repetitions}).
      </p>
    {/if}

    <div class="strain" data-level={level} data-testid="strain">
      <div class="bar" aria-hidden="true">
        <div style="width: {Math.min(100, (r.strain.max_abs / 0.1) * 100)}%"></div>
        <i style="left: {(project.ortho.strainTolerance / 0.1) * 100}%" title="tolerance"></i>
      </div>
      <span>
        Strain {formatStrain(r.strain.max_abs)} (max principal)
        {#if !r.already_orthogonal}· principal {r.strain.principal
            .map((x) => formatStrain(x))
            .join(', ')}{/if}
        {#if r.strain.rotation_deg > 1e-6}· rotation {fmt(r.strain.rotation_deg, 2)}°{/if}
      </span>
    </div>

    {#if !r.already_orthogonal}
      <div class="controls">
        <label
          ><input type="radio" bind:group={o.mode} value="auto" onchange={changed} /> Automatic (smallest
          cell within</label
        >
        <input
          type="number"
          min="0.1"
          max="10"
          step="0.1"
          aria-label="Strain tolerance in percent"
          value={project.ortho.strainTolerance * 100}
          oninput={(e) => {
            const v = Number(e.currentTarget.value);
            if (v > 0) {
              o.strainTolerance = v / 100;
              changed();
            }
          }}
          disabled={o.mode !== 'auto'}
        />
        <span>% strain)</span>
        <label
          ><input type="radio" bind:group={o.mode} value="manual" onchange={changed} /> Manual, max repetitions</label
        >
        <input
          type="number"
          min="1"
          max="20"
          aria-label="Maximum repetitions"
          bind:value={o.maxRepetitions}
          oninput={changed}
          disabled={o.mode !== 'manual'}
        />
      </div>

      {#if r.candidates.length > 1}
        <details>
          <summary>Cells tried ({r.candidates.length})</summary>
          <table>
            <thead><tr><th>max rep.</th><th>atoms</th><th>strain</th></tr></thead>
            <tbody>
              {#each r.candidates as c (c.max_repetitions)}
                <tr class:chosen={c.max_repetitions === r.max_repetitions}>
                  <td>{c.max_repetitions}</td><td>{c.natoms}</td><td>{formatStrain(c.strain)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </details>
      {/if}
    {/if}

    {#each r.warnings as w, i (i)}
      <p class="warn" data-testid="ortho-warning">{w}</p>
    {/each}
  {/if}

  {#if reg.response}
    <p class="muted small" data-testid="registered">
      Registered with the backend: {reg.response.summary.natoms} atoms,
      {reg.response.summary.formula}, ρ = {fmt(reg.response.summary.density, 3)} g/cm³.
    </p>
    {#each reg.response.warnings as w, i (i)}
      <p class="warn" data-testid="register-warning">{w}</p>
    {/each}
  {/if}
</section>

<style>
  .ortho {
    padding: 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 0.8rem;
  }
  h2 {
    margin: 0;
  }
  p {
    margin: 0;
  }
  .small {
    font-size: 0.82rem;
  }
  .view {
    display: inline-flex;
    gap: 0;
  }
  .view button {
    border-radius: 0;
  }
  .view button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .view button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .view button.active {
    background: var(--accent);
    color: #fff;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
  }
  .controls input[type='number'] {
    width: 4.5rem;
  }
  .strain {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bar {
    position: relative;
    height: 0.6rem;
    background: var(--surface-2);
    border-radius: 999px;
    overflow: hidden;
    max-width: 24rem;
  }
  .bar > div {
    height: 100%;
    background: #10b981;
  }
  .bar > i {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--text-h);
    opacity: 0.6;
  }
  [data-level='warn'] .bar > div {
    background: #f59e0b;
  }
  [data-level='bad'] .bar > div {
    background: #ef4444;
  }
  .ok {
    color: var(--ok);
  }
  .err {
    color: var(--err);
  }
  .warn {
    color: #b45309;
    font-size: 0.88rem;
  }
  table {
    border-collapse: collapse;
    margin-top: 0.3rem;
    font-size: 0.85rem;
  }
  th,
  td {
    padding: 0.1rem 0.8rem 0.1rem 0;
    text-align: left;
  }
  tr.chosen {
    font-weight: 700;
  }
</style>
