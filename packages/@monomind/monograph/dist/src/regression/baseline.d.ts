export interface RegressionBaselineFile {
    version: number;
    createdAt: string;
    counts: Record<string, number>;
}
export declare const REGRESSION_BASELINE_VERSION = 1;
export declare const DEFAULT_REGRESSION_BASELINE_PATH = ".monograph/regression-baseline.json";
export type SaveRegressionTarget = {
    kind: 'file';
    path: string;
} | {
    kind: 'config';
    configPath: string;
};
export interface RegressionBaselineOpts {
    saveTarget: SaveRegressionTarget;
    tolerance?: number;
}
export interface RegressionCompareResult {
    passed: boolean;
    exceeded: Array<{
        metric: string;
        baseline: number;
        current: number;
        delta: number;
        tolerance: number;
    }>;
}
export declare function saveRegressionBaseline(counts: Record<string, number>, target?: SaveRegressionTarget, root?: string): void;
export declare function loadRegressionBaseline(path?: string, root?: string): RegressionBaselineFile | null;
export declare function compareWithRegressionBaseline(baseline: RegressionBaselineFile, current: Record<string, number>, tolerance?: number): RegressionCompareResult;
//# sourceMappingURL=baseline.d.ts.map