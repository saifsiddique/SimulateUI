// The workflow tabs and their progress (context.md §7.MU "Workflow tabs that track progress").
// Pure: the app passes in what it knows and gets back each tab's state and the reason for it.

export const TAB_IDS = ['structure', 'specimen', 'simulation', 'run'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TAB_LABELS: Record<TabId, string> = {
  structure: 'Structure',
  specimen: 'Specimen',
  simulation: 'Simulation',
  run: 'Run · Results',
};

/**
 * - `locked`: a prerequisite is missing; the tab cannot be opened.
 * - `todo`: open it to continue.
 * - `busy`: the backend is working on it.
 * - `done`: set up.
 * - `warn`: set up, with a warning to look at.
 * - `stale`: an earlier tab changed after this one was set; its values are kept.
 */
export type TabState = 'locked' | 'todo' | 'busy' | 'done' | 'warn' | 'stale';

export interface TabStatus {
  state: TabState;
  /** Shown as the tab's tooltip and read by screen readers. */
  reason: string;
}

export interface WorkflowInput {
  /** A structure is shown (an open card). */
  loaded: boolean;
  registration: 'idle' | 'pending' | 'ok' | 'error';
  registrationError?: string | null;
  specimen: {
    status: 'idle' | 'pending' | 'ok' | 'error';
    error?: string | null;
    hasResult: boolean;
    /** A setting (zone axis, size, centre, cell...) changed after the box was built. */
    changed: boolean;
    warnings: number;
  };
  /** The chosen method's parameters, as its last preview or live image judged them. */
  parameters?: {
    status: 'idle' | 'pending' | 'ok' | 'error';
    warnings: number;
    error?: string | null;
  };
  /** The selected run: not started, running, finished or failed. */
  run?: 'idle' | 'busy' | 'done' | 'failed';
}

function simulationFromParameters(p: WorkflowInput['parameters']): TabStatus {
  if (!p || p.status === 'idle')
    return { state: 'todo', reason: 'Choose the method, the type and the parameters.' };
  if (p.status === 'pending') return { state: 'busy', reason: 'Checking the parameters…' };
  if (p.status === 'error')
    return { state: 'warn', reason: `The parameters have a problem: ${p.error ?? ''}`.trim() };
  return p.warnings > 0
    ? {
        state: 'warn',
        reason: `Parameters set, with ${p.warnings} warning${p.warnings === 1 ? '' : 's'}.`,
      }
    : { state: 'done', reason: 'Parameters set.' };
}

export function workflowStates(w: WorkflowInput): Record<TabId, TabStatus> {
  const structure: TabStatus = !w.loaded
    ? { state: 'todo', reason: 'Open a CIF or XYZ file.' }
    : w.registration === 'pending'
      ? { state: 'busy', reason: 'Registering the structure with the backend…' }
      : w.registration === 'error'
        ? {
            state: 'warn',
            reason: `The backend could not take the structure: ${w.registrationError ?? 'unknown error'}`,
          }
        : w.registration === 'ok'
          ? { state: 'done', reason: 'Structure loaded and registered.' }
          : { state: 'todo', reason: 'Waiting for the backend.' };

  const s = w.specimen;
  const specimen: TabStatus =
    w.registration !== 'ok'
      ? { state: 'locked', reason: 'Load a structure first.' }
      : s.status === 'pending'
        ? { state: 'busy', reason: 'Building the specimen…' }
        : s.status === 'error'
          ? { state: 'warn', reason: `The specimen could not be built: ${s.error ?? ''}`.trim() }
          : !s.hasResult
            ? { state: 'todo', reason: 'Choose the zone axis and build the specimen.' }
            : s.changed
              ? { state: 'stale', reason: 'A setting changed: rebuild the supercell.' }
              : s.warnings > 0
                ? {
                    state: 'warn',
                    reason: `Built, with ${s.warnings} warning${s.warnings === 1 ? '' : 's'}.`,
                  }
                : { state: 'done', reason: 'Specimen built.' };

  const simulation: TabStatus = !s.hasResult
    ? { state: 'locked', reason: 'Build a specimen first.' }
    : specimen.state === 'stale'
      ? { state: 'stale', reason: 'The specimen changed: check the parameters again.' }
      : simulationFromParameters(w.parameters);

  const run: TabStatus = !s.hasResult
    ? { state: 'locked', reason: 'Build a specimen first.' }
    : specimen.state === 'stale'
      ? { state: 'stale', reason: 'The specimen changed: check the list before running.' }
      : w.run === 'busy'
        ? { state: 'busy', reason: 'A simulation is running.' }
        : w.run === 'done'
          ? { state: 'done', reason: 'The selected run has finished.' }
          : w.run === 'failed'
            ? { state: 'warn', reason: 'The selected run failed or was cancelled.' }
            : { state: 'todo', reason: 'Check the list, then run.' };

  return { structure, specimen, simulation, run };
}

/** Tabs that are set up (done or done-with-warnings), as a fraction of all tabs. */
export function workflowProgress(states: Record<TabId, TabStatus>): number {
  const done = TAB_IDS.filter((id) => states[id].state === 'done' || states[id].state === 'warn');
  return done.length / TAB_IDS.length;
}

/** The tab to show when the current one becomes locked: the last one that is open to the user. */
export function fallbackTab(current: TabId, states: Record<TabId, TabStatus>): TabId {
  if (states[current].state !== 'locked') return current;
  for (let i = TAB_IDS.indexOf(current) - 1; i >= 0; i--)
    if (states[TAB_IDS[i]].state !== 'locked') return TAB_IDS[i];
  return 'structure';
}
