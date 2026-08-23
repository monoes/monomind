/**
 * Shared redaction — paths, PII, and secret patterns.
 *
 * Previously duplicated in three places that had already diverged:
 *   - crash-reporter.ts's `redact()` — the fullest implementation (POSIX +
 *     Windows paths, IPv4/IPv6, email, SSN, phone, 12 secret patterns,
 *     hostnames). This module is a lift of that pipeline.
 *   - input-guards.ts's `sanitizeError()` — a single POSIX-only path regex,
 *     no PII/secret handling at all.
 *   - neural-optimize.ts's `stripPii` block — POSIX-only `/Users`/`/home`
 *     paths, email, IPv4; no Windows paths, no secret patterns, despite
 *     defaulting ON specifically because it feeds a publicly-published
 *     pattern export.
 * Consolidated here so a new secret pattern or a Windows-path fix reaches
 * every caller instead of two of three.
 */
import { homedir } from 'node:os';

// Step order matters within `redact()` — see the inline comments below for
// why (mirrors crash-reporter.ts's original pipeline exactly).

function stripHomeAndUser(text: string, home: string): string {
  let out = text;
  if (home) out = out.split(home).join('~');

  const username = home.split('/').pop();
  if (username && username.length > 2) {
    out = out.replace(new RegExp(`\\b${username}\\b`, 'g'), '<user>');
  }
  return out;
}

// Generic path prefixes, in case a compiled binary's stack trace embeds a
// *different* machine's home dir (e.g. the CI runner or maintainer's build
// box) than the one stripHomeAndUser() is keyed to. Includes the Windows
// form — the gap both former narrow implementations had.
function stripGenericUserPrefixes(text: string): string {
  let out = text;
  out = out.replace(/\/home\/[^/\s]+/g, '/home/<user>');
  out = out.replace(/\/Users\/[^/\s]+/g, '/Users/<user>');
  out = out.replace(/C:\\Users\\[^\\\s]+/g, 'C:\\Users\\<user>');
  return out;
}

function stripIPv4(text: string): string {
  return text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
}

// #124-review: the original `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`
// has the same catastrophic-backtracking shape as the hostname regex fixed
// above, in TWO places: the unbounded local-part quantifier backtracks
// character-by-character at every scan position when no `@` follows (a
// long dotted string with no `@` at all — ~2s on 40K chars), and the
// domain part's `[A-Za-z0-9.-]+` vs the final `\.[A-Za-z]{2,}` has the
// exact middle-vs-final split ambiguity the hostname fix removes. Local
// part bounded to 64 chars (RFC 5321's actual limit); domain rewritten so
// each label's trailing dot is consumed by the SAME repeated group, never
// re-attemptable as part of the final TLD segment, with the repetition
// itself capped at 10 labels (real hostnames essentially never need more).
function stripEmail(text: string): string {
  return text.replace(
    /\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.){1,10}[A-Za-z]{2,24}\b/g,
    '<email>',
  );
}

function stripSsnAndPhone(text: string): string {
  let out = text;
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '<ssn>');
  out = out.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '<phone>');
  return out;
}

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  /(?:token|bearer)\s*[:=]\s*['"]?[^\s'"]{10,}['"]?/gi,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /npm_[a-zA-Z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // JWT
  /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s]+:[^@\s]+@[^\s'"]+/g, // user:pass@host connection strings
];

function stripSecretPatterns(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

// Collapse any remaining multi-segment absolute path to its basename,
// preserving optional :line:col suffixes for debuggability. Fires on
// /a/b, ~/a/b, C:\a\b — single-segment paths (/tmp) are not touched.
// Must run AFTER home-dir/username replacement — see redactPaths()/redact().
function collapseAbsolutePaths(text: string): string {
  return text.replace(
    /(?:~\/|(?<![:/>\w])\/(?!\/)|[A-Z]:\\)(?:[^\s'"]*[/\\])([\w.-]+(?::\d+(?::\d+)?)?)/g,
    '<path>/$1',
  );
}

const KNOWN_CODE_EXTS =
  /\.(?:js|ts|jsx|tsx|json|md|yaml|yml|html|css|mjs|cjs|toml|xml|txt|log|sql|sh|py|go|rs|rb|java|c|cpp|h|hpp|swift|kt|lock|map)$/i;

function stripHostnames(text: string): string {
  let out = text;
  // Contextual: hostnames that follow :// or @ (requires at least one dot).
  out = out.replace(
    /(\/\/|@)([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+)/g,
    '$1<host>',
  );
  // Standalone: 3+ dot-separated segments with a TLD-like tail (2-6 alpha
  // chars). Excludes version numbers (v2.9.0, 1.2.3), filenames whose last
  // segment is a known code/config extension, and bare decimal numbers.
  //
  // #124-review: the original two-part regex (`(?:\.seg)+` immediately
  // followed by a required `\.[a-zA-Z]{2,6}`) let the engine backtrack over
  // every way to split a long run of dot-segments between "middle
  // repetitions" and "the final segment" before concluding no match —
  // catastrophic (measured ~quadratic) backtracking on a crafted non-
  // matching input (e.g. a long chain of short dotted tokens with no valid
  // trailing TLD), reachable via both crash-reporter's redact() and
  // neural-optimize.ts's public pattern-export path. Rewritten so segments
  // can never contain a dot themselves — there is exactly one way to parse
  // any input, so there is nothing to backtrack over. The "last segment
  // must be a short alpha TLD" check moves into the callback instead of the
  // regex, since the regex itself no longer distinguishes middle vs final.
  out = out.replace(/\b[a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9-]*){2,}\b/g, (match) => {
    if (/^v?\d+(\.\d+)+$/.test(match)) return match; // version
    if (KNOWN_CODE_EXTS.test(match)) return match; // filename
    if (/^\d+(\.\d+)+$/.test(match)) return match; // decimal
    const lastSegment = match.slice(match.lastIndexOf('.') + 1);
    if (!/^[a-zA-Z]{2,6}$/.test(lastSegment)) return match; // not a TLD-shaped tail
    return '<host>';
  });
  return out;
}

function stripIPv6(text: string): string {
  let out = text;
  // Bracketed form (URLs): [::1], [fe80::1], [2001:db8::1]
  out = out.replace(/\[(?:[0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F]{0,4}\]/g, '[<ipv6>]');
  // Full unbracketed: 3+ colon-separated hex groups (avoids HH:MM:SS false positives)
  out = out.replace(/(?<![:\w])(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{0,4}(?![:\w])/g, '<ipv6>');
  // Compressed :: with leading hex groups: fe80::1, 2001:db8::1.
  // Uses \b (not lookbehind) so hex digits before :: don't block the match.
  // std::vector is safe: 's' is not [0-9a-fA-F].
  out = out.replace(
    /\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?\b/g,
    '<ipv6>',
  );
  // Compressed :: without leading hex: ::1, ::ffff:10.0.0.1
  out = out.replace(/(?<![:\w])::(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*)?(?![:\w])/g, '<ipv6>');
  return out;
}

/**
 * Path redaction: home dir, username, generic `/home`/`/Users`/`C:\Users`
 * prefixes (POSIX and Windows), and a generic absolute-path-to-basename
 * collapse. Standalone entry point for callers that only need paths gone
 * (e.g. sanitizeError() — an internal error message, not published data).
 */
export function redactPaths(text: string): string {
  const home = homedir();
  let out = stripHomeAndUser(text, home);
  out = stripGenericUserPrefixes(out);
  out = collapseAbsolutePaths(out);
  return out;
}

/** IPv4/IPv6, email, SSN, phone, and hostname redaction. */
export function redactPii(text: string): string {
  let out = stripIPv4(text);
  out = stripEmail(out);
  out = stripSsnAndPhone(out);
  out = stripHostnames(out);
  out = stripIPv6(out);
  return out;
}

/** API keys, tokens, passwords, private keys, and known provider key formats. */
export function redactSecrets(text: string): string {
  return stripSecretPatterns(text);
}

/**
 * Strip obvious secrets/PII/paths before anything gets sent somewhere it
 * shouldn't (a public GitHub issue, an exported pattern file). Not a
 * substitute for careful callers — this is a last-resort net.
 *
 * Order matters: home/user/generic-prefix replacement must run before the
 * generic absolute-path collapse (so a username-bearing path collapses to
 * `<user>`'s neighborhood correctly), and secret-pattern stripping runs
 * before that path collapse too (a secret string that happens to look
 * path-like should still hit the secret patterns first).
 */
export function redact(text: string): string {
  const home = homedir();
  let out = stripHomeAndUser(text, home);
  out = stripGenericUserPrefixes(out);
  out = stripIPv4(out);
  out = stripEmail(out);
  out = stripSsnAndPhone(out);
  out = stripSecretPatterns(out);
  out = collapseAbsolutePaths(out);
  out = stripHostnames(out);
  out = stripIPv6(out);
  return out;
}
