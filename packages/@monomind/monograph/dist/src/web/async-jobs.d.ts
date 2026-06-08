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
export declare function createJobRegistry(): JobRegistry;
export declare const globalJobRegistry: JobRegistry;
//# sourceMappingURL=async-jobs.d.ts.map