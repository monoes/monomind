export interface FixerAnalysisResults {
    unusedExports: unknown[];
    unusedDependencies: unknown[];
    unusedEnumMembers: unknown[];
}
export interface FixOptions {
    root: string;
    output: 'human' | 'json';
    dryRun: boolean;
    yes: boolean;
    quiet: boolean;
}
export interface FixRecord {
    file: string;
    kind: string;
    name: string;
    applied: boolean;
    dryRun: boolean;
}
export type FixApplier = (root: string, results: FixerAnalysisResults, dryRun: boolean, out: FixRecord[]) => Promise<boolean>;
export declare function runFix(results: FixerAnalysisResults, opts: FixOptions, appliers?: {
    exports?: FixApplier;
    deps?: FixApplier;
    enumMembers?: FixApplier;
}): Promise<{
    exitCode: number;
}>;
//# sourceMappingURL=orchestrator.d.ts.map