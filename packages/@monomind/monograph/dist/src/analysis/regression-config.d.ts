export interface Tolerance {
    type: 'absolute' | 'percentage';
    value: number;
}
export declare function parseTolerance(s: string): Tolerance;
export declare function toleranceExceeded(tol: Tolerance, baseline: number, current: number): boolean;
export declare function saveBaselineToConfig(configPath: string, counts: Record<string, number>): void;
//# sourceMappingURL=regression-config.d.ts.map