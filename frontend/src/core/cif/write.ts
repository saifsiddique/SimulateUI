/**
 * CIF writer for a `CifStructure`. It writes exactly what the structure holds, so exporting a
 * P1-expanded cell (M3) is a matter of passing a structure whose symops are just 'x, y, z'.
 * Numbers are written at full precision, so parse -> write -> parse is lossless.
 */
import type { CifAtom, CifStructure } from './structure';

/** A CIF value token: bare when safe, quoted when it has spaces or starts with a special char. */
export function cifString(s: string): string {
  if (s === '') return "''";
  if (s.includes('\n')) return `\n;${s}\n;`;
  const needsQuote =
    /\s/.test(s) ||
    /^[_#$'"[\];]/.test(s) ||
    s === '?' ||
    s === '.' ||
    /^(data_|loop_|save_|global_|stop_)/i.test(s);
  if (!needsQuote) return s;
  // A quote only ends a string when followed by whitespace, so the other kind is always safe.
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  return `\n;${s}\n;`;
}

const n = (v: number): string => String(v);

function atomRow(a: CifAtom, hasU: boolean, hasAdp: boolean, hasDis: boolean): string {
  // Placeholders are written bare: a quoted '?' would be data, not "unknown".
  const cols = [
    cifString(a.label),
    cifString(a.typeSymbol ?? a.element),
    n(a.occupancy),
    n(a.x),
    n(a.y),
    n(a.z),
  ];
  if (hasU) cols.push(a.uiso === undefined ? '?' : n(a.uiso));
  if (hasAdp) cols.push(a.adpType === undefined ? '?' : cifString(a.adpType));
  if (hasDis) cols.push(a.disorderGroup === undefined ? '.' : cifString(a.disorderGroup));
  return cols.join(' ');
}

export function writeCif(s: CifStructure): string {
  const out: string[] = [];
  const line = (tag: string, value: string) => out.push(`${tag.padEnd(36)}${value}`);

  out.push(`data_${s.name.replace(/\s+/g, '_') || 'structure'}`);
  line('_audit_creation_method', cifString('Crystal Viewer Lite'));
  if (s.title) line('_publ_section_title', cifString(s.title));
  if (s.chemicalName) line('_chemical_name_common', cifString(s.chemicalName));
  if (s.formula) line('_chemical_formula_sum', cifString(s.formula));
  if (s.ids.cod) line('_cod_database_code', cifString(s.ids.cod));
  if (s.ids.icsd) line('_database_code_icsd', cifString(s.ids.icsd));
  line('_cell_length_a', n(s.cell.a));
  line('_cell_length_b', n(s.cell.b));
  line('_cell_length_c', n(s.cell.c));
  line('_cell_angle_alpha', n(s.cell.alpha));
  line('_cell_angle_beta', n(s.cell.beta));
  line('_cell_angle_gamma', n(s.cell.gamma));
  if (s.spaceGroup.hm) line('_space_group_name_H-M_alt', cifString(s.spaceGroup.hm));
  if (s.spaceGroup.hall) line('_space_group_name_Hall', cifString(s.spaceGroup.hall));
  if (s.spaceGroup.number !== undefined) line('_space_group_IT_number', n(s.spaceGroup.number));

  // No operations stays no loop (a P1 export passes ['x, y, z']), so parse -> write -> parse is exact.
  if (s.symops.length > 0) {
    out.push('', 'loop_', '_space_group_symop_operation_xyz', ...s.symops.map(cifString));
  }

  const hasU = s.atoms.some((a) => a.uiso !== undefined);
  const hasAdp = s.atoms.some((a) => a.adpType !== undefined);
  const hasDis = s.atoms.some((a) => a.disorderGroup !== undefined);
  out.push(
    '',
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_occupancy',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
  );
  if (hasU) out.push('_atom_site_U_iso_or_equiv');
  if (hasAdp) out.push('_atom_site_adp_type');
  if (hasDis) out.push('_atom_site_disorder_group');
  for (const a of s.atoms) out.push(atomRow(a, hasU, hasAdp, hasDis));

  const aniso = s.atoms.filter((a) => a.aniso);
  if (aniso.length > 0) {
    out.push(
      '',
      'loop_',
      '_atom_site_aniso_label',
      ...['11', '22', '33', '12', '13', '23'].map((ij) => `_atom_site_aniso_U_${ij}`),
    );
    for (const a of aniso) {
      const u = a.aniso!;
      out.push(
        [cifString(a.label), ...[u.U11, u.U22, u.U33, u.U12, u.U13, u.U23].map(n)].join(' '),
      );
    }
  }
  return out.join('\n') + '\n';
}
