<script lang="ts">
  // The design system on one page (open the app with ?kit): tokens, controls and the kit
  // components, for visual checks in light and dark mode (TESTING.md). Not linked from the app.
  import { OVERLAY } from '../core/overlayColours';
  import Logo from './Logo.svelte';
  import NumberField from './kit/NumberField.svelte';
  import Stat from './kit/Stat.svelte';
  import SummaryBar from './kit/SummaryBar.svelte';
  import ViewCard from './kit/ViewCard.svelte';
  import WarnChip from './kit/WarnChip.svelte';
  import SidePanel from './SidePanel.svelte';

  const TOKENS = [
    'accent',
    'accent-2',
    'accent-soft',
    'accent-ink',
    'text-h',
    'text',
    'muted',
    'bg',
    'surface',
    'surface-2',
    'border',
    'border-strong',
    'ok',
    'warn',
    'err',
  ];

  let alpha = $state(20);
  let energy = $state(200);
  let step = $state(0.25);
  let seg = $state('stem');
  let chip = $state(true);
  let clicked = $state(0);
  let sideTab = $state('probe');
  const SIDE_TABS = [
    { id: 'probe', label: 'Probe' },
    { id: 'sampling', label: 'Sampling' },
    { id: 'detectors', label: 'Detectors' },
  ];
</script>

<header class="top">
  <Logo size={40} />
  <div>
    <h1>SimulateUI · design kit</h1>
    <p class="tagline">
      Tokens and components (context.md §7.MU). Switch the OS theme to check dark mode.
    </p>
  </div>
</header>

<main class="kit" data-testid="kit">
  <section class="card block">
    <h2>Colour tokens</h2>
    <div class="swatches">
      {#each TOKENS as t (t)}
        <div class="sw">
          <span class="chipc" style:background={`var(--${t})`}></span>
          <code>--{t}</code>
        </div>
      {/each}
    </div>
    <h3>Overlay colours (on the white viewer)</h3>
    <div class="swatches viewer">
      {#each Object.entries(OVERLAY) as [name, hex] (name)}
        <div class="sw">
          <span class="ring" style:border-color={hex}></span>
          <code>{name} {hex}</code>
        </div>
      {/each}
    </div>
    <div class="title-demo">
      <span class="grad">Gradient title</span>
    </div>
  </section>

  <section class="card block">
    <h2>Buttons</h2>
    <div class="row">
      <button type="button">Default</button>
      <button type="button" class="primary">Primary</button>
      <button type="button" aria-pressed="true">Pressed</button>
      <button type="button" disabled>Disabled</button>
      <span class="seg" role="group" aria-label="Segmented">
        {#each ['saed', 'cbed', 'stem', '4dstem'] as s (s)}
          <button type="button" aria-pressed={seg === s} onclick={() => (seg = s)}
            >{s.toUpperCase()}</button
          >
        {/each}
      </span>
      <label class="chip"><input type="checkbox" bind:checked={chip} /> Chip toggle</label>
    </div>
  </section>

  <section class="card block">
    <h2>Ribbon</h2>
    <div class="ribbon card">
      <fieldset>
        <legend>Method</legend>
        <div class="ctl">
          <span class="seg">
            <button type="button" aria-pressed="true">Multislice</button><button type="button"
              >Bloch</button
            ><button type="button">INCOSTEM</button>
          </span>
        </div>
      </fieldset>
      <fieldset>
        <legend>Beam</legend>
        <div class="ctl">
          <span class="seg">
            {#each [80, 200, 300] as kv (kv)}
              <button type="button" aria-pressed={energy === kv} onclick={() => (energy = kv)}
                >{kv}</button
              >
            {/each}
          </span>
          <span>kV</span>
        </div>
      </fieldset>
      <fieldset disabled>
        <legend>Disabled group</legend>
        <div class="ctl"><button type="button">Off</button></div>
      </fieldset>
    </div>
  </section>

  <section class="card block">
    <h2>NumberField</h2>
    <div class="fields">
      <NumberField
        label="Convergence α"
        bind:value={alpha}
        unit="mrad"
        min={0.1}
        max={100}
        step={0.5}
        slider
        sliderMin={1}
        sliderMax={60}
        def={20}
        help="Probe convergence semi-angle"
        testid="kit-alpha"
      />
      <NumberField
        label="Energy"
        bind:value={energy}
        unit="kV"
        min={20}
        max={400}
        step={10}
        def={200}
      />
      <NumberField
        label="Scan step"
        bind:value={step}
        unit="Å"
        min={0.01}
        max={5}
        step={0.01}
        digits={2}
      />
      <NumberField label="Disabled" value={1} disabled />
    </div>
    <p class="small" data-testid="kit-alpha-value">α = {alpha} mrad</p>
  </section>

  <section class="card block">
    <h2>Stat, WarnChip, notices</h2>
    <div class="row">
      <Stat label="Grid" value="512 × 512" unit="px" />
      <Stat label="Slices" value={96} />
      <Stat label="Memory" value="3.1" unit="GB" level="warn" />
      <Stat label="Time" value="> 1" unit="h" level="err" />
    </div>
    <div class="row">
      <WarnChip text="HAADF outer angle beyond α max" onclick={() => clicked++} />
      <WarnChip text="Memory over the GPU's 16 GB" level="err" />
      <span class="small">chip clicked {clicked}×</span>
    </div>
    <p class="notice warn">⚠ A warning notice.</p>
    <p class="notice err">✕ An error notice.</p>
    <p class="hint"><kbd>drag</kbd> rotate · <kbd>wheel</kbd> zoom · <kbd>Shift</kbd> finer</p>
  </section>

  <section class="block wide">
    <h2>ViewCard and SummaryBar</h2>
    <div class="cards">
      <ViewCard title="Real space" square>
        {#snippet tools()}<button type="button">Reset</button>{/snippet}
        <div class="demo-stage">
          <svg viewBox="0 0 100 100" aria-label="Demo overlay">
            <rect
              x="25"
              y="25"
              width="50"
              height="40"
              fill="none"
              stroke={OVERLAY.fov}
              stroke-dasharray="3 2"
            />
            <circle cx="50" cy="45" r="6" fill="none" stroke={OVERLAY.probe} />
          </svg>
        </div>
      </ViewCard>
      <ViewCard title="Diffraction plane" square>
        {#snippet titleExtra()}<button type="button">Export ▾</button>{/snippet}
        {#snippet tools()}<span class="seg"
            ><button type="button">−</button><button type="button">Reset</button><button
              type="button">+</button
            ></span
          >{/snippet}
        <div class="demo-stage">
          <svg viewBox="0 0 100 100" aria-label="Demo detectors">
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={OVERLAY.limit}
              stroke-dasharray="2 2"
            />
            <circle
              cx="50"
              cy="50"
              r="8"
              fill={OVERLAY.bf}
              fill-opacity="0.25"
              stroke={OVERLAY.bf}
            />
            <circle cx="50" cy="50" r="18" fill="none" stroke={OVERLAY.abf} />
            <circle cx="50" cy="50" r="26" fill="none" stroke={OVERLAY.adf} />
            <circle cx="50" cy="50" r="38" fill="none" stroke={OVERLAY.haadf} stroke-width="2" />
          </svg>
        </div>
      </ViewCard>
    </div>
    <SummaryBar
      items={[
        { label: 'Grid', value: '512 × 512', unit: 'px' },
        { label: 'Slices', value: 96 },
        { label: 'α max', value: 167, unit: 'mrad' },
        { label: 'Positions', value: 4096 },
        { label: 'Memory', value: '3.1', unit: 'GB', level: 'warn' },
        { label: 'Time', value: '~4', unit: 'min' },
      ]}
      warnings={[{ text: 'Scan step above Nyquist', onclick: () => clicked++ }]}
    >
      {#snippet action()}<button type="button" class="primary" disabled>Run (M6)</button>{/snippet}
    </SummaryBar>
  </section>

  <section class="block wide">
    <h2>View with a sidebar (SidePanel: drag the handle, collapse with ⟩)</h2>
    <div class="with-side">
      <ViewCard title="Specimen">
        <div class="demo-stage tall"></div>
      </ViewCard>
      <SidePanel
        tabs={SIDE_TABS}
        bind:tab={sideTab}
        label="Demo settings"
        storageKey="emsim.kitPanel"
        idPrefix="kit"
        testid="kit-"
        defaultWidth={320}
      >
        <div class="fields">
          <p class="small">Tab: {sideTab}</p>
          <NumberField label="Defocus" value={0} unit="Å" />
          <NumberField label="Cs" value={0} unit="mm" />
        </div>
      </SidePanel>
    </div>
  </section>
</main>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.9rem 1.5rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  h1 {
    margin: 0;
    font-size: 1.3rem;
    color: var(--text-h);
  }
  .tagline,
  .small {
    margin: 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .kit {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    gap: 1rem;
    padding: 1rem 1.5rem 3rem;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.9rem 1rem;
    min-width: 0;
  }
  .wide {
    grid-column: 1 / -1;
    padding: 0;
  }
  h2 {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-h);
  }
  h3 {
    margin: 0.3rem 0 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    gap: 0.4rem 0.8rem;
  }
  .swatches.viewer {
    padding: 0.6rem;
    border-radius: 8px;
    background: #fff;
  }
  .viewer code {
    color: #0d1220;
  }
  .sw {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.75rem;
  }
  .chipc {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
  }
  .ring {
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    border: 3px solid;
  }
  .grad {
    font-size: 1.6rem;
    font-weight: 700;
    background: var(--title-grad);
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: 0.8rem;
    margin-bottom: 0.8rem;
  }
  .demo-stage {
    position: absolute;
    inset: 0;
    background: #fff;
  }
  .demo-stage.tall {
    position: static;
    height: 22rem;
  }
  .with-side {
    display: flex;
    align-items: stretch;
  }
  .with-side > :global(:first-child) {
    flex: 1;
  }
  .demo-stage svg {
    width: 100%;
    height: 100%;
  }
</style>
