import type { CountDelta } from './counts.js';
export type RegressionOutcomeKind = 'pass' | 'exceeded' | 'skipped';
export interface RegressionOutcomePass {
    kind: 'pass';
    delta: number;
    tolerance: number;
    toleranceKind: 'absolute' | 'percent';
}
export interface RegressionOutcomeExceeded {
    kind: 'exceeded';
    delta: number;
    tolerance: number;
    toleranceKind: 'absolute' | 'percent';
    exceeded: CountDelta[];
}
export interface RegressionOutcomeSkipped {
    kind: 'skipped';
    reason: string;
}
export type RegressionOutcome = RegressionOutcomePass | RegressionOutcomeExceeded | RegressionOutcomeSkipped;
export declare function regressionOutcomeToJson(outcome: RegressionOutcome): string;
export declare function printRegressionOutcome(outcome: RegressionOutcome): string;
export declare function makePassOutcome(delta: number, tolerance: number, toleranceKind?: 'absolute' | 'percent'): RegressionOutcomePass;
export declare function makeExceededOutcome(delta: number, tolerance: number, exceeded: CountDelta[], toleranceKind?: 'absolute' | 'percent'): RegressionOutcomeExceeded;
export declare function makeSkippedOutcome(reason: string): RegressionOutcomeSkipped;
//# sourceMappingURL=outcome.d.ts.map