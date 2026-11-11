<script lang="ts">
  // The spots of a Bloch SAED (context.md M7): a disc at every beam, its area following the
  // intensity, with the Miller indices on request. Same orientation as the saved picture (x mirrored).
  import type { SpotsReply } from '../api/client';
  import { barLabel, niceLength } from '../plots/colormap';

  let {
    spots,
    indices = true,
    height = '24rem',
    testid = 'spots-canvas',
  }: { spots: SpotsReply | null; indices?: boolean; height?: string; testid?: string } = $props();

  let box = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let width = $state(300);
  let heightPx = $state(300);

  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => {
      if (!box) return;
      width = Math.max(120, Math.round(box.clientWidth));
      heightPx = Math.max(120, Math.round(box.clientHeight));
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  /** The pattern as a PNG, as drawn. */
  export function exportPng(): Promise<Blob | null> {
    return new Promise((res) => (canvas ? canvas.toBlob(res, 'image/png') : res(null)));
  }

  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(heightPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, heightPx);
    if (!spots || spots.qxy.length === 0) return;
    const reach = Math.max(1e-6, ...spots.qxy.map(([x, y]) => Math.hypot(x, y)));
    const s = (Math.min(width, heightPx) / 2 - 24) / reach; // pixels per Å⁻¹
    const top = Math.max(1e-30, ...spots.intensity);
    const cx = width / 2;
    const cy = heightPx / 2;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    spots.qxy.forEach(([qx, qy], i) => {
      const f = Math.sqrt(Math.max(0, spots.intensity[i]) / top);
      const r = 1.5 + 11 * f;
      const x = cx - qx * s;
      const y = cy - qy * s;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      if (indices && f > 0.12) {
        ctx.fillStyle = '#facc15';
        ctx.fillText(spots.hkl[i].join(' '), x + r + 2, y);
      }
    });
    // scale bar
    const len = niceLength((width * 0.2) / s);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(14, heightPx - 14);
    ctx.lineTo(14 + len * s, heightPx - 14);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'bottom';
    ctx.fillText(barLabel(len, spots.unit), 14, heightPx - 20);
  });
</script>

<div
  class="box"
  style:height
  bind:this={box}
  data-testid={testid}
  data-spots={spots?.qxy.length ?? 0}
>
  <canvas bind:this={canvas} style:width="{width}px" style:height="{heightPx}px" aria-label="Spots"
  ></canvas>
</div>

<style>
  .box {
    background: #000;
    border-radius: 6px;
    overflow: hidden;
    min-width: 0;
  }
  canvas {
    display: block;
  }
</style>
