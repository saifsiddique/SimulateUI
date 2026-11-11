<script lang="ts">
  // A frame on a canvas (context.md M7): colour map, intensity scale and its vmin / vmax, zoom
  // (wheel) and pan (drag), a scale bar in the frame's unit, a value readout, a pick tool (click a
  // pixel) and circles for detectors. The numbers stay in the browser, so changing the scale or the
  // colour map never asks the backend for anything.
  //
  // Speed: the picture of the frame is rebuilt only when the frame, the scale, the colour map or
  // `invert` change (one pass over the pixels through a 32-bit view); zooming and panning only
  // redraw that picture, at most once per animation frame, and the view state is kept outside
  // Svelte's reactivity so that a pointer move does not re-run anything but the drawing.
  import type { Frame } from '../api/client';
  import {
    barLabel,
    niceLength,
    toRgba,
    type ColormapName,
    type ScaleOptions,
  } from '../plots/colormap';

  export interface Circle {
    /** The centre in pixel coordinates (the centre of pixel (c, r) is (c + 0.5, r + 0.5)). */
    col: number;
    row: number;
    /** Radius in the frame's unit. */
    radius: number;
    color: string;
  }
  export type Tool = 'pan' | 'pick';
  export interface Hover {
    col: number;
    row: number;
    value: number;
  }

  let {
    frame,
    scale,
    cmap,
    invert = false,
    tool = 'pan',
    circles = [],
    marker = null,
    onhover,
    onpick,
    height = '24rem',
    testid = 'result-canvas',
    url = '',
  }: {
    frame: Frame | null;
    scale: ScaleOptions;
    cmap: ColormapName;
    invert?: boolean;
    tool?: Tool;
    circles?: Circle[];
    marker?: { col: number; row: number } | null;
    onhover?: (h: Hover | null) => void;
    onpick?: (col: number, row: number) => void;
    height?: string;
    testid?: string;
    /** Where the frame came from (shown as an attribute: what a test reads). */
    url?: string;
  } = $props();

  let box: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();

  // the view: plain variables, not state (see the note at the top)
  let width = 300;
  let heightPx = 300;
  let zoom = 1; // screen pixels per unit length
  let ox = 0;
  let oy = 0;
  let fitted = '';
  let image: HTMLCanvasElement | null = null;
  let raf = 0;
  let lastHover = '';

  const px = () => frame?.pixel?.[0] ?? 1;
  const py = () => frame?.pixel?.[1] ?? 1;
  const w = () => frame?.shape[1] ?? 0; // columns
  const h = () => frame?.shape[0] ?? 0; // rows
  const unit = () => (frame?.pixel ? frame.unit : 'px');

  function fit(): void {
    if (!frame) return;
    const s = Math.min(width / (w() * px()), heightPx / (h() * py())) * 0.98;
    zoom = s;
    ox = (width - w() * px() * s) / 2;
    oy = (heightPx - h() * py() * s) / 2;
  }

  function schedule(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  const toScreen = (c: number, r: number): [number, number] => [
    ox + c * px() * zoom,
    oy + r * py() * zoom,
  ];
  const toPixel = (sx: number, sy: number): [number, number] => [
    (sx - ox) / (px() * zoom),
    (sy - oy) / (py() * zoom),
  ];

  function drawBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pxPerUnit: number,
    maxLen: number,
  ): void {
    if (!frame?.pixel) return;
    const len = niceLength(maxLen / pxPerUnit);
    const wpx = len * pxPerUnit;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + wpx, y);
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#fff';
    const label = barLabel(len, unit());
    ctx.strokeText(label, x, y - 6);
    ctx.fillText(label, x, y - 6);
    ctx.restore();
  }

  function draw(): void {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / heightPx, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, heightPx);
    if (!frame || !image) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, ox, oy, w() * px() * zoom, h() * py() * zoom);
    for (const c of circles) {
      const [sx, sy] = toScreen(c.col, c.row);
      ctx.beginPath();
      ctx.arc(sx, sy, c.radius * zoom, 0, Math.PI * 2);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (marker) {
      const [sx, sy] = toScreen(marker.col + 0.5, marker.row + 0.5);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      const bw = px() * zoom;
      const bh = py() * zoom;
      ctx.strokeRect(sx - bw / 2 - 2, sy - bh / 2 - 2, bw + 4, bh + 4);
    }
    drawBar(ctx, 14, heightPx - 14, zoom, width * 0.22);
  }

  // The picture: rebuilt when the frame, the scale (mode, γ, vmin, vmax), the colour map or the
  // inversion change, and then drawn.
  $effect(() => {
    const f = frame;
    const o: ScaleOptions = {
      mode: scale.mode,
      gamma: scale.gamma,
      vmin: scale.vmin,
      vmax: scale.vmax,
    };
    const map = cmap;
    const inv = invert;
    if (!f) {
      image = null;
      schedule();
      return;
    }
    const c = document.createElement('canvas');
    c.width = f.shape[1];
    c.height = f.shape[0];
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const rgba = toRgba(f.values, o, map, inv, { min: f.min, max: f.max });
    ctx.putImageData(
      new ImageData(rgba as unknown as Uint8ClampedArray<ArrayBuffer>, f.shape[1], f.shape[0]),
      0,
      0,
    );
    image = c;
    // a new shape (another result, another binning) is fitted again; a new frame of the same
    // shape (a slider) keeps the zoom
    const key = `${f.shape[1]}x${f.shape[0]}:${f.pixel?.[0]}:${f.pixel?.[1]}`;
    if (key !== fitted) {
      fitted = key;
      fit();
    }
    schedule();
  });

  // detector circles and the marker
  $effect(() => {
    void circles;
    void marker;
    schedule();
  });

  $effect(() => {
    if (!box || !canvas) return;
    const el = box;
    const cv = canvas;
    const ro = new ResizeObserver(() => {
      width = Math.max(120, Math.round(el.clientWidth));
      heightPx = Math.max(120, Math.round(el.clientHeight));
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(heightPx * dpr);
      cv.style.width = `${width}px`;
      cv.style.height = `${heightPx}px`;
      fitted = '';
      if (frame) {
        fitted = `${w()}x${h()}:${frame.pixel?.[0]}:${frame.pixel?.[1]}`;
        fit();
      }
      schedule();
    });
    ro.observe(el);
    cv.addEventListener('wheel', onWheel, { passive: false }); // preventDefault needs a non-passive listener
    return () => {
      cv.removeEventListener('wheel', onWheel);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  });

  // ---- pointer ---------------------------------------------------------------------------------

  let drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;

  function local(e: PointerEvent | WheelEvent): [number, number] {
    const r = canvas!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onDown(e: PointerEvent): void {
    if (!frame) return;
    const [x, y] = local(e);
    canvas!.setPointerCapture(e.pointerId);
    drag = { x, y, ox, oy, moved: false };
  }

  function onMove(e: PointerEvent): void {
    if (!frame) return;
    const [x, y] = local(e);
    if (drag) {
      if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
      if (drag.moved) {
        ox = drag.ox + (x - drag.x);
        oy = drag.oy + (y - drag.y);
        schedule();
      }
    }
    const p = toPixel(x, y);
    const col = Math.floor(p[0]);
    const row = Math.floor(p[1]);
    const key = `${col},${row}`;
    if (key === lastHover) return; // the readout only changes with the pixel
    lastHover = key;
    onhover?.(
      col >= 0 && col < w() && row >= 0 && row < h()
        ? { col, row, value: frame.values[row * w() + col] }
        : null,
    );
  }

  function onUp(e: PointerEvent): void {
    if (!drag || !frame) return;
    const [x, y] = local(e);
    if (tool === 'pick' && !drag.moved) {
      const p = toPixel(x, y);
      const col = Math.floor(p[0]);
      const row = Math.floor(p[1]);
      if (col >= 0 && col < w() && row >= 0 && row < h()) onpick?.(col, row);
    }
    drag = null;
  }

  function onWheel(e: WheelEvent): void {
    if (!frame) return;
    e.preventDefault();
    const [x, y] = local(e);
    const f = Math.pow(1.0015, -e.deltaY);
    const next = Math.min(Math.max(zoom * f, 0.05), 400);
    const k = next / zoom;
    ox = x - (x - ox) * k;
    oy = y - (y - oy) * k;
    zoom = next;
    schedule();
  }

  /** The current view as a PNG: the part of the picture that is on the screen (the zoom and pan as
   *  they are), with its scale bar, every pixel a square of at least 1024 px on the long side.
   *  Null when there is no frame. */
  export function exportPng(): Promise<Blob | null> {
    if (!frame || !image) return Promise.resolve(null);
    const [a0, b0] = toPixel(0, 0);
    const [a1, b1] = toPixel(width, heightPx);
    const c0 = Math.max(0, Math.min(w(), a0));
    const r0 = Math.max(0, Math.min(h(), b0));
    const sw = Math.max(1, Math.min(w(), a1) - c0);
    const sh = Math.max(1, Math.min(h(), b1) - r0);
    const fine = Math.min(px(), py());
    const lw = sw * (px() / fine);
    const lh = sh * (py() / fine);
    const up = Math.max(1, Math.ceil(1024 / Math.max(lw, lh)));
    const cw = Math.max(1, Math.round(lw * up));
    const ch = Math.max(1, Math.round(lh * up));
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, c0, r0, sw, sh, 0, 0, cw, ch);
    drawBar(ctx, cw * 0.03, ch * 0.96, cw / (sw * px()), cw * 0.22);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  export function resetView(): void {
    fit();
    schedule();
  }
</script>

<div
  class="canvas-box"
  style:height
  bind:this={box}
  data-testid={testid}
  data-frame-url={url}
  data-frame-shape={frame ? `${frame.shape[1]}x${frame.shape[0]}` : ''}
>
  <canvas
    bind:this={canvas}
    style:cursor={tool === 'pick' ? 'crosshair' : 'grab'}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointerleave={() => {
      lastHover = '';
      onhover?.(null);
    }}
    ondblclick={resetView}
    aria-label="Result image"
  ></canvas>
</div>

<style>
  .canvas-box {
    position: relative;
    background: #000;
    border-radius: 6px;
    overflow: hidden;
    min-width: 0;
    touch-action: none;
  }
  canvas {
    display: block;
  }
</style>
