/**
 * C6 — Crash reporter redaction is weaker than docs claim
 *
 * Before fix: redact() only catches /home/<user>, /Users/<user>, C:\Users\<user>
 * plus 12 hard-coded secret regexes. It misses:
 *   - project-relative paths in stack frames (leaks repo name, file structure)
 *   - non-/Users paths (/var, /srv, /data, /tmp/build, docker volumes)
 *   - IP addresses (IPv4 and IPv6)
 *   - internal hostnames
 *   - emails embedded in error messages
 *   - customer names / arbitrary PII in err.message
 *
 * The README and doc/commands/cli-reference.md:67 claim "secret/PII-scrubbed"
 * — which overstates what redact() actually does.
 *
 * After fix: redact() strips paths to basename-only, scrubs IPs, emails,
 * and hostnames. The README claim becomes true.
 */
import { describe, expect, it } from 'vitest';
import { redact } from '../../packages/@monomind/cli/src/services/crash-reporter.js';

describe('C6 — crash reporter redaction strength', () => {
  it('strips project-relative paths in stack frames to basename', () => {
    const input =
      "TypeError: cannot read 'x' of undefined\n" +
      '    at handler (~/projects/acme-merger/src/deal_eval.ts:42:17)\n' +
      '    at Object.<anonymous> (~/projects/acme-merger/src/index.ts:10:1)';
    const out = redact(input);
    // The directory chain above the basename must NOT survive.
    expect(out).not.toContain('projects/acme-merger');
    expect(out).not.toContain('acme-merger/src');
    expect(out).not.toContain('src/deal_eval');
    expect(out).not.toContain('src/index');
    // Filename without path IS useful for debugging and safe to keep.
    expect(out).toMatch(/deal_eval\.ts/);
  });

  it('strips non-/Users paths (/var, /srv, /data, /tmp)', () => {
    const paths = [
      '/var/log/monomind/output.log',
      '/srv/app/dist/index.js',
      '/data/projects/billing/src/charge.ts',
      '/tmp/build-1234/src/main.ts',
    ];
    for (const p of paths) {
      const out = redact(`error at ${p}: boom`);
      expect(out).not.toContain(p);
      // The path should be reduced to basename — full path must not leak
      expect(out).not.toMatch(/\/(var|srv|data|tmp)\/[^<]/);
    }
  });

  it('strips Docker-style container paths', () => {
    const input = '    at handler (/app/src/index.ts:42:5)';
    const out = redact(input);
    expect(out).not.toContain('/app/src/index.ts');
  });

  it('strips IPv4 addresses', () => {
    const input = 'ECONNREFUSED 10.0.0.5:5432 — postgres unavailable';
    const out = redact(input);
    expect(out).not.toContain('10.0.0.5');
    expect(out).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it('strips IPv6 addresses', () => {
    const input = 'fetch failed: connect to fd12:3456:789a:1::1 timed out';
    const out = redact(input);
    expect(out).not.toContain('fd12:3456:789a:1::1');
  });

  it('strips email addresses', () => {
    const input =
      'ValidationError: invalid customer email moritze@example-corp.com at field billing';
    const out = redact(input);
    expect(out).not.toContain('moritze@example-corp.com');
    expect(out).not.toContain('example-corp.com');
  });

  it('strips internal hostnames', () => {
    const input = 'failed to reach https://internal.acme-corp.io/api/v2/charge — 503';
    const out = redact(input);
    expect(out).not.toContain('internal.acme-corp.io');
  });

  it('redacts PII embedded in err.message (SSN, phone)', () => {
    const input = 'ValidationError: SSN 123-45-6789 is invalid for customer +1-555-867-5309';
    const out = redact(input);
    expect(out).not.toContain('123-45-6789');
    expect(out).not.toContain('555-867-5309');
  });

  it('preserves the error type and message structure (still debuggable)', () => {
    const input = "TypeError: cannot read property 'id' of undefined";
    const out = redact(input);
    expect(out).toContain('TypeError');
    expect(out).toContain("cannot read property 'id'");
  });

  it('keeps the existing secret patterns working (regression guard)', () => {
    const input = 'using ANTHROPIC_API_KEY=sk-ant-abc123def456ghi789jkl012mno345pqr678';
    const out = redact(input);
    expect(out).not.toContain('sk-ant-abc123');
    expect(out).toContain('[redacted]');
  });
});
