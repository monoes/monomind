export type ToleranceKind = 'percentage' | 'absolute';
export interface Tolerance {
    kind: ToleranceKind;
    value: number;
}
export declare function parseTolerance(s: string): Tolerance;
export declare function toleranceExceeded(tol: Tolerance, baselineTotal: number, currentTotal: number): boolean;
export declare function formatTolerance(tol: Tolerance): string;
export declare const ZERO_TOLERANCE: Tolerance;
//# sourceMappingURL=tolerance.d.ts.map