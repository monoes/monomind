/**
 * Input validation and prompt-injection guards.
 *
 * Inlined from the former @monomind/security package. Provides a single
 * typed entry point for input validation covering string, number, path,
 * url, and orgName types, plus a heuristic prompt-injection detector
 * for untrusted external content.
 *
 * @module @monomind/cli/utils/input-guards
 */

import { resolve, isAbsolute, relative, dirname, basename } from 'node:path';
import { cwd } from 'node:process';
import { realpathSync } from 'node:fs';
import { redactPaths } from './redaction.js';

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
 * Strip C0 and C1 control characters (U+0000–U+001F, U+007F–U+009F)
 * but preserve printable ASCII and extended Unicode.
 */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

function validateString(
  value: unknown,
  opts: ValidateInputOpts,
): ValidationResult {
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

function validateNumber(value: unknown, opts: ValidateInputOpts): ValidationResult {
  const parsed =
    typeof value === 'number'
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

/** Resolve symlinks so the containment check below can't be bypassed by a
 * link that lexically resolves inside cwd but physically points outside it
 * (e.g. `./link -> /etc`). `realpathSync` requires the full path to exist,
 * which a not-yet-created file (or a symlinked *directory* holding a
 * not-yet-created file) would fail — so walk up to the longest existing
 * ancestor, realpath *that* (resolving any symlink components in it), and
 * re-append the non-existent tail. Falls back to the lexical path only when
 * no ancestor at all can be resolved. */
export function realOrResolved(p: string): string {
  let cur = p;
  const tail: string[] = [];
  // eslint-disable-next-line no-constant-condition
  for (let i = 0; i < 64; i++) {
    try {
      const real = realpathSync(cur);
      return tail.length ? resolve(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p; // reached filesystem root, nothing resolvable
      tail.push(basename(cur));
      cur = parent;
    }
  }
  return p;
}

function validatePath(value: unknown, opts: ValidateInputOpts): ValidationResult {
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
  // Reject absolute paths that escape cwd. Uses path.relative (platform-correct
  // separator handling — the previous `startsWith(cwd + '/')` hardcoded POSIX
  // '/' and rejected every legitimate path on Windows) plus realpathSync on
  // both sides so a symlink that's lexically inside cwd but physically points
  // outside it is caught too. Mirrors the pattern in
  // src/memory/memory-bridge.ts's getDbPath().
  if (isAbsolute(value)) {
    const cwdPath = realOrResolved(cwd());
    const resolved = realOrResolved(resolve(value));
    const rel = relative(cwdPath, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { valid: false, error: 'Absolute path must not escape the current working directory' };
    }
  }
  const maxLen = opts.maxLength ?? 4096;
  if (value.length > maxLen) {
    return { valid: false, error: `Path exceeds maximum length of ${maxLen}` };
  }
  return { valid: true, sanitized: value };
}

function validateUrl(value: unknown, opts: ValidateInputOpts): ValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'URL must be a string' };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
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

function validateOrgName(value: unknown, _opts: ValidateInputOpts): ValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Org name must be a string' };
  }
  if (!ORG_NAME_RE.test(value)) {
    return {
      valid: false,
      error:
        'Org name must match ^[a-z0-9][a-z0-9-]{0,63}$ (lowercase, alphanumeric + hyphens, 1–64 chars)',
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
export function validateInput(
  value: unknown,
  opts: ValidateInputOpts,
): ValidationResult {
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

/* ------------------------------------------------------------------ */
/*  MCP tool helpers — shared across MCP handler files                 */
/* ------------------------------------------------------------------ */

/**
 * Sanitize an error before returning it to MCP callers.
 * Strips filesystem paths (POSIX and Windows) from error messages to avoid
 * leaking internal layout. Shared with crash-reporter.ts and
 * neural-optimize.ts's PII stripping via utils/redaction.ts — this used to
 * be a single POSIX-only regex with no Windows-path handling.
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return redactPaths(error.message).substring(0, 500);
  }
  return 'Internal error';
}

/**
 * Reject NUL and C0 control chars except \t \n \r.
 * NUL truncates strings at the C-API boundary in some bridge backends
 * (key collision); ANSI/control chars enable terminal injection when
 * values are echoed back; \r/\n in values fed to log files breaks
 * log-line integrity.
 */
const MCP_CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/**
 * Validate a string value for MCP tool handlers.
 * Returns the string when valid, or null when invalid.
 * Lighter-weight than `validateInput({ type: 'string' })` — designed
 * for the fast-path guard pattern used in MCP tool handlers.
 */
export function validateMcpString(
  value: unknown,
  _name: string,
  maxLen = 100_000,
): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length > maxLen) return null;
  if (MCP_CONTROL_CHAR_RE.test(value)) return null;
  return value;
}

/**
 * Validate a positive integer for MCP tool parameters.
 * Returns the clamped value or the default.
 */
export function validatePositiveInt(
  value: unknown,
  defaultVal: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultVal;
  const n = Math.floor(value);
  return n > 0 ? Math.min(n, max) : defaultVal;
}

/**
 * Validate a score (0–1 range) for MCP tool parameters.
 * Returns the clamped value or the default.
 */
export function validateScore(
  value: unknown,
  defaultVal: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultVal;
  return Math.max(0, Math.min(1, value));
}

/**
 * Validate a git ref: non-empty string, bounded length, no shell
 * metacharacters. Returns the sanitized ref, 'HEAD' for empty/missing
 * input, or null for invalid input.
 */
const REF_SAFE_RE = /^[a-zA-Z0-9_./:@^~\-\.{}\[\]]+$/;
export function validateRef(value: unknown, maxLen = 256): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'HEAD';
  if (value.length > maxLen) return null;
  if (!REF_SAFE_RE.test(value)) return null;
  return value;
}

/* ------------------------------------------------------------------ */
/*  Prompt-injection guard for external / untrusted content            */
/* ------------------------------------------------------------------ */

export interface ExternalContentResult {
  safe: boolean;
  reason?: string;
}

/**
 * Case-insensitive patterns that indicate an attempt to override
 * system-level instructions or inject prompt directives.
 */
const INJECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
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
const ENCODING_PATTERNS: Array<{ re: RegExp; label: string }> = [
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
 * This is defense-in-depth, not a security boundary: a rephrased or
 * non-English injection attempt can trivially evade a fixed pattern list.
 * Do not rely on this as the sole safeguard for content that then gets
 * treated as trusted/authoritative — pair it with least-privilege handling
 * of whatever downstream action the content can influence.
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
export async function validateExternalContent(
  content: string,
  source?: string,
): Promise<ExternalContentResult> {
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
