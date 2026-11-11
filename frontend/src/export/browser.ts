/**
 * The browser side of the export (context.md M12): downloads, the clipboard, turning an on-page SVG
 * into a stand-alone file, rasterising it at a chosen resolution and PNG output. The pure parts
 * (the PNG resolution chunk, the raster size, the SVG and text builders) live in their own modules.
 */
import type { LegendEntry } from '../core/structure/legend';
import { setPngDpi } from './png';
import { LEGEND, shade } from './svg3d';

/** CSS pixels per inch: how a screen size becomes a size on paper. */
export const CSS_DPI = 96;
/** The longest side of an exported bitmap, pixels (canvas and WebGL limits). */
export const MAX_SIDE = 8192;

export interface RasterPlan {
  /** Output scale against CSS pixels. */
  scale: number;
  pxW: number;
  pxH: number;
  /** The resolution the file states: the requested one unless the size limit cut it. */
  dpi: number;
  limited: boolean;
}

/** Pixel size of a w × h CSS-pixel view exported at `dpi` (96 CSS pixels are one inch). */
export function rasterPlan(
  cssW: number,
  cssH: number,
  dpi: number,
  maxSide = MAX_SIDE,
): RasterPlan {
  let scale = dpi / CSS_DPI;
  let limited = false;
  const longest = Math.max(cssW, cssH) * scale;
  if (longest > maxSide) {
    scale = maxSide / Math.max(cssW, cssH);
    limited = true;
  }
  return {
    scale,
    pxW: Math.max(1, Math.round(cssW * scale)),
    pxH: Math.max(1, Math.round(cssH * scale)),
    dpi: scale * CSS_DPI,
    limited,
  };
}

/** A file-name stem from a crystal or title: letters, digits, dot, dash and underscore only. */
export function safeName(name: string, fallback = 'structure'): string {
  const stem = name
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return stem || fallback;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const downloadText = (text: string, filename: string, mime = 'text/plain'): void =>
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText)
    throw new Error('This browser does not allow copying to the clipboard here.');
  await navigator.clipboard.writeText(text);
}

export async function copyImage(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
    throw new Error('This browser cannot copy images to the clipboard.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** The canvas as a PNG file that states its resolution. */
export async function canvasToPng(canvas: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not make the PNG.');
  const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([bytes as BlobPart], { type: 'image/png' });
}

// ---- SVG already on the page ---------------------------------------------------------------------

/** What an element's look needs when it is no longer styled by the page's style sheet. */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'opacity',
];

/**
 * A stand-alone SVG file from an SVG on the page: the style sheet's rules are written into each
 * styled element, page-only attributes are dropped, and the background is set: a rectangle of
 * `background` behind everything, or none when `transparent`. Elements marked `data-export-bg`
 * (the page's own background rectangle) are replaced by it.
 */
export function serializeSvg(
  svg: SVGSVGElement,
  options: { transparent: boolean; background: string },
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < from.length; i++) {
    const el = from[i];
    const out = to[i];
    if (el !== svg && !el.hasAttribute('class')) continue;
    const cs = getComputedStyle(el);
    const css = STYLE_PROPS.filter((p) => cs.getPropertyValue(p) !== '')
      .map((p) => `${p}:${cs.getPropertyValue(p)}`)
      .join(';');
    if (el === svg) out.setAttribute('style', `font-family:${cs.fontFamily}`);
    else out.setAttribute('style', css);
    out.removeAttribute('class');
  }
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    el.removeAttribute('data-testid');
    el.removeAttribute('tabindex');
  }
  clone.querySelectorAll('[data-export-bg]').forEach((e) => e.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const { w, h } = svgSize(svg);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (!options.transparent) {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', String(w));
    bg.setAttribute('height', String(h));
    bg.setAttribute('fill', options.background);
    clone.insertBefore(bg, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone) + '\n';
}

/** Size in CSS pixels of an SVG on the page. */
export function svgSize(svg: SVGSVGElement): { w: number; h: number } {
  const box = svg.viewBox.baseVal;
  const w = svg.width.baseVal.value || box?.width || svg.getBoundingClientRect().width;
  const h = svg.height.baseVal.value || box?.height || svg.getBoundingClientRect().height;
  return { w, h };
}

/** Draw SVG text onto a canvas of `plan.pxW` × `plan.pxH` pixels (vector-sharp at that size). */
export async function svgToCanvas(svgText: string, plan: RasterPlan): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The browser could not draw the SVG.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = plan.pxW;
    canvas.height = plan.pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas available.');
    ctx.drawImage(img, 0, 0, plan.pxW, plan.pxH);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- the structure view's overlays on a canvas ---------------------------------------------------

/** The legend as the page shows it (balls and names, bottom right), painted in CSS-pixel units. */
export function paintLegend(
  ctx: CanvasRenderingContext2D,
  entries: readonly LegendEntry[],
  width: number,
  height: number,
  ink = '#27304a',
): void {
  const { font, row, ball, margin } = LEGEND;
  ctx.save();
  ctx.font = `${font}px system-ui, -apple-system, 'Segoe UI', Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  entries.forEach((e, k) => {
    const y = height - margin - row / 2 - (entries.length - 1 - k) * row;
    const textWidth = ctx.measureText(e.label).width;
    const left = width - margin - textWidth - 2 * ball - 7;
    const cx = left + ball;
    const g = ctx.createRadialGradient(cx - 0.32 * ball, y - 0.4 * ball, 0, cx, y, ball);
    g.addColorStop(0, shade(e.color, 0.62));
    g.addColorStop(0.45, e.color);
    g.addColorStop(1, shade(e.color, -0.45));
    ctx.beginPath();
    ctx.arc(cx, y, ball, 0, 2 * Math.PI);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillText(e.label, left + 2 * ball + 7, y);
  });
  ctx.restore();
}
