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
/**
 * Case-insensitive patterns that indicate an attempt to override
 * system-level instructions or inject prompt directives.
 */
const INJECTION_PATTERNS = [
    { re: /ignore\s+(all\s+)?previous\s+instructions/i, label: 'instruction override ("ignore previous instructions")' },
    { re: /ignore\s+(all\s+)?prior\s+instructions/i, label: 'instruction override ("ignore prior instructions")' },
    { re: /disregard\s+(all\s+)?(previous|prior|above)\s+instructions/i, label: 'instruction override ("disregard instructions")' },
    { re: /forget\s+(all\s+)?(previous|prior|above)\s+(instructions|context)/i, label: 'instruction override ("forget instructions")' },
    { re: /you\s+are\s+now\b/i, label: 'identity hijack ("you are now")' },
    { re: /act\s+as\s+(if\s+you\s+are|a|an)\b/i, label: 'identity hijack ("act as")' },
    { re: /pretend\s+(you\s+are|to\s+be)\b/i, label: 'identity hijack ("pretend to be")' },
    { re: /^system\s*:/im, label: 'system prompt injection ("system:")' },
    { re: /\[system\]/i, label: 'system prompt injection ("[system]")' },
    { re: /<<\s*system\s*>>/i, label: 'system prompt injection ("<<system>>")' },
    { re: /^IMPORTANT\s*:/im, label: 'directive injection ("IMPORTANT:")' },
    { re: /^INSTRUCTION\s*:/im, label: 'directive injection ("INSTRUCTION:")' },
    { re: /^OVERRIDE\s*:/im, label: 'directive injection ("OVERRIDE:")' },
    { re: /\bdo\s+not\s+follow\s+(any\s+)?(previous|prior|earlier)\b/i, label: 'instruction override ("do not follow previous")' },
    { re: /\bnew\s+instructions?\s*:/i, label: 'directive injection ("new instructions:")' },
];
/**
 * Suspicious encoding patterns that may attempt to smuggle directives
 * through Base64, hex escapes, or Unicode homoglyphs.
 */
const ENCODING_PATTERNS = [
    // Large Base64 blobs (>80 chars of contiguous base64 alphabet)
    { re: /[A-Za-z0-9+/=]{80,}/, label: 'suspicious Base64-encoded blob' },
    // Excessive hex escapes (\x41\x42...)
    { re: /(\\x[0-9a-fA-F]{2}){6,}/, label: 'suspicious hex-escape sequence' },
    // Excessive Unicode escapes (AB...)
    { re: /(\\u[0-9a-fA-F]{4}){6,}/, label: 'suspicious Unicode-escape sequence' },
];
/** Threshold ratio of uppercase + directive-like words to total words. */
const DIRECTIVE_DENSITY_THRESHOLD = 0.4;
const DIRECTIVE_WORDS = /\b(MUST|SHALL|ALWAYS|NEVER|IMPORTANT|OVERRIDE|IMMEDIATELY|MANDATORY|REQUIRED|CRITICAL)\b/g;
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
export async function validateExternalContent(content, source) {
    if (typeof content !== 'string') {
        return { safe: false, reason: 'Content must be a string' };
    }
    // Empty / very short content is trivially safe.
    if (content.length === 0) {
        return { safe: true };
    }
    // --- 1. Direct injection patterns ---
    for (const { re, label } of INJECTION_PATTERNS) {
        if (re.test(content)) {
            return { safe: false, reason: `Prompt injection detected: ${label}` };
        }
    }
    // --- 2. Suspicious encoding ---
    for (const { re, label } of ENCODING_PATTERNS) {
        if (re.test(content)) {
            return { safe: false, reason: `Suspicious encoding: ${label}` };
        }
    }
    // --- 3. Directive density ---
    // Only check strings long enough to be meaningful (>20 words).
    const words = content.split(/\s+/).filter(Boolean);
    if (words.length > 20) {
        const matches = content.match(DIRECTIVE_WORDS);
        const density = (matches?.length ?? 0) / words.length;
        if (density >= DIRECTIVE_DENSITY_THRESHOLD) {
            return {
                safe: false,
                reason: `Excessive directive density (${(density * 100).toFixed(0)}% directive keywords)`,
            };
        }
    }
    return { safe: true };
}
//# sourceMappingURL=input-guards.js.map