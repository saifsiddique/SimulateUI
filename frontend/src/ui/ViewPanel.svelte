<script lang="ts" module>
  export const VIEW_TABS = [
    { id: 'range', label: 'Range' },
    { id: 'bonds', label: 'Bonds' },
    { id: 'polyhedra', label: 'Polyhedra' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'elements', label: 'Elements' },
  ] as const;
  export type ViewTab = (typeof VIEW_TABS)[number]['id'];
</script>

<script lang="ts">
  // The M6 controls: what is shown (range, slab, hidden atoms), how it is bonded, polyhedra, and
  // how it looks, one sidebar tab at a time (the tab bar is the SidePanel's). It edits `settings`
  // in place; the Viewer reacts and redraws.
  import type { Crystal } from '../core/crystal';
  import { dSpacing } from '../core/lattice';
  import { elementInfo } from '../core/scattering';
  import {
    addManualBond,
    applyRangePreset,
    defaultBondRules,
    defaultRange,
    newBondRule,
    removeManualBond,
    ruleKey,
    visibilityTree,
    DEFAULT_BACKGROUND,
    type AtomRef,
    type RangePreset,
    type StructureModel,
    type ViewSettings,
  } from '../core/structure';

  let {
    tab,
    crystal,
    model,
    selection,
    settings = $bindable(),
    polyhedraInfo,
    onHideSelected,
  }: {
    tab: ViewTab;
    crystal: Crystal;
    model: StructureModel | null;
    selection: readonly number[];
    settings: ViewSettings;
    polyhedraInfo: { count: number; skipped: number };
    onHideSelected: () => void;
  } = $props();

  const AXES = ['a', 'b', 'c'] as const;
  const elements = $derived([...new Set(crystal.sites.map((s) => s.element))]);
  const tree = $derived(visibilityTree(crystal, settings.appearance));
  const colourOf = (el: string) => settings.appearance.elements[el]?.color ?? elementInfo(el).color;
  const siteColourOf = (label: string, el: string) =>
    settings.appearance.sites[label]?.color ?? colourOf(el);

  // ---- range -------------------------------------------------------------------------------------
  const num = (text: string): number | null => {
    const v = Number(text);
    return text.trim() !== '' && Number.isFinite(v) ? v : null;
  };

  function setBound(which: 'min' | 'max', k: number, text: string) {
    const v = num(text);
    if (v === null) return;
    const min = [...settings.range.min] as [number, number, number];
    const max = [...settings.range.max] as [number, number, number];
    (which === 'min' ? min : max)[k] = v;
    // keep min <= max by moving the other bound
    if (min[k] > max[k]) {
      if (which === 'min') max[k] = v;
      else min[k] = v;
    }
    settings.range.min = min;
    settings.range.max = max;
  }

  const preset = (p: RangePreset) => applyRangePreset(settings, p);

  function setSlab(on: boolean) {
    settings.range.slab = on
      ? {
          hkl: [0, 0, 1],
          offset: 0,
          thickness: Math.round(dSpacing(crystal.lattice, [0, 0, 1]) * 100) / 100,
        }
      : null;
  }
  function setSlabHkl(k: number, text: string) {
    const v = num(text);
    if (v === null || !settings.range.slab || !Number.isInteger(v)) return;
    const hkl = [...settings.range.slab.hkl] as [number, number, number];
    hkl[k] = v;
    if (hkl.every((x) => x === 0)) return;
    settings.range.slab.hkl = hkl;
  }
  function setSlabNumber(key: 'offset' | 'thickness', text: string) {
    const v = num(text);
    if (v === null || !settings.range.slab) return;
    if (key === 'thickness' && v <= 0) return;
    settings.range.slab[key] = v;
  }

  // ---- bonds -------------------------------------------------------------------------------------
  let pairA = $state('');
  let pairB = $state('');
  $effect(() => {
    if (!elements.includes(pairA)) pairA = elements[0] ?? '';
    if (!elements.includes(pairB)) pairB = elements[elements.length - 1] ?? '';
  });
  const pairExists = $derived(
    settings.bonds.rules.some((r) => ruleKey(r.a, r.b) === ruleKey(pairA, pairB)),
  );

  function addRule() {
    if (!pairA || !pairB || pairExists) return;
    settings.bonds.rules.push(newBondRule(pairA, pairB));
  }
  function setRuleNumber(i: number, key: 'min' | 'max' | 'radius', text: string) {
    const v = num(text);
    if (v === null || v < 0 || (key === 'radius' && v === 0)) return;
    settings.bonds.rules[i][key] = v;
  }

  const refOf = (i: number): AtomRef => {
    const p = model!.placed;
    return { atom: p.atom[i], cell: [p.cell[3 * i], p.cell[3 * i + 1], p.cell[3 * i + 2]] };
  };
  const twoSelected = $derived(selection.length === 2 && model !== null);
  const bondedNow = $derived.by(() => {
    if (!twoSelected || !model) return false;
    const i = Math.min(selection[0], selection[1]);
    const j = Math.max(selection[0], selection[1]);
    for (let b = 0; b < model.bonds.length; b += 2)
      if (model.bonds[b] === i && model.bonds[b + 1] === j) return true;
    return false;
  });
  const manualCount = $derived(
    settings.bonds.manual.add.length + settings.bonds.manual.remove.length,
  );
  function drawBond() {
    if (!twoSelected) return;
    settings.bonds.manual = addManualBond(
      settings.bonds.manual,
      refOf(selection[0]),
      refOf(selection[1]),
    );
  }
  function deleteBond() {
    if (!twoSelected) return;
    settings.bonds.manual = removeManualBond(
      settings.bonds.manual,
      refOf(selection[0]),
      refOf(selection[1]),
    );
  }

  // ---- polyhedra ---------------------------------------------------------------------------------
  function toggleCentre(el: string, on: boolean) {
    const rest = settings.polyhedra.centres.filter((c) => c !== el);
    settings.polyhedra.centres = on ? [...rest, el] : rest;
  }

  // ---- appearance --------------------------------------------------------------------------------
  const ap = $derived(settings.appearance);
  function setElementColour(el: string, hex: string) {
    ap.elements[el] = { ...ap.elements[el], color: hex };
  }
  function setElementRadius(el: string, text: string) {
    const { radius: _drop, ...rest } = ap.elements[el] ?? {};
    void _drop;
    const v = num(text);
    ap.elements[el] = v !== null && v > 0 ? { ...rest, radius: v } : rest;
  }
  function setElementVisible(el: string, on: boolean) {
    ap.elements[el] = { ...ap.elements[el], visible: on };
  }
  function setSiteColour(label: string, hex: string) {
    ap.sites[label] = { ...ap.sites[label], color: hex };
  }
  function setSiteRadius(label: string, text: string) {
    const { radius: _drop, ...rest } = ap.sites[label] ?? {};
    void _drop;
    const v = num(text);
    ap.sites[label] = v !== null && v > 0 ? { ...rest, radius: v } : rest;
  }
  function setSiteVisible(label: string, on: boolean) {
    ap.sites[label] = { ...ap.sites[label], visible: on };
  }
  function resetElement(el: string) {
    delete ap.elements[el];
    for (const s of crystal.sites) if (s.element === el) delete ap.sites[s.label];
  }
</script>

<div class="panel" data-testid="view-panel">
  {#if tab === 'range'}
    <div class="presets">
      <button type="button" onclick={() => preset('cell')} data-testid="preset-cell">1 cell</button>
      <button type="button" onclick={() => preset('cellBoundary')} data-testid="preset-boundary"
        >1 cell + boundary</button
      >
      <button type="button" onclick={() => preset('supercell2')} data-testid="preset-2"
        >2×2×2</button
      >
      <button
        type="button"
        onclick={() => (settings.range = defaultRange())}
        title="One cell with its boundary atoms, no slab"
        data-testid="reset-range">Reset range</button
      >
    </div>
    <table class="grid">
      <thead><tr><th></th><th>from</th><th>to</th></tr></thead>
      <tbody>
        {#each AXES as axis, k (axis)}
          <tr>
            <th scope="row">{axis}</th>
            <td
              ><input
                type="number"
                step="0.5"
                aria-label={`${axis} min`}
                value={settings.range.min[k]}
                onchange={(e) => setBound('min', k, e.currentTarget.value)}
              /></td
            >
            <td
              ><input
                type="number"
                step="0.5"
                aria-label={`${axis} max`}
                value={settings.range.max[k]}
                onchange={(e) => setBound('max', k, e.currentTarget.value)}
              /></td
            >
          </tr>
        {/each}
      </tbody>
    </table>
    <label class="row"
      ><input type="checkbox" bind:checked={settings.range.boundary} data-testid="boundary" /> Include
      boundary atoms</label
    >
    <label class="row"
      ><input
        type="checkbox"
        checked={settings.range.slab !== null}
        onchange={(e) => setSlab(e.currentTarget.checked)}
        data-testid="slab"
      /> Slab (cut from the box above)</label
    >
    {#if settings.range.slab}
      {@const slab = settings.range.slab}
      <div class="row">
        plane (hkl)
        {#each [0, 1, 2] as k (k)}
          <input
            class="n"
            type="number"
            step="1"
            aria-label={`slab ${'hkl'[k]}`}
            value={slab.hkl[k]}
            onchange={(e) => setSlabHkl(k, e.currentTarget.value)}
          />
        {/each}
      </div>
      <div class="row">
        from
        <input
          class="n"
          type="number"
          step="0.5"
          aria-label="slab offset"
          value={slab.offset}
          onchange={(e) => setSlabNumber('offset', e.currentTarget.value)}
        />
        thickness
        <input
          class="n"
          type="number"
          step="0.5"
          min="0.1"
          aria-label="slab thickness"
          value={slab.thickness}
          onchange={(e) => setSlabNumber('thickness', e.currentTarget.value)}
        />
        Å
      </div>
      <p class="hint">
        d(hkl) = {dSpacing(crystal.lattice, slab.hkl as [number, number, number]).toFixed(3)} Å; the distance
        is measured from the plane through the origin.
      </p>
    {/if}
  {:else if tab === 'bonds'}
    <label class="row"
      ><input type="checkbox" bind:checked={settings.bonds.beyondRange} data-testid="beyond" /> Search
      bonds beyond the range</label
    >
    <label class="row"
      ><input
        type="checkbox"
        bind:checked={settings.bonds.completeMolecules}
        data-testid="complete"
      /> Complete molecules</label
    >
    {#if settings.bonds.rules.length === 0}
      <p class="hint">No element pair of this structure is within bonding distance.</p>
    {:else}
      <table class="grid rules" data-testid="rules">
        <colgroup
          ><col class="c-pair" /><col /><col /><col /><col class="c-colour" /><col
            class="c-shown"
          /><col class="c-x" /></colgroup
        >
        <thead
          ><tr
            ><th>pair</th><th>min Å</th><th>max Å</th><th>r Å</th><th>colour</th><th>shown</th><th
            ></th></tr
          ></thead
        >
        <tbody>
          {#each settings.bonds.rules as rule, i (ruleKey(rule.a, rule.b))}
            <tr>
              <th scope="row">{rule.a}–{rule.b}</th>
              <td
                ><input
                  class="n"
                  type="number"
                  step="0.05"
                  min="0"
                  aria-label={`${rule.a}-${rule.b} min`}
                  value={rule.min}
                  onchange={(e) => setRuleNumber(i, 'min', e.currentTarget.value)}
                /></td
              >
              <td
                ><input
                  class="n"
                  type="number"
                  step="0.05"
                  min="0"
                  aria-label={`${rule.a}-${rule.b} max`}
                  value={rule.max}
                  onchange={(e) => setRuleNumber(i, 'max', e.currentTarget.value)}
                /></td
              >
              <td
                ><input
                  class="n"
                  type="number"
                  step="0.02"
                  min="0.02"
                  aria-label={`${rule.a}-${rule.b} radius`}
                  value={rule.radius}
                  onchange={(e) => setRuleNumber(i, 'radius', e.currentTarget.value)}
                /></td
              >
              <td class="colour">
                <input
                  type="color"
                  aria-label={`${rule.a}-${rule.b} colour`}
                  value={rule.color ?? '#9aa3b5'}
                  oninput={(e) => (rule.color = e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="small"
                  title="Colour by the two atoms"
                  disabled={!rule.color}
                  onclick={() => (rule.color = undefined)}>auto</button
                >
              </td>
              <td
                ><input
                  type="checkbox"
                  aria-label={`${rule.a}-${rule.b} shown`}
                  bind:checked={rule.visible}
                /></td
              >
              <td
                ><button
                  type="button"
                  class="small"
                  aria-label={`remove ${rule.a}-${rule.b}`}
                  onclick={() => settings.bonds.rules.splice(i, 1)}>×</button
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <div class="row">
      <select bind:value={pairA} aria-label="pair element 1">
        {#each elements as el (el)}<option value={el}>{el}</option>{/each}
      </select>
      –
      <select bind:value={pairB} aria-label="pair element 2">
        {#each elements as el (el)}<option value={el}>{el}</option>{/each}
      </select>
      <button type="button" onclick={addRule} disabled={pairExists} data-testid="add-rule"
        >Add pair</button
      >
      <button
        type="button"
        onclick={() => (settings.bonds.rules = defaultBondRules(crystal))}
        title="Back to the bonds found from covalent radii">Reset rules</button
      >
    </div>
    <div class="row stack">
      <button type="button" onclick={drawBond} disabled={!twoSelected} data-testid="draw-bond"
        >Draw bond between the 2 selected atoms</button
      >
      <button
        type="button"
        onclick={deleteBond}
        disabled={!twoSelected || !(bondedNow || manualCount > 0)}
        data-testid="delete-bond">Delete that bond</button
      >
      <button
        type="button"
        disabled={manualCount === 0}
        onclick={() => (settings.bonds.manual = { add: [], remove: [] })}
        >Clear {manualCount} manual change{manualCount === 1 ? '' : 's'}</button
      >
    </div>
  {:else if tab === 'polyhedra'}
    <p class="hint">Coordination polyhedra around the chosen elements, from their bonds.</p>
    <div class="row wrap">
      {#each elements as el (el)}
        <label
          ><input
            type="checkbox"
            checked={settings.polyhedra.centres.includes(el)}
            onchange={(e) => toggleCentre(el, e.currentTarget.checked)}
            data-testid={`poly-${el}`}
          />
          {el}</label
        >
      {/each}
    </div>
    <label class="row"
      >opacity
      <input
        type="range"
        min="0.05"
        max="1"
        step="0.05"
        bind:value={settings.polyhedra.opacity}
        aria-label="polyhedra opacity"
      />
      {settings.polyhedra.opacity.toFixed(2)}</label
    >
    <label class="row"
      ><input type="checkbox" bind:checked={settings.polyhedra.edges} /> Draw edges</label
    >
    {#if settings.polyhedra.centres.length > 0}
      <p class="hint" data-testid="poly-info">
        {polyhedraInfo.count} drawn{polyhedraInfo.skipped
          ? `, ${polyhedraInfo.skipped} skipped because some neighbours are not shown (try "Search bonds beyond the range")`
          : ''}.
      </p>
    {/if}
  {:else if tab === 'appearance'}
    <label class="row"
      >Atom radii
      <select bind:value={ap.radiusScheme} aria-label="radius scheme" data-testid="scheme">
        <option value="auto">automatic (by style)</option>
        <option value="covalent">covalent</option>
        <option value="ionic">ionic (Shannon)</option>
        <option value="vdw">van der Waals</option>
        <option value="uniform">uniform</option>
      </select></label
    >
    <label class="row"
      >scale
      <input
        type="range"
        min="0.2"
        max="2"
        step="0.05"
        bind:value={ap.radiusScale}
        aria-label="radius scale"
      />
      {ap.radiusScale.toFixed(2)}</label
    >
    {#if ap.radiusScheme === 'uniform'}
      <label class="row"
        >uniform radius
        <input
          class="n"
          type="number"
          min="0.1"
          step="0.05"
          bind:value={ap.uniformRadius}
          aria-label="uniform radius"
        />
        Å</label
      >
    {/if}
    <label class="row"
      >Background
      <input
        type="color"
        bind:value={ap.background}
        aria-label="background colour"
        data-testid="background"
      />
      <button type="button" class="small" onclick={() => (ap.background = DEFAULT_BACKGROUND)}
        >default</button
      ></label
    >
    <label class="row"
      >Atom labels
      <select bind:value={ap.labels} aria-label="atom labels" data-testid="labels">
        <option value="none">none</option>
        <option value="element">element</option>
        <option value="site">site label</option>
      </select></label
    >
  {:else}
    <p class="hint">Show, colour and size each element and site; hide selected atoms.</p>
    <ul class="tree" data-testid="tree">
      {#each tree as node (node.element)}
        <li>
          <div class="row">
            <input
              type="checkbox"
              checked={node.visible}
              onchange={(e) => setElementVisible(node.element, e.currentTarget.checked)}
              aria-label={`show ${node.element}`}
            />
            <input
              type="color"
              value={colourOf(node.element)}
              oninput={(e) => setElementColour(node.element, e.currentTarget.value)}
              aria-label={`${node.element} colour`}
            />
            <strong>{node.element}</strong>
            <input
              class="n"
              type="number"
              step="0.05"
              min="0.05"
              placeholder="auto"
              title="Radius in Å; empty for automatic"
              aria-label={`${node.element} radius`}
              value={ap.elements[node.element]?.radius ?? ''}
              onchange={(e) => setElementRadius(node.element, e.currentTarget.value)}
            />
            <button
              type="button"
              class="small"
              title="Forget this element's and its sites' overrides"
              onclick={() => resetElement(node.element)}>↺</button
            >
          </div>
          {#if node.sites.length > 0}
            <ul>
              {#each node.sites as site (site.label)}
                <li class="row">
                  <input
                    type="checkbox"
                    checked={site.visible}
                    onchange={(e) => setSiteVisible(site.label, e.currentTarget.checked)}
                    aria-label={`show site ${site.label}`}
                  />
                  <input
                    type="color"
                    value={siteColourOf(site.label, node.element)}
                    oninput={(e) => setSiteColour(site.label, e.currentTarget.value)}
                    aria-label={`${site.label} colour`}
                  />
                  {site.label}
                  <span class="hint">×{site.count}</span>
                  <input
                    class="n"
                    type="number"
                    step="0.05"
                    min="0.05"
                    placeholder="auto"
                    aria-label={`${site.label} radius`}
                    value={ap.sites[site.label]?.radius ?? ''}
                    onchange={(e) => setSiteRadius(site.label, e.currentTarget.value)}
                  />
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="row">
      <button
        type="button"
        onclick={onHideSelected}
        disabled={selection.length === 0}
        data-testid="hide-selected">Hide {selection.length} selected</button
      >
      <button
        type="button"
        disabled={settings.hiddenAtoms.length === 0}
        onclick={() => (settings.hiddenAtoms = [])}
        data-testid="show-hidden">Show {settings.hiddenAtoms.length} hidden</button
      >
    </div>
  {/if}
</div>

<style>
  .panel {
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0.3rem 0;
  }
  .row.wrap {
    flex-wrap: wrap;
  }
  .presets {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin: 0.4rem 0;
  }
  .grid {
    border-collapse: collapse;
    max-width: 100%;
  }
  .grid th,
  .grid td {
    padding: 0.1rem 0.3rem 0.1rem 0;
    text-align: left;
    font-weight: normal;
  }
  .rules th[scope='row'] {
    font-family: var(--mono);
    white-space: nowrap;
  }
  .n {
    width: 4.2rem;
  }
  .grid input[type='number'] {
    width: 4.6rem;
  }
  .rules {
    width: 100%;
    table-layout: fixed;
  }
  .rules .n {
    width: 100%;
  }
  .rules .c-pair {
    width: 4.4rem;
  }
  .rules .c-colour {
    width: 4.6rem;
  }
  .rules .c-shown {
    width: 2.6rem;
  }
  .rules .c-x {
    width: 1.9rem;
  }
  .rules th {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rules th,
  .rules td {
    padding-right: 0.2rem;
  }
  .row.stack {
    flex-direction: column;
    align-items: stretch;
  }
  .colour {
    white-space: nowrap;
  }
  input[type='color'] {
    width: 1.8rem;
    height: 1.4rem;
    padding: 0;
    border: 1px solid var(--border);
    background: none;
  }
  .small {
    padding: 0 0.35rem;
    font-size: 0.75rem;
  }
  .hint {
    margin: 0.2rem 0;
    font-size: 0.75rem;
  }
  .tree,
  .tree ul {
    list-style: none;
    margin: 0;
    padding-left: 0;
  }
  .tree ul {
    padding-left: 1.4rem;
  }
</style>
