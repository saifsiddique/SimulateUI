<script lang="ts">
  // The settings sidebar of a tab: a tab bar over a scrolling body, to the right of the view. It can
  // be resized with the handle on its left and collapsed to a rail; both are remembered in this
  // browser under `storageKey`. The Structure Viewer and the Electron Diffraction tab share it.
  import type { Snippet } from 'svelte';

  let {
    tabs,
    tab = $bindable(),
    label,
    storageKey,
    idPrefix,
    testid = '',
    defaultWidth = 380,
    sticky = false,
    children,
  }: {
    tabs: readonly { id: string; label: string }[];
    tab: string;
    /** Accessible name of the tab list. */
    label: string;
    storageKey: string;
    /** Prefix of the element ids, unique on the page. */
    idPrefix: string;
    /** Prefix of the test ids ('' gives side-panel, panel-handle, ...). */
    testid?: string;
    defaultWidth?: number;
    /** Stays in view while the page scrolls past tall views (it is as high as the window). */
    sticky?: boolean;
    children: Snippet;
  } = $props();

  const PANEL_MIN = 280;
  const PANEL_MAX = 900;
  // svelte-ignore state_referenced_locally
  let width = $state(defaultWidth);
  let collapsed = $state(false);

  const key = () => storageKey;
  try {
    const saved = JSON.parse(localStorage.getItem(key()) ?? 'null') as {
      width?: unknown;
      collapsed?: unknown;
    } | null;
    if (saved && typeof saved.width === 'number' && Number.isFinite(saved.width))
      width = Math.min(PANEL_MAX, Math.max(PANEL_MIN, saved.width));
    if (saved && typeof saved.collapsed === 'boolean') collapsed = saved.collapsed;
  } catch {
    // no storage (private window, blocked site data): the defaults stand
  }

  function save() {
    try {
      localStorage.setItem(key(), JSON.stringify({ width, collapsed }));
    } catch {
      // ignore: remembering the layout is a convenience
    }
  }

  function setWidth(w: number) {
    const max = Math.min(PANEL_MAX, Math.max(PANEL_MIN, window.innerWidth * 0.6));
    width = Math.round(Math.min(max, Math.max(PANEL_MIN, w)));
    save();
  }

  function setCollapsed(on: boolean) {
    collapsed = on;
    save();
  }

  function startResize(e: PointerEvent) {
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => setWidth(w0 + (x0 - ev.clientX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function onHandleKey(e: KeyboardEvent) {
    const d = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowLeft') setWidth(width + d);
    else if (e.key === 'ArrowRight') setWidth(width - d);
    else return;
    e.preventDefault();
  }

  /** Left/Right arrows move between tabs (the WAI-ARIA tabs pattern). */
  function onTabKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    tab = next.id;
    document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
  }
</script>

{#if collapsed}
  <button
    type="button"
    class="rail card"
    onclick={() => setCollapsed(false)}
    title="Show the settings panel"
    data-testid={`${testid}panel-expand`}><span>⟨</span><span class="vtext">Settings</span></button
  >
{:else}
  <!-- a focusable separator is the WAI-ARIA window-splitter pattern -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="handle"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize the settings panel"
    aria-valuenow={width}
    aria-valuemin={PANEL_MIN}
    aria-valuemax={PANEL_MAX}
    tabindex="0"
    title="Drag to resize; double-click for the default width"
    onpointerdown={startResize}
    ondblclick={() => setWidth(defaultWidth)}
    onkeydown={onHandleKey}
    data-testid={`${testid}panel-handle`}
  ></div>
  <aside
    class="side card"
    class:sticky
    style:width={`${width}px`}
    data-testid={`${testid}side-panel`}
  >
    <!-- absolutely placed, so that the panel takes the height of the view, not of its content -->
    <div class="inner">
      <div class="tabbar">
        <div class="tabs" role="tablist" aria-label={label}>
          {#each tabs as t (t.id)}
            <button
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${idPrefix}-tabpanel`}
              tabindex={tab === t.id ? 0 : -1}
              class:active={tab === t.id}
              onclick={() => (tab = t.id)}
              onkeydown={onTabKey}
              data-testid={`${testid}side-tab-${t.id}`}>{t.label}</button
            >
          {/each}
        </div>
        <button
          type="button"
          class="collapse"
          onclick={() => setCollapsed(true)}
          title="Hide the panel"
          aria-label="Hide the panel"
          data-testid={`${testid}panel-collapse`}>⟩</button
        >
      </div>
      <div
        class="body"
        role="tabpanel"
        id={`${idPrefix}-tabpanel`}
        aria-labelledby={`${idPrefix}-tab-${tab}`}
      >
        {@render children()}
      </div>
    </div>
  </aside>
{/if}

<style>
  .handle {
    flex: none;
    width: 0.75rem;
    cursor: col-resize;
    position: relative;
    touch-action: none;
  }
  .handle::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 4px;
    height: 2.5rem;
    transform: translate(-50%, -50%);
    border-radius: 2px;
    background: var(--border-strong);
    transition: background 0.12s;
  }
  .handle:hover::after,
  .handle:focus-visible::after {
    background: var(--accent);
  }
  .handle:focus-visible {
    outline: none;
  }
  .side {
    position: relative;
    flex: none;
    box-sizing: border-box;
    min-width: 0;
    overflow: hidden;
  }
  .side.sticky {
    position: sticky;
    top: 0.5rem;
    align-self: flex-start;
    height: calc(100vh - 1rem);
  }
  .inner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    font-size: 0.82rem;
  }
  .tabbar {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    border-radius: var(--radius) var(--radius) 0 0;
  }
  /* Tabs that do not fit go on a second row rather than out of sight. */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .tabs button {
    flex: 1 0 auto;
    padding: 0.55rem 0.6rem 0.5rem;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    color: var(--text);
    font-weight: 500;
    white-space: nowrap;
  }
  .tabs button:hover:not(:disabled) {
    background: none;
    color: var(--text-h);
  }
  .tabs button.active {
    color: var(--accent-ink);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .collapse {
    border: none;
    border-left: 1px solid var(--border);
    border-radius: 0 var(--radius) 0 0;
    background: none;
    padding: 0 0.7rem;
    font-size: 1rem;
    color: var(--muted);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0.6rem 0.85rem 0.85rem;
  }
  .rail {
    flex: none;
    margin-left: 0.75rem;
    width: 2.4rem;
    padding: 0.6rem 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
    border-radius: var(--radius);
    color: var(--text);
  }
  .vtext {
    writing-mode: vertical-rl;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  @media (max-width: 60rem) {
    .side,
    .side.sticky {
      position: relative;
      width: auto !important;
      height: 28rem;
    }
    .handle {
      display: none;
    }
    .rail {
      margin-left: 0;
      width: auto;
      flex-direction: row;
      justify-content: center;
    }
    .vtext {
      writing-mode: horizontal-tb;
    }
  }
</style>
