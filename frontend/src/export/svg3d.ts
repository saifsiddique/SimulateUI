/**
 * Vector (SVG) export of the 3D structure view (context.md M12).
 *
 * The viewer hands over what it shows as plain numbers in screen pixels (`SvgScene`): atoms as
 * discs, bonds as half-sticks, the cell edges, the polyhedra, the axes triad, atom labels and the
 * legend, each with its distance from the camera. Everything is drawn back to front (the painter's
 * algorithm) as editable vector art: atoms are circles with a radial-gradient "ball" shading (a
 * flat fill with an outline in toon mode), bonds are straight strokes as wide as the stick, the
 * cell is a set of lines. No DOM: the output is a string.
 */
import type { LegendEntry } from '../core/structure/legend';

export interface SvgAtom {
  /** Index in the model, to find its label. */
  index: number;
  x: number;
  y: number;
  /** Radius in pixels. */
  r: number;
  /** Distance from the camera: larger is farther. */
  depth: number;
  /** '#rrggbb'. */
  color: string;
}

export interface SvgSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  depth: number;
  color: string;
  /** Stroke width in pixels. */
  width: number;
}

export interface SvgTriangle {
  /** x0 y0 x1 y1 x2 y2. */
  pts: [number, number, number, number, number, number];
  depth: number;
  color: string;
}

export interface SvgAxis {
  /** End of the arrow relative to the triad centre, pixels (y down). */
  dx: number;
  dy: number;
  depth: number;
  name: string;
  color: string;
}

export interface SvgScene {
  width: number;
  height: number;
  /** '#rrggbb' of the background, painted unless `transparent`. */
  background: string;
  toon: boolean;
  atoms: SvgAtom[];
  /** Half-bonds: each runs from an atom centre to the middle of its bond. */
  bonds: SvgSegment[];
  cell: SvgSegment[];
  polyhedra: { triangles: SvgTriangle[]; opacity: number; edges: SvgSegment[] };
  /** Axes triad, or null when it is off. */
  triad: { cx: number; cy: number; axes: SvgAxis[] } | null;
  /** Text above atoms, by model index (empty when labels are off). */
  labels: Map<number, string>;
  legend: LegendEntry[];
}

export interface SvgOptions {
  transparent?: boolean;
}

/** Label texts by atom index, for the atoms that are visible and have a text. */
export function labelMap(
  texts: readonly string[],
  visible: ArrayLike<number>,
): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i < texts.length; i++) if (texts[i] && visible[i]) out.set(i, texts[i]);
  return out;
}

const round = (x: number): string => String(Math.round(x * 100) / 100);

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (c: readonly number[]): string =>
  '#' +
  c
    .map((x) =>
      Math.round(Math.min(255, Math.max(0, x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

/** Mix a colour with white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const c = parseHex(hex);
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  return toHex(c.map((x) => x + (target - x) * k));
}

const gradientId = (hex: string): string => 'ball-' + hex.replace('#', '').toLowerCase();

function gradient(hex: string): string {
  const id = gradientId(hex);
  return (
    `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" fx="0.34" fy="0.3">` +
    `<stop offset="0" stop-color="${shade(hex, 0.62)}"/>` +
    `<stop offset="0.45" stop-color="${hex}"/>` +
    `<stop offset="1" stop-color="${shade(hex, -0.45)}"/></radialGradient>`
  );
}

interface Drawable {
  depth: number;
  svg: string;
}

/** Legend sizes in CSS pixels, as on the screen (the PNG export uses them too). */
export const LEGEND = { font: 15, row: 24, ball: 9, margin: 12 } as const;
const LEGEND_FONT = LEGEND.font;
const LEGEND_ROW = LEGEND.row;
const LEGEND_BALL = LEGEND.ball;
const CHAR_WIDTH = 0.6 * LEGEND_FONT;

/** The structure as an SVG document. */
export function buildStructureSvg(scene: SvgScene, options: SvgOptions = {}): string {
  const { width, height } = scene;
  const outline = scene.toon
    ? ' stroke="#000000" stroke-opacity="0.75" stroke-width="1"'
    : ' stroke="#000000" stroke-opacity="0.22" stroke-width="0.6"';
  const colours = new Set<string>();
  const items: Drawable[] = [];

  const ball = (cx: number, cy: number, r: number, color: string): string => {
    colours.add(color.toLowerCase());
    const fill = scene.toon ? color : `url(#${gradientId(color.toLowerCase())})`;
    return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${fill}"${outline}/>`;
  };
  const line = (s: SvgSegment, cap: 'butt' | 'round'): string =>
    `<line x1="${round(s.x1)}" y1="${round(s.y1)}" x2="${round(s.x2)}" y2="${round(s.y2)}" ` +
    `stroke="${s.color}" stroke-width="${round(s.width)}" stroke-linecap="${cap}"/>`;

  for (const s of scene.cell) items.push({ depth: s.depth, svg: line(s, 'round') });
  for (const b of scene.bonds) items.push({ depth: b.depth, svg: line(b, 'butt') });
  for (const a of scene.atoms) items.push({ depth: a.depth, svg: ball(a.x, a.y, a.r, a.color) });
  for (const t of scene.polyhedra.triangles) {
    const p = t.pts.map(round);
    items.push({
      depth: t.depth,
      svg:
        `<polygon points="${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}" fill="${t.color}" ` +
        `fill-opacity="${round(scene.polyhedra.opacity)}" stroke="none"/>`,
    });
  }
  for (const e of scene.polyhedra.edges) items.push({ depth: e.depth, svg: line(e, 'round') });

  // far first; the sort is stable, so equal depths keep their order
  items.sort((a, b) => b.depth - a.depth);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
      `font-family="system-ui, -apple-system, 'Segoe UI', Arial, sans-serif">`,
  );
  out.push('<title>Crystal structure</title>');
  const defsAt = out.length;
  out.push('');
  if (!options.transparent)
    out.push(`<rect width="${width}" height="${height}" fill="${scene.background}"/>`);
  out.push('<g id="structure">');
  for (const it of items) out.push(it.svg);
  out.push('</g>');

  if (scene.labels.size > 0) {
    out.push(
      '<g id="atom-labels" font-size="11" text-anchor="middle" fill="#1b1d24" stroke="#ffffff" ' +
        'stroke-width="3" stroke-linejoin="round" paint-order="stroke">',
    );
    for (const a of scene.atoms) {
      const text = scene.labels.get(a.index);
      if (text) out.push(`<text x="${round(a.x)}" y="${round(a.y - 2)}">${escapeXml(text)}</text>`);
    }
    out.push('</g>');
  }

  if (scene.triad) {
    out.push('<g id="axes" font-size="12" font-weight="600">');
    const { cx, cy } = scene.triad;
    for (const ax of [...scene.triad.axes].sort((a, b) => b.depth - a.depth)) {
      const x2 = cx + ax.dx;
      const y2 = cy + ax.dy;
      out.push(
        `<line x1="${round(cx)}" y1="${round(cy)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${ax.color}" stroke-width="2" stroke-linecap="round"/>`,
      );
      const len = Math.hypot(ax.dx, ax.dy);
      if (len > 6) {
        // arrow head: a small triangle on the tip
        const ux = ax.dx / len;
        const uy = ax.dy / len;
        const hx = x2 - ux * 7;
        const hy = y2 - uy * 7;
        out.push(
          `<polygon points="${round(x2)},${round(y2)} ${round(hx - uy * 3.2)},${round(hy + ux * 3.2)} ${round(hx + uy * 3.2)},${round(hy - ux * 3.2)}" fill="${ax.color}"/>`,
        );
      }
      const lx = cx + ax.dx * 1.28 + (len > 0 ? (ax.dx / len) * 4 : 0);
      const ly = cy + ax.dy * 1.28 + (len > 0 ? (ax.dy / len) * 4 : 0) + 4;
      out.push(
        `<text x="${round(lx)}" y="${round(ly)}" text-anchor="middle" font-style="italic" fill="${ax.color}">${escapeXml(ax.name)}</text>`,
      );
    }
    out.push('</g>');
  }

  if (scene.legend.length > 0) {
    out.push(`<g id="legend" font-size="${LEGEND_FONT}" fill="#27304a">`);
    const margin = LEGEND.margin;
    scene.legend.forEach((entry, k) => {
      const fromBottom = scene.legend.length - 1 - k;
      const y = height - margin - LEGEND_ROW / 2 - fromBottom * LEGEND_ROW;
      const textWidth = entry.label.length * CHAR_WIDTH;
      const left = width - margin - textWidth - 2 * LEGEND_BALL - 7;
      out.push(ball(left + LEGEND_BALL, y, LEGEND_BALL, entry.color));
      out.push(
        `<text x="${round(left + 2 * LEGEND_BALL + 7)}" y="${round(y + LEGEND_FONT * 0.35)}">${escapeXml(entry.label)}</text>`,
      );
    });
    out.push('</g>');
  }

  out.push('</svg>');
  if (!scene.toon && colours.size > 0)
    out[defsAt] = `<defs>${[...colours].sort().map(gradient).join('')}</defs>`;
  return out.filter((s) => s !== '').join('\n') + '\n';
}
