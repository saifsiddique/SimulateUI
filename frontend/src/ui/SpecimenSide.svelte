<script lang="ts" module>
  export const SPECIMEN_TABS = [
    { id: 'cell', label: 'Supercell' },
    { id: 'occupancy', label: 'Occupancy' },
    { id: 'summary', label: 'Summary' },
  ] as const;
  export type SpecimenTab = (typeof SPECIMEN_TABS)[number]['id'];
</script>

<script lang="ts">
  // ② Specimen, sidebar tabs (context.md §7.MU step U3):
  //   Supercell  the size in unit cells, what sits at the centre, and how the orthogonal periodic
  //              cell is found (with the other cells on offer);
  //   Occupancy  what to do with shared and partly occupied sites;
  //   Summary    the box that abTEM receives, the strain, the warnings.
  import { formatStrain, strainLevel } from '../core/strain';
  import { buildSpecimen, resetParams, specimen } from '../state/specimen.svelte';
  import RepeatFields from './RepeatFields.svelte';
  import Stat from './kit/Stat.svelte';

  let { tab }: { tab: SpecimenTab } = $props();

  const p = specimen.params;
  const r = $derived(specimen.result);
  const fmt = (x: number, d = 2) => x.toFixed(d);
  const level = $derived(r ? strainLevel(r.strain.max_abs, specimen.params.strainTolerance) : 'ok');

  const CENTRES = [
    ['cell', 'Cell centre'],
    ['atom', 'Nearest atom'],
    ['origin', 'Origin'],
  ] as const;

  /** A cell setting changed: the offered supercell no longer applies. */
  function cellChanged() {
    p.supercell = null;
  }
</script>

<div class="side" data-testid="specimen-side">
  {#if tab === 'cell'}
    <section>
      <h4>Supercell size (unit cell repeats)</h4>
      <div class="ctl">
        <RepeatFields prefix="side-" />
      </div>
    </section>

    <section>
      <h4>Unit cell centering</h4>
      <span class="seg" role="group" aria-label="What sits at the centre of the box">
        {#each CENTRES as [value, label] (value)}
          <button
            type="button"
            aria-pressed={p.center === value}
            onclick={() => (p.center = value)}
            data-testid={`centre-${value}`}>{label}</button
          >
        {/each}
      </span>
    </section>

    <section>
      <h4>Orthogonalize unit cell</h4>
      <label class="col"
        >Method
        <select bind:value={p.method} onchange={cellChanged} data-testid="method">
          <option value="search">lattice search (zone axis exact, least strain)</option>
          <option value="abtem">abTEM orthogonalize_cell</option>
        </select></label
      >
      {#if p.method === 'search'}
        <label class="row"
          >Strain tolerance
          <span class="num"
            ><input
              type="number"
              step="0.05"
              min="0.01"
              value={+(p.strainTolerance * 100).toFixed(3)}
              oninput={(e) => {
                const v = Number(e.currentTarget.value);
                if (v > 0) {
                  p.strainTolerance = v / 100;
                  cellChanged();
                }
              }}
              data-testid="strain-tol"
            /> %</span
          ></label
        >
        <label class="row"
          >Max atoms per cell
          <span class="num"
            ><input
              type="number"
              step="100"
              min="1"
              bind:value={p.maxRepeatAtoms}
              oninput={cellChanged}
              data-testid="max-atoms"
            /></span
          ></label
        >
        <label class="row"
          >Max cell length
          <span class="num"
            ><input
              type="number"
              step="10"
              min="5"
              bind:value={p.maxLength}
              oninput={cellChanged}
              data-testid="max-length"
            /> Å</span
          ></label
        >
      {:else}
        <label class="row"
          >Max repetitions
          <span class="num"
            ><input type="number" min="1" max="20" bind:value={p.abtemRepetitions} /></span
          ></label
        >
      {/if}
      <label class="row"
        >Vacuum entrance / exit
        <span class="num"
          ><input
            type="number"
            min="0"
            bind:value={p.vacuum[0]}
            aria-label="Vacuum at the entrance, in angstrom"
          />
          <input
            type="number"
            min="0"
            bind:value={p.vacuum[1]}
            aria-label="Vacuum at the exit, in angstrom"
          /> Å</span
        ></label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={p.compareAbtem} data-testid="compare-abtem" /> Compare with
        abTEM</label
      >

      {#if r && r.candidates.length > 1}
        <details>
          <summary>Other cells: smaller or less strained ({r.candidates.length})</summary>
          <table data-testid="candidates">
            <thead><tr><th>atoms</th><th>strain</th><th>cell (Å)</th><th></th></tr></thead>
            <tbody>
              {#each r.candidates as c, i (i)}
                <tr class:chosen={JSON.stringify(c.supercell) === JSON.stringify(r.supercell)}>
                  <td>{c.natoms}</td>
                  <td>{formatStrain(c.strain)}</td>
                  <td>{c.repeat_cell.map((x) => fmt(x, 1)).join(' × ')}</td>
                  <td
                    ><button
                      type="button"
                      onclick={() => {
                        p.supercell = c.supercell;
                        void buildSpecimen();
                      }}>Use</button
                    ></td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
          {#if p.supercell}<button
              type="button"
              onclick={() => {
                p.supercell = null;
                void buildSpecimen();
              }}>Back to the automatic choice</button
            >{/if}
        </details>
      {/if}

      {#if r?.abtem}
        <details open>
          <summary>abTEM orthogonalize_cell for the same zone axis</summary>
          <table data-testid="abtem-compare">
            <thead><tr><th>max repetitions</th><th>atoms</th><th>strain</th></tr></thead>
            <tbody>
              {#each r.abtem as a (a.max_repetitions)}
                <tr>
                  <td>{a.max_repetitions}</td>
                  {#if a.error}<td colspan="2">{a.error}</td>
                  {:else}<td>{a.natoms}</td><td>{formatStrain(a.strain ?? 0)}</td>{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </details>
      {/if}
      <button type="button" class="reset" onclick={resetParams} data-testid="specimen-defaults"
        >Defaults</button
      >
    </section>
  {:else if tab === 'occupancy'}
    <label class="col"
      >Partial occupancy
      <select bind:value={p.occupancy} data-testid="occupancy">
        <option value="dominant">dominant species per site</option>
        <option value="random">random sample (by occupancy)</option>
        <option value="keep">keep all (overlapping)</option>
      </select></label
    >
    {#if p.occupancy === 'random'}
      <label class="row"
        >Seed
        <span class="num"><input type="number" bind:value={p.seed} data-testid="seed" /></span
        ></label
      >
    {/if}
    <p class="muted small">
      abTEM needs whole atoms. <em>Dominant</em> keeps the most abundant species at each shared or
      partly occupied site; <em>random</em> draws each site's species by its occupancy (the seed
      repeats the draw); <em>keep all</em> leaves every species at its site, so atoms overlap.
    </p>
  {:else if !r}
    <p class="muted" data-testid="specimen-empty">
      Choose the beam direction and the size, then press <strong>Build</strong>.
    </p>
  {:else}
    <div class="tiles">
      <Stat
        label="Box"
        value={r.box.map((x) => fmt(x, 1)).join(' × ')}
        unit="Å"
        testid="stat-box"
      />
      <Stat
        label="Periodic cell"
        value={r.repeat_cell.map((x) => fmt(x, 2)).join(' × ')}
        unit="Å"
        testid="stat-cell"
      />
      <Stat label="Atoms" value={r.natoms} testid="stat-atoms" />
      <Stat
        label="Strain"
        value={formatStrain(r.strain.max_abs)}
        level={level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : 'err'}
        testid="stat-strain"
      />
    </div>

    <p data-testid="specimen-summary">
      Zone axis [{r.zone_axis.join(' ')}] · periodic cell {fmt(r.repeat_cell[0])} × {fmt(
        r.repeat_cell[1],
      )} × {fmt(r.repeat_cell[2])} Å ({r.natoms_repeat} atoms) · repeated {r.repeats.join(' × ')} →
      <strong
        >{fmt(r.crystal_extent[0], 1)} × {fmt(r.crystal_extent[1], 1)} × {fmt(
          r.crystal_extent[2],
          1,
        )} Å</strong
      >, {r.natoms} atoms{#if r.vacuum[0] || r.vacuum[1]}
        (box {fmt(r.box[2], 1)} Å with vacuum){/if}
    </p>
    <div class="strain" data-level={level} data-testid="specimen-strain">
      <div class="bar" aria-hidden="true">
        <div style="width: {Math.min(100, (r.strain.max_abs / 0.02) * 100)}%"></div>
        <i style="left: {Math.min(100, (p.strainTolerance / 0.02) * 100)}%"></i>
      </div>
      <span
        >{level === 'ok' ? '✓' : '⚠'} Strain {formatStrain(r.strain.max_abs)} (max principal; tolerance
        {formatStrain(p.strainTolerance)}) · the zone axis stays exactly along the beam{#if r.method === 'abtem'}
          (abTEM method){/if}</span
      >
    </div>
    {#if r.supercell}
      <p class="muted small" data-testid="supercell">
        Cell vectors (lattice indices): t₁ = [{r.supercell[0].join(' ')}], t₂ = [{r.supercell[1].join(
          ' ',
        )}], t₃ = [{r.supercell[2].join(' ')}]
      </p>
    {/if}
    {#each r.warnings as w, i (i)}
      <p class="notice warn" data-testid="specimen-warning">⚠ {w}</p>
    {/each}
  {/if}
</div>

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .side p {
    margin: 0;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid var(--border);
  }
  section:last-child {
    border-bottom: none;
  }
  h4 {
    margin: 0;
    font-size: 0.85rem;
  }
  .ctl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .num {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
  }
  .num input {
    width: 4.8rem;
  }
  select {
    max-width: 100%;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .small {
    font-size: 0.82rem;
  }
  .reset {
    align-self: flex-start;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.5rem;
  }
  .strain {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .bar {
    position: relative;
    height: 0.6rem;
    max-width: 24rem;
    background: var(--surface-2);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar > div {
    height: 100%;
    background: var(--ok);
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
    background: var(--warn);
  }
  [data-level='bad'] .bar > div {
    background: var(--err);
  }
  table {
    border-collapse: collapse;
    font-size: 0.85rem;
    margin: 0.3rem 0;
  }
  th,
  td {
    text-align: left;
    padding: 0.1rem 0.9rem 0.1rem 0;
  }
  tr.chosen {
    font-weight: 700;
  }
</style>
