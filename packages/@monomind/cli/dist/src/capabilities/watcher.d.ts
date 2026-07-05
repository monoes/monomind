import { EventEmitter } from 'events';
export interface WatcherOptions {
    useGit?: boolean;
    debounceMs?: number;
    ignore?: string[];
}
export declare class FileWatcher extends EventEmitter {
    private watcher;
    private debounceTimers;
    private _mode;
    private debounceMs;
    private knownFiles;
    get mode(): 'git' | 'fs';
    start(root: string, options?: WatcherOptions): Promise<void>;
    private seedKnownFiles;
    stop(): Promise<void>;
}
//# sourceMappingURL=watcher.d.ts.map