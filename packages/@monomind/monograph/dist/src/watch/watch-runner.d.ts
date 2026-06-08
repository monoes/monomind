export declare function isRelevantSource(filePath: string): boolean;
export declare function isRelevantConfig(filePath: string): boolean;
export declare function collectChangedPaths(rawPaths: string[], root: string): string[];
export interface WatchRunnerOptions {
    root: string;
    noCache?: boolean;
    quiet?: boolean;
    clearScreen?: boolean;
    debounceMs?: number;
    includeEntryExports?: boolean;
    onAnalysis: (changedPaths: string[]) => Promise<void>;
    loadConfig: () => Promise<unknown>;
}
export declare function reloadConfigOrKeepPrevious<T>(current: T, loader: () => Promise<T>, onError?: (err: unknown) => void): Promise<T>;
export declare function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T;
//# sourceMappingURL=watch-runner.d.ts.map