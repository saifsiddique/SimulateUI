<script lang="ts">
  // Mixed and partially occupied sites (context.md M2 task 3). abTEM needs whole atoms, so the
  // specimen step (M3) picks one species per site; here the user only sees where they are.
  import type { Crystal } from '../core/crystal';
  import { partialSites } from '../core/payload';

  let { crystal }: { crystal: Crystal | null } = $props();
  const sites = $derived(crystal ? partialSites(crystal) : []);
  const label = (s: (typeof sites)[number]) =>
    s.species.map((x) => `${x.element} ${x.occupancy.toFixed(2)}`).join(' / ');
  const fmt = (x: number) => x.toFixed(3);
</script>

{#if sites.length}
  <section class="card notice" data-testid="partial-sites" aria-label="Partial occupancy">
    <h2>Partial occupancy ({sites.length} sites)</h2>
    <p>
      Some sites are shared by several species or are not fully occupied. Multislice needs whole
      atoms, so the specimen step will ask how to resolve them (dominant species, or a random
      sample). Until then all atoms at these sites are kept.
    </p>
    <details>
      <summary>Show the sites</summary>
      <table>
        <thead><tr><th>Occupants</th><th>Total</th><th>Fractional position</th></tr></thead>
        <tbody>
          {#each sites.slice(0, 60) as s, i (i)}
            <tr
              ><td>{label(s)}</td><td>{s.total.toFixed(2)}</td><td
                >{fmt(s.frac[0])}, {fmt(s.frac[1])}, {fmt(s.frac[2])}</td
              ></tr
            >
          {/each}
        </tbody>
      </table>
      {#if sites.length > 60}<p class="muted">… and {sites.length - 60} more.</p>{/if}
    </details>
  </section>
{/if}

<style>
  .notice {
    padding: 0.8rem 1rem;
    border-left: 4px solid #f59e0b;
  }
  h2 {
    margin: 0 0 0.3rem;
    font-size: 1rem;
  }
  p {
    margin: 0 0 0.4rem;
  }
  table {
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th,
  td {
    padding: 0.1rem 1rem 0.1rem 0;
    text-align: left;
  }
</style>
