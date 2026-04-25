/**
 * Metric Evaluators for Benchmark Runner (Task 34)
 * Individual metric evaluation functions for quality assessment.
 */

import type { MetricResult } from '@monobrain/shared';

/**
 * Checks whether the output contains the expected substring.
 */
export function containsExpected(
  output: string,
  config: { expected: string },
): MetricResult {
  const found = output.includes(config.expected);
  return {
    type: 'contains_expected',
    passed: found,
    actual: found ? config.expected : null,
    expected: config.expected,
    message: found
      ? `Output contains expected string "${config.expected}"`
      : `Output missing expected string "${config.expected}"`,
  };
}

/**
 * Checks whether the output length falls within the specified range.
 */
export function lengthRange(
  output: string,
  config: { min: number; max: number },
): MetricResult {
  const len = output.length;
  const passed = len >= config.min && len <= config.max;
  return {
    type: 'length_range',
    passed,
    actual: len,
    expected: { min: config.min, max: config.max },
    message: passed
      ? `Output length ${len} within range [${config.min}, ${config.max}]`
      : `Output length ${len} outside range [${config.min}, ${config.max}]`,
  };
}

/**
 * Checks that the output does not contain any forbidden words (hallucination markers).
 */
export function noHallucination(
  output: string,
  config: { forbidden: string[] },
): MetricResult {
  const lowerOutput = output.toLowerCase();
  const found = config.forbidden.filter((word) =>
    lowerOutput.includes(word.toLowerCase()),
  );
  const passed = found.length === 0;
  return {
    type: 'no_hallucination',
    passed,
    actual: found.length > 0 ? found : null,
    expected: null,
    message: passed
      ? 'No forbidden words found in output'
      : `Forbidden words found: ${found.join(', ')}`,
  };
}

/**
 * Checks whether the output is valid JSON.
 */
export function jsonValid(output: string): MetricResult {
  let passed = false;
  let parsedType: string | null = null;
  try {
    const parsed = JSON.parse(output);
    passed = true;
    parsedType = typeof parsed;
  } catch {
    // not valid JSON
  }
  return {
    type: 'json_valid',
    passed,
    actual: passed ? parsedType : 'invalid',
    expected: 'valid JSON',
    message: passed ? 'Output is valid JSON' : 'Output is not valid JSON',
  };
}

/**
 * Checks whether the output matches a custom regex pattern.
 */
export function customRegex(
  output: string,
  config: { pattern: string },
): MetricResult {
  const regex = new RegExp(config.pattern);
  const match = regex.test(output);
  return {
    type: 'custom_regex',
    passed: match,
    actual: match ? output.match(regex)?.[0] ?? null : null,
    expected: config.pattern,
    message: match
      ? `Output matches pattern /${config.pattern}/`
      : `Output does not match pattern /${config.pattern}/`,
  };
}
