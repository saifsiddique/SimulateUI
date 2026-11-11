/**
 * The rows of the Export menus (context.md M12): what each view can save or copy. A row is one
 * format with a Save and (for images) a Copy action; each returns a short message for the status
 * line and throws an Error the menu shows. The builders here are shared by the three tabs: every
 * view panel has an image menu (PNG, SVG), the Structure Viewer's ribbon a structure-file menu.
 */
import { toP1Structure, writeCif } from '../core/cif';
import type { Crystal } from '../core/crystal';
import type { Appearance, LegendEntry, Range, StructureModel } from '../core/structure';
import type { StructureView } from '../render/structureView';
import {
  canvasToPng,
  copyImage,
  copyText,
  downloadBlob,
  downloadText,
  rasterPlan,
  serializeSvg,
  svgSize,
  svgToCanvas,
} from './browser';
import { buildStructureSvg } from './svg3d';
import { viewAtoms, writeComputemXyz, writeXyz } from './xyz';

export interface ExportOptions {
  /** Resolution of PNG files (96 CSS pixels are one inch). */
  dpi: number;
  /** PNG and SVG without a background. */
  transparent: boolean;
}

export interface ExportRow {
  id: string;
  label: string;
  hint?: string;
  save: (o: ExportOptions) => Promise<string> | string;
  copy?: (o: ExportOptions) => Promise<string> | string;
}

export interface ExportSection {
  title: string;
  /** Show the DPI and transparency options (the section has PNG or SVG rows). */
  image?: boolean;
  rows: ExportRow[];
}

/** A text file: the content is made on demand and saved under `filename()` (no Copy). */
export function textRow(
  id: string,
  label: string,
  make: () => string,
  filename: () => string,
  mime = 'text/plain',
  hint?: string,
): ExportRow {
  return {
    id,
    label,
    hint,
    save: () => {
      const name = filename();
      downloadText(make(), name, mime);
      return `Saved ${name}`;
    },
  };
}

export const pngMessage = (name: string, w: number, h: number, dpi: number, limited: boolean) =>
  `Saved ${name} (${w} × ${h} px at ${Math.round(dpi)} dpi${limited ? ', the size limit lowered it' : ''})`;

type PngMaker = (o: ExportOptions) => Promise<{ blob: Blob; plan: ReturnType<typeof rasterPlan> }>;

/** The PNG and SVG rows of an image menu, from a PNG maker and an SVG-text maker. */
function imageRows(
  png: PngMaker,
  svg: (o: ExportOptions) => string,
  name: () => string,
  hints: { png: string; svg: string },
): ExportRow[] {
  return [
    {
      id: 'png',
      label: 'PNG',
      hint: hints.png,
      save: async (o) => {
        const { blob, plan } = await png(o);
        const file = `${name()}.png`;
        downloadBlob(blob, file);
        return pngMessage(file, plan.pxW, plan.pxH, plan.dpi, plan.limited);
      },
      copy: async (o) => {
        await copyImage((await png(o)).blob);
        return 'Copied the image to the clipboard';
      },
    },
    {
      id: 'svg',
      label: 'SVG',
      hint: hints.svg,
      save: (o) => {
        const file = `${name()}.svg`;
        downloadText(svg(o), file, 'image/svg+xml');
        return `Saved ${file}`;
      },
      copy: async (o) => {
        await copyText(svg(o));
        return 'Copied the SVG text to the clipboard';
      },
    },
  ];
}

/** PNG and SVG rows for an SVG element of the page (the diffraction pattern, the powder plot). */
export function svgImageRows(opts: {
  get: () => SVGSVGElement | undefined;
  /** File name without extension. */
  name: () => string;
  background?: string;
}): ExportRow[] {
  const svgOf = (): SVGSVGElement => {
    const svg = opts.get();
    if (!svg) throw new Error('There is nothing to export yet.');
    return svg;
  };
  const text = (o: ExportOptions) =>
    serializeSvg(svgOf(), { transparent: o.transparent, background: opts.background ?? '#ffffff' });
  async function png(o: ExportOptions) {
    const svg = svgOf();
    const { w, h } = svgSize(svg);
    const plan = rasterPlan(w, h, o.dpi);
    const canvas = await svgToCanvas(text(o), plan);
    return { blob: await canvasToPng(canvas, plan.dpi), plan };
  }
  return imageRows(png, text, opts.name, {
    png: 'bitmap at the DPI set above',
    svg: 'vector graphics; Copy puts the SVG text on the clipboard',
  });
}

/**
 * PNG and SVG rows for a 3D structure view. The PNG is rendered again by WebGL at the size the DPI
 * asks for, with `overlay` (atom names, legend) painted on top in CSS-pixel units; the SVG is the
 * depth-sorted vector drawing of the same scene.
 */
export function structureImageRows(opts: {
  view: () => StructureView | null;
  background: () => string;
  /** File name without extension. */
  name: () => string;
  labels?: () => Map<number, string>;
  legend?: () => LegendEntry[];
  overlay?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}): ExportRow[] {
  const viewOf = (): StructureView => {
    const v = opts.view();
    if (!v) throw new Error('There is nothing to export yet.');
    return v;
  };
  async function png(o: ExportOptions) {
    const view = viewOf();
    const { width, height } = view.size;
    const plan = rasterPlan(width, height, o.dpi);
    const gl = view.renderToCanvas(plan.pxW, plan.pxH);
    if (!gl) throw new Error('The browser could not render an image this large. Lower the DPI.');
    const out = document.createElement('canvas');
    out.width = plan.pxW;
    out.height = plan.pxH;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas available.');
    if (!o.transparent) {
      ctx.fillStyle = opts.background();
      ctx.fillRect(0, 0, plan.pxW, plan.pxH);
    }
    ctx.drawImage(gl, 0, 0);
    if (opts.overlay) {
      ctx.save();
      ctx.scale(plan.scale, plan.scale);
      opts.overlay(ctx, width, height);
      ctx.restore();
    }
    return { blob: await canvasToPng(out, plan.dpi), plan };
  }
  function svg(o: ExportOptions): string {
    const scene = viewOf().exportScene({
      background: opts.background(),
      labels: opts.labels?.() ?? new Map(),
      legend: opts.legend?.() ?? [],
    });
    if (!scene) throw new Error('There is nothing to export yet.');
    return buildStructureSvg(scene, { transparent: o.transparent });
  }
  return imageRows(png, svg, opts.name, {
    png: 'the view as drawn, rendered again at the DPI set above',
    svg: 'vector art, atoms and bonds sorted back to front; Copy puts the SVG text on the clipboard',
  });
}

/** What the structure files are made from: the view's model and which atoms are shown. */
export interface StructureSource {
  crystal: Crystal;
  model: StructureModel;
  app: Pick<Appearance, 'atomVisible'> | null;
  range: Range;
}

/** CIF, XYZ and XYZ (computem) rows for the crystal and the atoms of the view (Save only). */
export function structureRows(get: () => StructureSource | null, base: () => string): ExportRow[] {
  const src = (): StructureSource => {
    const s = get();
    if (!s) throw new Error('There is no structure to export yet.');
    return s;
  };
  return [
    textRow(
      'cif',
      'CIF',
      () => writeCif(toP1Structure(src().crystal)),
      () => `${base()}_P1.cif`,
      'chemical/x-cif',
      'the unit cell, every atom listed (P1)',
    ),
    textRow(
      'xyz',
      'XYZ',
      () => {
        const s = src();
        return writeXyz(s.crystal, viewAtoms(s.crystal, s.model, s.app));
      },
      () => `${base()}.xyz`,
      'chemical/x-xyz',
      'the atoms of the view: symbol and Cartesian x y z in Å',
    ),
    textRow(
      'computem',
      'XYZ (computem)',
      () => {
        const s = src();
        return writeComputemXyz(s.crystal.lattice, viewAtoms(s.crystal, s.model, s.app), s.range);
      },
      () => `${base()}_computem.xyz`,
      'chemical/x-xyz',
      'atoms in the range: Z x y z occupancy B(Å²), view extent in line 2, ends with -1',
    ),
  ];
}
