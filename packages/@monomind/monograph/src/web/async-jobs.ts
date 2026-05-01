import { randomUUID } from 'crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  payload: unknown;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobRegistry {
  create(type: string, payload: unknown): Job;
  get(id: string): Job | undefined;
  update(id: string, patch: Partial<Pick<Job, 'status' | 'result' | 'error'>>): boolean;
  cancel(id: string): boolean;
  list(): Job[];
}

export function createJobRegistry(): JobRegistry {
  const jobs = new Map<string, Job>();

  function now(): string { return new Date().toISOString(); }

  return {
    create(type, payload) {
      const job: Job = {
        id: randomUUID(),
        type,
        status: 'queued',
        payload,
        createdAt: now(),
        updatedAt: now(),
      };
      jobs.set(job.id, job);
      return { ...job };
    },
    get(id) {
      const j = jobs.get(id);
      return j ? { ...j } : undefined;
    },
    update(id, patch) {
      const j = jobs.get(id);
      if (!j) return false;
      Object.assign(j, patch, { updatedAt: now() });
      return true;
    },
    cancel(id) {
      const j = jobs.get(id);
      if (!j) return false;
      j.status = 'cancelled';
      j.updatedAt = now();
      return true;
    },
    list() {
      return [...jobs.values()].map(j => ({ ...j }));
    },
  };
}

export const globalJobRegistry = createJobRegistry();
