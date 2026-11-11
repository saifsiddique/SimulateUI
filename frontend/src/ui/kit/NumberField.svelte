<script lang="ts">
  // A labelled number with its unit (context.md §7.MU kit): an exact value in a box, an optional
  // slider beside it, and a reset to the default. The box commits on Enter or when it loses focus
  // and accepts the whole [min, max]; the slider may cover a narrower, more useful range
  // (sliderMin/sliderMax). An invalid entry is put back to the current value.
  let {
    label,
    value = $bindable(),
    unit = '',
    min = -Infinity,
    max = Infinity,
    step = 1,
    slider = false,
    sliderMin,
    sliderMax,
    def,
    digits,
    disabled = false,
    help = '',
    testid = '',
  }: {
    label: string;
    value: number;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
    /** Show a slider next to the box. */
    slider?: boolean;
    sliderMin?: number;
    sliderMax?: number;
    /** The default; a reset button appears when the value differs from it. */
    def?: number;
    /** Decimals shown in the box (default: as typed). */
    digits?: number;
    disabled?: boolean;
    /** A tooltip explaining the parameter. */
    help?: string;
    testid?: string;
  } = $props();

  const id = `nf-${Math.random().toString(36).slice(2, 9)}`;
  const shown = (v: number) => (digits === undefined ? String(v) : v.toFixed(digits));
  let text = $state('');
  let editing = false;

  $effect(() => {
    const v = value;
    if (!editing) text = shown(v);
  });

  function commit() {
    editing = false;
    const v = Number(text.trim());
    if (text.trim() === '' || !Number.isFinite(v)) {
      text = shown(value);
      return;
    }
    const clamped = Math.min(max, Math.max(min, v));
    value = clamped;
    text = shown(clamped);
  }

  const sMin = $derived(sliderMin ?? (Number.isFinite(min) ? min : 0));
  const sMax = $derived(sliderMax ?? (Number.isFinite(max) ? max : 100));
  const changed = $derived(def !== undefined && Math.abs(value - def) > 1e-12);
  const outside = $derived(slider && (value < sMin || value > sMax));
</script>

<div class="nf" class:disabled title={help || undefined}>
  <label for={id}>{label}</label>
  <span class="row">
    {#if slider}
      <input
        type="range"
        min={sMin}
        max={sMax}
        {step}
        value={Math.min(sMax, Math.max(sMin, value))}
        {disabled}
        aria-label={`${label} slider`}
        class:outside
        oninput={(e) => (value = Number(e.currentTarget.value))}
        data-testid={testid ? `${testid}-slider` : undefined}
      />
    {/if}
    <span class="box">
      <input
        {id}
        type="text"
        inputmode="decimal"
        bind:value={text}
        {disabled}
        onfocus={() => (editing = true)}
        onblur={commit}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            editing = false;
            text = shown(value);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? step : -step)));
            value = Number(v.toPrecision(12));
            text = shown(value);
          }
        }}
        data-testid={testid || undefined}
      />
      {#if unit}<span class="unit">{unit}</span>{/if}
    </span>
    {#if changed}
      <button
        type="button"
        class="reset"
        {disabled}
        onclick={() => (value = def!)}
        title={`Back to the default (${shown(def!)}${unit ? ' ' + unit : ''})`}
        aria-label={`Reset ${label}`}>↺</button
      >
    {/if}
  </span>
</div>

<style>
  .nf {
    display: grid;
    grid-template-columns: minmax(6.5rem, max-content) 1fr;
    align-items: center;
    gap: 0.2rem 0.6rem;
    font-size: 0.84rem;
  }
  .nf.disabled {
    opacity: 0.55;
  }
  label {
    color: var(--text);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }
  input[type='range'] {
    flex: 1;
    min-width: 4rem;
  }
  /* The value is beyond the slider's range (typed in the box): the thumb sits at the end. */
  input[type='range'].outside {
    opacity: 0.5;
  }
  .box {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
  }
  .box:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .box input {
    width: 4.6rem;
    border: none;
    background: none;
    text-align: right;
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  .unit {
    padding: 0 0.4rem 0 0.1rem;
    color: var(--muted);
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .reset {
    padding: 0 0.35rem;
    border-color: transparent;
    background: none;
    color: var(--muted);
  }
</style>
