/**
 * How the atoms and bonds of a `StructureModel` look (context.md M6 tasks 4 and 5): colour,
 * radius and visibility, resolved from the display style, the radius scheme, per-element and
 * per-site overrides, hidden atoms and the bond rules into flat arrays the renderer applies.
 *
 * Precedence, most specific first: per-site override, per-element override, scheme default.
 */
import type { Crystal } from '../crystal';
import { elementInfo, parseSpecies } from '../scattering';
import { DEFAULT_BOND_RADIUS, MANUAL_RULE, type BondRule } from './bonds';
import type { AtomRef, DisplayStyle, StructureModel } from './model';
import { atomKey } from './range';

/** Where atom radii come from. 'auto' is covalent for ball-and-stick and van der Waals for space-filling. */
export type RadiusScheme = 'auto' | 'covalent' | 'ionic' | 'vdw' | 'uniform';

export interface ElementStyle {
  /** '#rrggbb' */
  color?: string;
  /** Radius in angstrom, replacing the scheme's. */
  radius?: number;
  visible?: boolean;
}

export type SiteStyle = ElementStyle;

export type LabelMode = 'none' | 'element' | 'site';

export interface AppearanceSettings {
  displayStyle: DisplayStyle;
  radiusScheme: RadiusScheme;
  /** Multiplies the scheme's radii (not those typed in by hand). */
  radiusScale: number;
  /** Radius for the 'uniform' scheme, angstrom. */
  uniformRadius: number;
  /** Per element symbol. */
  elements: Record<string, ElementStyle>;
  /** Per site label of the CIF's asymmetric unit. */
  sites: Record<string, SiteStyle>;
  /** Draw bonds at all (false hides every bond). */
  bondsVisible: boolean;
  background: string;
  labels: LabelMode;
}

export const DEFAULT_BACKGROUND = '#ffffff';

export const defaultAppearance = (): AppearanceSettings => ({
  displayStyle: 'ballStick',
  radiusScheme: 'auto',
  radiusScale: 1,
  uniformRadius: 0.5,
  elements: {},
  sites: {},
  bondsVisible: true,
  background: DEFAULT_BACKGROUND,
  labels: 'none',
});

/** Sphere radius = scheme radius x this, per display style. */
export const BALL_FACTOR = 0.45;

export interface Appearance {
  /** Sphere radius in angstrom per atom. */
  atomRadius: Float32Array;
  /** sRGB, 3 bytes per atom. */
  atomColor: Uint8Array;
  atomVisible: Uint8Array;
  /** Stick radius per bond. */
  bondRadius: Float32Array;
  /** sRGB, 3 bytes per bond rule: a rule with its own colour draws both halves of its bonds in it. */
  ruleColor: Uint8Array;
  /** 1 for a rule that has its own colour; the others (and manual bonds) take the end atoms'. */
  ruleColored: Uint8Array;
  bondVisible: Uint8Array;
  /** Draw bonds at all: false for space-filling or when the user switched them off. */
  bondsDrawn: boolean;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** The radius a scheme gives an element, or undefined when it has none (then covalent is used). */
function schemeRadius(
  scheme: Exclude<RadiusScheme, 'auto'>,
  element: string,
  charge: number,
  uniform: number,
): number {
  const info = elementInfo(element);
  switch (scheme) {
    case 'covalent':
      return info.covalentRadius;
    case 'vdw':
      return info.vdwRadius ?? info.covalentRadius * 1.6;
    case 'uniform':
      return uniform;
    case 'ionic':
      return info.ionicRadii[charge] ?? info.covalentRadius;
  }
}

/** The charge written in a site's type symbol ('Fe3+' gives 3), or 0. */
function siteCharge(crystal: Crystal, site: number): number {
  const t = crystal.sites[site]?.typeSymbol;
  if (!t) return 0;
  try {
    return parseSpecies(t).charge;
  } catch {
    return 0;
  }
}

/** Resolved look of every site of the asymmetric unit (colour, radius, visibility). */
export interface SiteLook {
  color: [number, number, number];
  radius: number;
  visible: boolean;
}

export function resolveSites(
  crystal: Crystal,
  appearance: AppearanceSettings,
  maxBondRadius: number,
): SiteLook[] {
  const style = appearance.displayStyle;
  const scheme: Exclude<RadiusScheme, 'auto'> =
    appearance.radiusScheme === 'auto'
      ? style === 'spaceFill'
        ? 'vdw'
        : 'covalent'
      : appearance.radiusScheme;
  const factor = style === 'ballStick' ? BALL_FACTOR : 1;
  return crystal.sites.map((site, index) => {
    const el = appearance.elements[site.element] ?? {};
    const st = appearance.sites[site.label] ?? {};
    const color = hexToRgb(st.color ?? el.color ?? elementInfo(site.element).color);
    let radius: number;
    if (style === 'stick') {
      radius = maxBondRadius;
    } else if (st.radius !== undefined || el.radius !== undefined) {
      radius = (st.radius ?? el.radius)!;
    } else {
      radius =
        schemeRadius(scheme, site.element, siteCharge(crystal, index), appearance.uniformRadius) *
        factor *
        appearance.radiusScale;
    }
    return { color, radius, visible: st.visible !== false && el.visible !== false };
  });
}

/** Just the colours of an appearance: what a colour change needs, without radii or visibility. */
export interface Colours {
  atomColor: Uint8Array;
  ruleColor: Uint8Array;
  ruleColored: Uint8Array;
}

export function resolveColours(
  crystal: Crystal,
  model: StructureModel,
  appearance: AppearanceSettings,
  rules: readonly BondRule[],
): Colours {
  const sites = resolveSites(crystal, appearance, DEFAULT_BOND_RADIUS);
  const siteOfAtom = crystal.atoms.map((a) => a.site);
  const n = model.count;
  const atomColor = new Uint8Array(3 * n);
  const atomIndex = model.placed.atom;
  for (let i = 0; i < n; i++) {
    const c = sites[siteOfAtom[atomIndex[i]]].color;
    atomColor[3 * i] = c[0];
    atomColor[3 * i + 1] = c[1];
    atomColor[3 * i + 2] = c[2];
  }
  const ruleColor = new Uint8Array(3 * rules.length);
  const ruleColored = new Uint8Array(rules.length);
  rules.forEach((r, k) => {
    if (!r.color) return;
    const c = hexToRgb(r.color);
    ruleColor.set(c, 3 * k);
    ruleColored[k] = 1;
  });
  return { atomColor, ruleColor, ruleColored };
}

/** The colours of the two halves of bond `b` (each as [r, g, b], sRGB bytes). */
export function bondHalfColours(
  model: StructureModel,
  c: Colours,
  b: number,
): [[number, number, number], [number, number, number]] {
  const ri = model.bondRule[b];
  if (ri !== MANUAL_RULE && c.ruleColored[ri]) {
    const own: [number, number, number] = [
      c.ruleColor[3 * ri],
      c.ruleColor[3 * ri + 1],
      c.ruleColor[3 * ri + 2],
    ];
    return [own, [...own]];
  }
  const i = 3 * model.bonds[2 * b];
  const j = 3 * model.bonds[2 * b + 1];
  return [
    [c.atomColor[i], c.atomColor[i + 1], c.atomColor[i + 2]],
    [c.atomColor[j], c.atomColor[j + 1], c.atomColor[j + 2]],
  ];
}

export function resolveAppearance(
  crystal: Crystal,
  model: StructureModel,
  appearance: AppearanceSettings,
  rules: readonly BondRule[],
  hiddenAtoms: readonly AtomRef[] = [],
): Appearance {
  const maxBond = rules.reduce((m, r) => Math.max(m, r.radius), 0) || DEFAULT_BOND_RADIUS;
  const sites = resolveSites(crystal, appearance, maxBond);
  const { atomColor, ruleColor, ruleColored } = resolveColours(crystal, model, appearance, rules);
  const n = model.count;
  const atomRadius = new Float32Array(n);
  const atomVisible = new Uint8Array(n);
  const hidden = new Set(hiddenAtoms.map((r) => atomKey(r.atom, r.cell[0], r.cell[1], r.cell[2])));
  const { placed } = model;
  for (let i = 0; i < n; i++) {
    const look = sites[crystal.atoms[placed.atom[i]].site];
    atomRadius[i] = look.radius;
    atomVisible[i] =
      look.visible &&
      !(
        hidden.size > 0 &&
        hidden.has(
          atomKey(
            placed.atom[i],
            placed.cell[3 * i],
            placed.cell[3 * i + 1],
            placed.cell[3 * i + 2],
          ),
        )
      )
        ? 1
        : 0;
  }

  const nb = model.bondRule.length;
  const bondRadius = new Float32Array(nb);
  const bondVisible = new Uint8Array(nb);
  for (let b = 0; b < nb; b++) {
    const i = model.bonds[2 * b];
    const j = model.bonds[2 * b + 1];
    const ri = model.bondRule[b];
    const rule = ri === MANUAL_RULE ? undefined : rules[ri];
    bondRadius[b] = rule ? rule.radius : DEFAULT_BOND_RADIUS;
    bondVisible[b] = atomVisible[i] && atomVisible[j] && (rule ? rule.visible : true) ? 1 : 0;
  }
  return {
    atomRadius,
    atomColor,
    atomVisible,
    bondRadius,
    ruleColor,
    ruleColored,
    bondVisible,
    bondsDrawn: appearance.bondsVisible && appearance.displayStyle !== 'spaceFill',
  };
}

// ---- visibility tree ---------------------------------------------------------------------------

export interface SiteNode {
  label: string;
  /** Number of atoms of this site in the unit cell. */
  count: number;
  visible: boolean;
}

export interface ElementNode {
  element: string;
  visible: boolean;
  sites: SiteNode[];
}

/** Elements and their sites as a two-level tree, with the current visibility of each node. */
export function visibilityTree(crystal: Crystal, appearance: AppearanceSettings): ElementNode[] {
  const counts = new Map<number, number>();
  for (const a of crystal.atoms) counts.set(a.site, (counts.get(a.site) ?? 0) + 1);
  const byElement = new Map<string, ElementNode>();
  for (const site of crystal.sites) {
    let node = byElement.get(site.element);
    if (!node) {
      node = {
        element: site.element,
        visible: appearance.elements[site.element]?.visible !== false,
        sites: [],
      };
      byElement.set(site.element, node);
    }
    node.sites.push({
      label: site.label,
      count: counts.get(site.index) ?? 0,
      visible: appearance.sites[site.label]?.visible !== false,
    });
  }
  return [...byElement.values()];
}

/** The text drawn next to each atom for a label mode. */
export function atomLabel(
  crystal: Crystal,
  model: StructureModel,
  i: number,
  mode: LabelMode,
): string {
  if (mode === 'none') return '';
  const a = crystal.atoms[model.placed.atom[i]];
  return mode === 'element' ? a.element : crystal.sites[a.site].label;
}
