export interface Spinner {
    stop(finalMessage?: string): void;
}
export declare class AnalysisProgress {
    private readonly enabled;
    private spinners;
    constructor(enabled: boolean);
    stageSpinner(message: string): Spinner;
    finish(): void;
}
export declare function createAnalysisProgress(quiet: boolean): AnalysisProgress;
//# sourceMappingURL=progress.d.ts.map