import { EventEmitter } from 'events';
import type { PipelineProgress } from '../types.js';
export interface WatcherOptions {
    debounceMs?: number;
}
export interface WatchAsyncOptions extends WatcherOptions {
    onProgress?: (p: PipelineProgress) => void;
    force?: boolean;
    codeOnly?: boolean;
    llmMaxSections?: number;
}
/** Convenience: start a watcher and trigger buildAsync on every change. Returns stop() fn. */
export declare function watchAsync(repoPath: string, opts?: WatchAsyncOptions): Promise<{
    stop: () => Promise<void>;
}>;
export declare class MonographWatcher extends EventEmitter {
    private readonly repoPath;
    private watcher;
    private debounceTimer;
    private pendingChanges;
    private readonly debounceMs;
    constructor(repoPath: string, opts?: WatcherOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleChange;
}
//# sourceMappingURL=watcher.d.ts.map