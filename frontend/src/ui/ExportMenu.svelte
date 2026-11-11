<script lang="ts">
  // An Export menu (context.md M12): a button that opens a panel listing the formats a view can save
  // or copy. The panel is a popover, so it is not clipped by the cards around it.
  import { rasterPlan } from '../export/browser';
  import type { ExportOptions, ExportSection } from '../export/rows';

  let {
    sections,
    disabled = false,
    imageSize = null,
    testid = 'export',
    compact = false,
    label = 'Export',
  }: {
    sections: ExportSection[];
    disabled?: boolean;
    /** Size in CSS pixels of the picture that PNG files are made from, to show their pixel size. */
    imageSize?: (() => { width: number; height: number } | null) | null;
    testid?: string;
    /** A small button, for a panel header. */
    compact?: boolean;
    /** Text of the button. */
    label?: string;
  } = $props();

  const uid = $props.id();
  let panel = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();
  let open = $state(false);
  let dpi = $state(300);
  let transparent = $state(false);
  let busy = $state<string | null>(null);
  let message = $state('');
  let failed = $state(false);

  const options = $derived<ExportOptions>({
    dpi: Number.isFinite(dpi) && dpi >= 30 && dpi <= 2400 ? dpi : 300,
    transparent,
  });
  const dpiValid = $derived(Number.isFinite(dpi) && dpi >= 30 && dpi <= 2400);
  const anyCopy = $derived(sections.some((s) => s.rows.some((r) => r.copy)));

  /** Pixel size the PNG will have, once the panel is open (the picture may have been resized). */
  const pixels = $derived.by(() => {
    void open;
    const size = imageSize?.();
    if (!size || !dpiValid) return null;
    const p = rasterPlan(size.width, size.height, dpi);
    return { w: p.pxW, h: p.pxH, dpi: Math.round(p.dpi), limited: p.limited };
  });

  function place() {
    if (!panel || !trigger) return;
    const r = trigger.getBoundingClientRect();
    const w = panel.offsetWidth;
    panel.style.top = `${Math.min(r.bottom + 6, window.innerHeight - panel.offsetHeight - 8)}px`;
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  }

  function onToggle(e: Event) {
    open = (e as ToggleEvent).newState === 'open';
    if (open) {
      message = '';
      place();
    }
  }

  async function run(id: string, kind: 'save' | 'copy', action: () => Promise<string> | string) {
    busy = `${id}-${kind}`;
    failed = false;
    message = '';
    try {
      message = await action();
    } catch (e) {
      failed = true;
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
</script>

<button
  bind:this={trigger}
  type="button"
  popovertarget={`export-${uid}`}
  {disabled}
  class="trigger"
  class:compact
  aria-haspopup="dialog"
  aria-expanded={open}
  data-testid={`${testid}-button`}>{label} ▾</button
>

<div
  bind:this={panel}
  id={`export-${uid}`}
  popover="auto"
  ontoggle={onToggle}
  class="menu"
  role="dialog"
  aria-label={label}
  data-testid={`${testid}-panel`}
>
  {#each sections as section (section.title)}
    <section>
      <h4>{section.title}</h4>
      {#if section.image}
        <div class="opts">
          <label class="unit" title="Resolution of PNG files. 96 screen pixels are one inch.">
            DPI
            <input
              class="num"
              type="number"
              min="30"
              max="2400"
              step="50"
              bind:value={dpi}
              aria-invalid={!dpiValid}
              aria-label="PNG resolution in dots per inch"
              data-testid={`${testid}-dpi`}
            />
          </label>
          <label class="unit" title="Leave the background out (PNG and SVG)">
            <input
              type="checkbox"
              bind:checked={transparent}
              data-testid={`${testid}-transparent`}
            />
            transparent
          </label>
          {#if pixels}
            <span class="muted" data-testid={`${testid}-pixels`}
              >{pixels.w} × {pixels.h} px{pixels.limited
                ? ` (at ${pixels.dpi} dpi, the limit)`
                : ''}</span
            >
          {:else if !dpiValid}
            <span class="muted bad">30 to 2400</span>
          {/if}
        </div>
      {/if}
      {#each section.rows as row (row.id)}
        <div class="row" class:single={!anyCopy}>
          <span class="name" title={row.hint}>{row.label}</span>
          <button
            type="button"
            disabled={busy !== null || (!dpiValid && !!section.image)}
            onclick={() => run(row.id, 'save', () => row.save(options))}
            data-testid={`${testid}-${row.id}-save`}>Save</button
          >
          {#if row.copy}
            <button
              type="button"
              disabled={busy !== null || (!dpiValid && !!section.image)}
              onclick={() => run(row.id, 'copy', () => row.copy!(options))}
              data-testid={`${testid}-${row.id}-copy`}>Copy</button
            >
          {:else if anyCopy}
            <span></span>
          {/if}
        </div>
      {/each}
    </section>
  {/each}
  <p
    class="status"
    class:bad={failed}
    role={failed ? 'alert' : 'status'}
    data-testid={`${testid}-status`}
  >
    {#if busy}Working…{:else}{message}{/if}
  </p>
</div>

<style>
  .trigger.compact {
    padding: 0.05rem 0.55rem;
    font-size: 0.78rem;
  }
  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
    width: min(21rem, calc(100vw - 1rem));
    max-height: calc(100vh - 1rem);
    overflow: auto;
    padding: 0.7rem 0.8rem 0.6rem;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-h);
    box-shadow: 0 12px 34px rgba(15, 23, 42, 0.22);
    /* the menu is a child of the panel header, whose capitals and weight it must not inherit */
    font-size: 0.84rem;
    font-weight: 400;
    letter-spacing: normal;
    text-transform: none;
  }
  section + section {
    margin-top: 0.6rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  h4 {
    margin: 0 0 0.35rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.8rem;
    margin-bottom: 0.4rem;
  }
  .unit {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .num {
    width: 4.2rem;
    padding: 0.15rem 0.3rem;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 4rem 4rem;
    align-items: center;
    gap: 0.4rem;
    padding: 0.12rem 0;
  }
  .row.single {
    grid-template-columns: 1fr 4rem;
  }
  .name {
    font-weight: 600;
  }
  .muted {
    color: var(--muted);
    font: 0.76rem var(--mono);
  }
  .bad {
    color: #b91c1c;
  }
  .status {
    min-height: 1.2em;
    margin: 0.5rem 0 0;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .status.bad {
    color: #b91c1c;
  }
</style>
