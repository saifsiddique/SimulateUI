<script lang="ts">
  // The page (context.md §7.MU): header with the status pill, the Open CIF bar, the workflow tabs and
  // the workspace of the shown tab. A tab is mounted when it is first opened and then kept hidden,
  // so its 3D views keep their camera and state.
  //
  // ① Structure, ② Specimen and ③ Simulation (multislice) have their layouts (U2-U4); ③ Bloch wave
  // keeps the M5 panel until U5.
  import { APP_NAME } from './core/meta';
  import { serializeSetup, setupFileName, type SetupDocument } from './core/setup';
  import { downloadText } from './export/browser';
  import { partialSites, structurePayload } from './core/payload';
  import { fallbackTab, TAB_IDS, workflowStates, type TabId } from './core/workflow';
  import Inspector from './Inspector.svelte';
  import { project, registerStructure, resetProject } from './state/project.svelte';
  import {
    applyState,
    capture,
    keep,
    recall,
    restoreSpecimen,
    session,
    toDocument,
  } from './state/session.svelte';
  import { isActive, jobs } from './state/jobs.svelte';
  import { parameterState } from './state/simulation.svelte';
  import { rememberPayload, needsRebuild, specimen } from './state/specimen.svelte';
  import LoadBar, { type Loaded } from './ui/LoadBar.svelte';
  import Logo from './ui/Logo.svelte';
  import RunStep from './ui/RunStep.svelte';
  import SimulationStep from './ui/SimulationStep.svelte';
  import SpecimenStep from './ui/SpecimenStep.svelte';
  import StatusPill from './ui/StatusPill.svelte';
  import Viewer from './ui/Viewer.svelte';
  import WorkflowTabs from './ui/WorkflowTabs.svelte';

  let loaded = $state.raw<Loaded>({ crystal: null, fileName: '', warnings: [], rawCif: '' });
  let tab = $state<TabId>('structure');
  const visited = $state<Record<TabId, boolean>>({
    structure: true,
    specimen: false,
    simulation: false,
    run: false,
  });
  $effect(() => {
    visited[tab] = true;
  });

  // Every open card keeps its own settings (state/session.svelte.ts): switching saves the shown
  // card's and writes the other one's back, building its specimen again (same settings, same id).
  let activeId: number | null = null;
  let token = 0;

  async function onLoad(l: Loaded) {
    const mine = ++token;
    if (activeId !== null && !l.fresh) keep(activeId, capture(tab));
    activeId = l.id ?? null;
    loaded = l;
    session.notice = '';
    const plan = applyState(!l.fresh && l.id != null ? recall(l.id) : null);
    if (!l.crystal) {
      rememberPayload(null);
      resetProject();
      return;
    }
    const payload = structurePayload(l.crystal, l.rawCif, l.fileName);
    rememberPayload(payload);
    await registerStructure(payload);
    if (mine !== token) return;
    if ((await restoreSpecimen(plan, () => mine === token)) && plan.build) tab = plan.tab;
  }

  function onSetup(id: number, doc: SetupDocument) {
    keep(id, doc);
  }

  function saveSetup() {
    if (!loaded.crystal) return;
    const doc = toDocument(capture(tab), { fileName: loaded.fileName, rawCif: loaded.rawCif });
    downloadText(serializeSetup(doc), setupFileName(loaded.fileName), 'application/json');
  }

  const r = $derived(specimen.result);
  /** The space group for the name of a run's folder: the symbol without spaces, else the number. */
  const spaceGroup = $derived.by(() => {
    const sg = loaded.crystal?.spaceGroup;
    if (sg?.symbol) return sg.symbol.replace(/\s+/g, '');
    return sg?.number ? `SG${sg.number}` : '';
  });
  const mixed = $derived(loaded.crystal ? partialSites(loaded.crystal).length : 0);

  const states = $derived(
    workflowStates({
      loaded: !!loaded.crystal,
      registration: project.registration.status,
      registrationError: project.registration.error,
      specimen: {
        status: specimen.status,
        error: specimen.error,
        hasResult: !!r,
        changed: needsRebuild(),
        warnings: r?.warnings.length ?? 0,
      },
      parameters: (() => {
        const p = parameterState();
        return {
          status: p.error ? 'error' : p.pending ? 'pending' : p.warnings ? 'ok' : 'idle',
          warnings: p.warnings?.length ?? 0,
          error: p.error,
        } as const;
      })(),
      run: !jobs.current
        ? 'idle'
        : isActive(jobs.current)
          ? 'busy'
          : jobs.current.state === 'done'
            ? 'done'
            : 'failed',
    }),
  );

  // A tab that becomes locked (its structure was closed) hands over to the nearest open one.
  $effect(() => {
    const next = fallbackTab(tab, states);
    if (next !== tab) tab = next;
  });
</script>

<header class="top">
  <div></div>
  <div class="brand">
    <Logo size={44} />
    <div>
      <h1>{APP_NAME}</h1>
      <p class="tagline">Set up electron microscopy simulations from a CIF</p>
    </div>
  </div>
  <StatusPill />
</header>

<main>
  <LoadBar {onLoad} {onSetup} onSave={saveSetup} />
  {#if session.notice}<p class="notice warn" role="status" data-testid="setup-notice">
      ⚠ {session.notice}
    </p>{/if}
  <WorkflowTabs bind:tab {states} panelId="workspace" />

  <div
    class="workspace"
    id="workspace"
    role="tabpanel"
    aria-labelledby={`tab-${tab}`}
    data-tab={tab}
    data-testid="workspace"
  >
    {#each TAB_IDS as id (id)}
      {#if visited[id]}
        <div class="pane" class:off={tab !== id} data-pane={id}>
          {#if id === 'structure'}
            <Viewer crystal={loaded.crystal} fileName={loaded.fileName}>
              {#snippet crystalData()}
                {#if mixed}
                  <p class="notice warn" data-testid="partial-sites">
                    ⚠ {mixed} sites are shared or partly occupied. The specimen keeps the dominant species
                    at each.
                  </p>
                {/if}
                {#each loaded.warnings.slice(0, 3) as w, i (i)}
                  <p class="notice warn">⚠ {w}</p>
                {/each}
                {#if project.registration.status === 'error'}
                  <p class="notice err" data-testid="registration-error">
                    ✕ The backend could not take the structure: {project.registration.error}
                  </p>
                {/if}
                <Inspector
                  crystal={loaded.crystal}
                  fileName={loaded.fileName}
                  warnings={loaded.warnings}
                />
              {/snippet}
            </Viewer>
          {:else if id === 'specimen'}
            <SpecimenStep crystal={loaded.crystal} name={loaded.fileName} />
          {:else if id === 'simulation'}
            <SimulationStep />
          {:else}
            <RunStep onGo={(t) => (tab = t)} name={loaded.fileName} {spaceGroup} />
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</main>

<style>
  .top {
    position: relative;
    z-index: 20;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0.9rem 1.5rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: var(--title-grad);
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
  }
  .tagline {
    margin: 0.1rem 0 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
  main {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1rem 1.5rem 3rem;
  }

  .workspace {
    min-width: 0;
  }
  .pane {
    min-width: 0;
  }
  .pane.off {
    display: none;
  }
  @media (max-width: 40rem) {
    .top {
      grid-template-columns: 1fr auto;
      padding: 0.7rem 1rem;
    }
    .top > div:first-child {
      display: none;
    }
    main {
      padding: 0.75rem 1rem 2rem;
    }
  }
</style>
