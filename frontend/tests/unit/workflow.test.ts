import { describe, expect, it } from 'vitest';
import {
  fallbackTab,
  workflowProgress,
  workflowStates,
  type WorkflowInput,
} from '../../src/core/workflow';

const base = (over: Partial<WorkflowInput> = {}): WorkflowInput => ({
  loaded: true,
  registration: 'ok',
  specimen: { status: 'idle', hasResult: false, changed: false, warnings: 0 },
  ...over,
});
const spec = (s: Partial<WorkflowInput['specimen']>) =>
  base({ specimen: { ...base().specimen, ...s } });

describe('workflow tabs', () => {
  it('starts with only the structure tab open', () => {
    const s = workflowStates(base({ loaded: false, registration: 'idle' }));
    expect(s.structure.state).toBe('todo');
    expect(s.specimen.state).toBe('locked');
    expect(s.simulation.state).toBe('locked');
    expect(s.run.state).toBe('locked');
    expect(workflowProgress(s)).toBe(0);
  });

  it('unlocks the specimen once the backend has the structure', () => {
    expect(workflowStates(base({ registration: 'pending' })).specimen.state).toBe('locked');
    expect(workflowStates(base({ registration: 'pending' })).structure.state).toBe('busy');
    const s = workflowStates(base());
    expect(s.structure.state).toBe('done');
    expect(s.specimen.state).toBe('todo');
    expect(workflowProgress(s)).toBe(0.25);
  });

  it('reports a registration failure as a warning with the reason', () => {
    const s = workflowStates(base({ registration: 'error', registrationError: 'offline' }));
    expect(s.structure.state).toBe('warn');
    expect(s.structure.reason).toContain('offline');
    expect(s.specimen.state).toBe('locked');
  });

  it('marks Simulation done once the parameters check out, and Run when a run has finished', () => {
    const built = { status: 'ok', hasResult: true } as const;
    const sim = (parameters: WorkflowInput['parameters'], run?: WorkflowInput['run']) =>
      workflowStates(base({ specimen: { ...base().specimen, ...built }, parameters, run }));
    expect(sim(undefined).simulation.state).toBe('todo');
    expect(sim({ status: 'idle', warnings: 0 }).simulation.state).toBe('todo');
    expect(sim({ status: 'pending', warnings: 0 }).simulation.state).toBe('busy');
    expect(sim({ status: 'ok', warnings: 0 }).simulation.state).toBe('done');
    const warned = sim({ status: 'ok', warnings: 2 }).simulation;
    expect(warned.state).toBe('warn');
    expect(warned.reason).toContain('2 warnings');
    expect(sim({ status: 'error', warnings: 0, error: 'bad angle' }).simulation.reason).toContain(
      'bad angle',
    );
    expect(sim({ status: 'ok', warnings: 0 }, 'busy').run.state).toBe('busy');
    expect(sim({ status: 'ok', warnings: 0 }, 'done').run.state).toBe('done');
    expect(sim({ status: 'ok', warnings: 0 }, 'failed').run.state).toBe('warn');
    expect(workflowProgress(sim({ status: 'ok', warnings: 0 }, 'done'))).toBe(1);
    // a changed specimen still makes both stale, whatever the parameters say
    const stale = workflowStates(
      base({
        specimen: { ...base().specimen, ...built, changed: true },
        parameters: { status: 'ok', warnings: 0 },
        run: 'done',
      }),
    );
    expect(stale.simulation.state).toBe('stale');
    expect(stale.run.state).toBe('stale');
  });

  it('follows the specimen through busy, done, warn and stale', () => {
    expect(workflowStates(spec({ status: 'pending' })).specimen.state).toBe('busy');
    const done = workflowStates(spec({ status: 'ok', hasResult: true }));
    expect(done.specimen.state).toBe('done');
    expect(done.simulation.state).toBe('todo');
    expect(done.run.state).toBe('todo');
    expect(workflowProgress(done)).toBe(0.5);
    const warned = workflowStates(spec({ status: 'ok', hasResult: true, warnings: 2 }));
    expect(warned.specimen.state).toBe('warn');
    expect(warned.specimen.reason).toContain('2 warnings');
    expect(workflowProgress(warned)).toBe(0.5);
    const stale = workflowStates(spec({ status: 'ok', hasResult: true, changed: true }));
    expect(stale.specimen.state).toBe('stale');
    expect(stale.simulation.state).toBe('stale');
    expect(stale.run.state).toBe('stale');
    expect(workflowProgress(stale)).toBe(0.25);
  });

  it('keeps the simulation unlocked when a rebuild fails but a specimen exists', () => {
    const s = workflowStates(spec({ status: 'error', error: 'boom', hasResult: true }));
    expect(s.specimen.state).toBe('warn');
    expect(s.simulation.state).toBe('todo');
  });

  it('falls back to the nearest open tab when the shown one locks', () => {
    const s = workflowStates(base());
    expect(fallbackTab('simulation', s)).toBe('specimen');
    expect(fallbackTab('specimen', s)).toBe('specimen');
    const none = workflowStates(base({ loaded: false, registration: 'idle' }));
    expect(fallbackTab('simulation', none)).toBe('structure');
  });
});
