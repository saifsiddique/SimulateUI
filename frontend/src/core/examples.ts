// The example setups (context.md M8): saved setups shipped with the app, in public/examples/.
// Each one opens like a setup file: its structure as a card, with the zone axis, the specimen and
// the simulation chosen, ready to run. They are made by tests/e2e/examples.spec.ts
// (MAKE_EXAMPLES=1) from the CIFs in ../examples/cifs.

export interface Example {
  /** The file in public/examples/. */
  file: string;
  title: string;
  /** What it shows, in a few words. */
  about: string;
  /** How it is made: the CIF (in examples/cifs), the zone axis, the method and the type. */
  cif: string;
  zone: [number, number, number];
  method: 'multislice' | 'bloch' | 'incostem';
  type: string;
}

export const EXAMPLES: Example[] = [
  {
    file: 'Si_110_HAADF-STEM.simulateui.json',
    title: 'Si [110] · HAADF-STEM',
    about: 'Multislice STEM with BF, ABF, ADF and HAADF detectors: the dumbbells.',
    cif: 'Si',
    zone: [1, 1, 0],
    method: 'multislice',
    type: 'stem',
  },
  {
    file: 'Si_110_CBED.simulateui.json',
    title: 'Si [110] · CBED',
    about: 'Multislice convergent-beam pattern.',
    cif: 'Si',
    zone: [1, 1, 0],
    method: 'multislice',
    type: 'cbed',
  },
  {
    file: 'Si_110_Bloch-SAED.simulateui.json',
    title: 'Si [110] · SAED (Bloch wave)',
    about: 'Dynamical spot pattern from the Bloch-wave solver.',
    cif: 'Si',
    zone: [1, 1, 0],
    method: 'bloch',
    type: 'saed',
  },
  {
    file: 'Si_110_INCOSTEM.simulateui.json',
    title: 'Si [110] · HAADF (INCOSTEM)',
    about: 'Incoherent ADF-STEM image in seconds (thin specimens).',
    cif: 'Si',
    zone: [1, 1, 0],
    method: 'incostem',
    type: 'stem',
  },
  {
    file: 'SrTiO3_001_4D-STEM.simulateui.json',
    title: 'SrTiO₃ [001] · 4D-STEM',
    about: 'A pattern at every scan position; virtual detectors in the viewer.',
    cif: 'SrTiO3',
    zone: [0, 0, 1],
    method: 'multislice',
    type: '4dstem',
  },
  {
    file: 'Au_110_HRTEM.simulateui.json',
    title: 'Au [110] · HRTEM',
    about: 'Plane-wave image with the objective lens, and the exit wave.',
    cif: 'Au',
    zone: [1, 1, 0],
    method: 'multislice',
    type: 'hrtem',
  },
  {
    file: '1T-TaS2_001_Bloch-LACBED.simulateui.json',
    title: '1T-TaS₂ [001] · LACBED (Bloch wave)',
    about: 'One large-angle disc per beam, chosen by h k l in the viewer.',
    cif: '1T-TaS2',
    zone: [0, 0, 1],
    method: 'bloch',
    type: 'lacbed',
  },
];
