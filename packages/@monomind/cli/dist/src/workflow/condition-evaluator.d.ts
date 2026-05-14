/**
 * Evaluate a simple boolean expression with variable substitution.
 *
 * 1. Replace `{{variable}}` references using the provided context.
 * 2. Reject any expression containing dangerous patterns.
 * 3. Validate that all remaining tokens are safe.
 * 4. Evaluate using `new Function` with strict mode.
 */
export declare function evaluateCondition(expression: string, context: Record<string, unknown>): boolean;
//# sourceMappingURL=condition-evaluator.d.ts.map