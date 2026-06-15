/**
 * Metric Evaluators for Benchmark Runner (Task 34)
 * Individual metric evaluation functions for quality assessment.
 */

type MetricResult = any;

/**
 * Checks whether the output contains the expected substring.
 */
export function containsExpected(output: string, config: { expected: string }): MetricResult {
  // Cap expected to prevent huge strings from inflating returned objects
  const expected = typeof config.expected === 'string' ? config.expected.slice(0, 200) : '';
  const found = output.includes(expected);
  return {
    type: 'contains_expected',
    passed: found,
    actual: found ? expected : null,
    expected,
    message: found
      ? `Output contains expected string "${expected}"`
      : `Output missing expected string "${expected}"`,
  };
}

/**
 * Checks whether the output length falls within the specified range.
 */
export function lengthRange(output: string, config: { min: number; max: number }): MetricResult {
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
export function noHallucination(output: string, config: { forbidden: string[] }): MetricResult {
  const lowerOutput = output.toLowerCase();
  // Cap forbidden array to 200 entries to prevent unbounded O(n) scan
  const forbidden = Array.isArray(config.forbidden) ? config.forbidden.slice(0, 200) : [];
  const found = forbidden.filter((word) =>
    typeof word === 'string' && lowerOutput.includes(word.toLowerCase()),
  );
  const passed = found.length === 0;
  // Truncate reflected words to avoid inflated messages
  const truncatedFound = found.map((w) => w.slice(0, 50));
  return {
    type: 'no_hallucination',
    passed,
    actual: found.length > 0 ? truncatedFound : null,
    expected: null,
    message: passed
      ? 'No forbidden words found in output'
      : `Forbidden words found: ${truncatedFound.join(', ')}`,
  };
}

/**
 * Checks whether the output is valid JSON.
 */
export function jsonValid(output: string): MetricResult {
  let passed = false;
  let parsedType: string | null = null;
  // Cap output before JSON.parse to prevent OOM on huge strings
  const MAX_JSON_BYTES = 1 * 1024 * 1024; // 1 MB
  const bounded = typeof output === 'string' && output.length > MAX_JSON_BYTES
    ? output.slice(0, MAX_JSON_BYTES)
    : output;
  try {
    const parsed = JSON.parse(bounded);
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
export function customRegex(output: string, config: { pattern: string }): MetricResult {
  // Reject overly long patterns and those with nested/repeated quantifiers
  // (catastrophic backtracking — a malicious benchmark definition could
  // pin CI runners with `^(a+)+$` against a long output string).
  if (typeof config.pattern !== 'string' || config.pattern.length > 200) {
    return {
      type: 'custom_regex',
      passed: false,
      actual: null,
      expected: config.pattern,
      message: 'Pattern rejected: too long or invalid',
    };
  }
  if (/(\(.*[+*?].*\)|[+*?]){2,}|\{[0-9,]+\}.*[+*?]|\([^)]*\|[^)]*\)[+*?{]/.test(config.pattern)) {
    return {
      type: 'custom_regex',
      passed: false,
      actual: null,
      expected: config.pattern,
      message: 'Pattern rejected: nested quantifiers risk catastrophic backtracking',
    };
  }
  // Cap output length so even slow patterns can't burn unlimited CPU
  const boundedOutput = output.length > 1024 * 1024 ? output.slice(0, 1024 * 1024) : output;
  const regex = new RegExp(config.pattern);
  const match = regex.test(boundedOutput);
  return {
    type: 'custom_regex',
    passed: match,
    actual: match ? boundedOutput.match(regex)?.[0] ?? null : null,
    expected: config.pattern,
    message: match
      ? `Output matches pattern /${config.pattern}/`
      : `Output does not match pattern /${config.pattern}/`,
  };
}
