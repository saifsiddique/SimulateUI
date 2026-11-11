<script lang="ts" module>
  import type { Crystal } from '../core/crystal';

  export interface Loaded {
    crystal: Crystal | null;
    fileName: string;
    warnings: string[];
    /** The file's text as read (em_sim_ui: the backend cross-checks its own reading against it). */
    rawCif: string;
    /** The card shown (null = none); the app keeps each card's settings under it. */
    id?: number | null;
    /** The structure changed under the same card (another data block): no settings to restore. */
    fresh?: boolean;
  }

  /** More open structures than this and the bar warns that the page may slow down. */
  export const SOFT_LIMIT = 10;
  /** No more than this are kept open; further files are refused with a message. */
  export const HARD_LIMIT = 40;
</script>

<script lang="ts">
  // Opening structures: CIFs from disk (button or drag and drop, several at once). Each open file
  // is a card with its formula (TiO2, ErTe3) and space group; clicking a card shows that structure in
  // every tab, its × closes it. A file with several data blocks gets a chooser for the shown card.
  import { parseCif, type BlockOutcome } from '../core/cif';
  import { buildCrystal, compactFormula } from '../core/crystal';
  import { EXAMPLES } from '../core/examples';
  import { migrateSetup, SetupError, type SetupDocument } from '../core/setup';
  import { parseXyz } from '../core/xyz';
  import SpaceGroupSymbol from './SpaceGroupSymbol.svelte';

  // em_sim_ui: XYZ files open too (one structure, no data blocks), and the raw text travels with
  // the crystal for the backend's cross-check.
  // Setups (U7): a saved .simulateui.json opens its structure as a card together with the
  // settings; Save setup writes the shown card's.
  let {
    onLoad,
    onSave,
    onSetup,
  }: {
    onLoad: (loaded: Loaded) => void;
    onSave?: () => void;
    onSetup?: (id: number, doc: SetupDocument) => void;
  } = $props();

  interface OpenFile {
    id: number;
    fileName: string;
    outcomes: BlockOutcome[];
    block: number;
    crystal: Crystal;
    warnings: string[];
    rawCif: string;
  }

  let files = $state.raw<OpenFile[]>([]);
  let activeId = $state<number | null>(null);
  let errors = $state<string[]>([]);
  let notice = $state('');
  let dragging = $state(false);
  let input: HTMLInputElement;
  let setupInput: HTMLInputElement;
  let nextId = 1;

  const active = $derived(files.find((f) => f.id === activeId) ?? null);

  function show(file: OpenFile | null, fresh = false) {
    activeId = file?.id ?? null;
    onLoad(
      file
        ? {
            crystal: file.crystal,
            fileName: file.fileName,
            warnings: file.warnings,
            rawCif: file.rawCif,
            id: file.id,
            fresh,
          }
        : { crystal: null, fileName: '', warnings: [], rawCif: '', id: null },
    );
  }

  /** The crystal of one data block, or the reason there is none. */
  function build(outcomes: BlockOutcome[], index: number) {
    const o = outcomes[index];
    if (!o?.structure) return { error: o?.error ?? 'No structure in this data block.' };
    const built = buildCrystal(o.structure);
    return {
      crystal: built.crystal,
      warnings: [...o.warnings, ...built.warnings].map((w) => w.message),
    };
  }

  async function read(file: File): Promise<OpenFile> {
    const rawCif = await file.text();
    if (/\.xyz$/i.test(file.name)) {
      const xyz = parseXyz(rawCif, file.name);
      const built = buildCrystal(xyz.structure);
      return {
        id: nextId++,
        fileName: file.name,
        outcomes: [],
        block: 0,
        crystal: built.crystal,
        warnings: [...xyz.warnings, ...built.warnings.map((w) => w.message)],
        rawCif,
      };
    }
    const outcomes = parseCif(rawCif);
    const first = outcomes.findIndex((o) => o.structure);
    if (first === -1) throw new Error(outcomes[0]?.error ?? 'No structure found in this file.');
    const b = build(outcomes, first);
    if (!b.crystal) throw new Error(b.error);
    return {
      id: nextId++,
      fileName: file.name,
      outcomes,
      block: first,
      crystal: b.crystal,
      warnings: b.warnings,
      rawCif,
    };
  }

  /** A saved setup: its structure as a card, and the settings kept for that card. */
  async function readSetup(file: File): Promise<{ file: OpenFile; doc: SetupDocument }> {
    let doc: SetupDocument;
    try {
      doc = migrateSetup(JSON.parse(await file.text()));
    } catch (e) {
      throw e instanceof SetupError
        ? e
        : new Error('This is not a SimulateUI setup file (it is not valid JSON).');
    }
    const opened = await read(new File([doc.structure.rawCif], doc.structure.fileName));
    return { file: opened, doc };
  }

  async function openAll(list: FileList | File[] | null | undefined) {
    const picked = [...(list ?? [])];
    if (picked.length === 0) return;
    errors = [];
    const room = HARD_LIMIT - files.length;
    const taken = picked.slice(0, Math.max(0, room));
    const refused = picked.length - taken.length;
    const added: OpenFile[] = [];
    const setups: { id: number; doc: SetupDocument }[] = [];
    const failed: string[] = [];
    for (const f of taken) {
      try {
        if (/\.json$/i.test(f.name)) {
          const s = await readSetup(f);
          added.push(s.file);
          setups.push({ id: s.file.id, doc: s.doc });
        } else added.push(await read(f));
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (refused > 0)
      failed.push(
        `${refused} file${refused === 1 ? ' was' : 's were'} not opened: at most ${HARD_LIMIT} structures can be open at once. Close some first.`,
      );
    errors = failed;
    if (added.length === 0) return;
    files = [...files, ...added];
    updateNotice();
    for (const s of setups) onSetup?.(s.id, s.doc);
    show(added[added.length - 1]);
  }

  function updateNotice() {
    notice =
      files.length > SOFT_LIMIT
        ? `${files.length} structures are open. Each one is kept in memory and switching rebuilds every view, so more than ${SOFT_LIMIT} can slow the page down. Close the ones you no longer need.`
        : '';
  }

  function close(id: number) {
    const i = files.findIndex((f) => f.id === id);
    if (i === -1) return;
    const rest = files.filter((f) => f.id !== id);
    files = rest;
    updateNotice();
    errors = [];
    if (id === activeId) show(rest[i] ?? rest[i - 1] ?? null);
  }

  function selectBlock(index: number) {
    const f = active;
    if (!f) return;
    const b = build(f.outcomes, index);
    if (!b.crystal) {
      errors = [`${f.fileName}: ${b.error}`];
      return;
    }
    errors = [];
    const updated = { ...f, block: index, crystal: b.crystal, warnings: b.warnings };
    files = files.map((x) => (x.id === f.id ? updated : x));
    show(updated, true);
  }

  /** The card's label: the formula, its numbers as subscripts. */
  const formulaParts = (c: Crystal) =>
    compactFormula(c.summary)
      .split(/(\d+(?:\.\d+)?)/)
      .filter((t) => t !== '')
      .map((t) => ({ text: t, sub: /^\d/.test(t) }));
  const nameOf = (c: Crystal) => compactFormula(c.summary);

  /** An example setup shipped with the app (public/examples/): opened like a setup file. */
  async function openExample(event: Event) {
    const el = event.currentTarget as HTMLSelectElement;
    const file = el.value;
    el.value = '';
    if (!file) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}examples/${file}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await openAll([new File([await res.text()], file)]);
    } catch (e) {
      errors = [`${file}: ${e instanceof Error ? e.message : String(e)}`];
    }
  }

  function onFile(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    void openAll(el.files).then(() => (el.value = ''));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    void openAll(event.dataTransfer?.files);
  }
</script>

<section
  class="load card"
  class:dragging
  aria-label="Open structures"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <div class="actions">
    <button type="button" class="primary" onclick={() => input.click()}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"
        ><path
          d="M3 5.5A1.5 1.5 0 0 1 4.5 4h3.6l1.6 1.8h5.8A1.5 1.5 0 0 1 17 7.3v7.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"
          fill="currentColor"
        /></svg
      >
      Open CIF…
    </button>
    <input
      bind:this={input}
      class="file"
      type="file"
      accept=".cif,.txt,.xyz"
      multiple
      onchange={onFile}
      data-testid="cif-input"
      aria-label="CIF or XYZ files"
    />
    <button
      type="button"
      onclick={() => setupInput.click()}
      title="Open a saved setup: its structure and all its settings"
      data-testid="setup-open">Open setup…</button
    >
    <input
      bind:this={setupInput}
      class="file"
      type="file"
      accept=".json"
      onchange={onFile}
      data-testid="setup-input"
      aria-label="Saved setup"
    />
    <button
      type="button"
      disabled={!active}
      onclick={() => onSave?.()}
      title="Save the shown structure with its specimen and simulation settings"
      data-testid="setup-save">Save setup</button
    >
    <select
      class="examples"
      onchange={openExample}
      title="Open a ready-made example: a structure with its specimen and simulation set up"
      aria-label="Examples"
      data-testid="examples"
    >
      <option value="">Examples…</option>
      {#each EXAMPLES as ex (ex.file)}
        <option value={ex.file} title={ex.about}>{ex.title}</option>
      {/each}
    </select>
    <span class="hint">or drop .cif / .xyz / setup files here</span>
  </div>

  {#if files.length > 0}
    <span class="divider" aria-hidden="true"></span>
    <ul class="cards" aria-label="Open structures" data-testid="loaded">
      {#each files as f (f.id)}
        <li
          class="cif"
          class:active={f.id === activeId}
          title={[f.crystal.chemicalName, f.fileName].filter(Boolean).join(' · ')}
          data-testid="cif-card"
        >
          <button
            type="button"
            class="pick"
            aria-pressed={f.id === activeId}
            onclick={() => f.id !== activeId && show(f)}
            data-testid="cif-card-select"
          >
            <span class="name" data-testid="cif-card-name"
              >{#each formulaParts(f.crystal) as part, k (k)}{#if part.sub}<sub>{part.text}</sub
                  >{:else}{part.text}{/if}{/each}</span
            >
            {#if f.crystal.spaceGroup.symbol}
              <span class="sg" data-testid="cif-card-sg"
                ><SpaceGroupSymbol symbol={f.crystal.spaceGroup.symbol} /></span
              >
            {/if}
          </button>
          <button
            type="button"
            class="close"
            onclick={() => close(f.id)}
            aria-label={`Close ${nameOf(f.crystal)} (${f.fileName})`}
            title="Close this structure"
            data-testid="cif-card-close">×</button
          >
        </li>
      {/each}
    </ul>
  {/if}

  {#if active && active.outcomes.length > 1}
    <label class="block">
      Data block
      <select value={active.block} onchange={(e) => selectBlock(Number(e.currentTarget.value))}>
        {#each active.outcomes as o, i (i)}
          <option value={i} disabled={!o.structure}
            >{o.name}{o.structure ? '' : ' (no structure)'}</option
          >
        {/each}
      </select>
    </label>
  {/if}

  {#if notice}<p class="warn" role="status" data-testid="cif-warning">{notice}</p>{/if}
  {#each errors as e, i (i)}<p class="err" data-testid="error">{e}</p>{/each}
</section>

<style>
  .examples {
    font: inherit;
    font-size: 0.88rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-h);
    cursor: pointer;
  }
  .load {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1rem;
    padding: 0.7rem 1rem;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .load.dragging {
    border-color: var(--accent);
    border-style: dashed;
    background: var(--accent-soft);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.9rem;
    font-weight: 600;
    color: #fff;
    background: linear-gradient(135deg, var(--accent-grad-a), var(--accent-grad-b));
    border-color: var(--accent);
  }
  .primary:hover:not(:disabled) {
    color: #fff;
    background: linear-gradient(135deg, var(--accent-grad-a), var(--accent-grad-b));
    filter: brightness(0.9);
  }
  /* Visually hidden, still reachable by tests and assistive technology through the button. */
  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .hint {
    font-size: 0.82rem;
    color: var(--muted);
  }
  .divider {
    align-self: stretch;
    width: 1px;
    min-height: 2rem;
    background: var(--border-strong);
  }
  .cards {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cif {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .cif.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .cif button {
    border: none;
    border-radius: 0;
    background: none;
    color: var(--text-h);
  }
  .cif button:hover:not(:disabled) {
    background: var(--accent-soft);
  }
  .pick {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.3rem 0.4rem 0.3rem 0.7rem;
    max-width: 18rem;
  }
  .name sub {
    font-size: 0.72em;
    line-height: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cif.active .name {
    color: var(--accent-ink);
  }
  .sg {
    flex: none;
    font-size: 0.85rem;
    color: var(--text);
  }
  .close {
    padding: 0 0.55rem;
    font-size: 1.05rem;
    line-height: 1;
    color: var(--muted) !important;
  }
  .close:hover:not(:disabled) {
    color: var(--err) !important;
  }
  .block {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.85rem;
  }
  .warn,
  .err {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.85rem;
  }
  .warn {
    color: var(--warn);
  }
  .err {
    color: var(--err);
  }
</style>
