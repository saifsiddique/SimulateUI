<script lang="ts">
  // ② Specimen (context.md §7.MU step U3). Ribbon: zone axis, size, rotate, build. Two square
  // cards (the crystal with the beam and the periodic cell, and the supercell abTEM receives) and
  // a sidebar (Supercell, Occupancy, Summary). Nothing is rebuilt by itself: after a change the
  // Build button turns on and the user presses it. The scan field of view is chosen in ③.
  import type { Crystal } from '../core/crystal';
  import { crystalOverlay } from '../core/specimen';
  import { buildSpecimen, needsRebuild, specimen, specimenCrystal } from '../state/specimen.svelte';
  import CrystalPane from './CrystalPane.svelte';
  import RepeatFields from './RepeatFields.svelte';
  import SidePanel from './SidePanel.svelte';
  import SpecimenSide, { SPECIMEN_TABS, type SpecimenTab } from './SpecimenSide.svelte';
  import SpecimenView from './SpecimenView.svelte';

  let { crystal, name = '' }: { crystal: Crystal | null; name?: string } = $props();

  const p = specimen.params;
  const r = $derived(specimen.result);
  const overlay = $derived(r ? crystalOverlay(r) : null);
  const specCrystal = $derived(r ? specimenCrystal(r) : null);
  const fmt = (x: number, d = 1) => x.toFixed(d);

  let pane = $state<{
    useView(): void;
    lookAlongUvw(uvw: [number, number, number]): void;
    lookNormalToHkl(hkl: [number, number, number]): void;
    rotate(right: number, upward: number, roll: number): void;
  }>();
  let specView = $state<{ rotate(right: number, upward: number, roll: number): void }>();
  let target = $state<'left' | 'right'>('left');
  let angle = $state(5);
  const deg = $derived(Number.isFinite(angle) && angle > 0 ? angle : 5);
  /** Rotate the view the toggle points at; the crystal's rotation also sets the zone axis. */
  function rotate(right: number, upward: number, roll: number) {
    (target === 'left' ? pane : specView)?.rotate(right, upward, roll);
  }
  const dirty = $derived(needsRebuild());
  let sideTab = $state<SpecimenTab>('summary');

  // The typed zone axis follows the one chosen elsewhere (the crystal view, the Structure tab).
  let uvwInput = $derived<[string, string, string]>(
    p.zoneAxis.map(String) as [string, string, string],
  );
  const uvwValue = $derived.by((): [number, number, number] | null => {
    const v = uvwInput.map((x) => Number(x.trim() === '' ? NaN : x));
    return v.every(Number.isInteger) && v.some((x) => x !== 0) ? [v[0], v[1], v[2]] : null;
  });

  const AXES: { name: string; v: [number, number, number] }[] = [
    { name: 'a', v: [1, 0, 0] },
    { name: 'b', v: [0, 1, 0] },
    { name: 'c', v: [0, 0, 1] },
  ];
  const extent = $derived(
    r
      ? `${fmt(r.crystal_extent[0])} × ${fmt(r.crystal_extent[1])} × ${fmt(r.crystal_extent[2])} Å`
      : '',
  );
</script>

<div class="step" data-testid="specimen-step">
  <form
    class="ribbon card"
    novalidate
    onsubmit={(e) => {
      e.preventDefault();
      if (uvwValue) pane?.lookAlongUvw(uvwValue);
    }}
  >
    <fieldset disabled={!crystal}>
      <legend>Zone axis</legend>
      <div class="ctl">
        <span class="uvw">
          <span class="br">[</span>
          {#each [0, 1, 2] as k (k)}
            <input
              class="idx"
              value={uvwInput[k]}
              oninput={(e) =>
                (uvwInput = uvwInput.map((x, i) => (i === k ? e.currentTarget.value : x)) as [
                  string,
                  string,
                  string,
                ])}
              aria-label={`u v w, index ${k + 1}`}
              data-testid={`zone-${k}`}
              inputmode="numeric"
            />
          {/each}
          <span class="br">]</span>
        </span>
        <button type="submit" disabled={!uvwValue} data-testid="zone-go">Go</button>
        <span class="seg" role="group" aria-label="Along a lattice vector">
          {#each AXES as { name: axis, v } (axis)}
            <button type="button" title={`Beam along ${axis}`} onclick={() => pane?.lookAlongUvw(v)}
              >{axis}</button
            >
          {/each}
        </span>
        <span class="seg" role="group" aria-label="Normal to a lattice plane">
          {#each AXES as { name: axis, v } (axis)}
            <button
              type="button"
              title={`Beam along ${axis}* (normal to the plane)`}
              onclick={() => pane?.lookNormalToHkl(v)}>{axis}*</button
            >
          {/each}
        </span>
        <button
          type="button"
          title="Take the direction the crystal view is looking along"
          onclick={() => pane?.useView()}
          data-testid="use-view">Use the crystal view</button
        >
      </div>
    </fieldset>

    <fieldset disabled={!crystal}>
      <legend>Supercell size (Unit Cell Repeats)</legend>
      <div class="ctl">
        <RepeatFields />
        <span class="extent" data-testid="specimen-extent">{extent ? `= ${extent}` : ''}</span>
      </div>
    </fieldset>

    <fieldset disabled={!crystal}>
      <legend>Rotate sample</legend>
      <div class="ctl">
        <span class="seg" role="group" aria-label="View to rotate">
          <button
            type="button"
            aria-pressed={target === 'left'}
            onclick={() => (target = 'left')}
            title="Rotate the crystal (left view); its direction becomes the zone axis"
            data-testid="rotate-left">Left view</button
          ><button
            type="button"
            aria-pressed={target === 'right'}
            onclick={() => (target = 'right')}
            title="Rotate the supercell (right view); the zone axis is unchanged"
            data-testid="rotate-right">Right view</button
          >
        </span>
        <span class="seg" role="group" aria-label="Goniometer">
          <button type="button" onclick={() => rotate(-deg, 0, 0)} aria-label="Tilt left">◀</button
          ><button type="button" onclick={() => rotate(deg, 0, 0)} aria-label="Tilt right">▶</button
          ><button type="button" onclick={() => rotate(0, deg, 0)} aria-label="Tilt up">▲</button
          ><button type="button" onclick={() => rotate(0, -deg, 0)} aria-label="Tilt down">▼</button
          >
        </span>
        <span class="seg" role="group" aria-label="Rotate about the view axis">
          <button
            type="button"
            onclick={() => rotate(0, 0, -deg)}
            aria-label="Rotate in plane anticlockwise">⟲</button
          ><button
            type="button"
            onclick={() => rotate(0, 0, deg)}
            aria-label="Rotate in plane clockwise">⟳</button
          >
        </span>
        <label class="unit" title="Rotation step">
          <input
            class="idx"
            type="number"
            min="0.1"
            max="180"
            step="0.5"
            bind:value={angle}
            aria-label="Rotation step in degrees"
            data-testid="rotate-step"
          />°
        </label>
      </div>
    </fieldset>

    <fieldset disabled={!crystal}>
      <legend>Build orthogonal periodic supercell</legend>
      <div class="ctl">
        <button
          type="button"
          class="primary"
          onclick={() => void buildSpecimen()}
          disabled={!crystal || specimen.status === 'pending' || (!!r && !dirty)}
          data-testid="build-specimen">{r ? 'Rebuild' : 'Build'}</button
        >
        {#if specimen.status === 'pending'}<span class="muted">Building…</span>{:else if dirty}<span
            class="muted"
            data-testid="rebuild-hint">Settings changed: rebuild to continue.</span
          >{/if}
      </div>
    </fieldset>
  </form>

  {#if specimen.status === 'error'}
    <p class="notice err" role="alert" data-testid="specimen-error">✕ {specimen.error}</p>
  {/if}

  <div class="row">
    <div class="views">
      <CrystalPane bind:this={pane} {crystal} {overlay} {name} />
      <SpecimenView
        bind:this={specView}
        crystal={specCrystal}
        {name}
        title="Supercell (to be simulated)"
      />
    </div>
    <SidePanel
      tabs={SPECIMEN_TABS}
      bind:tab={sideTab}
      label="Specimen settings"
      storageKey="emsim.specimenPanel"
      idPrefix="spec"
      testid="spec-"
      defaultWidth={340}
    >
      <SpecimenSide tab={sideTab} />
    </SidePanel>
  </div>

  <p class="hint">
    <kbd>drag</kbd> rotate the crystal · <kbd>wheel</kbd> zoom · click the crystal, then
    <kbd>←↑→↓</kbd> tilt 5° (<kbd>Shift</kbd> 1°, <kbd>Ctrl</kbd> 15°) · the red outline is one periodic
    cell and the beam; the specimen is that cell repeated.
  </p>
</div>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: stretch;
    min-width: 0;
  }
  .views {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.8rem;
    align-content: start;
  }
  .uvw {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .idx {
    width: 2.6rem;
    text-align: center;
  }
  .br {
    color: var(--muted);
  }
  .extent {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 60rem) {
    .row {
      flex-direction: column;
      gap: 0.8rem;
    }
  }
  @media (max-width: 40rem) {
    .views {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
