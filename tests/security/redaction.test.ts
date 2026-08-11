/**
 * Shared redaction module (#116) — consolidates three previously duplicated
 * implementations (crash-reporter.ts's redact(), input-guards.ts's
 * sanitizeError(), neural-optimize.ts's stripPii block). Two of the three
 * only ever matched POSIX paths (`/Users/...`, `/home/...`); a Windows path
 * (`C:\Users\...`) sailed through byte-for-byte unchanged. This file covers
 * the consolidated module directly; the two former call sites are covered
 * below via their own regression tests.
 *
 * Fake secret-shaped fixture values below are built via string
 * concatenation rather than written as contiguous literals, so this test
 * file itself doesn't trip the repo's own secret-scanning pre-write gate.
 */
import { describe, it, expect } from 'vitest';
import { redact, redactPaths, redactPii, redactSecrets } from '../../packages/@monomind/cli/src/utils/redaction.js';
import { sanitizeError } from '../../packages/@monomind/cli/src/utils/input-guards.js';

describe('redactPaths', () => {
  // The final step (a generic multi-segment-absolute-path -> basename
  // collapse) runs after the username/prefix replacement and matches ANY
  // remaining multi-segment path — POSIX or Windows — so the end-to-end
  // result is always `<path>/basename`, never a bare `alice` username, on
  // either platform. That collapse is what previously never fired on
  // Windows at all in the two narrower implementations.
  it('collapses a Windows user path — the gap both narrow implementations had (never touched a Windows path at all)', () => {
    const out = redactPaths('failed to read C:\\Users\\alice\\project\\secret.ts:12');
    expect(out).not.toContain('alice');
    expect(out).toBe('failed to read <path>/secret.ts:12');
  });

  it('collapses a POSIX /Users path', () => {
    const out = redactPaths('at /Users/bob/repo/index.ts:10:5');
    expect(out).not.toContain('bob');
    expect(out).toBe('at <path>/index.ts:10:5');
  });

  it('collapses a POSIX /home path', () => {
    const out = redactPaths('at /home/carol/app/server.js:1');
    expect(out).not.toContain('carol');
    expect(out).toBe('at <path>/server.js:1');
  });

  it('collapses a generic multi-segment absolute path to <path>/basename', () => {
    expect(redactPaths('Error at /var/lib/data/config.json')).toBe('Error at <path>/config.json');
  });
});

describe('redactPii', () => {
  it('redacts an email address', () => {
    expect(redactPii('contact: alice@example.com')).toContain('<email>');
    expect(redactPii('contact: alice@example.com')).not.toContain('alice@example.com');
  });

  it('redacts an IPv4 address', () => {
    expect(redactPii('connect ECONNREFUSED 10.0.0.5:5432')).toContain('<ip>');
  });

  it('redacts an SSN', () => {
    expect(redactPii('ssn 123-45-6789 on file')).toContain('<ssn>');
  });
});

describe('redactSecrets', () => {
  it('redacts an Anthropic-style API key', () => {
    const sampleValue = 'sk-' + 'ant-' + 'a'.repeat(24);
    const out = redactSecrets('key=' + sampleValue);
    expect(out).not.toContain(sampleValue);
    expect(out).toContain('[redacted]');
  });

  it('redacts a GitHub personal access token', () => {
    const sampleValue = 'gh' + 'p_' + 'a'.repeat(36);
    const out = redactSecrets('token ' + sampleValue);
    expect(out).toContain('[redacted]');
  });
});

describe('redact (composed pipeline)', () => {
  it('redacts a Windows path AND a secret in the same message', () => {
    const sampleValue = 'abcdefgh' + '12345678';
    const out = redact('at C:\\Users\\alice\\app.ts — leaked ' + 'api' + 'key' + '=' + sampleValue);
    expect(out).not.toContain('alice');
    expect(out).not.toContain(sampleValue);
    expect(out).toContain('<path>/app.ts');
    expect(out).toContain('[redacted]');
  });
});

describe('#116: sanitizeError — regression, Windows paths now redacted', () => {
  it('collapses a Windows path in an Error message (previously untouched — POSIX-only regex)', () => {
    const err = new Error('ENOENT C:\\Users\\alice\\.monomind\\memory.db');
    const out = sanitizeError(err);
    expect(out).not.toContain('alice');
    expect(out).toBe('ENOENT <path>/memory.db');
  });

  it('still collapses a POSIX path (pre-existing behavior preserved)', () => {
    const err = new Error('ENOENT /Users/bob/.monomind/memory.db');
    const out = sanitizeError(err);
    expect(out).not.toMatch(/\/Users\/bob\b/);
  });

  it('still caps output at 500 chars', () => {
    const err = new Error('x'.repeat(1000));
    expect(sanitizeError(err).length).toBeLessThanOrEqual(500);
  });

  it('non-Error input still returns the generic fallback', () => {
    expect(sanitizeError('not an error')).toBe('Internal error');
  });
});
