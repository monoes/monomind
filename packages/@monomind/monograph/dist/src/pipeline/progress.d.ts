export type ProgressPhase = 'discovery' | 'parse' | 'churn' | 'complexity' | 'duplication' | 'scoring' | 'render' | 'complete';
export interface ProgressEvent {
    phase: ProgressPhase;
    filesProcessed?: number;
    totalFiles?: number;
    message?: string;
    elapsedMs?: number;
}
export type ProgressCallback = (event: ProgressEvent) => void;
export declare class ProgressReporter {
    private callbacks;
    private startTime;
    private counts;
    subscribe(cb: ProgressCallback): () => void;
    emit(phase: ProgressPhase, opts?: Omit<ProgressEvent, 'phase' | 'elapsedMs'>): void;
    increment(phase: ProgressPhase): void;
    getCount(phase: ProgressPhase): number;
}
export declare function consoleProgressReporter(enabled: boolean): ProgressCallback;
//# sourceMappingURL=progress.d.ts.map