// The run (context.md M6): start the chosen method as a job on the backend, follow it, cancel it,
// and list the runs stored on disk. One job runs at a time; the backend queues the rest.
import {
  cancelJob,
  followJob,
  getJobs,
  openJobFolder,
  postJob,
  removeJob,
  type Job,
} from '../api/client';
import { blochBody, blochDepths, incostemBody, previewBody, simulation } from './simulation.svelte';

export const jobs = $state<{
  /** The job being followed (started here, or picked from the list). */
  current: Job | null;
  /** Earlier jobs, newest first. */
  list: Job[];
  starting: boolean;
  error: string;
}>({ current: null, list: [], starting: false, error: '' });

let stop: (() => void) | null = null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The request body of the chosen method, or null without a specimen or structure. */
export function runBody(): { method: Job['method']; body: Record<string, unknown> } | null {
  const m = simulation.method;
  if (m === 'bloch') {
    const b = blochBody();
    return b ? { method: m, body: { ...b, thicknesses: blochDepths(simulation.bloch) } } : null;
  }
  if (m === 'incostem') {
    const b = incostemBody();
    return b ? { method: m, body: b } : null;
  }
  const b = previewBody();
  return b ? { method: 'multislice', body: b } : null;
}

export const isActive = (j: Job | null) => !!j && (j.state === 'queued' || j.state === 'running');

function follow(job: Job): void {
  stop?.();
  jobs.current = job;
  stop = followJob(
    job.id,
    (j) => {
      if (jobs.current?.id === j.id) jobs.current = j;
    },
    () => void refreshJobs(),
  );
}

export async function refreshJobs(): Promise<void> {
  try {
    jobs.list = await getJobs();
  } catch (e) {
    jobs.error = message(e);
  }
}

export async function startRun(project: string): Promise<void> {
  const req = runBody();
  if (!req || jobs.starting) return;
  jobs.starting = true;
  jobs.error = '';
  try {
    const job = await postJob({ ...req, project, name: '' });
    follow(job);
    void refreshJobs();
  } catch (e) {
    jobs.error = message(e);
  } finally {
    jobs.starting = false;
  }
}

export async function cancelRun(): Promise<void> {
  const j = jobs.current;
  if (!j) return;
  try {
    jobs.current = await cancelJob(j.id);
  } catch (e) {
    jobs.error = message(e);
  }
}

export async function deleteRun(id: string): Promise<void> {
  try {
    await removeJob(id);
    if (jobs.current?.id === id) jobs.current = null;
    await refreshJobs();
  } catch (e) {
    jobs.error = message(e);
  }
}

export async function openFolder(id: string, exports = false): Promise<void> {
  try {
    await openJobFolder(id, exports);
  } catch (e) {
    jobs.error = message(e);
  }
}

export function showRun(job: Job): void {
  if (isActive(job)) follow(job);
  else {
    stop?.();
    stop = null;
    jobs.current = job;
  }
}
