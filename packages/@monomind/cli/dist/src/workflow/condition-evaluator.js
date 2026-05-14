/**
 * Substitute context values into a condition expression, JSON-encoding string
 * values to prevent quote injection via user-controlled context data.
 */
function substituteCondition(expression, context) {
    return expression.replace(/\{\{([\w./-]+)\}\}/g, (_match, path) => {
        const segments = path.split('.');
        let current = context;
        for (const seg of segments) {
            if (current === null || current === undefined || typeof current !== 'object') {
                current = undefined;
                break;
            }
            if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') {
                current = undefined;
                break;
            }
            current = current[seg];
        }
        if (current === undefined)
            return `{{${path}}}`;
        if (typeof current === 'string')
            return JSON.stringify(current);
        if (typeof current === 'number' || typeof current === 'boolean')
            return String(current);
        return JSON.stringify(current);
    });
}
/**
 * Dangerous patterns that must never appear in condition expressions.
 */
const DANGEROUS_PATTERNS = [
    /\beval\b/,
    /\brequire\b/,
    /\bimport\b/,
    /\bprocess\b/,
    /\bglobal\b/,
    /\bglobalThis\b/,
    /\bFunction\b/,
    /\b__proto__\b/,
    /\bconstructor\b/,
    /\bprototype\b/,
];
/**
 * Allowed token pattern — only permits strings, numbers, booleans,
 * comparison/logical operators, parentheses, and whitespace.
 */
const SAFE_TOKEN = /^(\s*('([^']*)'|"([^"]*)"|-?\d+(\.\d+)?|true|false|null|undefined|===|!==|==|!=|>=|<=|>|<|&&|\|\||!|\(|\)|\s+))+\s*$/;
/**
 * Evaluate a simple boolean expression with variable substitution.
 *
 * 1. Replace `{{variable}}` references using the provided context.
 * 2. Reject any expression containing dangerous patterns.
 * 3. Validate that all remaining tokens are safe.
 * 4. Evaluate using `new Function` with strict mode.
 */
export function evaluateCondition(expression, context) {
    if (expression.length > 500) {
        throw new Error('Condition expression too long (max 500 characters)');
    }
    // Step 1: substitute variables (string values JSON-encoded to prevent quote injection)
    const resolved = substituteCondition(expression, context);
    // Re-check length after substitution — injected values can expand the expression
    if (resolved.length > 500) {
        throw new Error('Condition expression too long after variable substitution (max 500 characters)');
    }
    // Step 2: reject dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(resolved)) {
            throw new Error(`Unsafe expression rejected: contains forbidden pattern "${pattern.source}"`);
        }
    }
    // Step 3: validate tokens
    if (!SAFE_TOKEN.test(resolved)) {
        throw new Error(`Unsafe expression rejected: contains disallowed tokens in "${resolved}"`);
    }
    // Step 4: evaluate safely
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`"use strict"; return (${resolved});`);
    return Boolean(fn());
}
//# sourceMappingURL=condition-evaluator.js.map