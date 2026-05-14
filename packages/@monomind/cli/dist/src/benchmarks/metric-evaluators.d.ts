/**
 * Metric Evaluators for Benchmark Runner (Task 34)
 * Individual metric evaluation functions for quality assessment.
 */
type MetricResult = any;
/**
 * Checks whether the output contains the expected substring.
 */
export declare function containsExpected(output: string, config: {
    expected: string;
}): MetricResult;
/**
 * Checks whether the output length falls within the specified range.
 */
export declare function lengthRange(output: string, config: {
    min: number;
    max: number;
}): MetricResult;
/**
 * Checks that the output does not contain any forbidden words (hallucination markers).
 */
export declare function noHallucination(output: string, config: {
    forbidden: string[];
}): MetricResult;
/**
 * Checks whether the output is valid JSON.
 */
export declare function jsonValid(output: string): MetricResult;
/**
 * Checks whether the output matches a custom regex pattern.
 */
export declare function customRegex(output: string, config: {
    pattern: string;
}): MetricResult;
export {};
//# sourceMappingURL=metric-evaluators.d.ts.map