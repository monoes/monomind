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
export interface ExternalContentResult {
    safe: boolean;
    reason?: string;
}
/**
 * Heuristically check whether `content` contains prompt-injection
 * patterns. This is a structural / regex-based guard — it does not
 * call any LLM.
 *
 * @param content - The untrusted string to inspect.
 * @param source  - Optional label describing where the content came
 *                  from (used only in log-friendly diagnostics, not
 *                  in the returned reason).
 * @returns `{ safe: true }` when no injection signal is found, or
 *          `{ safe: false, reason }` describing the first match.
 *
 * @example
 * const check = await validateExternalContent(userQuery, 'memory search');
 * if (!check.safe) throw new Error(`Blocked: ${check.reason}`);
 */
export declare function validateExternalContent(content: string, source?: string): Promise<ExternalContentResult>;
//# sourceMappingURL=input-guards.d.ts.map