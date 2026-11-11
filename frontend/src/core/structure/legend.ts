/**
 * The legend of the structure view: one coloured ball and a name per kind of atom shown. Atoms of
 * one element normally share a colour, so they share an entry; when the user gave different sites
 * of one element different colours, each colour gets an entry named after its (first) site.
 */
import type { Crystal } from '../crystal';
import type { StructureModel } from './model';
import { rgbToHex, type Appearance } from './styles';

export interface LegendEntry {
  label: string;
  /** '#rrggbb'. */
  color: string;
}

export function legendEntries(
  crystal: Crystal,
  model: StructureModel,
  app: Pick<Appearance, 'atomColor' | 'atomVisible'> | null,
): LegendEntry[] {
  const groups = new Map<string, { species: number; color: string; site: string }>();
  const coloursOf = new Map<number, Set<string>>();
  for (let i = 0; i < model.count; i++) {
    if (app && app.atomVisible[i] === 0) continue;
    const s = model.species[i];
    const color = app
      ? rgbToHex(app.atomColor[3 * i], app.atomColor[3 * i + 1], app.atomColor[3 * i + 2])
      : model.info[s].color;
    const key = `${s}|${color}`;
    if (groups.has(key)) continue;
    const a = crystal.atoms[model.placed.atom[i]];
    groups.set(key, { species: s, color, site: crystal.sites[a.site].label });
    if (!coloursOf.has(s)) coloursOf.set(s, new Set());
    coloursOf.get(s)!.add(color);
  }
  return [...groups.values()]
    .sort((a, b) => a.species - b.species)
    .map((g) => ({
      label: coloursOf.get(g.species)!.size > 1 ? g.site : model.elements[g.species],
      color: g.color,
    }));
}
