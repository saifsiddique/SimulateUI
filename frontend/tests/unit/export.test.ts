import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFirstStructure } from '../../src/core/cif';
import { buildCrystal, type Crystal } from '../../src/core/crystal';
import { buildModel, legendEntries, type StructureModel } from '../../src/core/structure';
import { rasterPlan, safeName } from '../../src/export/browser';
import { crc32, readPngDpi, setPngDpi } from '../../src/export/png';
import { buildStructureSvg, shade, type SvgScene } from '../../src/export/svg3d';
import { fixed, rangeBox, viewAtoms, writeComputemXyz, writeXyz } from '../../src/export/xyz';
import { fixtureDir } from './helpers/fixtures';

const load = (name: string): Crystal =>
  buildCrystal(parseFirstStructure(readFileSync(`${fixtureDir}cifs/${name}.cif`, 'utf8')).structure)
    .crystal;
const rutile = load('rutile');

const modelOf = (c: Crystal, max: [number, number, number], boundary: boolean): StructureModel =>
  buildModel(c, { range: { min: [0, 0, 0], max }, boundary, bonds: false });

describe('XYZ files', () => {
  it('standard XYZ: the count, a comment line, then one "symbol x y z" line per atom', () => {
    const m = modelOf(rutile, [1, 1, 1], false);
    const atoms = viewAtoms(rutile, m, null);
    expect(atoms.length).toBe(6); // rutile: 2 Ti + 4 O
    const lines = writeXyz(rutile, atoms).trimEnd().split('\n');
    expect(lines[0]).toBe('6');
    expect(lines[1]).toContain(rutile.name);
    expect(lines.length).toBe(2 + 6);
    const row = lines[2].trim().split(/\s+/);
    expect(row.length).toBe(4);
    expect(['Ti', 'O']).toContain(row[0]);
    expect(row.slice(1).every((x) => Number.isFinite(Number(x)))).toBe(true);
    expect(lines.slice(2).filter((l) => l.startsWith('Ti')).length).toBe(2);
    expect(writeXyz(rutile, atoms)).not.toContain('-0.000000');
  });

  it('the positions are the Cartesian ones of the model, in angstrom', () => {
    const m = modelOf(rutile, [1, 1, 1], false);
    const atoms = viewAtoms(rutile, m, null);
    atoms.forEach((a, i) =>
      expect(a.pos).toEqual([m.cart[3 * i], m.cart[3 * i + 1], m.cart[3 * i + 2]]),
    );
    // tetragonal, a along x: no coordinate leaves the cell
    for (const a of atoms) {
      expect(a.pos[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(a.pos[0]).toBeLessThan(rutile.cell.a + 1e-9);
      expect(a.pos[2]).toBeLessThan(rutile.cell.c + 1e-9);
    }
  });

  it('hidden atoms are left out of both files', () => {
    const m = modelOf(rutile, [1, 1, 1], false);
    const visible = new Uint8Array(m.count).fill(1);
    for (let i = 0; i < m.count; i++) if (m.elements[m.species[i]] === 'O') visible[i] = 0;
    const atoms = viewAtoms(rutile, m, { atomVisible: visible });
    expect(atoms.length).toBe(2);
    expect(atoms.every((a) => a.element === 'Ti')).toBe(true);
    const range = { min: [0, 0, 0] as const, max: [1, 1, 1] as const };
    expect(writeComputemXyz(rutile.lattice, atoms, range).split('\n')[0]).toBe('2');
  });

  it('computem: count, extent, six columns per atom, and a last line of -1', () => {
    const range = { min: [0, 0, 0] as const, max: [2, 2, 3] as const };
    const m = modelOf(rutile, [2, 2, 3], false);
    const atoms = viewAtoms(rutile, m, null);
    const text = writeComputemXyz(rutile.lattice, atoms, range);
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toBe(String(atoms.length));
    expect(atoms.length).toBe(6 * 2 * 2 * 3);
    const extent = lines[1].split(' ').map(Number);
    expect(extent[0]).toBeCloseTo(2 * rutile.cell.a, 5);
    expect(extent[1]).toBeCloseTo(2 * rutile.cell.b, 5);
    expect(extent[2]).toBeCloseTo(3 * rutile.cell.c, 5);
    expect(lines[lines.length - 1]).toBe('-1');
    expect(lines.length).toBe(2 + atoms.length + 1);
    for (const l of lines.slice(2, -1)) {
      const col = l.split(' ');
      expect(col.length).toBe(6);
      const [Z, x, y, z, occ, B] = col.map(Number);
      expect([22, 8]).toContain(Z);
      for (const [v, e] of [
        [x, extent[0]],
        [y, extent[1]],
        [z, extent[2]],
      ] as const) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(e);
      }
      expect(occ).toBe(1);
      expect(B).toBeGreaterThan(0.3); // rutile gives U, so B = 8π²U
      expect(B).toBeLessThan(1);
    }
  });

  it('computem B is 8π²U of the atom (and 0 when the CIF has no displacement parameter)', () => {
    const m = modelOf(rutile, [1, 1, 1], false);
    const a = viewAtoms(rutile, m, null);
    const ti = a.find((x) => x.element === 'Ti')!;
    const uiso = rutile.atoms.find((x) => x.element === 'Ti')!.uiso;
    const siteU = rutile.sites[rutile.atoms.find((x) => x.element === 'Ti')!.site];
    const u = uiso ?? 0;
    if (u > 0) expect(ti.B).toBeCloseTo(8 * Math.PI ** 2 * u, 9);
    else expect(siteU.aniso).toBeDefined();
    const nacl = load('NaCl');
    const none = viewAtoms(nacl, modelOf(nacl, [1, 1, 1], false), null);
    expect(none.every((x) => x.B === 0)).toBe(true);
    expect(none.map((x) => x.Z).sort((p, q) => p - q)).toEqual([
      ...Array(4).fill(11),
      ...Array(4).fill(17),
    ]);
  });

  it('occupancy is written as it is (a mixed site)', () => {
    const olivine = load('olivine_partial');
    const m = modelOf(olivine, [1, 1, 1], false);
    const atoms = viewAtoms(olivine, m, null);
    expect(atoms.some((a) => a.occupancy < 1)).toBe(true);
    const lines = writeComputemXyz(olivine.lattice, atoms, {
      min: [0, 0, 0],
      max: [1, 1, 1],
    })
      .trimEnd()
      .split('\n');
    expect(lines.slice(2, -1).some((l) => Number(l.split(' ')[4]) < 1)).toBe(true);
  });

  it('the box of a range: the corner and the extent of the whole parallelepiped', () => {
    const graphite = load('graphite'); // hexagonal, gamma = 120°
    const a = graphite.cell.a;
    const box = rangeBox(graphite.lattice, { min: [0, 0, 0], max: [1, 1, 1] });
    expect(box.origin[0]).toBeCloseTo(-a / 2, 9);
    expect(box.extent[0]).toBeCloseTo(1.5 * a, 9);
    expect(box.extent[1]).toBeCloseTo((a * Math.sqrt(3)) / 2, 9);
    expect(box.extent[2]).toBeCloseTo(graphite.cell.c, 9);
    // every atom of the range is inside the box
    const m = modelOf(graphite, [2, 2, 1], true);
    const text = writeComputemXyz(graphite.lattice, viewAtoms(graphite, m, null), {
      min: [0, 0, 0],
      max: [2, 2, 1],
    });
    const lines = text.trimEnd().split('\n');
    const e = rangeBox(graphite.lattice, { min: [0, 0, 0], max: [2, 2, 1] }).extent;
    for (const l of lines.slice(2, -1)) {
      const [, x, y, z] = l.split(' ').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(e[0] + 1e-6);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(e[1] + 1e-6);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(e[2] + 1e-6);
    }
  });

  it('the bonded atoms outside the range go into the standard file, not the computem one', () => {
    const m = buildModel(rutile, {
      range: { min: [0, 0, 0], max: [1, 1, 1] },
      boundary: false,
      bonds: { beyondRange: true },
    });
    const atoms = viewAtoms(rutile, m, null);
    expect(atoms.length).toBeGreaterThan(6);
    expect(atoms.filter((a) => a.inRange).length).toBe(6);
    const range = { min: [0, 0, 0] as const, max: [1, 1, 1] as const };
    expect(writeXyz(rutile, atoms).split('\n')[0]).toBe(String(atoms.length));
    expect(writeComputemXyz(rutile.lattice, atoms, range).split('\n')[0]).toBe('6');
  });

  it('no negative zeros', () => {
    expect(fixed(-1e-12, 6)).toBe('0.000000');
    expect(fixed(-0.5, 2)).toBe('-0.50');
    expect(fixed(0, 3)).toBe('0.000');
  });
});

describe('legend', () => {
  it('one entry per element shown, in the order of the model, with its colour', () => {
    const m = modelOf(rutile, [1, 1, 1], true);
    const entries = legendEntries(rutile, m, null);
    expect(entries.map((e) => e.label)).toEqual(m.elements);
    expect(entries.length).toBe(2);
    expect(entries[0].color).toBe(m.info[0].color);
  });
  it('hidden atoms leave the legend; two colours of one element are told apart by site', () => {
    const m = modelOf(rutile, [1, 1, 1], false);
    const n = m.count;
    const colour = new Uint8Array(3 * n);
    const visible = new Uint8Array(n).fill(1);
    let first = true;
    for (let i = 0; i < n; i++) {
      if (m.elements[m.species[i]] === 'Ti') {
        const rgb = first ? [255, 0, 0] : [0, 0, 255];
        first = false;
        colour.set(rgb, 3 * i);
      } else {
        colour.set([10, 10, 10], 3 * i);
        visible[i] = 0;
      }
    }
    const e = legendEntries(rutile, m, { atomColor: colour, atomVisible: visible });
    expect(e.length).toBe(2); // O is hidden; Ti is in two colours
    expect(e.map((x) => x.color).sort()).toEqual(['#0000ff', '#ff0000']);
    expect(e[0].label).toBe(rutile.sites[rutile.atoms.find((a) => a.element === 'Ti')!.site].label);
  });
});

describe('PNG resolution', () => {
  // a 1 × 1 pixel PNG
  const tiny = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  it('crc32 of "123456789" is the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('writes a pHYs chunk after the header that reads back as the DPI', () => {
    expect(readPngDpi(tiny)).toBeNull();
    for (const dpi of [72, 150, 300, 600]) {
      const out = setPngDpi(tiny, dpi);
      expect(out.length).toBe(tiny.length + 21);
      expect(readPngDpi(out)!).toBeCloseTo(dpi, 1);
      // right after the 8-byte signature and the 25-byte IHDR chunk
      expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs');
      // its CRC covers the type and the data
      const stored = new DataView(out.buffer, out.byteOffset).getUint32(33 + 8 + 9);
      expect(stored).toBe(crc32(out.subarray(37, 37 + 4 + 9)));
    }
    // the rest of the file is untouched
    const out = setPngDpi(tiny, 300);
    expect([...out.subarray(0, 33)]).toEqual([...tiny.subarray(0, 33)]);
    expect([...out.subarray(54)]).toEqual([...tiny.subarray(33)]);
  });
  it('setting it twice leaves one chunk; bad input is refused', () => {
    const twice = setPngDpi(setPngDpi(tiny, 100), 300);
    expect(twice.length).toBe(tiny.length + 21);
    expect(readPngDpi(twice)!).toBeCloseTo(300, 1);
    expect(() => setPngDpi(Uint8Array.from([1, 2, 3]), 300)).toThrow(/PNG/);
    expect(() => setPngDpi(tiny, 0)).toThrow();
    expect(() => setPngDpi(tiny, NaN)).toThrow();
  });
});

describe('raster size and names', () => {
  it('96 CSS pixels are one inch: 700 × 500 at 300 dpi is 2188 × 1563 px', () => {
    const p = rasterPlan(700, 500, 300);
    expect([p.pxW, p.pxH, p.limited]).toEqual([2188, 1563, false]);
    expect(p.dpi).toBeCloseTo(300, 9);
    expect(rasterPlan(700, 500, 96)).toMatchObject({ pxW: 700, pxH: 500 });
  });
  it('the longest side is limited and the stated resolution drops with it', () => {
    const p = rasterPlan(700, 500, 1200, 8192);
    expect(p.limited).toBe(true);
    expect(p.pxW).toBe(8192);
    expect(p.dpi).toBeCloseTo((96 * 8192) / 700, 9);
    expect(p.pxH).toBe(Math.round((500 * 8192) / 700));
  });
  it('file name stems keep letters, digits, dot, dash and underscore', () => {
    expect(safeName('Si.cif')).toBe('Si');
    expect(safeName('my crystal (α) #2')).toBe('my_crystal_2');
    expect(safeName('', 'x')).toBe('x');
    expect(safeName('///')).toBe('structure');
  });
});

const scene = (over: Partial<SvgScene> = {}): SvgScene => ({
  width: 400,
  height: 300,
  background: '#ffffff',
  toon: false,
  atoms: [
    { index: 0, x: 100, y: 100, r: 20, depth: 10, color: '#ff0000' },
    { index: 1, x: 150, y: 120, r: 15, depth: 30, color: '#0000ff' },
    { index: 2, x: 200, y: 140, r: 12, depth: 20, color: '#ff0000' },
  ],
  bonds: [{ x1: 100, y1: 100, x2: 125, y2: 110, depth: 25, color: '#ff0000', width: 6 }],
  cell: [{ x1: 10, y1: 10, x2: 300, y2: 10, depth: 5, color: '#5b6578', width: 1 }],
  polyhedra: { triangles: [], opacity: 0, edges: [] },
  triad: {
    cx: 40,
    cy: 260,
    axes: [
      { dx: 30, dy: 0, depth: 0, name: 'a', color: '#e5484d' },
      { dx: 0, dy: -30, depth: 1, name: 'b', color: '#30a46c' },
      { dx: 5, dy: 5, depth: -1, name: 'c', color: '#3e63dd' },
    ],
  },
  labels: new Map(),
  legend: [
    { label: 'Fe', color: '#ff0000' },
    { label: 'O', color: '#0000ff' },
  ],
  ...over,
});

describe('3D SVG', () => {
  it('is a stand-alone svg with the view size, a background and a title', () => {
    const svg = buildStructureSvg(scene());
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"',
      ),
    ).toBe(true);
    expect(svg).toContain('<title>Crystal structure</title>');
    expect(svg).toContain('<rect width="400" height="300" fill="#ffffff"/>');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
  it('the transparent version has no background', () => {
    expect(buildStructureSvg(scene(), { transparent: true })).not.toContain('<rect');
  });
  it('draws far to near: the atom with the larger depth comes first', () => {
    const svg = buildStructureSvg(scene());
    const body = svg.slice(svg.indexOf('<g id="structure">'), svg.indexOf('</g>'));
    const radii = [...body.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii).toEqual([15, 12, 20]); // depths 30, 20, 10
    // the bond (depth 25) lies between the far atom and the middle one, the cell edge (5) is last
    const kinds = [...body.matchAll(/<(circle|line)\b/g)].map((m) => m[1]);
    expect(kinds).toEqual(['circle', 'line', 'circle', 'circle', 'line']);
  });
  it('shades atoms with one radial gradient per colour; toon uses flat fills and an outline', () => {
    const svg = buildStructureSvg(scene());
    expect(svg.match(/<radialGradient /g)!.length).toBe(2);
    expect(svg).toContain('fill="url(#ball-ff0000)"');
    expect(svg).toContain(`stop-color="${shade('#ff0000', 0.62)}"`);
    expect(svg).toContain('<stop offset="0.45" stop-color="#ff0000"/>'); // the middle is the colour itself
    const toon = buildStructureSvg(scene({ toon: true }));
    expect(toon).not.toContain('radialGradient');
    expect(toon).toContain('fill="#ff0000"');
  });
  it('bonds are strokes as wide as the stick; the legend and axes are included', () => {
    const svg = buildStructureSvg(scene());
    expect(svg).toContain('stroke="#ff0000" stroke-width="6" stroke-linecap="butt"');
    expect(svg).toContain('<g id="legend"');
    expect(svg).toContain('>Fe</text>');
    expect(svg).toContain('>O</text>');
    expect(svg).toContain('<g id="axes"');
    expect(svg).toContain('font-style="italic" fill="#e5484d">a</text>');
  });
  it('atom labels are escaped, and only atoms that are drawn get one', () => {
    const svg = buildStructureSvg(
      scene({
        labels: new Map([
          [0, 'Fe<1>&'],
          [9, 'ghost'],
        ]),
      }),
    );
    expect(svg).toContain('Fe&lt;1&gt;&amp;');
    expect(svg).not.toContain('ghost');
  });
  it('a scene without a triad, legend or labels has none of them', () => {
    const svg = buildStructureSvg(scene({ triad: null, legend: [] }));
    expect(svg).not.toContain('id="axes"');
    expect(svg).not.toContain('id="legend"');
    expect(svg).not.toContain('atom-labels');
  });
  it('polyhedron faces are translucent polygons sorted with the atoms', () => {
    const svg = buildStructureSvg(
      scene({
        polyhedra: {
          opacity: 0.45,
          triangles: [{ pts: [0, 0, 50, 0, 25, 40], depth: 15, color: '#00ff00' }],
          edges: [],
        },
      }),
    );
    expect(svg).toContain('<polygon points="0,0 50,0 25,40" fill="#00ff00" fill-opacity="0.45"');
    const body = svg.slice(svg.indexOf('<g id="structure">'), svg.indexOf('</g>'));
    const kinds = [...body.matchAll(/<(circle|line|polygon)\b/g)].map((m) => m[1]);
    expect(kinds).toEqual(['circle', 'line', 'circle', 'polygon', 'circle', 'line']);
  });
  it('shade mixes towards white or black', () => {
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#ff0000', 0)).toBe('#ff0000');
  });
});
