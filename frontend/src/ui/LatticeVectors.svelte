<script lang="ts">
  // The equations that turn a, b, c, α, β, γ into Cartesian lattice vectors for this crystal's
  // family (the convention used throughout: a ∥ x, b in the xy-plane), the resulting numbers, and
  // a reference page for the lattice family.
  import { cellShape, type CellShape } from '../core/cellShape';
  import type { Crystal } from '../core/crystal';

  let { crystal }: { crystal: Crystal } = $props();

  const EQUATIONS: Record<CellShape, { title: string; lines: string[]; where?: string[] }> = {
    cubic: {
      title: 'Cubic (a = b = c, α = β = γ = 90°)',
      lines: ['a = a x̂', 'b = a ŷ', 'c = a ẑ'],
    },
    tetragonal: {
      title: 'Tetragonal (a = b ≠ c, α = β = γ = 90°)',
      lines: ['a = a x̂', 'b = a ŷ', 'c = c ẑ'],
    },
    orthorhombic: {
      title: 'Orthorhombic (α = β = γ = 90°)',
      lines: ['a = a x̂', 'b = b ŷ', 'c = c ẑ'],
    },
    hexagonal: {
      title: 'Hexagonal axes (a = b, α = β = 90°, γ = 120°)',
      lines: ['a = a x̂', 'b = −½ a x̂ + (√3 / 2) a ŷ', 'c = c ẑ'],
    },
    rhombohedral: {
      title: 'Rhombohedral axes (a = b = c, α = β = γ)',
      lines: ['a = a x̂', 'b = a cos α x̂ + a sin α ŷ', 'c = a cos α x̂ + c_y ŷ + c_z ẑ'],
      where: ['c_y = a (cos α − cos²α) ⁄ sin α', 'c_z = a √(1 − 3 cos²α + 2 cos³α) ⁄ sin α'],
    },
    'monoclinic-b': {
      title: 'Monoclinic, unique axis b (α = γ = 90°)',
      lines: ['a = a x̂', 'b = b ŷ', 'c = c cos β x̂ + c sin β ẑ'],
    },
    'monoclinic-c': {
      title: 'Monoclinic, unique axis c (α = β = 90°)',
      lines: ['a = a x̂', 'b = b cos γ x̂ + b sin γ ŷ', 'c = c ẑ'],
    },
    'monoclinic-a': {
      title: 'Monoclinic, unique axis a (β = γ = 90°)',
      lines: ['a = a x̂', 'b = b ŷ', 'c = c cos α ŷ + c sin α ẑ'],
    },
    triclinic: {
      title: 'Triclinic (general cell)',
      lines: ['a = a x̂', 'b = b cos γ x̂ + b sin γ ŷ', 'c = c_x x̂ + c_y ŷ + c_z ẑ'],
      where: [
        'c_x = c cos β',
        'c_y = c (cos α − cos β cos γ) ⁄ sin γ',
        'c_z = √(c² − c_x² − c_y²)',
      ],
    },
  };

  const shape = $derived(cellShape(crystal.cell, crystal.spaceGroup.crystalSystem));
  const eq = $derived(EQUATIONS[shape]);
  const family = $derived(crystal.spaceGroup.crystalSystem);
  const link = $derived(
    family ? `https://www.aflowlib.org/prototype-encyclopedia/${family}_lattice.html` : null,
  );
  const vectors = $derived([0, 1, 2].map((k) => [0, 1, 2].map((i) => crystal.lattice.M[i][k])));
  /** Split an equation into pieces: function names upright, variables italic, c_x subscripted. */
  type Piece = { text: string; italic?: boolean; sub?: string };
  function pieces(text: string): Piece[] {
    const out: Piece[] = [];
    for (const m of text.matchAll(
      /(cos|sin)|([a-z])_([xyz])|([a-cα-γ])(?![a-z])|([^a-zα-γ]+|.)/g,
    )) {
      if (m[1]) out.push({ text: m[1] });
      else if (m[2]) out.push({ text: m[2], italic: true, sub: m[3] });
      else if (m[4]) out.push({ text: m[4], italic: true });
      else out.push({ text: m[0] });
    }
    return out;
  }

  const fmt = (x: number) => (Math.abs(x) < 5e-7 ? 0 : x).toFixed(4).padStart(9);
</script>

{#snippet math(text: string)}{#each pieces(text) as p, i (i)}{#if p.italic}<i>{p.text}</i
      >{:else}{p.text}{/if}{#if p.sub}<sub>{p.sub}</sub>{/if}{/each}{/snippet}

<details class="lattice" open data-testid="lattice-vectors">
  <summary>Lattice vectors: {eq.title}</summary>
  <div class="cols">
    <div class="math">
      <!-- the vector on the left in bold; lengths and angles italic; cos and sin upright -->
      {#each eq.lines as line (line)}
        {@const [lhs, rhs] = line.split(' = ')}
        <div><b>{lhs}</b> = {@render math(rhs)}</div>
      {/each}
      {#if eq.where}
        <div class="where">
          where {#each eq.where as w (w)}<div>{@render math(w)}</div>{/each}
        </div>
      {/if}
    </div>
    <pre class="numbers">{['a', 'b', 'c']
        .map((n, k) => `${n} = (${vectors[k].map(fmt).join(',')} ) Å`)
        .join('\n')}</pre>
  </div>
  <p class="hint">
    Convention: a along x, b in the xy-plane, c completing a right-handed set (so c* is along z).
    {#if link}
      Reference:
      <a href={link} target="_blank" rel="noopener noreferrer">AFLOW, the {family} lattices</a>
      (for centred lattices AFLOW lists primitive vectors and may orient the cell differently; the equations
      here are the ones this program uses).
    {/if}
  </p>
</details>

<style>
  .lattice {
    margin: 0.25rem 0 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
    color: var(--text-h);
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 2.5rem;
    align-items: flex-start;
    margin: 0.5rem 0;
  }
  .math {
    font-family: 'Times New Roman', Times, serif;
    font-size: 1.05rem;
    line-height: 1.5;
  }
  .where {
    margin-top: 0.3rem;
    font-size: 0.95rem;
  }
  .where div {
    padding-left: 1.2rem;
  }
  .numbers {
    margin: 0;
    font-family: var(--mono);
    font-size: 0.85rem;
  }
  .hint {
    font-size: 0.8rem;
    margin: 0;
  }
</style>
