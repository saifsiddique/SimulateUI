<script lang="ts">
  // The aberrations of the probe (context.md §7.MU steps U4, U6): every abTEM coefficient with
  // Haider's notation, "Reset all to zero" and "Add random aberrations". Shared by the multislice
  // and INCOSTEM sidebars; `params` is the object that holds `ab` (magnitudes in Å, angles in
  // degrees, abTEM's names) and the `defocus` (Å, positive is underfocus), which random aberrations
  // leave alone.
  import { ABERRATIONS, fromUi, phiName, randomAberrations, toUi } from '../core/aberrations';

  let { params }: { params: { ab: Record<string, number>; defocus: number } } = $props();

  const nonZero = $derived(ABERRATIONS.filter((d) => params.ab[d.id] !== 0).length);
  const shown = (v: number) => +v.toPrecision(6);
  function randomize() {
    for (const [k, v] of Object.entries(randomAberrations())) params.ab[k] = +v.toPrecision(6);
  }
  function setAb(key: string, text: string, scale = 1) {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v)) params.ab[key] = v * scale;
  }
</script>

<h4>Aberrations <span class="muted small">({nonZero} non-zero)</span></h4>
<div class="row">
  <button
    type="button"
    disabled={nonZero === 0}
    onclick={() => {
      for (const k of Object.keys(params.ab)) params.ab[k] = 0;
    }}
    data-testid="ab-reset">Reset all to zero</button
  >
  <button
    type="button"
    onclick={randomize}
    title="Every coefficient except the defocus drawn from a typical range (A₁ 0–2 nm, B₂ and A₂ 0–5 nm, C₃ ±500 nm, S₃ and A₃ 0–100 nm, the rest 0–5 µm), every angle 0–360°"
    data-testid="ab-random">Add random aberrations</button
  >
</div>
<p class="muted small">
  abTEM's coefficients with Haider's notation in brackets: the magnitude, and the angle of the axis
  (φ) for the terms that have one. The defocus is the C<sub>10</sub> (C<sub>1</sub>) field above.
</p>
<table class="ab" data-testid="aberrations">
  <thead><tr><th>Coefficient</th><th>Magnitude</th><th>φ (°)</th></tr></thead>
  <tbody>
    {#each ABERRATIONS as d (d.id)}
      <tr>
        <td title={`${d.id} (${d.haider}) ${d.label}`}
          >C<sub>{d.id.slice(1)}</sub> ({d.haider[0]}<sub>{d.haider.slice(1)}</sub>)
          <span class="muted">{d.label}</span></td
        >
        <td>
          <span class="num"
            ><input
              type="text"
              inputmode="decimal"
              value={shown(toUi(d, params.ab[d.id]))}
              onchange={(e) => setAb(d.id, e.currentTarget.value, fromUi(d, 1))}
              aria-label={`${d.id} in ${d.unit}`}
              data-testid={`ab-${d.id}`}
            />
            {d.unit}</span
          >
        </td>
        <td>
          {#if d.angle}
            <input
              type="text"
              inputmode="decimal"
              value={shown(params.ab[phiName(d.id)])}
              onchange={(e) => setAb(phiName(d.id), e.currentTarget.value)}
              aria-label={`${phiName(d.id)} in degrees`}
              data-testid={`ab-${phiName(d.id)}`}
            />
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  h4,
  p {
    margin: 0;
  }
  h4 {
    font-size: 0.85rem;
  }
  .small {
    font-size: 0.8rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .ab {
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .ab th {
    text-align: left;
    font-weight: 600;
    color: var(--muted);
    padding: 0 0.4rem 0.2rem 0;
  }
  .ab td {
    padding: 0.1rem 0.4rem 0.1rem 0;
    white-space: nowrap;
  }
  .ab td:first-child {
    white-space: normal;
  }
  .ab input {
    width: 4.6rem;
    text-align: right;
  }
  .num {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--muted);
  }
</style>
