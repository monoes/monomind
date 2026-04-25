/**
 * Validation utilities for SwarmState.
 */

import type { SwarmState } from './swarm-state.js';

export interface StateValidationError {
  key: string;
  expected: string;
  actual: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: StateValidationError[];
}

/**
 * Validate that a partial SwarmState contains all required keys and that
 * each present field has the expected shape ({ value, reducer }).
 */
export function validateSwarmState(
  state: Partial<SwarmState>,
  requiredKeys: Array<keyof SwarmState>,
): ValidationResult {
  const errors: StateValidationError[] = [];

  for (const key of requiredKeys) {
    const field = state[key];
    if (field === undefined) {
      errors.push({
        key,
        expected: 'SwarmStateField',
        actual: 'undefined',
        message: `Missing required key "${key}"`,
      });
      continue;
    }

    if (typeof field !== 'object' || field === null) {
      errors.push({
        key,
        expected: 'SwarmStateField (object with value & reducer)',
        actual: typeof field,
        message: `Key "${key}" must be a SwarmStateField object`,
      });
      continue;
    }

    if (!('value' in field)) {
      errors.push({
        key,
        expected: 'property "value"',
        actual: 'missing',
        message: `Key "${key}" is missing the "value" property`,
      });
    }

    if (!('reducer' in field)) {
      errors.push({
        key,
        expected: 'property "reducer"',
        actual: 'missing',
        message: `Key "${key}" is missing the "reducer" property`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
