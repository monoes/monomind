/**
 * Shared validateInput() utility for @monomind/security
 *
 * Provides a single typed entry point for input validation covering
 * string, number, path, url, and orgName types. Import this instead
 * of rolling per-package validation to ensure consistency and avoid
 * missed injection vectors.
 *
 * @module @monomind/security/input-guards
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    sanitized?: string;
}
export interface ValidateInputOpts {
    type: 'string' | 'number' | 'path' | 'url' | 'orgName';
    maxLength?: number;
    required?: boolean;
}
/**
 * Validate and sanitize an input value.
 *
 * @example
 * const result = validateInput(req.body.name, { type: 'orgName' });
 * if (!result.valid) throw new Error(result.error);
 * const safeName = result.sanitized!;
 */
export declare function validateInput(value: unknown, opts: ValidateInputOpts): ValidationResult;
//# sourceMappingURL=input-guards.d.ts.map