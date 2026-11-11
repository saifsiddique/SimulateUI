<script lang="ts">
  // The results viewer (context.md M7) for one finished run: pick a result, step through its series
  // (a thickness slider and, for runs with a defocus or tilt series, a second slider), choose the
  // colour map, the intensity scale and its vmin / vmax, zoom and pan, read values, and export (the
  // files go to the run's `Exports` folder). 4D-STEM gets a virtual detector: a disk or an annulus
  // in the diffraction pattern gives the virtual image, and a click on that image shows the pattern
  // of the scan position.
  import {
    frameUrl,
    getBeams,
    getFrame,
    getPattern,
    getSpots,
    getVirtual,
    openJobFolder,
    postExport,
    postExportPng,
    type Beams,
    type Frame,
    type Job,
    type JobResult,
    type SavedExport,
    type SpotsReply,
  } from '../api/client';
  import { formatBytes } from '../core/memory';
  import { COLORMAPS, type ColormapName, type ScaleMode } from '../plots/colormap';
  import ImageCanvas, { type Circle, type Hover } from './ImageCanvas.svelte';
  import NumberField from './kit/NumberField.svelte';
  import SpotsCanvas from './SpotsCanvas.svelte';

  let {
    job,
    view = 'native',
    onview,
  }: {
    job: Job;
    /** Native (the ideal simulation) or processed (the Postprocessing card's result). */
    view?: 'native' | 'processed';
    onview?: (v: 'native' | 'processed') => void;
  } = $props();

  const results = $derived(job.state === 'done' ? job.results : []);
  let picked = $state('');
  const result = $derived(results.find((r) => r.name === picked) ?? results[0] ?? null);
  const processed = $derived(result?.processed ?? null);
  const source = $derived<'native' | 'processed'>(
    view === 'processed' && processed ? 'processed' : 'native',
  );
  const isFour = $derived(result?.name === '4dstem');
  const isSpots = $derived(result?.kind === 'spots');
  const isWave = $derived(result?.kind === 'wave');
  const isDiscs = $derived(result?.kind === 'discs');

  // ---- series ------------------------------------------------------------------------------------
  let run = $state(0);
  let depth = $state(0);
  let sample = $state(0);
  // LACBED: the indices of the disc (the direct beam, 0 0 0, first)
  let hkl = $state({ h: 0, k: 0, l: 0 });
  let beamList = $state.raw<Beams | null>(null);
  let part = $state<'phase' | 'amplitude'>('phase');
  const nRun = $derived(result?.runs?.length ?? 1);
  const nDepth = $derived(result?.depths?.length ?? 1);
  const nSample = $derived(source === 'processed' ? (processed?.samples ?? 1) : 1);
  const runTitle = $derived.by(() => {
    const labels = result?.runs ?? [];
    const d = labels.some((l) => l.startsWith('defocus'));
    const t = labels.some((l) => l.includes('tilt'));
    return d && t ? 'Defocus · tilt' : d ? 'Defocus' : t ? 'Tilt' : 'Series';
  });
  const runLabel = $derived((result?.runs ?? [])[Math.min(run, nRun - 1)] ?? '');
  const depthLabel = $derived.by(() => {
    const z = (result?.depths ?? [])[Math.min(depth, nDepth - 1)];
    return z === undefined ? '' : `${+z.toFixed(2)} Å`;
  });

  /** What the saved array's axes are, in words: "1 run · 2 depths · image 6 × 6" (4D-STEM:
   *  "… · scan 9 × 15 · pattern 90 × 104"). The array has one axis for every number. */
  function shapeText(r: JobResult): string {
    const s = r.shape ?? [];
    if (r.name === '4dstem' && s.length === 6)
      return `${s[0]} run${s[0] === 1 ? '' : 's'} · ${s[1]} depth${s[1] === 1 ? '' : 's'} · scan ${s[2]} × ${s[3]} · pattern ${s[4]} × ${s[5]} (kx × ky)`;
    if (s.length < 2) return s.join(' × ');
    const lead = s.slice(0, -2);
    const names = (r.axes ?? []).slice(0, lead.length);
    const bits = lead.map((n, i) => {
      const name = names[i] ?? (lead.length === 1 ? 'depth' : i === 0 ? 'run' : 'depth');
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    });
    bits.push(
      `${r.kind === 'pattern' ? 'pattern' : 'image'} ${s[s.length - 2]} × ${s[s.length - 1]}`,
    );
    return bits.join(' · ');
  }

  // ---- display -----------------------------------------------------------------------------------
  let cmap = $state<ColormapName>('gray');
  let mode = $state<ScaleMode>('linear');
  let gamma = $state(0.5);
  let vmin = $state<number | null>(null); // null = the frame's own minimum
  let vmax = $state<number | null>(null);
  let invert = $state(false);
  const scale = $derived({ mode, gamma, vmin, vmax });

  // ---- the data ----------------------------------------------------------------------------------
  // Frames are replaced whole, never changed: `$state.raw` keeps Svelte from wrapping them.
  let frame = $state.raw<Frame | null>(null); // the picture (4D-STEM: the virtual image)
  let pattern = $state.raw<Frame | null>(null); // 4D-STEM: the pattern of the picked position
  let spots = $state.raw<SpotsReply | null>(null);
  let error = $state('');
  let pos = $state<{ row: number; col: number } | null>(null);
  let det = $state({ shape: 'disk' as 'disk' | 'annulus', inner: 5, outer: 10 });
  let hover = $state.raw<Hover | null>(null);
  let showIndices = $state(true);
  let mainCanvas = $state<ImageCanvas>();
  let patternCanvas = $state<ImageCanvas>();
  let spotsCanvas = $state<SpotsCanvas>();
  let saved = $state<SavedExport | null>(null);

  // a different result starts with its own defaults
  let lastKey = '';
  $effect(() => {
    const r = result;
    const key = `${job.id}|${r?.name ?? ''}`;
    if (key === lastKey || !r) return;
    lastKey = key;
    run = 0;
    depth = Math.max(0, (r.depths?.length ?? 1) - 1); // the exit surface, as the preview
    sample = 0;
    hkl = { h: 0, k: 0, l: 0 };
    beamList = null;
    part = 'phase';
    pos = null;
    frame = pattern = null;
    spots = null;
    saved = null;
    const pat = r.kind === 'pattern';
    cmap = pat || r.kind === 'discs' ? 'inferno' : r.kind === 'wave' ? 'twilight' : 'gray';
    mode = pat ? 'log' : 'linear';
    vmin = vmax = null;
    invert = false;
    if (r.name === '4dstem') {
      mode = 'linear'; // the picture is the virtual image; the pattern is always logarithmic
      cmap = 'gray';
      const a = r.semiangle_mrad ?? 10;
      det = { shape: 'disk', inner: a, outer: a };
    }
  });
  $effect(() => {
    if (isWave) {
      cmap = part === 'phase' ? 'twilight' : 'gray';
      vmin = vmax = null;
    }
  });

  const base = $derived(
    result
      ? {
          result: result.name,
          source,
          run: Math.min(run, nRun - 1),
          depth: Math.min(depth, nDepth - 1),
          sample: Math.min(sample, nSample - 1),
          // a processed result is written again by every Apply: its stamp makes the request new
          v: source === 'processed' ? processed?.stamp : undefined,
        }
      : null,
  );
  const url = $derived(
    base
      ? frameUrl(job.id, {
          ...base,
          part: isWave ? part : undefined,
          ...(isDiscs ? hkl : {}),
        })
      : '',
  );

  // LACBED: the beams that have a disc. Not every h k l is one, so the boxes say which are.
  $effect(() => {
    if (!isDiscs || !result) return;
    const c = new AbortController();
    getBeams(job.id, { result: result.name, source }).then(
      (b) => {
        if (!c.signal.aborted) beamList = b;
      },
      () => {},
    );
    return () => c.abort();
  });
  const beamKeys = $derived(new Set((beamList?.hkl ?? []).map((b) => b.join(' '))));
  /** Whether the indices typed are a beam of this run (true until the list has arrived). */
  const validBeam = $derived(!isDiscs || !beamList || beamKeys.has(`${hkl.h} ${hkl.k} ${hkl.l}`));
  const beamRange = $derived(beamList?.ranges ?? result?.ranges ?? null);

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

  // The frame, the spots or the 4D-STEM pattern. A newer request cancels the one on the way, and
  // the browser keeps the frames it has had, so stepping back is instant.
  $effect(() => {
    if (!base || !result) return;
    if (isDiscs && !validBeam) return; // keep the last disc until the indices are a beam
    const c = new AbortController();
    const ok = () => {
      error = '';
    };
    const fail = (e: unknown) => {
      if (!aborted(e) && !c.signal.aborted) error = message(e);
    };
    if (isSpots) {
      getSpots(job.id, base).then((s) => {
        if (c.signal.aborted) return;
        spots = s;
        ok();
      }, fail);
    } else if (isFour) {
      getPattern(job.id, { ...base, row: pos?.row, col: pos?.col }, c.signal).then((f) => {
        if (c.signal.aborted) return;
        pattern = f;
        ok();
      }, fail);
    } else {
      getFrame(
        job.id,
        { ...base, part: isWave ? part : undefined, ...(isDiscs ? hkl : {}) },
        c.signal,
      ).then((f) => {
        if (c.signal.aborted) return;
        frame = f;
        ok();
      }, fail);
    }
    return () => c.abort();
  });

  $effect(() => {
    if (!base || !isFour) return;
    const q = { ...base, shape: det.shape, inner: det.inner, outer: det.outer };
    const c = new AbortController();
    const timer = setTimeout(() => {
      getVirtual(job.id, q, c.signal).then(
        (f) => {
          if (c.signal.aborted) return;
          frame = f;
          error = '';
        },
        (e) => {
          if (!aborted(e) && !c.signal.aborted) error = message(e);
        },
      );
    }, 120); // a slider sends many values; only the last is asked for
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  });

  // the pattern's range in mrad (the detector can reach as far as the pattern does)
  const reach = $derived.by(() => {
    const f = pattern;
    if (f?.pixel) return Math.min(f.shape[1] * f.pixel[0], f.shape[0] * f.pixel[1]) / 2;
    return 100;
  });
  const circles = $derived.by((): Circle[] => {
    const f = pattern;
    if (!isFour || !f) return [];
    const [rows, cols] = f.shape;
    // the direct beam is at pixel n // 2 of each axis; x is mirrored in the picture
    const c = {
      col: cols - 1 - Math.floor(cols / 2) + 0.5,
      row: rows - 1 - Math.floor(rows / 2) + 0.5,
    };
    const out: Circle[] = [{ ...c, radius: det.outer, color: '#22d3ee' }];
    if (det.shape === 'annulus') out.push({ ...c, radius: det.inner, color: '#22d3ee' });
    return out;
  });

  function setShape(s: 'disk' | 'annulus') {
    if (s === det.shape) return;
    const a = result?.semiangle_mrad ?? 10;
    det =
      s === 'annulus'
        ? { shape: s, inner: det.outer, outer: Math.min(reach, Math.max(det.outer * 2, a * 2)) }
        : { shape: s, inner: 0, outer: det.inner > 0 ? det.inner : a };
  }

  // vmin / vmax: the boxes show the frame's range until a value is typed; a value that reads the
  // same as the frame's own is "automatic" again
  const sig = (v: number) => +v.toPrecision(4);
  const autoMin = $derived(frame ? sig(frame.min) : 0);
  const autoMax = $derived(frame ? sig(frame.max) : 1);
  const setMin = (v: number) => (vmin = v === autoMin ? null : v);
  const setMax = (v: number) => (vmax = v === autoMax ? null : v);
  const fmt = (v: number) => +v.toPrecision(3);

  // ---- export ------------------------------------------------------------------------------------
  let saving = $state(false);
  const exportQ = $derived(
    base ? { ...base, part: isWave ? part : undefined, ...(isDiscs ? hkl : {}) } : null,
  );
  async function save(task: () => Promise<SavedExport | null>) {
    saving = true;
    error = '';
    try {
      saved = await task();
    } catch (e) {
      error = message(e);
    } finally {
      saving = false;
    }
  }
  const savePng = (c: { exportPng(): Promise<Blob | null> } | undefined, name: string) =>
    save(async () => {
      const blob = await c?.exportPng();
      return blob ? postExportPng(job.id, name, blob) : null;
    });
  const saveFile = (format: 'tiff' | 'npy' | 'h5') =>
    save(() => (exportQ ? postExport(job.id, { ...exportQ, format }) : Promise.resolve(null)));

  const snippet = $derived.by(() => {
    if (!result) return '';
    if (result.kind === 'spots' || result.kind === 'discs')
      return `import numpy as np\nz = np.load("${result.file}")   # in the run's results folder\nprint(z.files)`;
    const lines = [
      'import h5py',
      `with h5py.File("${result.name}_${source}.h5") as f:   # the HDF5 export, in the run's Exports folder`,
      '    d = f["data"]',
      '    data = d[...]                     # the saved layout, see d.attrs["axes"]',
      '    pixel, unit = d.attrs["pixel"], d.attrs["unit"]',
    ];
    if (isFour)
      lines.push(
        '    # py4DSTEM: one run and depth as a data cube (x, y, kx, ky)',
        '    import py4DSTEM',
        '    dc = py4DSTEM.DataCube(data=data[0, 0])',
        '    dc.calibration.set_R_pixel_size(d.attrs["scan_pixel_A"][0]); dc.calibration.set_R_pixel_units("A")',
        '    dc.calibration.set_Q_pixel_size(pixel[0]); dc.calibration.set_Q_pixel_units("mrad")',
      );
    else lines.push('    # a frame saved as NPY: np.load("<name>.npy")');
    return lines.join('\n');
  });
</script>

<div class="pane" data-testid="result-pane">
  {#if result}
    <div class="seg" role="group" aria-label="Result">
      {#each results as r (r.name)}
        <button
          type="button"
          aria-pressed={r.name === result.name}
          onclick={() => (picked = r.name)}
          data-testid={`viewer-${r.name}`}>{r.name}</button
        >
      {/each}
    </div>
    <div class="seg" role="group" aria-label="Native or processed">
      <button
        type="button"
        aria-pressed={view === 'native'}
        onclick={() => onview?.('native')}
        title="The ideal simulation, at its native pixel"
        data-testid="view-native">Native</button
      ><button
        type="button"
        aria-pressed={view === 'processed'}
        disabled={!processed}
        onclick={() => onview?.('processed')}
        title={processed
          ? 'After the pixel size, smoothing, dose and noise of the Postprocessing card'
          : (result.processed_note ?? 'Apply the Postprocessing settings to this run first')}
        data-testid="view-processed">Processed</button
      >
    </div>

    {#if nDepth > 1}
      <label class="series" data-testid="series-depth">
        <span class="name">Thickness</span>
        <input
          type="range"
          min="0"
          max={nDepth - 1}
          step="1"
          bind:value={depth}
          aria-label="Thickness series"
          data-testid="depth-slider"
        />
        <span class="val" data-testid="depth-value"
          >{depthLabel} <small>({Math.min(depth, nDepth - 1) + 1} of {nDepth})</small></span
        >
      </label>
    {/if}
    {#if nRun > 1}
      <label class="series" data-testid="series-run">
        <span class="name">{runTitle}</span>
        <input
          type="range"
          min="0"
          max={nRun - 1}
          step="1"
          bind:value={run}
          aria-label={`${runTitle} series`}
          data-testid="run-slider"
        />
        <span class="val" data-testid="run-value"
          >{runLabel} <small>({Math.min(run, nRun - 1) + 1} of {nRun})</small></span
        >
      </label>
    {/if}
    {#if nSample > 1}
      <label class="series">
        <span class="name">Noise sample</span>
        <input
          type="range"
          min="0"
          max={nSample - 1}
          step="1"
          bind:value={sample}
          aria-label="Noise sample"
        />
        <span class="val">{Math.min(sample, nSample - 1) + 1} of {nSample}</span>
      </label>
    {/if}
    {#if isWave}
      <div class="seg" role="group" aria-label="Exit wave part">
        {#each ['phase', 'amplitude'] as p (p)}
          <button type="button" aria-pressed={part === p} onclick={() => (part = p as typeof part)}
            >{p === 'phase' ? 'Phase' : 'Amplitude'}</button
          >
        {/each}
      </div>
    {/if}
    {#if isDiscs}
      <div class="beam" data-testid="beam-choice">
        <span class="name">Beam</span>
        {#each ['h', 'k', 'l'] as ax (ax)}
          <NumberField
            label={ax}
            bind:value={hkl[ax as 'h' | 'k' | 'l']}
            min={beamRange?.[ax as 'h' | 'k' | 'l'][0] ?? -20}
            max={beamRange?.[ax as 'h' | 'k' | 'l'][1] ?? 20}
            step={1}
            digits={0}
            unit={beamRange
              ? `${beamRange[ax as 'h' | 'k' | 'l'][0]} … ${beamRange[ax as 'h' | 'k' | 'l'][1]}`
              : ''}
            def={0}
            testid={`beam-${ax}`}
          />
        {/each}
        {#if validBeam}
          <p class="muted small" data-testid="beam-status">
            Disc {hkl.h}
            {hkl.k}
            {hkl.l}{beamList ? ` · ${beamList.hkl.length} beams in this run` : ''}.
          </p>
        {:else}
          <p class="err" data-testid="beam-status">
            {hkl.h}
            {hkl.k}
            {hkl.l} is not a beam of this run (h {beamRange?.h[0]} … {beamRange?.h[1]}, k {beamRange
              ?.k[0]} … {beamRange?.k[1]}, l {beamRange?.l[0]} … {beamRange?.l[1]}; not every
            combination is a beam).
          </p>
        {/if}
      </div>
    {/if}

    {#if isSpots}
      <label class="check"
        ><input type="checkbox" bind:checked={showIndices} /> Miller indices</label
      >
    {:else}
      <div class="display">
        <label
          >Colour map
          <select bind:value={cmap} data-testid="cmap">
            {#each COLORMAPS as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
          </select>
        </label>
        <div class="seg" role="group" aria-label="Intensity scale">
          {#each [['linear', 'Linear'], ['log', 'Log'], ['power', 'Power']] as [id, text] (id)}
            <button
              type="button"
              aria-pressed={mode === id}
              onclick={() => (mode = id as ScaleMode)}
              data-testid={`scale-${id}`}>{text}</button
            >
          {/each}
        </div>
        <label class="check"
          ><input type="checkbox" bind:checked={invert} data-testid="invert" /> Invert</label
        >
      </div>
      <div class="range">
        {#if mode === 'power'}
          <NumberField label="γ" bind:value={gamma} min={0.05} max={5} step={0.05} def={0.5} />
        {/if}
        <NumberField
          label="vmin"
          bind:value={() => vmin ?? autoMin, setMin}
          def={autoMin}
          step={Math.max(Math.abs(autoMax - autoMin) / 100, 1e-12)}
          help="The value shown as the darkest colour. Automatic: the frame's minimum."
          testid="vmin"
        />
        <NumberField
          label="vmax"
          bind:value={() => vmax ?? autoMax, setMax}
          def={autoMax}
          step={Math.max(Math.abs(autoMax - autoMin) / 100, 1e-12)}
          help="The value shown as the brightest colour. Automatic: the frame's maximum."
          testid="vmax"
        />
      </div>
    {/if}

    {#if isFour}
      <div class="detector" data-testid="virtual-detector">
        <h4>Virtual detector</h4>
        <div class="seg" role="group" aria-label="Detector shape">
          <button
            type="button"
            aria-pressed={det.shape === 'disk'}
            onclick={() => setShape('disk')}
            data-testid="det-disk">Disk</button
          ><button
            type="button"
            aria-pressed={det.shape === 'annulus'}
            onclick={() => setShape('annulus')}
            data-testid="det-annulus">Annulus</button
          >
        </div>
        {#if det.shape === 'annulus'}
          <NumberField
            label="Inner"
            bind:value={det.inner}
            unit="mrad"
            min={0}
            max={reach}
            step={0.5}
            digits={1}
            slider
            sliderMax={reach}
            testid="det-inner"
          />
        {/if}
        <NumberField
          label="Outer"
          bind:value={det.outer}
          unit="mrad"
          min={0.1}
          max={reach}
          step={0.5}
          digits={1}
          slider
          sliderMax={reach}
          testid="det-outer"
        />
      </div>
      <div class="two">
        <div>
          <p class="cap">Virtual image{pos ? '' : ' · click a pixel'}</p>
          <ImageCanvas
            bind:this={mainCanvas}
            {frame}
            {scale}
            {cmap}
            {invert}
            tool="pick"
            marker={pos}
            onhover={(h) => (hover = h)}
            onpick={(col, row) => (pos = { row, col })}
            height="18rem"
            testid="result-canvas"
            {url}
          />
        </div>
        <div>
          <p class="cap">
            Diffraction pattern · {pos ? `pixel ${pos.col}, ${pos.row}` : 'mean of the scan'}
          </p>
          <ImageCanvas
            bind:this={patternCanvas}
            frame={pattern}
            scale={{ mode: 'log', gamma, vmin: null, vmax: null }}
            cmap="inferno"
            {circles}
            height="18rem"
            testid="pattern-canvas"
            url={base
              ? `pattern:${base.run}:${base.depth}:${pos?.row ?? ''}:${pos?.col ?? ''}`
              : ''}
          />
        </div>
      </div>
    {:else if isSpots}
      <SpotsCanvas bind:this={spotsCanvas} {spots} indices={showIndices} testid="result-canvas" />
    {:else}
      <ImageCanvas
        bind:this={mainCanvas}
        {frame}
        {scale}
        {cmap}
        {invert}
        onhover={(h) => (hover = h)}
        testid="result-canvas"
        {url}
      />
    {/if}

    {#if error}<p class="err" data-testid="viewer-error">{error}</p>{/if}
    <p class="muted small readout" data-testid="readout">
      {#if hover && frame}
        {#if frame.pixel}x {fmt(hover.col * frame.pixel[0])}, y {fmt(hover.row * frame.pixel[1])}
          {frame.unit} ·
        {/if}pixel {hover.col}, {hover.row} · value {fmt(hover.value)}
      {:else if frame}
        {frame.shape[1]} × {frame.shape[0]} pixels{frame.pixel
          ? ` · pixel ${fmt(frame.pixel[0])}${frame.pixel[1] !== frame.pixel[0] ? ` × ${fmt(frame.pixel[1])}` : ''} ${frame.unit}`
          : ''} · range {fmt(frame.min)} to {fmt(frame.max)}
      {:else if spots}
        {spots.qxy.length} beams{spots.depth ? ` at ${+spots.depth.toFixed(1)} Å` : ''}
      {/if}
    </p>

    <p class="muted small" data-testid="viewer-shape">
      {job.name} · {result.kind} · {shapeText(result)} · {formatBytes(result.bytes)}
    </p>
    {#if view === 'processed' && processed}
      <p class="muted small" data-testid="viewer-processed-info">
        Processed: {processed.shape.join(' × ')}{processed.pixel
          ? ` · pixel ${+processed.pixel[0].toPrecision(3)} ${processed.unit}`
          : ''}{processed.electrons !== null
          ? ` · ${+processed.electrons.toPrecision(3)} e⁻`
          : ''}{processed.samples > 1
          ? ` · sample ${Math.min(sample, nSample - 1) + 1} of ${processed.samples}`
          : ''}
      </p>
    {/if}
    {#if result.note}<p class="small">{result.note}</p>{/if}

    <div class="export" data-testid="export">
      <span class="name">Export</span>
      {#if true}
        <button
          type="button"
          disabled={saving}
          onclick={() =>
            savePng(
              isSpots ? spotsCanvas : mainCanvas,
              `${result.name}_${isFour ? 'virtual_image' : 'image'}`,
            )}
          data-testid="export-png">PNG</button
        >
        {#if isFour}
          <button
            type="button"
            disabled={saving}
            onclick={() => savePng(patternCanvas, `${result.name}_pattern`)}>Pattern PNG</button
          >
        {/if}
      {/if}
      {#if exportQ && !isSpots}
        <button
          type="button"
          disabled={saving}
          onclick={() => saveFile('tiff')}
          data-testid="export-tiff">TIFF</button
        >
        <button
          type="button"
          disabled={saving}
          onclick={() => saveFile('npy')}
          data-testid="export-npy">NPY</button
        >
      {/if}
      {#if exportQ}
        <button
          type="button"
          disabled={saving}
          onclick={() => saveFile('h5')}
          data-testid="export-h5">HDF5{isFour ? ' (all of it)' : ''}</button
        >
      {/if}
    </div>
    {#if saved}
      <p class="small saved" data-testid="export-saved">
        Saved <b>{saved.name}</b> in the run's Exports folder.
        <button type="button" class="link" onclick={() => openJobFolder(job.id, true)}
          >Open the folder</button
        >
      </p>
    {:else}
      <p class="muted small">Exports are saved in this run's <b>Exports</b> folder.</p>
    {/if}
    {#if isFour}
      <p class="muted small">
        TIFF and NPY of 4D-STEM are the mean pattern; HDF5 holds the whole 4D array with its
        calibration.
      </p>
    {/if}
    <details>
      <summary>Load the export in Python</summary>
      <pre data-testid="snippet">{snippet}</pre>
    </details>
  {:else}
    <p class="muted">This run has no results to show.</p>
  {/if}
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.8rem;
  }
  .err {
    color: var(--err);
    font-size: 0.82rem;
  }
  .saved {
    color: var(--ok);
  }
  .link {
    font: inherit;
    border: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  .series {
    display: grid;
    grid-template-columns: 5.5rem 1fr minmax(8rem, max-content);
    align-items: center;
    gap: 0.6rem;
    font-size: 0.84rem;
  }
  .series input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .name {
    color: var(--text-h);
    font-weight: 600;
    font-size: 0.82rem;
  }
  .val {
    font-variant-numeric: tabular-nums;
  }
  .val small {
    color: var(--muted);
  }
  .display {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
    font-size: 0.82rem;
  }
  .display label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .beam {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .range {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
  }
  select {
    font: inherit;
    padding: 0.15rem 0.3rem;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-h);
  }
  .detector {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem 0.7rem;
    background: var(--surface-2);
    border-radius: 8px;
  }
  h4 {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-h);
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.6rem;
  }
  .cap {
    font-size: 0.78rem;
    color: var(--muted);
    margin-bottom: 0.2rem;
  }
  .readout {
    min-height: 1.2em;
    font-variant-numeric: tabular-nums;
  }
  .export {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .export button {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.2rem 0.65rem;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-h);
    cursor: pointer;
  }
  .export button:hover:not(:disabled) {
    background: var(--accent-soft);
  }
  details {
    font-size: 0.8rem;
  }
  pre {
    margin: 0.3rem 0 0;
    padding: 0.5rem 0.6rem;
    background: var(--surface-2);
    border-radius: 6px;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 0.74rem;
  }
</style>
