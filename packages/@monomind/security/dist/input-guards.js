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
import { resolve, isAbsolute } from 'node:path';
import { cwd } from 'node:process';
/**
 * Strip C0 and C1 control characters (U+0000–U+001F, U+007F–U+009F)
 * but preserve printable ASCII and extended Unicode.
 */
function stripControlChars(s) {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}
function validateString(value, opts) {
    if (typeof value !== 'string') {
        if (opts.required !== false && value == null) {
            return { valid: false, error: 'Value is required' };
        }
        return { valid: false, error: 'Value must be a string' };
    }
    if (opts.required !== false && value.length === 0) {
        return { valid: false, error: 'Value must not be empty' };
    }
    const maxLen = opts.maxLength ?? 4096;
    if (value.length > maxLen) {
        return {
            valid: false,
            error: `Value exceeds maximum length of ${maxLen}`,
        };
    }
    const sanitized = stripControlChars(value);
    return { valid: true, sanitized };
}
function validateNumber(value, opts) {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : NaN;
    if (!Number.isFinite(parsed)) {
        if (opts.required === false && value == null) {
            return { valid: true };
        }
        return { valid: false, error: 'Value must be a finite number' };
    }
    return { valid: true, sanitized: String(parsed) };
}
function validatePath(value, opts) {
    if (typeof value !== 'string') {
        return { valid: false, error: 'Path must be a string' };
    }
    if (value.includes('\0')) {
        return { valid: false, error: 'Path must not contain null bytes' };
    }
    // Reject traversal segments
    if (/(^|[\\/])\.\.($|[\\/])/.test(value)) {
        return { valid: false, error: 'Path must not contain directory traversal (..)' };
    }
    // Reject absolute paths that escape cwd
    if (isAbsolute(value)) {
        const cwdPath = cwd();
        const resolved = resolve(value);
        if (!resolved.startsWith(cwdPath + '/') && resolved !== cwdPath) {
            return { valid: false, error: 'Absolute path must not escape the current working directory' };
        }
    }
    const maxLen = opts.maxLength ?? 4096;
    if (value.length > maxLen) {
        return { valid: false, error: `Path exceeds maximum length of ${maxLen}` };
    }
    return { valid: true, sanitized: value };
}
function validateUrl(value, opts) {
    if (typeof value !== 'string') {
        return { valid: false, error: 'URL must be a string' };
    }
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        return { valid: false, error: 'Value is not a valid URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, error: 'URL must use http or https protocol' };
    }
    const maxLen = opts.maxLength ?? 4096;
    if (value.length > maxLen) {
        return { valid: false, error: `URL exceeds maximum length of ${maxLen}` };
    }
    return { valid: true, sanitized: parsed.toString() };
}
/** Org name: lowercase alphanumeric + hyphens, 1–64 chars, must start with alnum */
const ORG_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function validateOrgName(value, _opts) {
    if (typeof value !== 'string') {
        return { valid: false, error: 'Org name must be a string' };
    }
    if (!ORG_NAME_RE.test(value)) {
        return {
            valid: false,
            error: 'Org name must match ^[a-z0-9][a-z0-9-]{0,63}$ (lowercase, alphanumeric + hyphens, 1–64 chars)',
        };
    }
    return { valid: true, sanitized: value };
}
/**
 * Validate and sanitize an input value.
 *
 * @example
 * const result = validateInput(req.body.name, { type: 'orgName' });
 * if (!result.valid) throw new Error(result.error);
 * const safeName = result.sanitized!;
 */
export function validateInput(value, opts) {
    switch (opts.type) {
        case 'string':
            return validateString(value, opts);
        case 'number':
            return validateNumber(value, opts);
        case 'path':
            return validatePath(value, opts);
        case 'url':
            return validateUrl(value, opts);
        case 'orgName':
            return validateOrgName(value, opts);
    }
}
//# sourceMappingURL=input-guards.js.map