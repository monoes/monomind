/**
 * @monomind/security — public API
 *
 * Re-exports all public symbols so consumers can import from the
 * package root:
 *
 *   import { validateInput } from '@monomind/security';
 */

export type { ValidationResult, ValidateInputOpts } from './input-guards.js';
export { validateInput } from './input-guards.js';
