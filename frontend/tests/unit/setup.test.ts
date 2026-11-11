import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  SetupError,
  fillDefaults,
  isReady,
  migrateSetup,
  readiness,
  replaceInPlace,
  serializeSetup,
  setupFileName,
  type ReadyInput,
  type SetupDocument,
} from '../../src/core/setup';

const doc = (): SetupDocument => ({
  schemaVersion: SCHEMA_VERSION,
  app: 'SimulateUI',
  name: 'Si.cif',
  structure: { fileName: 'Si.cif', rawCif: 'data_Si\n_cell_length_a 5.43\n' },
  tab: 'simulation',
  ortho: { mode: 'manual', maxRepetitions: 3, strainTolerance: 0.02 },
  specimen: {
    params: { zoneAxis: [1, 1, 0], thickness: 120 },
    built: true,
    builtParams: null,
    specimenId: 'abc123',
  },
  simulation: {
    method: 'bloch',
    ms: { type: 'cbed', scanFov: { x0: 1, y0: 2, w: 3, h: 4 } },
    bloch: { kMax: 3 },
    incostem: {},
    sigmas: { Si: 0.07 },
  },
});

describe('setup document', () => {
  it('survives a save and an open unchanged', () => {
    const d = doc();
    expect(migrateSetup(JSON.parse(serializeSetup(d)))).toEqual(d);
  });

  it('refuses what is not a setup, and a newer schema', () => {
    expect(() => migrateSetup(null)).toThrow(SetupError);
    expect(() => migrateSetup({})).toThrow(/schema version/);
    expect(() => migrateSetup({ ...doc(), schemaVersion: 3 })).toThrow(/newer version/);
    expect(() => migrateSetup({ ...doc(), structure: { fileName: 'a.cif', rawCif: ' ' } })).toThrow(
      /no structure/,
    );
  });

  it('migrates schema 1: specimen sections flatten, the field of view moves to the simulation', () => {
    const v1 = {
      schemaVersion: 1,
      name: 'Si',
      structure: { fileName: 'Si.cif', rawCif: 'data_Si\n' },
      specimen: {
        zoneAxis: [1, 1, 0],
        strainTolerance: 0.005,
        occupancyPolicy: 'random',
        lateral: { mode: 'angstrom', x: 30, y: 40 },
        thickness: { mode: 'angstrom', value: 90 },
        vacuum: { top: 2, bottom: 3 },
        scanFov: { x0: 0, y0: 0, w: 10, h: 10 },
      },
      method: 'abtem',
      simType: 'hrtem',
      incostem: { alpha: 25 },
    };
    const d = migrateSetup(v1);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.specimen.params).toEqual({
      zoneAxis: [1, 1, 0],
      strainTolerance: 0.005,
      occupancy: 'random',
      lateral: [30, 40],
      thickness: 90,
      vacuum: [2, 3],
    });
    expect(d.specimen.built).toBe(false);
    expect(d.simulation.method).toBe('multislice');
    expect(d.simulation.ms).toEqual({ type: 'hrtem', scanFov: { x0: 0, y0: 0, w: 10, h: 10 } });
    expect(d.simulation.incostem).toEqual({ alpha: 25 });
  });

  it('names the file after the structure', () => {
    expect(setupFileName('Si.cif')).toBe('Si.simulateui.json');
    expect(setupFileName('my.crystal.xyz')).toBe('my.crystal.simulateui.json');
    expect(setupFileName('')).toBe('setup.simulateui.json');
  });
});

describe('defaults and in-place replacement', () => {
  it('a setting that is missing or of the wrong type takes its default', () => {
    const defaults = { a: 1, b: { c: 'x', d: [1, 2] }, e: null as unknown, f: {} };
    expect(fillDefaults(defaults, { a: 'oops', b: { c: 'y' }, f: { Si: 2 } })).toEqual({
      a: 1,
      b: { c: 'y', d: [1, 2] },
      e: null,
      f: { Si: 2 },
    });
    expect(fillDefaults(defaults, 5)).toEqual(defaults);
  });

  it('replaceInPlace keeps the objects the panels hold', () => {
    const inner = { x: 1, y: 2 };
    const target: Record<string, unknown> = { inner, gone: true, list: [1] };
    replaceInPlace(target, { inner: { x: 5 }, list: [7, 8], fresh: { z: 1 } });
    expect(target.inner).toBe(inner);
    expect(inner).toEqual({ x: 5 });
    expect(target.gone).toBeUndefined();
    expect(target.list).toEqual([7, 8]);
    expect(target.fresh).toEqual({ z: 1 });
  });
});

describe('ready to run', () => {
  const ok = (over: Partial<ReadyInput> = {}): ReadyInput => ({
    registration: 'ok',
    specimen: { hasResult: true, changed: false, warnings: [] },
    parameterWarnings: [],
    ...over,
  });

  it('is ready when every step is in order', () => {
    const items = readiness(ok());
    expect(items.map((i) => i.state)).toEqual(['ok', 'ok', 'ok']);
    expect(isReady(items)).toBe(true);
  });

  it('lists the warnings of the specimen and of the parameters but still allows a run', () => {
    const items = readiness(
      ok({
        specimen: { hasResult: true, changed: false, warnings: ['strain 0.4 %'] },
        parameterWarnings: ['under-sampled'],
      }),
    );
    expect(items[1]).toMatchObject({ state: 'warn', details: ['strain 0.4 %'] });
    expect(items[2]).toMatchObject({ state: 'warn', details: ['under-sampled'] });
    expect(isReady(items)).toBe(true);
  });

  it('is not ready without a current specimen, a structure, or a working preview', () => {
    expect(isReady(readiness(ok({ registration: 'error', registrationError: 'x' })))).toBe(false);
    expect(
      isReady(readiness(ok({ specimen: { hasResult: false, changed: false, warnings: [] } }))),
    ).toBe(false);
    const stale = readiness(ok({ specimen: { hasResult: true, changed: true, warnings: [] } }));
    expect(stale[1].state).toBe('fail');
    expect(readiness(ok({ parameterError: 'boom' }))[2]).toMatchObject({
      state: 'fail',
      details: ['boom'],
    });
  });

  it('warns, but never blocks, when the memory estimate is near or over what is free', () => {
    const small = readiness(ok({ memory: { needed: 1e9, available: 10e9, where: 'in RAM' } }));
    expect(small[3]).toMatchObject({ id: 'memory', state: 'ok', details: [] });
    const near = readiness(ok({ memory: { needed: 7e9, available: 10e9, where: 'in RAM' } }));
    expect(near[3].state).toBe('warn');
    expect(near[3].details[0]).toContain('70 %');
    const over = readiness(ok({ memory: { needed: 20e9, available: 16e9, where: 'on the GPU' } }));
    expect(over[3].details[0]).toMatch(/needs about 20\.0 GB but only 16\.0 GB is free on the GPU/);
    expect(isReady(over)).toBe(true);
    expect(readiness(ok({ memory: null }))).toHaveLength(3);
  });

  it('asks to open ③ when no preview has been made yet', () => {
    const items = readiness(ok({ parameterWarnings: null }));
    expect(items[2].state).toBe('warn');
    expect(items[2].details[0]).toMatch(/Open ③/);
  });
});
