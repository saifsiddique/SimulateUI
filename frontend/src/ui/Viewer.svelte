<script lang="ts">
  // ① Structure (context.md §7.MU, step U2): the copied strFac_app viewer, trimmed to what a
  // simulation setup needs. Ribbon: display, view direction, rotate, range. Sidebar: crystal data,
  // appearance, element colours. No measuring, polyhedra, bond-rule tables or file export. The
  // direction it looks along is the zone axis the specimen (②) starts from.
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { Crystal } from '../core/crystal';
  import type { Vec3 } from '../core/math/vec3';
  import {
    atomLabel,
    buildModel,
    defaultViewSettings,
    hexToRgb,
    legendEntries,
    resolveAppearance,
    resolveColours,
    settingsForNewCrystal,
    type Appearance,
    type AtomRef,
    type LegendEntry,
    type StructureModel,
    type ViewSettings,
  } from '../core/structure';
  import {
    defaultUp,
    directionAlongUvw,
    directionNormalToHkl,
    readOrientation,
    rotateView,
    snapToZoneAxis,
    type ReadoutMemory,
  } from '../core/orientation';
  import { paintLegend, safeName } from '../export/browser';
  import { structureImageRows, type ExportSection } from '../export/rows';
  import { labelMap } from '../export/svg3d';
  import { StructureView, type CameraState } from '../render/structureView';
  import ExportMenu from './ExportMenu.svelte';
  import { orientation } from './orientation.svelte';
  import Logo from './Logo.svelte';
  import SidePanel from './SidePanel.svelte';
  import ViewPanel, { VIEW_TABS } from './ViewPanel.svelte';
  import { setZone, specimen } from '../state/specimen.svelte';

  let {
    crystal,
    fileName = '',
    settings = $bindable(defaultViewSettings(null)),
    crystalData,
  }: {
    crystal: Crystal | null;
    /** Name of the loaded file: the stem of the exported files' names. */
    fileName?: string;
    /** Bound by the app so that the electron-diffraction tab can share the appearance. */
    settings?: ViewSettings;
    /** The "Crystal data" sidebar tab (cell, symmetry, sites; the notices above them). */
    crystalData?: Snippet;
  } = $props();

  let stage = $state<HTMLDivElement>();
  let canvas: HTMLCanvasElement;
  let labelCanvas: HTMLCanvasElement;
  let view: StructureView | null = null;
  let ready = $state(false);
  // True until a newly loaded crystal has been drawn once (with the default camera).
  let fresh = true;

  let model = $state.raw<StructureModel | null>(null);
  let modelWarnings = $state<string[]>([]);
  let error = $state('');
  let fps = $state(0);
  let hover = $state<{ atom: number; x: number; y: number } | null>(null);
  let selection = $state.raw<readonly number[]>([]);
  const screen = { x: 0, y: 0, visible: true };

  const fmt = (x: number, d = 4) => x.toFixed(d);

  function describe(atom: number) {
    if (!model || !crystal) return null;
    const placed = model.placed;
    const a = crystal.atoms[placed.atom[atom]];
    const site = crystal.sites[a.site];
    return {
      label: site.label,
      element: a.element,
      frac: [0, 1, 2].map((k) => placed.frac[3 * atom + k]),
      occupancy: a.occupancy,
      added: model.inRange[atom] === 0,
    };
  }

  const refOf = (i: number): AtomRef => {
    const p = model!.placed;
    return { atom: p.atom[i], cell: [p.cell[3 * i], p.cell[3 * i + 1], p.cell[3 * i + 2]] };
  };

  // ---- overlays: atom labels ---------------------------------------------

  const MAX_ATOM_LABELS = 4000;
  let labelCtx: CanvasRenderingContext2D | null = null;
  let labelTexts: string[] = [];
  let labelInk = $state('#1b1d24');
  let labelHalo = $state('rgba(255,255,255,0.85)');
  /** One ball and name per kind of atom shown, bottom right (static: it does not turn). */
  let legend = $state.raw<LegendEntry[]>([]);
  let lastApp: Appearance | null = null;
  let stageW = 1;
  let stageH = 1;

  function drawAtomLabels() {
    const ctx = labelCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, stageW, stageH);
    paintAtomLabels(ctx);
  }

  /** The atom names above their atoms, in CSS-pixel units (scale the context for a larger image). */
  function paintAtomLabels(ctx: CanvasRenderingContext2D) {
    if (!view || !lastApp || labelTexts.length === 0) return;
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = labelHalo;
    ctx.fillStyle = labelInk;
    const n = labelTexts.length;
    for (let i = 0; i < n; i++) {
      if (!lastApp.atomVisible[i]) continue;
      view.atomScreen(i, screen);
      if (
        !screen.visible ||
        screen.x < -20 ||
        screen.y < -20 ||
        screen.x > stageW + 20 ||
        screen.y > stageH + 20
      )
        continue;
      ctx.strokeText(labelTexts[i], screen.x, screen.y - 2);
      ctx.fillText(labelTexts[i], screen.x, screen.y - 2);
    }
    ctx.restore();
  }

  function onRendered() {
    drawAtomLabels();
    updateOrientation();
  }

  // ---- orientation (M7) ---------------------------------------------------------------------------

  const memory: ReadoutMemory = {};
  let readLattice: unknown = null;
  let readDirection: Vec3 = [0, 0, 0];

  /** Refresh the live [uvw]/(hkl) readout, only when the line of sight or the lattice changed. */
  function updateOrientation() {
    if (!view || !crystal) {
      orientation.ready = false;
      return;
    }
    const { direction, up } = view.viewState();
    const lat = crystal.lattice;
    const moved =
      Math.abs(direction[0] - readDirection[0]) +
        Math.abs(direction[1] - readDirection[1]) +
        Math.abs(direction[2] - readDirection[2]) >
      1e-9;
    if (lat === readLattice && !moved) {
      orientation.up = up;
      return;
    }
    if (lat !== readLattice) {
      delete memory.uvw;
      delete memory.hkl;
      readLattice = lat;
    }
    readDirection = direction;
    const r = readOrientation(lat, direction, memory);
    orientation.ready = true;
    orientation.direction = direction;
    orientation.up = up;
    orientation.uvw = r.uvw;
    orientation.hkl = r.hkl;
  }

  let uvwInput = $state<[string, string, string]>(['0', '0', '1']);
  let hklInput = $state<[string, string, string]>(['0', '0', '1']);

  function parseTriple(t: readonly string[]): Vec3 | null {
    const v = t.map((x) => Number(x.trim() === '' ? NaN : x));
    return v.every(Number.isFinite) && v.some((x) => x !== 0) ? [v[0], v[1], v[2]] : null;
  }
  const uvwValue = $derived(parseTriple(uvwInput));
  const hklValue = $derived(parseTriple(hklInput));

  /** The direction now looked along becomes the beam direction ② starts from. */
  function publishZone() {
    updateOrientation();
    if (!orientation.uvw) return;
    const u = orientation.uvw.indices.map((n) => Math.round(n)) as [number, number, number];
    if (u.every((n) => n === 0)) return;
    setZone(u, [...orientation.up] as [number, number, number]);
  }

  function viewAlong(direction: Vec3) {
    if (!crystal || !view) return;
    view.lookAlong(direction, defaultUp(crystal.lattice, direction));
    publishZone();
  }
  const viewAlongUvw = (uvw: Vec3) => crystal && viewAlong(directionAlongUvw(crystal.lattice, uvw));
  const viewNormalToHkl = (hkl: Vec3) =>
    crystal && viewAlong(directionNormalToHkl(crystal.lattice, hkl));

  /** Turn the structure like a goniometer: degrees right, up, and clockwise about the view axis. */
  function turn(right: number, upward: number, roll: number) {
    if (!view) return;
    const s = view.viewState();
    const f = rotateView({ direction: s.direction, up: s.up }, { right, upward, roll });
    view.lookAlong(f.direction, f.up);
    publishZone();
  }

  const step = $derived(
    Number.isFinite(settings.tiltStep) && settings.tiltStep > 0 ? settings.tiltStep : 5,
  );

  /** After a mouse rotation: jump onto the zone axis if one is close enough and snapping is on. */
  function onGestureEnd(rotated: boolean) {
    if (!rotated || !crystal || !view) return;
    if (!settings.snapToZone) {
      publishZone();
      return;
    }
    const s = view.viewState();
    const hit = snapToZoneAxis(
      crystal.lattice,
      s.direction,
      settings.snapDegrees,
      settings.snapMaxIndex,
    );
    if (hit) view.lookAlong(hit.direction, s.up);
    publishZone();
  }

  const ARROWS: Record<string, [number, number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };

  /**
   * Arrow keys tilt by the step (Shift: 1 degree, Ctrl: 15 degrees) the way a drag in that direction
   * would; Alt with Left/Right rolls about the view axis.
   */
  function onKeydown(e: KeyboardEvent) {
    const a = ARROWS[e.key];
    if (!a || e.metaKey || !view || !crystal) return;
    e.preventDefault();
    const size = e.shiftKey ? 1 : e.ctrlKey ? 15 : step;
    if (e.altKey) turn(0, 0, a[0] * size);
    else turn(a[0] * size, a[1] * size, 0);
  }

  function sizeOverlays() {
    if (!stage || !labelCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    stageW = stage.clientWidth;
    stageH = stage.clientHeight;
    labelCanvas.width = Math.max(1, Math.round(stageW * dpr));
    labelCanvas.height = Math.max(1, Math.round(stageH * dpr));
    labelCtx = labelCanvas.getContext('2d');
    labelCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- mounting ---------------------------------------------------------------------------------

  let lastApplyMs = 0;
  let lastBuildMs = 0;

  onMount(() => {
    view = new StructureView(canvas, {
      onHover: (atom, x, y) => {
        hover = atom === null ? null : { atom, x, y };
      },
      onSelect: (s) => {
        selection = s;
      },
      onRender: onRendered,
      onGestureEnd,
    });
    sizeOverlays();
    const observer = new ResizeObserver(() => {
      view?.resize();
      sizeOverlays();
      view?.requestRender();
    });
    observer.observe(stage!);
    const timer = setInterval(() => {
      if (view) fps = Math.round(view.stats.fps);
    }, 500);
    // Test hook (also handy in the console): screen positions of atoms, to drive the pointer.
    (window as unknown as Record<string, unknown>).__crystallens = {
      atomScreen: (i: number) => {
        view!.atomScreen(i, screen);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + screen.x, y: r.top + screen.y };
      },
      stats: () => ({ ...view!.stats }),
      model: () => model,
      pickAt: (x: number, y: number) => view!.pickAt(x, y),
      selection: () => [...view!.getSelection()],
      viewState: () => view!.viewState(),
      settings: () => $state.snapshot(settings),
      bondsDrawn: () => view!.bondsDrawn,
      appearanceMs: () => lastApplyMs,
      buildMs: () => lastBuildMs,
      turn: (right: number, upward: number, roll: number) => turn(right, upward, roll),
      legend: () => legend.map((e) => ({ ...e })),
    };
    ready = true;
    return () => {
      clearInterval(timer);
      observer.disconnect();
      view?.dispose();
      view = null;
    };
  });

  // ---- a new crystal starts with fresh settings (keeping the user's preferences) -----------------
  // With several files open, each keeps its settings and camera while another one is shown.

  const kept = new WeakMap<Crystal, { settings: ViewSettings; camera: CameraState | null }>();
  let shownCrystal: Crystal | null = null;
  /** The camera to put back when the structure of a file shown before is built again. */
  let restoreCamera: CameraState | null = null;

  $effect(() => {
    const c = crystal;
    untrack(() => {
      if (c === shownCrystal) return;
      if (shownCrystal)
        kept.set(shownCrystal, {
          settings: $state.snapshot(settings),
          camera: view?.cameraState() ?? null,
        });
      shownCrystal = c;
      const saved = c ? kept.get(c) : undefined;
      settings = saved
        ? structuredClone(saved.settings)
        : c
          ? settingsForNewCrystal(settings, c)
          : defaultViewSettings(null);
      restoreCamera = saved?.camera ?? null;
      fresh = true;
    });
  });

  // ---- what is shown: rebuilt only when the geometry-relevant settings change --------------------

  const geometryKey = $derived(
    JSON.stringify([
      settings.range,
      settings.bonds.rules.map((r) => [r.a, r.b, r.min, r.max]),
      settings.bonds.beyondRange,
      settings.bonds.completeMolecules,
      settings.bonds.manual,
    ]),
  );
  let builtFor: { crystal: Crystal | null; key: string } | null = null;
  let modelRevision = 0;

  $effect(() => {
    if (!ready || !view) return;
    const c = crystal;
    const key = geometryKey;
    if (builtFor && builtFor.crystal === c && builtFor.key === key) return;
    builtFor = { crystal: c, key };
    error = '';
    untrack(() => {
      if (!c) {
        model = null;
        modelWarnings = [];
        return;
      }
      try {
        const snap = $state.snapshot(settings);
        const t0 = performance.now();
        const built = buildModel(c, {
          range: snap.range,
          boundary: snap.range.boundary,
          slab: snap.range.slab,
          bonds: snap.bonds,
        });
        lastBuildMs = performance.now() - t0;
        model = built;
        modelRevision++;
        modelWarnings = built.warnings;
        // Same crystal, new range or rules: keep the user's orientation and zoom; a file shown
        // before gets its own camera back.
        const first = fresh && !restoreCamera;
        view!.setStructure(built, c.lattice, restoreCamera ?? !fresh);
        restoreCamera = null;
        fresh = false;
        // A new file starts looking down c, which is also the default beam of ②; a setup that was
        // opened looks along the beam it was saved with.
        if (first) {
          const z = specimen.params.zoneAxis;
          if (z[0] === 0 && z[1] === 0 && z[2] === 1 && !specimen.params.yDirection)
            viewAlongUvw([0, 0, 1]);
          else {
            const dir = directionAlongUvw(c.lattice, z);
            view!.lookAlong(dir, specimen.params.yDirection ?? defaultUp(c.lattice, dir));
            updateOrientation();
          }
        }
        selection = [];
        hover = null;
      } catch (e) {
        model = null;
        error = e instanceof Error ? e.message : String(e);
      }
    });
  });

  // ---- how it looks: resolved from the settings, applied in place -------------------------------

  const appearanceKey = $derived(
    JSON.stringify([
      settings.appearance,
      settings.bonds.rules.map((r) => [r.visible, r.radius, r.color]),
      settings.hiddenAtoms,
      settings.polyhedra,
    ]),
  );
  /** The parts of the appearance that change sizes or visibility, not only colours. */
  const shapeKey = $derived.by(() => {
    const a = settings.appearance;
    const pick = (o: Record<string, { radius?: number; visible?: boolean }>) =>
      Object.entries(o).map(([k, v]) => [k, v.radius, v.visible]);
    return JSON.stringify([
      a.displayStyle,
      a.radiusScheme,
      a.radiusScale,
      a.uniformRadius,
      pick(a.elements),
      pick(a.sites),
      settings.hiddenAtoms,
      settings.bonds.rules.map((r) => [r.visible, r.radius]),
    ]);
  });
  /** The colour settings alone: a change here rewrites only the colour buffers. */
  const colourKey = $derived.by(() => {
    const a = settings.appearance;
    const col = (o: Record<string, { color?: string }>) =>
      Object.entries(o).map(([k, v]) => [k, v.color]);
    return JSON.stringify([
      col(a.elements),
      col(a.sites),
      settings.bonds.rules.map((r) => r.color),
    ]);
  });
  let lastShapeKey = '';
  let lastColourKey = '';
  let lastLabelKey = '';
  let lastModelRevision = -1;

  $effect(() => {
    if (!ready || !view) return;
    const m = model;
    const c = crystal;
    void appearanceKey;
    const shape = shapeKey;
    const colour = colourKey;
    if (!m || !c) {
      legend = [];
      return;
    }
    untrack(() => {
      const t0 = performance.now();
      const snap = $state.snapshot(settings);
      const newModel = modelRevision !== lastModelRevision;
      // Three cases, cheapest last: sizes or visibility changed (everything is rewritten), only
      // colours changed (just the colour buffers), or neither (bonds on/off, labels, ...).
      let changed = false;
      if (shape !== lastShapeKey || newModel || !lastApp) {
        lastApp = resolveAppearance(c, m, snap.appearance, snap.bonds.rules, snap.hiddenAtoms);
        view!.setAppearance(lastApp, true);
        changed = true;
      } else if (colour !== lastColourKey) {
        const colours = resolveColours(c, m, snap.appearance, snap.bonds.rules);
        view!.setColours(colours);
        lastApp = { ...lastApp, ...colours };
        changed = true;
      }
      const drawn = snap.appearance.bondsVisible && snap.appearance.displayStyle !== 'spaceFill';
      if (lastApp.bondsDrawn !== drawn) {
        view!.setBondsDrawn(drawn);
        lastApp = { ...lastApp, bondsDrawn: drawn };
      }
      lastShapeKey = shape;
      lastColourKey = colour;
      lastModelRevision = modelRevision;
      if (changed) legend = legendEntries(c, m, lastApp);

      const mode = snap.appearance.labels;
      const labelKey = `${mode}|${modelRevision}`;
      if (labelKey !== lastLabelKey) {
        lastLabelKey = labelKey;
        labelTexts =
          mode === 'none' || m.count > MAX_ATOM_LABELS
            ? []
            : Array.from({ length: m.count }, (_, i) => atomLabel(c, m, i, mode));
      }
      const [r, g2, b] = hexToRgb(snap.appearance.background);
      const dark = 0.299 * r + 0.587 * g2 + 0.114 * b < 128;
      labelInk = dark ? '#f4f6fa' : '#1b1d24';
      labelHalo = dark ? 'rgba(10,12,18,0.85)' : 'rgba(255,255,255,0.85)';
      view!.requestRender();
      lastApplyMs = performance.now() - t0;
    });
  });

  // ---- viewer-level settings ---------------------------------------------------------------------

  $effect(() => {
    if (ready) view?.setProjection(settings.projection);
  });
  $effect(() => {
    if (ready) view?.setShowCell(settings.showCell);
  });
  $effect(() => {
    if (ready) view?.setShowAxes(settings.showAxes);
  });
  $effect(() => {
    if (ready) view?.setToon(settings.toon);
  });
  // ---- toolbar actions ---------------------------------------------------------------------------

  function hideSelected() {
    if (!model || selection.length === 0) return;
    const refs = selection.map(refOf);
    settings.hiddenAtoms = [...settings.hiddenAtoms, ...refs];
    view?.setSelection([]);
  }

  const hovered = $derived(hover ? describe(hover.atom) : null);

  // ---- export (M12) --------------------------------------------------------------------------------

  const baseName = () => safeName(fileName || (crystal?.name ?? ''));

  /** The panel header's menu: the picture with its atom names and legend. */
  const imageSections: ExportSection[] = [
    {
      title: 'Image of the view',
      image: true,
      rows: structureImageRows({
        view: () => view,
        background: () => settings.appearance.background,
        name: () => `${baseName()}_structure`,
        labels: () => (lastApp ? labelMap(labelTexts, lastApp.atomVisible) : new Map()),
        legend: () => legend,
        overlay: (ctx, w, h) => {
          paintAtomLabels(ctx);
          paintLegend(ctx, legend, w, h, labelInk);
        },
      }),
    },
  ];

  // ---- range: how many cells along a, b and c ------------------------------------------------------

  const MAX_CELLS = 8;
  const cells = $derived(
    settings.range.max.map((x, k) => Math.round((x - settings.range.min[k]) * 10) / 10),
  );

  function setCells(k: 0 | 1 | 2, input: HTMLInputElement) {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CELLS) {
      input.value = String(cells[k]);
      return;
    }
    const max: [number, number, number] = [...settings.range.max];
    max[k] = n;
    settings.range = { ...settings.range, min: [0, 0, 0], max, boundary: true, slab: null };
  }

  function presetCells(n: number) {
    settings.range = { min: [0, 0, 0], max: [n, n, n], boundary: true, slab: null };
  }

  // ---- sidebar -------------------------------------------------------------------------------------

  const SIDE_TABS = [
    { id: 'data', label: 'Crystal data' },
    ...VIEW_TABS.filter((t) => t.id === 'appearance' || t.id === 'elements'),
  ] as const;
  type SideTab = (typeof SIDE_TABS)[number]['id'];
  let sideTab = $state<SideTab>('data');
  const noPolyhedra = { count: 0, skipped: 0 };
</script>

<section aria-label="Structure viewer" data-testid="viewer" class="viewer">
  <div class="toolbar card">
    <fieldset class="tgroup" disabled={!crystal}>
      <legend>Display</legend>
      <div class="ctl">
        <select
          bind:value={settings.appearance.displayStyle}
          data-testid="style"
          aria-label="Style"
          title="Drawing style"
        >
          <option value="ballStick">Ball and stick</option>
          <option value="spaceFill">Space filling</option>
          <option value="stick">Stick</option>
        </select>
        <select
          bind:value={settings.projection}
          data-testid="projection"
          aria-label="Projection"
          title="Projection"
        >
          <option value="ortho">Orthographic</option>
          <option value="persp">Perspective</option>
        </select>
        <span class="chips">
          <label class="chip"><input type="checkbox" bind:checked={settings.showCell} /> Cell</label
          >
          <label class="chip"><input type="checkbox" bind:checked={settings.showAxes} /> Axes</label
          >
          <label class="chip" title="Untick to draw no bonds at all">
            <input
              type="checkbox"
              bind:checked={settings.appearance.bondsVisible}
              data-testid="bonds"
            /> Bonds
          </label>
          <label class="chip" title="Cartoon shading"
            ><input type="checkbox" bind:checked={settings.toon} /> Toon</label
          >
        </span>
      </div>
    </fieldset>

    <fieldset class="tgroup" disabled={!crystal} data-testid="orientation">
      <legend>View direction</legend>
      <div class="ctl">
        <form
          class="idxform"
          onsubmit={(e) => {
            e.preventDefault();
            if (uvwValue) viewAlongUvw(uvwValue);
          }}
          title="View along a direction [uvw]"
        >
          along <span class="br">[</span>
          {#each [0, 1, 2] as k (k)}
            <input
              class="idx"
              bind:value={uvwInput[k]}
              aria-label={`u v w, index ${k + 1}`}
              data-testid={`uvw-${k}`}
              inputmode="numeric"
            />
          {/each}
          <span class="br">]</span>
          <button type="submit" disabled={!uvwValue} data-testid="uvw-go">Go</button>
        </form>
        <form
          class="idxform"
          onsubmit={(e) => {
            e.preventDefault();
            if (hklValue) viewNormalToHkl(hklValue);
          }}
          title="View along the normal of a plane (hkl)"
        >
          normal to <span class="br">(</span>
          {#each [0, 1, 2] as k (k)}
            <input
              class="idx"
              bind:value={hklInput[k]}
              aria-label={`h k l, index ${k + 1}`}
              data-testid={`hkl-${k}`}
              inputmode="numeric"
            />
          {/each}
          <span class="br">)</span>
          <button type="submit" disabled={!hklValue} data-testid="hkl-go">Go</button>
        </form>
        <span class="seg" role="group" aria-label="Quick views">
          <button type="button" onclick={() => viewAlongUvw([1, 0, 0])} title="View along a"
            >a</button
          ><button type="button" onclick={() => viewAlongUvw([0, 1, 0])} title="View along b"
            >b</button
          ><button type="button" onclick={() => viewAlongUvw([0, 0, 1])} title="View along c"
            >c</button
          >
        </span>
        <span class="seg" role="group" aria-label="Quick views, reciprocal">
          <button type="button" onclick={() => viewNormalToHkl([1, 0, 0])} title="View along a*"
            >a*</button
          ><button type="button" onclick={() => viewNormalToHkl([0, 1, 0])} title="View along b*"
            >b*</button
          ><button type="button" onclick={() => viewNormalToHkl([0, 0, 1])} title="View along c*"
            >c*</button
          >
        </span>
      </div>
    </fieldset>

    <fieldset class="tgroup" disabled={!crystal}>
      <legend>Rotate</legend>
      <div class="ctl">
        <span class="seg" role="group" aria-label="Goniometer">
          <button type="button" onclick={() => turn(-step, 0, 0)} aria-label="Tilt left">◀</button
          ><button type="button" onclick={() => turn(step, 0, 0)} aria-label="Tilt right">▶</button
          ><button type="button" onclick={() => turn(0, step, 0)} aria-label="Tilt up">▲</button
          ><button type="button" onclick={() => turn(0, -step, 0)} aria-label="Tilt down">▼</button>
        </span>
        <label class="unit" title="Tilt step (arrow keys and buttons)">
          <input
            class="idx"
            type="number"
            min="0.1"
            max="90"
            step="0.5"
            bind:value={settings.tiltStep}
            aria-label="Tilt step in degrees"
            data-testid="tilt-step"
          />°
        </label>
        <span class="seg" role="group" aria-label="Rotate about the view axis">
          <button
            type="button"
            onclick={() => turn(0, 0, -step)}
            title="Rotate anticlockwise by the step"
            aria-label="Rotate in plane anticlockwise">⟲</button
          ><button
            type="button"
            onclick={() => turn(0, 0, step)}
            title="Rotate clockwise by the step"
            aria-label="Rotate in plane clockwise">⟳</button
          >
        </span>
        <span class="snap">
          <button
            type="button"
            aria-pressed={settings.snapToZone}
            onclick={() => (settings.snapToZone = !settings.snapToZone)}
            title="When on, releasing a mouse rotation close to a low-index zone axis snaps onto it"
            data-testid="snap">Snap: {settings.snapToZone ? 'on' : 'off'}</button
          >
          <label class="unit" title="Snap when within this angle">
            ≤
            <input
              class="idx"
              type="number"
              min="0.1"
              max="45"
              step="0.5"
              bind:value={settings.snapDegrees}
              aria-label="Snap angle in degrees"
              data-testid="snap-degrees"
            />°
          </label>
          <label class="unit" title="Only zone axes with indices up to this">
            index ≤
            <input
              class="idx"
              type="number"
              min="1"
              max="6"
              step="1"
              bind:value={settings.snapMaxIndex}
              aria-label="Largest zone-axis index to snap to"
              data-testid="snap-index"
            />
          </label>
        </span>
      </div>
    </fieldset>

    <fieldset class="tgroup" disabled={!crystal}>
      <legend>Range (cells)</legend>
      <div class="ctl">
        <span class="seg" role="group" aria-label="Range presets">
          {#each [1, 2, 3] as n (n)}
            <button
              type="button"
              aria-pressed={cells.every((c) => c === n)}
              onclick={() => presetCells(n)}>{n}×{n}×{n}</button
            >
          {/each}
        </span>
        <span class="cells">
          {#each ['a', 'b', 'c'] as axis, k (axis)}
            {#if k > 0}<span class="br">×</span>{/if}
            <input
              class="idx"
              type="number"
              min="1"
              max={MAX_CELLS}
              value={cells[k]}
              aria-label={`Cells along ${axis}`}
              data-testid={`cells-${axis}`}
              onchange={(e) => setCells(k as 0 | 1 | 2, e.currentTarget)}
            />
          {/each}
        </span>
      </div>
    </fieldset>
  </div>

  <div class="layout" class:withPanel={crystal !== null}>
    <div class="viewcol card">
      <div class="phead">
        <span class="phead-title">
          <span>Structure</span>
          <ExportMenu
            sections={imageSections}
            disabled={!crystal}
            imageSize={() => view?.size ?? null}
            testid="export"
            compact
          />
        </span>
        <span class="phead-tools">
          <span class="seg" role="group" aria-label="Reset">
            <button
              type="button"
              disabled={!crystal}
              onclick={() => view?.resetOrientation()}
              title="Default orientation and centring; the zoom stays"
              data-testid="reset-view">Reset view</button
            ><button
              type="button"
              disabled={!crystal}
              onclick={() => view?.resetZoom()}
              title="Magnification back to fit; orientation and pan stay"
              data-testid="reset-zoom">Reset zoom</button
            >
          </span>
        </span>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="stage"
        bind:this={stage}
        style:background={settings.appearance.background}
        tabindex="0"
        role="application"
        aria-label="3D structure. Arrow keys tilt it."
        onkeydown={onKeydown}
        onpointerdown={() => stage?.focus({ preventScroll: true })}
      >
        <canvas bind:this={canvas} data-testid="viewer-canvas"></canvas>
        <canvas bind:this={labelCanvas} class="overlay" data-testid="label-canvas"></canvas>

        {#if !crystal}
          <div class="empty">
            <Logo size={56} />
            <p>Open a CIF or XYZ file above, or drop one on the bar.</p>
          </div>
        {/if}
        {#if error}
          <p class="empty err" role="alert">{error}</p>
        {/if}

        {#if crystal}
          <span class="readout" data-testid="orientation-readout">
            {#if orientation.ready && orientation.uvw && orientation.hkl}
              along [{orientation.uvw.indices.join(' ')}] ({fmt(orientation.uvw.angleDeg, 2)}° off)
              · normal to ({orientation.hkl.indices.join(' ')}) ({fmt(orientation.hkl.angleDeg, 2)}°
              off)
            {/if}
          </span>
        {/if}

        {#if hover && hovered}
          <div
            class="tip"
            data-testid="tooltip"
            style:left={`${hover.x - stage!.getBoundingClientRect().left + 14}px`}
            style:top={`${hover.y - stage!.getBoundingClientRect().top + 14}px`}
          >
            <strong>{hovered.label}</strong>
            {hovered.element}
            <div>frac {hovered.frac.map((x) => fmt(x)).join(' ')}</div>
            <div>occ {fmt(hovered.occupancy, 3)}</div>
            {#if hovered.added}<div>outside the range (bonded)</div>{/if}
          </div>
        {/if}

        {#if legend.length > 0}
          <ul
            class="legend"
            aria-label="Legend"
            data-testid="legend"
            style:color={labelInk}
            style:--halo={labelHalo}
          >
            {#each legend as e (e.label + e.color)}
              <li data-testid="legend-item">
                <span class="ball" style:--c={e.color}></span><span>{e.label}</span>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="hud" data-testid="hud">
          {#if model}{model.count.toLocaleString('en')} atoms · {(
              model.bonds.length / 2
            ).toLocaleString('en')} bonds ·
          {/if}{fps > 0 ? `${fps} fps` : 'idle'}
        </div>
      </div>
    </div>

    {#if crystal}
      <SidePanel
        tabs={SIDE_TABS}
        bind:tab={sideTab}
        label="Structure settings"
        storageKey="emsim.structurePanel"
        idPrefix="view"
      >
        {#if sideTab === 'data'}
          <div class="data" data-testid="crystal-data">
            {@render crystalData?.()}
          </div>
        {:else}
          <ViewPanel
            tab={sideTab}
            {crystal}
            {model}
            {selection}
            bind:settings
            polyhedraInfo={noPolyhedra}
            onHideSelected={hideSelected}
          />
        {/if}
      </SidePanel>
    {/if}
  </div>

  {#each modelWarnings as w, i (i)}
    <p class="warn" role="status">{w}</p>
  {/each}
  <p class="hint">
    <kbd>drag</kbd> rotate · <kbd>wheel</kbd> zoom · <kbd>right-drag</kbd> pan · click the view,
    then
    <kbd>←↑→↓</kbd> tilt (<kbd>Shift</kbd> 1°, <kbd>Ctrl</kbd> 15°, <kbd>Alt</kbd>+<kbd>←→</kbd> roll)
    · click an atom to select it.
  </p>
</section>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  /* ---- toolbar: labelled groups of controls ---- */
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    padding: 0.35rem 0.4rem;
    font-size: 0.84rem;
  }
  .tgroup {
    margin: 0;
    padding: 0.25rem 0.85rem 0.35rem;
    border: none;
    border-right: 1px solid var(--border);
    min-width: 0;
  }
  .tgroup:last-child {
    border-right: none;
  }
  .tgroup:disabled {
    opacity: 0.55;
  }
  legend {
    float: left;
    width: 100%;
    padding: 0;
    margin-bottom: 0.25rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .ctl {
    clear: both;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
  }
  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.55rem 0.15rem 0.4rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    cursor: pointer;
    user-select: none;
  }
  .chip:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .chip input {
    margin: 0;
  }
  /* segmented button groups */
  .seg {
    display: inline-flex;
  }
  .seg > button {
    border-radius: 0;
    margin-left: -1px;
    min-width: 2rem;
  }
  .seg > button:first-child {
    border-radius: 6px 0 0 6px;
    margin-left: 0;
  }
  .seg > button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .seg > button:hover:not(:disabled) {
    position: relative;
    z-index: 1;
  }
  .idxform {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .br {
    font-family: var(--mono);
    color: var(--muted);
  }
  .idx {
    width: 2.6rem;
    padding: 0.15rem 0.2rem;
    text-align: center;
  }
  .cells {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .data {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .unit {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .snap {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding-left: 0.6rem;
    border-left: 1px dashed var(--border);
  }

  /* ---- stage and side panel ---- */
  .layout {
    display: flex;
    align-items: stretch;
    height: clamp(28rem, calc(100vh - 22.5rem), 70rem);
  }
  .viewcol {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
  }
  .stage:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  @media (max-width: 60rem) {
    .layout.withPanel {
      flex-direction: column;
      height: auto;
      gap: 0.75rem;
    }
    .layout.withPanel .viewcol {
      height: 60vh;
      min-height: 22rem;
      flex: none;
    }
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }
  canvas.overlay {
    pointer-events: none;
    cursor: inherit;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin: 0;
    pointer-events: none;
    color: #5b6578;
  }
  .empty p {
    margin: 0;
  }
  .err {
    color: var(--err);
  }
  .warn {
    margin: 0;
    font-size: 0.82rem;
    color: var(--warn);
  }
  .readout {
    position: absolute;
    left: 0.6rem;
    top: 0.6rem;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.82);
    border: 1px solid rgba(0, 0, 0, 0.06);
    color: #27304a;
    font: 0.78rem var(--mono);
    pointer-events: none;
    z-index: 2;
  }
  .readout:empty {
    display: none;
  }
  .tip {
    position: absolute;
    pointer-events: none;
    padding: 0.35rem 0.55rem;
    border-radius: 6px;
    background: rgba(20, 24, 33, 0.92);
    color: #f1f3f8;
    font: 0.75rem/1.35 var(--mono);
    white-space: nowrap;
    z-index: 3;
  }
  .legend {
    position: absolute;
    right: 0.75rem;
    bottom: 2rem;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font:
      0.95rem/1.2 system-ui,
      -apple-system,
      'Segoe UI',
      Arial,
      sans-serif;
    pointer-events: none;
    text-shadow:
      0 0 3px var(--halo, rgba(255, 255, 255, 0.9)),
      0 0 3px var(--halo, rgba(255, 255, 255, 0.9));
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .ball {
    flex: none;
    width: 1.15rem;
    height: 1.15rem;
    border-radius: 50%;
    border: 0.5px solid rgba(0, 0, 0, 0.3);
    background: radial-gradient(
      circle at 34% 30%,
      color-mix(in srgb, var(--c) 38%, white),
      var(--c) 45%,
      color-mix(in srgb, var(--c) 55%, black)
    );
  }
  .hud {
    position: absolute;
    right: 0.6rem;
    bottom: 0.45rem;
    padding: 0.05rem 0.45rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.6);
    font: 0.7rem var(--mono);
    color: #5b6578;
    pointer-events: none;
  }
  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
  }
  kbd {
    padding: 0 0.3rem;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    font: 0.72rem var(--mono);
    background: var(--surface);
  }
</style>
