import { substitute } from './template-engine.js';

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
const SAFE_TOKEN =
  /^(\s*('([^']*)'|"([^"]*)"|-?\d+(\.\d+)?|true|false|null|undefined|===|!==|==|!=|>=|<=|>|<|&&|\|\||!|\(|\)|\s+))+\s*$/;

/**
 * Evaluate a simple boolean expression with variable substitution.
 *
 * 1. Replace `{{variable}}` references using the provided context.
 * 2. Reject any expression containing dangerous patterns.
 * 3. Validate that all remaining tokens are safe.
 * 4. Evaluate using `new Function` with strict mode.
 */
export function evaluateCondition(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  // Step 1: substitute variables
  const resolved = substitute(expression, context);

  // Step 2: reject dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(resolved)) {
      throw new Error(
        `Unsafe expression rejected: contains forbidden pattern "${pattern.source}"`,
      );
    }
  }

  // Step 3: validate tokens
  if (!SAFE_TOKEN.test(resolved)) {
    throw new Error(
      `Unsafe expression rejected: contains disallowed tokens in "${resolved}"`,
    );
  }

  // Step 4: evaluate safely
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(`"use strict"; return (${resolved});`);
  return Boolean(fn());
}
