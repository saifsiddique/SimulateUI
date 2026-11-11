/**
 * Everything the user can change about how a structure is shown, as plain JSON-able data
 * (context.md 5.4 ViewState). M12 saves it in the session file; `parseViewSettings` is what
 * reads it back, filling in defaults for anything missing or malformed.
 */
import type { Crystal } from '../crystal';
import type { Vec3 } from '../math/vec3';
import { defaultBondRules, type BondRule } from './bonds';
import type { AtomRef, ManualBonds } from './model';
import { presetRange, type Range, type RangePreset, type Slab } from './range';
import { defaultAppearance, type AppearanceSettings } from './styles';

export interface RangeSettings extends Range {
  /** Include atoms on the upper bounds. */
  boundary: boolean;
  slab: Slab | null;
}

export interface BondSettings {
  rules: BondRule[];
  beyondRange: boolean;
  completeMolecules: boolean;
  manual: ManualBonds;
}

export interface PolyhedraSettings {
  /** Elements at the centres. */
  centres: string[];
  opacity: number;
  edges: boolean;
}

export interface ViewSettings {
  range: RangeSettings;
  bonds: BondSettings;
  polyhedra: PolyhedraSettings;
  appearance: AppearanceSettings;
  /** Individually hidden atoms ("hide selected"). */
  hiddenAtoms: AtomRef[];
  showCell: boolean;
  showAxes: boolean;
  toon: boolean;
  projection: 'ortho' | 'persp';
  /** Snap to the nearest zone axis when a mouse rotation ends within `snapDegrees` of one. */
  snapToZone: boolean;
  snapDegrees: number;
  /** Largest index of the zone axes that snapping aims at (3 keeps to the low-index ones). */
  snapMaxIndex: number;
  /** Angle of one arrow-key press or goniometer button, degrees. */
  tiltStep: number;
}

export const defaultRange = (): RangeSettings => {
  const { range, boundary } = presetRange('cellBoundary');
  return { ...range, boundary, slab: null };
};

export function defaultViewSettings(crystal: Crystal | null): ViewSettings {
  return {
    range: defaultRange(),
    bonds: {
      rules: crystal ? defaultBondRules(crystal) : [],
      beyondRange: false,
      completeMolecules: false,
      manual: { add: [], remove: [] },
    },
    polyhedra: { centres: [], opacity: 0.45, edges: true },
    appearance: defaultAppearance(),
    hiddenAtoms: [],
    showCell: true,
    showAxes: true,
    toon: false,
    projection: 'ortho',
    snapToZone: false,
    snapDegrees: 2,
    snapMaxIndex: 3,
    tiltStep: 5,
  };
}

/**
 * Settings for a newly loaded crystal: everything that belongs to the old structure (range,
 * bond rules, colours and visibility of its elements and sites, hidden atoms, polyhedra) starts
 * over; the user's general preferences (style, radius scheme, background, labels, cell, axes,
 * shading, projection) carry over.
 */
export function settingsForNewCrystal(previous: ViewSettings, crystal: Crystal): ViewSettings {
  const fresh = defaultViewSettings(crystal);
  const a = previous.appearance;
  fresh.appearance = {
    ...fresh.appearance,
    displayStyle: a.displayStyle,
    radiusScheme: a.radiusScheme,
    radiusScale: a.radiusScale,
    uniformRadius: a.uniformRadius,
    bondsVisible: a.bondsVisible,
    background: a.background,
    labels: a.labels,
  };
  fresh.showCell = previous.showCell;
  fresh.showAxes = previous.showAxes;
  fresh.toon = previous.toon;
  fresh.projection = previous.projection;
  fresh.snapToZone = previous.snapToZone;
  fresh.snapDegrees = previous.snapDegrees;
  fresh.snapMaxIndex = previous.snapMaxIndex;
  fresh.tiltStep = previous.tiltStep;
  fresh.bonds.beyondRange = previous.bonds.beyondRange;
  fresh.bonds.completeMolecules = previous.bonds.completeMolecules;
  return fresh;
}

export function applyRangePreset(settings: ViewSettings, preset: RangePreset): void {
  const { range, boundary } = presetRange(preset);
  settings.range = { ...range, boundary, slab: settings.range.slab };
}

// ---- manual bonds ------------------------------------------------------------------------------

const sameRef = (a: AtomRef, b: AtomRef): boolean =>
  a.atom === b.atom &&
  a.cell[0] === b.cell[0] &&
  a.cell[1] === b.cell[1] &&
  a.cell[2] === b.cell[2];
const samePair = (p: [AtomRef, AtomRef], a: AtomRef, b: AtomRef): boolean =>
  (sameRef(p[0], a) && sameRef(p[1], b)) || (sameRef(p[0], b) && sameRef(p[1], a));

/** Draw a bond between two atoms: undoes an earlier removal, else records an addition. */
export function addManualBond(manual: ManualBonds, a: AtomRef, b: AtomRef): ManualBonds {
  const removed = manual.remove.filter((p) => !samePair(p, a, b));
  if (removed.length !== manual.remove.length) return { add: manual.add, remove: removed };
  if (manual.add.some((p) => samePair(p, a, b))) return manual;
  return { add: [...manual.add, [a, b]], remove: manual.remove };
}

/** Delete the bond between two atoms: undoes a manual addition, else records a removal. */
export function removeManualBond(manual: ManualBonds, a: AtomRef, b: AtomRef): ManualBonds {
  const added = manual.add.filter((p) => !samePair(p, a, b));
  if (added.length !== manual.add.length) return { add: added, remove: manual.remove };
  if (manual.remove.some((p) => samePair(p, a, b))) return manual;
  return { add: manual.add, remove: [...manual.remove, [a, b]] };
}

// ---- reading back -------------------------------------------------------------------------------

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isVec3 = (x: unknown): x is Vec3 => Array.isArray(x) && x.length === 3 && x.every(isNum);
const isRef = (x: unknown): x is AtomRef =>
  !!x && typeof x === 'object' && isNum((x as AtomRef).atom) && isVec3((x as AtomRef).cell);
const isRefPair = (x: unknown): x is [AtomRef, AtomRef] =>
  Array.isArray(x) && x.length === 2 && isRef(x[0]) && isRef(x[1]);
const isHex = (x: unknown): x is string => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);

/** Read settings saved as JSON; fields that are missing or the wrong type keep their defaults. */
export function parseViewSettings(json: unknown, crystal: Crystal | null): ViewSettings {
  const out = defaultViewSettings(crystal);
  if (!json || typeof json !== 'object') return out;
  const j = json as Record<string, unknown>;
  const obj = (x: unknown): Record<string, unknown> =>
    x && typeof x === 'object' ? (x as Record<string, unknown>) : {};

  const r = obj(j.range);
  if (isVec3(r.min) && isVec3(r.max) && r.min.every((x, k) => x <= (r.max as Vec3)[k])) {
    out.range.min = [...r.min];
    out.range.max = [...r.max];
  }
  if (typeof r.boundary === 'boolean') out.range.boundary = r.boundary;
  const s = obj(r.slab);
  if (isVec3(s.hkl) && isNum(s.offset) && isNum(s.thickness) && s.thickness > 0) {
    out.range.slab = { hkl: [...s.hkl], offset: s.offset, thickness: s.thickness };
  }

  const b = obj(j.bonds);
  if (Array.isArray(b.rules)) {
    out.bonds.rules = b.rules
      .filter(
        (x): x is BondRule =>
          !!x &&
          typeof (x as BondRule).a === 'string' &&
          typeof (x as BondRule).b === 'string' &&
          isNum((x as BondRule).min) &&
          isNum((x as BondRule).max) &&
          isNum((x as BondRule).radius),
      )
      .map((x) => ({
        a: x.a,
        b: x.b,
        min: x.min,
        max: x.max,
        radius: x.radius,
        visible: x.visible !== false,
        ...(isHex(x.color) ? { color: x.color } : {}),
      }));
  }
  if (typeof b.beyondRange === 'boolean') out.bonds.beyondRange = b.beyondRange;
  if (typeof b.completeMolecules === 'boolean') out.bonds.completeMolecules = b.completeMolecules;
  const m = obj(b.manual);
  if (Array.isArray(m.add)) out.bonds.manual.add = m.add.filter(isRefPair);
  if (Array.isArray(m.remove)) out.bonds.manual.remove = m.remove.filter(isRefPair);

  const p = obj(j.polyhedra);
  if (Array.isArray(p.centres))
    out.polyhedra.centres = p.centres.filter((x) => typeof x === 'string');
  if (isNum(p.opacity)) out.polyhedra.opacity = Math.min(1, Math.max(0, p.opacity));
  if (typeof p.edges === 'boolean') out.polyhedra.edges = p.edges;

  const a = obj(j.appearance);
  const ap = out.appearance;
  if (['ballStick', 'spaceFill', 'stick'].includes(a.displayStyle as string))
    ap.displayStyle = a.displayStyle as typeof ap.displayStyle;
  if (['auto', 'covalent', 'ionic', 'vdw', 'uniform'].includes(a.radiusScheme as string))
    ap.radiusScheme = a.radiusScheme as typeof ap.radiusScheme;
  if (isNum(a.radiusScale) && a.radiusScale > 0) ap.radiusScale = a.radiusScale;
  if (isNum(a.uniformRadius) && a.uniformRadius > 0) ap.uniformRadius = a.uniformRadius;
  if (typeof a.bondsVisible === 'boolean') ap.bondsVisible = a.bondsVisible;
  if (isHex(a.background)) ap.background = a.background;
  if (['none', 'element', 'site'].includes(a.labels as string))
    ap.labels = a.labels as typeof ap.labels;
  const style = (x: unknown) => {
    const o = obj(x);
    const e: { color?: string; radius?: number; visible?: boolean } = {};
    if (isHex(o.color)) e.color = o.color;
    if (isNum(o.radius) && o.radius > 0) e.radius = o.radius;
    if (typeof o.visible === 'boolean') e.visible = o.visible;
    return e;
  };
  for (const [k, v] of Object.entries(obj(a.elements))) ap.elements[k] = style(v);
  for (const [k, v] of Object.entries(obj(a.sites))) ap.sites[k] = style(v);

  if (Array.isArray(j.hiddenAtoms)) out.hiddenAtoms = j.hiddenAtoms.filter(isRef);
  if (typeof j.showCell === 'boolean') out.showCell = j.showCell;
  if (typeof j.showAxes === 'boolean') out.showAxes = j.showAxes;
  if (typeof j.toon === 'boolean') out.toon = j.toon;
  if (j.projection === 'ortho' || j.projection === 'persp') out.projection = j.projection;
  if (typeof j.snapToZone === 'boolean') out.snapToZone = j.snapToZone;
  if (isNum(j.snapDegrees) && j.snapDegrees > 0 && j.snapDegrees <= 45)
    out.snapDegrees = j.snapDegrees;
  if (
    Number.isInteger(j.snapMaxIndex) &&
    (j.snapMaxIndex as number) >= 1 &&
    (j.snapMaxIndex as number) <= 6
  )
    out.snapMaxIndex = j.snapMaxIndex as number;
  if (isNum(j.tiltStep) && j.tiltStep > 0 && j.tiltStep <= 90) out.tiltStep = j.tiltStep;
  return out;
}
