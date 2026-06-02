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

export interface ProgressEvent {
  phase: string;
  percent?: number;
  message?: string;
  timestamp?: string;
}

export interface JobRegistry {
  create(type: string, payload: unknown): Job;
  get(id: string): Job | undefined;
  update(id: string, patch: Partial<Pick<Job, 'status' | 'result' | 'error'>>): boolean;
  cancel(id: string): boolean;
  purge(id: string): boolean;
  list(): Job[];
  emitProgress(id: string, event: ProgressEvent): void;
  getProgress(id: string): ProgressEvent[];
}

export function createJobRegistry(): JobRegistry {
  const jobs = new Map<string, Job>();
  const progressMap = new Map<string, ProgressEvent[]>();

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
      progressMap.set(job.id, []);
      return { ...job };
    },
    get(id) {
      const j = jobs.get(id);
      return j ? { ...j } : undefined;
    },
    update(id, patch) {
      const j = jobs.get(id);
      if (!j) return false;
      if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') return false;
      Object.assign(j, patch, { updatedAt: now() });
      return true;
    },
    cancel(id) {
      const j = jobs.get(id);
      if (!j) return false;
      if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') return false;
      j.status = 'cancelled';
      j.updatedAt = now();
      return true;
    },
    purge(id) {
      const existed = jobs.has(id);
      jobs.delete(id);
      progressMap.delete(id);
      return existed;
    },
    list() {
      return [...jobs.values()].map(j => ({ ...j }));
    },
    emitProgress(id, event) {
      if (!jobs.has(id)) return;
      const evts = progressMap.get(id) ?? [];
      evts.push({ ...event, timestamp: new Date().toISOString() });
      progressMap.set(id, evts);
    },
    getProgress(id) {
      return [...(progressMap.get(id) ?? [])];
    },
  };
}

export const globalJobRegistry = createJobRegistry();
