import { describe, expect, it } from 'vitest';
import {
  cifString,
  elementFromSymbol,
  parseCif,
  parseCifDocument,
  parseFirstStructure,
  parseNumeric,
  tokenize,
  writeCif,
} from '../../src/core/cif';
import { CifError } from '../../src/core/errors';

const kinds = (s: string) => tokenize(s).tokens.map((t) => `${t.kind}:${t.text}`);

describe('tokenizer', () => {
  it('splits tags, values and reserved words (any case)', () => {
    expect(kinds('DATA_x\n_a 1\nLOOP_ _b _c 1 2\nSave_f\nstop_ global_')).toEqual([
      'data:x',
      'tag:_a',
      'value:1',
      'loop:',
      'tag:_b',
      'tag:_c',
      'value:1',
      'value:2',
      'save:f',
      'stop:',
      'global:',
    ]);
  });

  it('lower-cases tags but not values', () => {
    expect(kinds('_Cell_Length_A Fe')).toEqual(['tag:_cell_length_a', 'value:Fe']);
  });

  it('skips comments, which start only at the beginning of a token', () => {
    expect(kinds('# top\n_a 1 # trailing\n_b x#y')).toEqual([
      'tag:_a',
      'value:1',
      'tag:_b',
      'value:x#y',
    ]);
  });

  it('reads single- and double-quoted strings, which end only before whitespace', () => {
    const t = tokenize(`_a 'hello world' _b "it's" _c 'it's fine' _d 'P6/mm'm''`).tokens;
    const values = t.filter((x) => x.kind === 'value');
    expect(values.map((x) => x.text)).toEqual(['hello world', "it's", "it's fine", "P6/mm'm'"]);
    expect(values.every((x) => x.quoted)).toBe(true);
  });

  it('keeps ? and . as unquoted placeholders, distinct from quoted strings', () => {
    const v = tokenize(`_a ? _b . _c '?'`).tokens.filter((t) => t.kind === 'value');
    expect(v.map((t) => t.quoted)).toEqual([false, false, true]);
  });

  it('reads ; text fields spanning lines, with ; only at column 0', () => {
    const src = '_t\n;first line\n second ; not an end\n;\n_next 1';
    const t = tokenize(src).tokens;
    expect(t[1]).toMatchObject({ kind: 'value', text: 'first line\n second ; not an end' });
    expect(t[2]).toMatchObject({ kind: 'tag', text: '_next', line: 5 });
  });

  it('reports unterminated quotes and text fields as warnings without failing', () => {
    expect(tokenize(`_a 'oops\n_b 2`).warnings).toHaveLength(1);
    const unterminated = tokenize('_a\n;never closed');
    expect(unterminated.warnings).toHaveLength(1);
    expect(unterminated.tokens[1].text).toBe('never closed');
  });

  it('handles CRLF line endings and a byte-order mark', () => {
    const t = tokenize('﻿data_x\r\n_a 1\r\n_b\r\n;txt\r\n;\r\n').tokens;
    expect(t.map((x) => x.text)).toEqual(['x', '_a', '1', '_b', 'txt']);
  });
});

describe('numbers', () => {
  it('parses values with standard uncertainties', () => {
    expect(parseNumeric('0.9344(13)')?.value).toBe(0.9344);
    expect(parseNumeric('0.9344(13)')?.su).toBeCloseTo(0.0013, 12);
    expect(parseNumeric('5.935(6)')?.su).toBeCloseTo(0.006, 12);
    expect(parseNumeric('10(2)')).toEqual({ value: 10, su: 2 });
    expect(parseNumeric('-.5')).toEqual({ value: -0.5, su: 0 });
    expect(parseNumeric('90.')).toEqual({ value: 90, su: 0 });
    expect(parseNumeric('1.5e-3(2)')?.su).toBeCloseTo(2e-4, 12);
    expect(parseNumeric('+2.5E2')?.value).toBe(250);
  });

  it('accepts simple fractions and rejects non-numbers', () => {
    expect(parseNumeric('1/3')?.value).toBeCloseTo(1 / 3, 15);
    expect(parseNumeric('-1/4')?.value).toBe(-0.25);
    for (const bad of ['?', '.', '', 'abc', '1.2.3', '1/0', '0.5(']) {
      expect(parseNumeric(bad), bad).toBeUndefined();
    }
  });
});

describe('document structure', () => {
  it('collects items and loops per data block', () => {
    const doc = parseCifDocument(`data_A\n_x 1\nloop_\n_p _q\n1 2\n3 4\ndata_B\n_x 2\n`);
    expect(doc.blocks.map((b) => b.name)).toEqual(['A', 'B']);
    expect(doc.blocks[0].items.get('_x')?.text).toBe('1');
    expect(doc.blocks[0].loops[0].tags).toEqual(['_p', '_q']);
    expect(doc.blocks[0].loops[0].rows.map((r) => r.map((c) => c.text))).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(doc.blocks[1].loops).toHaveLength(0);
  });

  it('handles loop values spread over several lines and an empty-string cell', () => {
    const doc = parseCifDocument(`data_A\nloop_\n_p\n_q\n_r\n1 ''\n3\n4 5 6\n`);
    expect(doc.blocks[0].loops[0].rows.map((r) => r.map((c) => c.text))).toEqual([
      ['1', '', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('drops an incomplete last loop row with a warning', () => {
    const b = parseCifDocument(`data_A\nloop_\n_p _q\n1 2\n3\n`).blocks[0];
    expect(b.loops[0].rows).toHaveLength(1);
    expect(b.warnings).toHaveLength(1);
  });

  it('ignores save frames and keeps the first of duplicate items', () => {
    const b = parseCifDocument(`data_A\nsave_frame\n_inside 1\nsave_\n_x 1\n_x 2\n`).blocks[0];
    expect(b.items.has('_inside')).toBe(false);
    expect(b.items.get('_x')?.text).toBe('1');
    expect(b.warnings.some((w) => w.message.includes('Duplicate'))).toBe(true);
  });

  it('warns about content before the first data block', () => {
    const doc = parseCifDocument(`stray\ndata_A\n_x 1\n`);
    expect(doc.warnings).toHaveLength(1);
    expect(doc.blocks).toHaveLength(1);
  });

  it('throws CifError when there is no data block at all', () => {
    expect(() => parseCif('just some text')).toThrow(CifError);
    expect(() => parseCif('')).toThrow(CifError);
  });
});

describe('element detection', () => {
  const el = (s: string, label = false) => elementFromSymbol(s, label)?.element;

  it('strips charges, digits and case from type symbols', () => {
    expect(el('Fe3+')).toBe('Fe');
    expect(el('O2-')).toBe('O');
    expect(el('Cu1+')).toBe('Cu');
    expect(el('CU')).toBe('Cu');
    expect(el('o')).toBe('O');
    expect(el('Si4+')).toBe('Si');
    expect(el('S2-')).toBe('S');
    expect(el('Sr2+')).toBe('Sr');
  });

  it('reads labels with a lower-case second letter as two-letter elements', () => {
    expect(el('Co1', true)).toBe('Co');
    expect(el('Ge1_1', true)).toBe('Ge');
    expect(el('CO1', true)).toBe('C');
    expect(el('O1W', true)).toBe('O');
  });

  it('maps deuterium and tritium to hydrogen', () => {
    expect(elementFromSymbol('D', false)).toEqual({ element: 'H', isotope: 'D' });
    expect(elementFromSymbol('T', true)).toEqual({ element: 'H', isotope: 'T' });
  });

  it('rejects non-elements', () => {
    expect(el('123')).toBeUndefined();
    expect(el('Q')).toBeUndefined();
    expect(el('Xx')).toBeUndefined();
  });
});

const MINIMAL = `data_t
_cell_length_a 4.0
_cell_length_b 4.0
_cell_length_c 4.0
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_ _atom_site_label _atom_site_fract_x _atom_site_fract_y _atom_site_fract_z
Na1 0 0 0
`;

const CELL4 = `_cell_length_a 4 _cell_length_b 4 _cell_length_c 4
_cell_angle_alpha 90 _cell_angle_beta 90 _cell_angle_gamma 90
`;

describe('structure mapping', () => {
  it('maps a minimal cell and atom list; occupancy defaults to 1', () => {
    const { structure, warnings } = parseFirstStructure(MINIMAL);
    expect(structure.cell).toEqual({ a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 });
    expect(structure.atoms).toEqual([
      { label: 'Na1', element: 'Na', x: 0, y: 0, z: 0, occupancy: 1 },
    ]);
    expect(structure.symops).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('defaults missing angles to 90 and throws CifError for a missing length', () => {
    const noAngles = MINIMAL.replace(/_cell_angle_\w+ 90\n/g, '');
    expect(parseFirstStructure(noAngles).structure.cell.gamma).toBe(90);
    expect(() => parseFirstStructure(MINIMAL.replace('_cell_length_b 4.0\n', ''))).toThrow(
      CifError,
    );
  });

  it('reports impossible cells as a per-block error', () => {
    expect(() =>
      parseFirstStructure(MINIMAL.replace('_cell_angle_alpha 90', '_cell_angle_alpha 0')),
    ).toThrow(/angles/);
  });

  it('throws CifError when there are no atom sites', () => {
    expect(() => parseFirstStructure(MINIMAL.split('loop_')[0])).toThrow(CifError);
  });

  it('reads uncertainties, B_iso conversion, adp type and disorder group', () => {
    const { structure } = parseFirstStructure(`data_t
_cell_length_a 5.935(6) _cell_length_b 10.282(2) _cell_length_c 13.368(13)
_cell_angle_alpha 90 _cell_angle_beta 106.78(7) _cell_angle_gamma 90.
loop_ _atom_site_label _atom_site_type_symbol _atom_site_fract_x _atom_site_fract_y
 _atom_site_fract_z _atom_site_B_iso_or_equiv _atom_site_occupancy _atom_site_disorder_group
Cu1 Cu1+ 0.071(9) 0.000(3) 0.355(4) 0.79 0.5 1
S2 S2- 1/3 2/3 .25 . . .
`);
    expect(structure.cell.a).toBe(5.935);
    expect(structure.cell.beta).toBe(106.78);
    const [cu, s] = structure.atoms;
    expect(cu).toMatchObject({ element: 'Cu', typeSymbol: 'Cu1+', x: 0.071, occupancy: 0.5 });
    expect(cu.uiso).toBeCloseTo(0.79 / (8 * Math.PI ** 2), 12);
    expect(cu.disorderGroup).toBe('1');
    expect(s.x).toBeCloseTo(1 / 3, 12);
    expect(s.uiso).toBeUndefined();
    expect(s.occupancy).toBe(1);
    expect(s.disorderGroup).toBeUndefined();
  });

  it('prefers the atom_site loop with fract_x over the aniso loop, whatever the order', () => {
    const { structure } = parseFirstStructure(`data_t
${CELL4}loop_ _atom_site_aniso_label _atom_site_aniso_U_11 _atom_site_aniso_U_22
 _atom_site_aniso_U_33 _atom_site_aniso_U_12 _atom_site_aniso_U_13 _atom_site_aniso_U_23
Fe1 0.01 0.02 0.03 0.001 0.002 0.003
loop_ _atom_site_label _atom_site_type_symbol _atom_site_fract_x _atom_site_fract_y
 _atom_site_fract_z
Fe1 Fe 0 0 0
`);
    expect(structure.atoms).toHaveLength(1);
    expect(structure.atoms[0].aniso).toEqual({
      U11: 0.01,
      U22: 0.02,
      U33: 0.03,
      U12: 0.001,
      U13: 0.002,
      U23: 0.003,
    });
  });

  it('converts B_ij of the aniso loop to U_ij', () => {
    const { structure } = parseFirstStructure(`data_t
${CELL4}loop_ _atom_site_label _atom_site_fract_x _atom_site_fract_y _atom_site_fract_z
Fe1 0 0 0
loop_ _atom_site_aniso_label _atom_site_aniso_B_11 _atom_site_aniso_B_22 _atom_site_aniso_B_33
 _atom_site_aniso_B_12 _atom_site_aniso_B_13 _atom_site_aniso_B_23
Fe1 1 1 1 0 0 0
`);
    expect(structure.atoms[0].aniso?.U11).toBeCloseTo(1 / (8 * Math.PI ** 2), 12);
  });

  it('skips dummy atoms and unreadable atoms, with warnings', () => {
    const { structure, warnings } = parseFirstStructure(`data_t
${CELL4}loop_ _atom_site_label _atom_site_type_symbol _atom_site_fract_x _atom_site_fract_y
 _atom_site_fract_z _atom_site_calc_flag
A1 Fe 0 0 0 d
A2 Fe ? 0 0 d
A3 Fe 0.5 0.5 0.5 dum
A4 Zz 0 0 0 d
`);
    expect(structure.atoms.map((a) => a.label)).toEqual(['A1']);
    expect(warnings).toHaveLength(2);
  });

  it('reads Cartesian positions, converting through the standard frame', () => {
    const { structure, warnings } = parseFirstStructure(`data_t
_cell_length_a 4 _cell_length_b 4 _cell_length_c 6
_cell_angle_alpha 90 _cell_angle_beta 90 _cell_angle_gamma 90
loop_ _atom_site_label _atom_site_type_symbol _atom_site_Cartn_x _atom_site_Cartn_y
 _atom_site_Cartn_z
A Fe 2 1 3
`);
    expect(structure.atoms[0].x).toBeCloseTo(0.5, 12);
    expect(structure.atoms[0].y).toBeCloseTo(0.25, 12);
    expect(structure.atoms[0].z).toBeCloseTo(0.5, 12);
    expect(warnings).toHaveLength(1);
  });

  it('reads a single atom given as plain items rather than a loop', () => {
    const { structure } = parseFirstStructure(`data_t
${CELL4}_atom_site_label Fe1
_atom_site_fract_x 0.1
_atom_site_fract_y 0.2
_atom_site_fract_z 0.3
`);
    expect(structure.atoms[0]).toMatchObject({ element: 'Fe', x: 0.1, y: 0.2, z: 0.3 });
  });

  it('accepts current and deprecated space-group and symmetry tags', () => {
    const modern = parseFirstStructure(`${MINIMAL}_space_group_name_H-M_alt 'F m -3 m'
_space_group_name_Hall '-F 4 2 3'
_space_group_IT_number 225
loop_ _space_group_symop_operation_xyz
'x, y, z'
'-x, -y, -z'
`).structure;
    expect(modern.spaceGroup).toEqual({ hm: 'F m -3 m', hall: '-F 4 2 3', number: 225 });
    expect(modern.symops).toEqual(['x, y, z', '-x, -y, -z']);

    const old = parseFirstStructure(`${MINIMAL}_symmetry_space_group_name_H-M 'P 1'
_symmetry_Int_Tables_number 1
loop_ _symmetry_equiv_pos_as_xyz
x,y,z
`).structure;
    expect(old.spaceGroup).toEqual({ hm: 'P 1', number: 1 });
    expect(old.symops).toEqual(['x,y,z']);
  });

  it('treats ? as unknown, and a lone symop given as a plain item', () => {
    const s = parseFirstStructure(`${MINIMAL}_space_group_name_H-M_alt ?
_symmetry_equiv_pos_as_xyz 'x,y,z'
`).structure;
    expect(s.spaceGroup).toEqual({});
    expect(s.symops).toEqual(['x,y,z']);
  });

  it('collects title (multi-line text field), formula and database ids', () => {
    const s = parseFirstStructure(`${MINIMAL}_publ_section_title
;
A  study of
   sodium
;
_chemical_formula_sum 'Na1'
_cod_database_code 1234567
`).structure;
    expect(s.title).toBe('A study of sodium');
    expect(s.formula).toBe('Na1');
    expect(s.ids).toEqual({ cod: '1234567' });
    expect(s.chemicalName).toBeUndefined();
  });

  it('keeps the chemical name apart from the title: mineral, then common, then systematic', () => {
    const s = parseFirstStructure(`${MINIMAL}_publ_section_title 'A study'
_chemical_name_systematic 'Sodium chloride'
_chemical_name_mineral Halite
`).structure;
    expect(s.title).toBe('A study');
    expect(s.chemicalName).toBe('Halite');
    const t = parseFirstStructure(`${MINIMAL}_chemical_name_systematic 'Sodium chloride'
`).structure;
    expect(t.chemicalName).toBe('Sodium chloride');
  });

  it('warns when the declared volume disagrees with the cell', () => {
    const w = parseFirstStructure(`${MINIMAL}_cell_volume 100\n`).warnings;
    expect(w.some((x) => x.message.includes('volume'))).toBe(true);
    expect(parseFirstStructure(`${MINIMAL}_cell_volume 64.0\n`).warnings).toEqual([]);
  });

  it('returns every data block, reporting failures per block', () => {
    const out = parseCif(
      `${MINIMAL}\ndata_empty\n_cell_length_a 1\n\n${MINIMAL.replace('data_t', 'data_third')}`,
    );
    expect(out.map((o) => o.name)).toEqual(['t', 'empty', 'third']);
    expect(out.map((o) => Boolean(o.structure))).toEqual([true, false, true]);
    expect(out[1].error).toBeTruthy();
    expect(parseFirstStructure(`data_empty\n_cell_length_a 1\n${MINIMAL}`).structure.name).toBe(
      't',
    );
  });
});

describe('quirks seen in real files', () => {
  it('VESTA output: indented loops, a quote character inside the H-M string', () => {
    const { structure } = parseFirstStructure(`
#======================================================================
# CRYSTAL DATA
#----------------------------------------------------------------------
data_VESTA_phase_1

_chemical_name_common                  ''
_cell_length_a                         10.005400
_cell_length_b                         10.005400
_cell_length_c                         8.109700
_cell_angle_alpha                      90.000000
_cell_angle_beta                       90.000000
_cell_angle_gamma                      120.000000
_space_group_name_H-M_alt              'P6/mm'm''
_space_group_IT_number                 191

loop_
_space_group_symop_operation_xyz
   'x, y, z'
   'x-y, x, z'

loop_
   _atom_site_label
   _atom_site_occupancy
   _atom_site_fract_x
   _atom_site_fract_y
   _atom_site_fract_z
   _atom_site_adp_type
   _atom_site_U_iso_or_equiv
   _atom_site_type_symbol
   Ge1_1      0.5     0.000000     0.000000     0.9344(13)  Uiso  0.007100 Ge
   Ge1_3      1  0.500000     0.000000     0.000000    Uiso  0.007100 Ge
`);
    expect(structure.spaceGroup).toEqual({ hm: "P6/mm'm'", number: 191 });
    expect(structure.symops).toEqual(['x, y, z', 'x-y, x, z']);
    expect(structure.atoms[0]).toMatchObject({
      element: 'Ge',
      occupancy: 0.5,
      z: 0.9344,
      uiso: 0.0071,
      adpType: 'Uiso',
    });
    expect(structure.title).toBeUndefined(); // the empty '' name is not a title
  });

  it('CrystalMaker output: P 1 with a +x,+y,+z operation and a label that is not an element', () => {
    const { structure } = parseFirstStructure(`data_Crystal
_audit_creation_method         'generated by CrystalMaker X for Windows'
_cell_length_a                   2.202500
_cell_length_b                   2.202500
_cell_length_c                   2.202500
_cell_angle_alpha               90.000000
_cell_angle_beta                90.000000
_cell_angle_gamma               90.000000
_symmetry_space_group_name_H-M     'P 1'
loop_
_symmetry_equiv_pos_as_xyz
'+x,+y,+z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_occupancy
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
 Site1  Te 1.0  0.0  0.0  0.0
`);
    expect(structure.atoms[0]).toMatchObject({ label: 'Site1', element: 'Te' });
    expect(structure.symops).toEqual(['+x,+y,+z']);
  });

  it('ICSD output: a blank line between a tag and its text field, trailing dots, CRLF', () => {
    const text = `#(C) 2024 FIZ
data_74024-ICSD
_database_code_ICSD 74024
_citation_title

;
Low-temperature study
;
_cell_length_a 5.935(6)
_cell_length_b 10.282(2)
_cell_length_c 13.368(13)
_cell_angle_alpha 90.
_cell_angle_beta 106.78(7)
_cell_angle_gamma 90.
_space_group_name_H-M_alt 'P 1 c 1'
_space_group_IT_number 7
loop_
_atom_type_symbol
_atom_type_oxidation_number
Cu1+ 1
S2- -2
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_B_iso_or_equiv
_atom_site_occupancy
Cu1 Cu1+ 0.071(9) 0.000(3) 0.355(4) . 1.
S1 S2- 0.725(11) 0.996(4) 0.371(5) . 1.
`.replace(/\n/g, '\r\n');
    const { structure, warnings } = parseFirstStructure(text);
    expect(structure.ids.icsd).toBe('74024');
    expect(structure.atoms.map((a) => a.element)).toEqual(['Cu', 'S']);
    expect(structure.atoms[1].occupancy).toBe(1);
    expect(warnings).toEqual([]);
  });
});

describe('writer', () => {
  it('quotes only what needs quoting', () => {
    expect(cifString('Fe1')).toBe('Fe1');
    expect(cifString('x, y, z')).toBe("'x, y, z'");
    expect(cifString("it's")).toBe("it's"); // a quote inside a bare word is legal
    expect(cifString("it's here")).toBe(`"it's here"`);
    expect(cifString('')).toBe("''");
    expect(cifString('?')).toBe("'?'");
    expect(cifString('_tag')).toBe("'_tag'");
    expect(cifString('data_x')).toBe("'data_x'");
    expect(cifString('line1\nline2')).toBe('\n;line1\nline2\n;');
    expect(cifString(`both ' and "`)).toBe(`\n;both ' and "\n;`);
  });

  it('round-trips parse -> write -> parse exactly, including awkward strings', () => {
    const first = parseFirstStructure(`data_t
_publ_section_title 'A title with "quotes" and it's'
_chemical_formula_sum 'Fe2 O3'
_cell_length_a 5.0345(3) _cell_length_b 5.0345 _cell_length_c 13.7495
_cell_angle_alpha 90 _cell_angle_beta 90 _cell_angle_gamma 120
_space_group_name_H-M_alt 'R -3 c'
_space_group_IT_number 167
loop_ _space_group_symop_operation_xyz
'x, y, z'
'-y, x-y, z'
loop_ _atom_site_label _atom_site_type_symbol _atom_site_fract_x _atom_site_fract_y
 _atom_site_fract_z _atom_site_occupancy _atom_site_U_iso_or_equiv _atom_site_adp_type
Fe1 Fe3+ 0 0 0.3553 0.5 0.0067 Uiso
O1 O2- 0.3059 0 0.25 1 . .
loop_ _atom_site_aniso_label _atom_site_aniso_U_11 _atom_site_aniso_U_22 _atom_site_aniso_U_33
 _atom_site_aniso_U_12 _atom_site_aniso_U_13 _atom_site_aniso_U_23
Fe1 0.0067 0.0067 0.0059 0.0033 0 0
`).structure;
    const text = writeCif(first);
    const second = parseFirstStructure(text);
    expect(second.warnings).toEqual([]);
    expect(second.structure).toEqual(first);
    expect(writeCif(second.structure)).toBe(text);
  });

  it('writes no symop loop when there are none, and keeps the deuterium isotope', () => {
    const out = writeCif(parseFirstStructure(MINIMAL).structure);
    expect(out).not.toContain('symop');
    const d = parseFirstStructure(MINIMAL.replace('Na1', 'D1')).structure;
    expect(d.atoms[0]).toMatchObject({ element: 'H', isotope: 'D' });
  });
});
