<script lang="ts">
  // Crystal data read from the CIF (M1-M4): what the parser, the symmetry code and the lattice
  // maths make of the loaded structure, plus small calculators. M14 reorganises this into tabs.
  import { toP1Structure, writeCif } from './core/cif';
  import type { Crystal } from './core/crystal';
  import { density } from './core/density';
  import {
    angleDirectionToPlaneNormal,
    cartesianToNearestHkl,
    dSpacing,
    directionLength,
    uvwToCart,
    uvwToHkl,
  } from './core/lattice';
  import type { Vec3 } from './core/math/vec3';
  import { detectSpaceGroup, type DetectedSymmetry } from './symmetry/detect';
  import LatticeVectors from './ui/LatticeVectors.svelte';
  import SpaceGroupSymbol from './ui/SpaceGroupSymbol.svelte';

  let {
    crystal,
    fileName,
    warnings,
  }: { crystal: Crystal | null; fileName: string; warnings: string[] } = $props();

  let error = $state('');
  let detected = $state.raw<DetectedSymmetry | null>(null);
  let detecting = $state(false);

  // A new structure forgets the previous detection result.
  $effect(() => {
    void crystal;
    detected = null;
    error = '';
  });

  async function detect() {
    if (!crystal) return;
    detecting = true;
    try {
      detected = await detectSpaceGroup(crystal);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      detecting = false;
    }
  }

  function download(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'chemical/x-cif' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  }

  const fmt = (x: number, digits = 4) => (Number.isFinite(x) ? x.toFixed(digits) : '–');

  // ---- lattice calculator -----------------------------------------------------------------------
  let uvw = $state<Vec3>([1, 1, 0]);
  let hkl = $state<Vec3>([1, 1, 0]);
  const calc = $derived.by(() => {
    if (!crystal) return null;
    const lat = crystal.lattice;
    try {
      const nearest = cartesianToNearestHkl(lat, uvwToCart(lat, uvw));
      return {
        length: directionLength(lat, uvw),
        d: dSpacing(lat, hkl),
        angle: angleDirectionToPlaneNormal(lat, uvw, hkl),
        planeNormalOfUvw: uvwToHkl(lat, uvw),
        nearest,
      };
    } catch {
      return null;
    }
  });
</script>

<section aria-label="Crystal data" class="inspector">
  <h2 class="section-title">Crystal data</h2>

  <div class="cards">
    {#if crystal}
      {@const c = crystal}
      <article class="card wide">
        <header>
          <h3 data-testid="crystal-title">{c.name}</h3>
          <span class="muted">{fileName}</span>
        </header>
        {#if c.title}<p class="hint">{c.title}</p>{/if}
        <dl data-testid="crystal-summary">
          <dt>Cell (Å, °)</dt>
          <dd>
            {fmt(c.cell.a)}
            {fmt(c.cell.b)}
            {fmt(c.cell.c)} · {fmt(c.cell.alpha, 3)}
            {fmt(c.cell.beta, 3)}
            {fmt(c.cell.gamma, 3)}
          </dd>
          <dt>Volume</dt>
          <dd>{fmt(c.summary.volume, 3)} Å³</dd>
          <dt>Space group</dt>
          <dd data-testid="space-group">
            {#if c.spaceGroup.symbol}<SpaceGroupSymbol symbol={c.spaceGroup.symbol} />{/if}
            (No. {c.spaceGroup.number ?? '?'}, {c.spaceGroup.crystalSystem ?? 'unknown'}),
            {c.spaceGroup.order} operations, from {c.spaceGroup.source}
          </dd>
          <dt>Declared</dt>
          <dd>{c.spaceGroup.declared.hm ?? '–'} · number {c.spaceGroup.declared.number ?? '–'}</dd>
          <dt>Content</dt>
          <dd data-testid="formula">
            {c.summary.formula}{c.summary.Z ? `, Z = ${c.summary.Z}` : ''} · {c.sites.length} sites →
            {c.atoms.length} atoms in {c.positions.length} positions
          </dd>
          <dt>Density</dt>
          <dd>{fmt(density(c), 3)} g/cm³</dd>
        </dl>

        <div class="actions">
          <button onclick={detect} disabled={detecting} data-testid="detect">
            {detecting ? 'Detecting…' : 'Detect symmetry from positions'}
          </button>
          <button onclick={() => download(writeCif(toP1Structure(c)), `${c.name}_P1.cif`)}>
            Download P1 cell
          </button>
          {#if detected}
            <span data-testid="detected" class="detected">
              detected <SpaceGroupSymbol symbol={detected.hmSymbol} /> (No. {detected.number},
              {detected.pearsonSymbol})
              {detected.number === c.spaceGroup.number
                ? '✓ matches the CIF'
                : '≠ the CIF declares ' + c.spaceGroup.number}
            </span>
          {/if}
        </div>
        {#if error}<p class="err">{error}</p>{/if}

        {#if warnings.length}
          <details class="warnings">
            <summary
              >{warnings.length} warning{warnings.length === 1 ? '' : 's'} while reading</summary
            >
            <ul>
              {#each warnings as w, i (i)}<li>{w}</li>{/each}
            </ul>
          </details>
        {/if}

        <LatticeVectors crystal={c} />

        <details class="fold" open data-testid="asymmetric-unit">
          <summary>Asymmetric unit ({c.sites.length} site{c.sites.length === 1 ? '' : 's'})</summary
          >
          <div class="scroll">
            <table>
              <thead
                ><tr
                  ><th>label</th><th>element</th><th>x</th><th>y</th><th>z</th><th>occ</th><th
                    >mult</th
                  ></tr
                ></thead
              >
              <tbody>
                {#each c.sites as site (site.index)}
                  <tr>
                    <td>{site.label}</td><td>{site.typeSymbol ?? site.element}</td>
                    <td>{fmt(site.frac[0])}</td><td>{fmt(site.frac[1])}</td><td
                      >{fmt(site.frac[2])}</td
                    >
                    <td>{site.occupancy}</td><td>{site.multiplicity}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      </article>

      <article class="card">
        <header><h3>Lattice calculator</h3></header>
        <div class="row">
          <span>direction [uvw]</span>
          {#each [0, 1, 2] as i (i)}<input
              type="number"
              step="1"
              bind:value={uvw[i]}
              aria-label={'uvw ' + i}
            />{/each}
        </div>
        <div class="row">
          <span>plane (hkl)</span>
          {#each [0, 1, 2] as i (i)}<input
              type="number"
              step="1"
              bind:value={hkl[i]}
              aria-label={'hkl ' + i}
            />{/each}
        </div>
        {#if calc}
          <dl data-testid="lattice-calc">
            <dt>|[uvw]|</dt>
            <dd>{fmt(calc.length)} Å</dd>
            <dt>d(hkl)</dt>
            <dd>{fmt(calc.d)} Å</dd>
            <dt>angle [uvw] ↔ (hkl) normal</dt>
            <dd>{fmt(calc.angle, 3)}°</dd>
            <dt>plane normal to [uvw] ∝ (hkl)</dt>
            <dd>
              ({calc.planeNormalOfUvw.map((x) => fmt(x, 3)).join(', ')}) ≈ ({calc.nearest.indices.join(
                ' ',
              )}), off by {fmt(calc.nearest.angleDeg, 3)}°
            </dd>
          </dl>
        {/if}
      </article>
    {:else}
      <p class="empty card wide">
        Open a CIF to see its cell, symmetry, sites and lattice vectors.
      </p>
    {/if}
  </div>
</section>

<style>
  .section-title {
    margin: 0.5rem 0 0.6rem;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    gap: 1rem;
    align-items: start;
  }
  .card {
    padding: 0.9rem 1.1rem;
    min-width: 0;
  }
  .wide {
    grid-column: 1 / -1;
  }
  article header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem 1rem;
    margin-bottom: 0.6rem;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
    color: var(--text-h);
  }
  .muted {
    font-family: var(--mono);
    font-size: 0.82rem;
    color: var(--muted);
  }
  .hint {
    margin: 0 0 0.75rem;
    font-size: 0.85rem;
  }
  .err {
    color: var(--err);
  }
  .empty {
    margin: 0;
    padding: 1.5rem;
    text-align: center;
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .row span {
    min-width: 7rem;
  }
  .row input[type='number'] {
    width: 4.5rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0 0.75rem;
  }
  .detected {
    font-size: 0.88rem;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-family: var(--mono);
    font-size: 0.85rem;
  }
  th {
    color: var(--muted);
    font-weight: 600;
  }
  th,
  td {
    padding: 0.2rem 0.9rem 0.2rem 0;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 1.5rem;
    margin: 0 0 0.75rem;
  }
  dd {
    margin: 0;
    font-family: var(--mono);
    color: var(--text-h);
  }
  .warnings {
    margin-bottom: 0.75rem;
    color: var(--warn);
  }
  .fold {
    margin: 0.5rem 0 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .fold summary {
    color: var(--text-h);
    margin-bottom: 0.4rem;
  }
</style>
