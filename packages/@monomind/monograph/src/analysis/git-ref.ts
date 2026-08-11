/**
 * Shared git-ref validator.
 *
 * Previously duplicated 4 ways (monovector/diff-classifier.ts in the CLI
 * package, plus changed-files.ts, git-changed-files.ts, and
 * changed-workspaces.ts here) and already disagreeing on `main..HEAD` /
 * `main...HEAD` — a valid, extremely common git range. This is
 * diff-classifier.ts's implementation (allowlist + leading-dash guard +
 * explicit range carve-out + length cap), merged with changed-files.ts's
 * typed `ChangedFilesError` for callers that want to distinguish an invalid
 * ref from an actual git failure.
 */

export class InvalidGitRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGitRefError';
  }
}

const VALID_REF_RE = /^[a-zA-Z0-9_\-./~^@]+$/;

/**
 * Validate a git ref before it reaches a git invocation.
 *
 * - Rejects shell metacharacters via an allowlist (alphanumeric plus
 *   `-._/~^@`).
 * - Rejects a leading `-` explicitly: `execFile`/`execFileSync` with an
 *   array argv defeats *shell* injection, but does not stop the `git`
 *   binary itself from treating an attacker-controlled ref as a flag
 *   (`--output=...`, `-G<regex>`, `-S<string>`).
 * - Allows `..`/`...` ranges (`main..HEAD`, `main...HEAD`) — the primary,
 *   extremely common case a naive "reject any `..`" rule breaks.
 * - Caps length at 256.
 *
 * Throws `InvalidGitRefError` (not a plain `Error`) so callers can
 * distinguish "bad input" from "git itself failed".
 */
export function validateGitRef(ref: string): string {
  if (!VALID_REF_RE.test(ref)) {
    throw new InvalidGitRefError(`Invalid git ref: "${ref}" contains unsafe characters`);
  }
  if (ref.startsWith('-')) {
    throw new InvalidGitRefError(`Invalid git ref: "${ref}" must not start with '-'`);
  }
  // Multiple dots are only valid as a two-dot or three-dot range between two
  // otherwise-valid ref segments (main..HEAD, main...HEAD) — anything else
  // containing ".." is a path-traversal-shaped pattern and rejected.
  if (ref.includes('..') && !/^[a-zA-Z0-9_-]+\.\.\.?[a-zA-Z0-9_-]+$/.test(ref)) {
    throw new InvalidGitRefError(`Invalid git ref: "${ref}" has a suspicious '..' pattern`);
  }
  if (ref.length > 256) {
    throw new InvalidGitRefError(`Invalid git ref: "${ref}" is too long`);
  }
  return ref;
}
