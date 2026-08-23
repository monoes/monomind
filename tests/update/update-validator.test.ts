// packages/@monomind/cli/__tests__/update/update-validator.test.ts
//
// Tests for the update validator's security boundary:
//   - Package name validation (accepts valid, rejects shell metacharacters / path traversal)
//   - Version format validation (accepts semver, rejects path-shaped or oversized strings)
//   - Bulk update cap enforcement
//   - Compatibility matrix / breaking change detection (functional, not security)

import { describe, expect, it } from 'vitest';
import {
  validateBulkUpdate,
  validateUpdate,
} from '../../packages/@monomind/cli/src/update/validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand: validate a single update with no installed packages. */
function v(pkg: string, from: string, to: string) {
  return validateUpdate(pkg, from, to, {});
}

// ---------------------------------------------------------------------------
// Package name validation
// ---------------------------------------------------------------------------

describe('validateUpdate — package name validation', () => {
  it('accepts a plain unscoped name', () => {
    expect(v('monomind', '1.0.0', '1.0.1').valid).toBe(true);
  });

  it('accepts a scoped name', () => {
    expect(v('@monoes/monomindcli', '1.0.0', '1.0.1').valid).toBe(true);
  });

  it('accepts names with dots, hyphens, underscores', () => {
    expect(v('my-pkg_v2.beta', '1.0.0', '1.0.1').valid).toBe(true);
  });

  it('rejects empty string', () => {
    const r = v('', '1.0.0', '1.0.1');
    expect(r.valid).toBe(false);
    expect(r.incompatibilities).toContain('Invalid package name');
  });

  it('rejects shell metacharacters: semicolon', () => {
    expect(v('pkg;rm -rf /', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects shell metacharacters: backtick', () => {
    expect(v('pkg`id`', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects shell metacharacters: pipe', () => {
    expect(v('pkg|cat /etc/passwd', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects shell metacharacters: $() subshell', () => {
    expect(v('$(whoami)', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects shell metacharacters: ampersand', () => {
    expect(v('pkg&bg', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects path traversal: ../etc/passwd', () => {
    expect(v('../etc/passwd', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects path traversal: names starting with a dot', () => {
    // npm spec says names must not start with .
    expect(v('.hidden', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects spaces in name', () => {
    expect(v('my package', '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects names exceeding 200 characters', () => {
    const long = 'a'.repeat(201);
    expect(v(long, '1.0.0', '1.0.1').valid).toBe(false);
  });

  it('rejects non-string input', () => {
    // TypeScript would prevent this at compile time, but at runtime
    // a crafted object could pass anything.
    const r = validateUpdate(42 as unknown as string, '1.0.0', '1.0.1', {});
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Version format validation
// ---------------------------------------------------------------------------

describe('validateUpdate — version format validation', () => {
  it('accepts standard semver', () => {
    expect(v('monomind', '2.8.4', '2.8.5').valid).toBe(true);
  });

  it('accepts semver with pre-release tag', () => {
    expect(v('monomind', '2.8.4-beta.1', '2.8.5').valid).toBe(true);
  });

  it('accepts semver with build metadata', () => {
    expect(v('monomind', '2.8.4+build.123', '2.8.5').valid).toBe(true);
  });

  it('rejects version that looks like a file path', () => {
    const r = v('monomind', '1.0.0', '../../etc/passwd');
    expect(r.valid).toBe(false);
    expect(r.incompatibilities).toContain('Invalid version string(s)');
  });

  it('rejects version with shell injection', () => {
    expect(v('monomind', '1.0.0', '1.0.0;rm -rf /').valid).toBe(false);
  });

  it('rejects version that is a URL', () => {
    expect(v('monomind', '1.0.0', 'https://evil.com/payload.tgz').valid).toBe(false);
  });

  it('rejects version with spaces', () => {
    expect(v('monomind', '1.0.0', '1.0.0 --scripts-prepend-node-path').valid).toBe(false);
  });

  it('rejects oversized version string (>64 chars)', () => {
    const long = `1.0.${'0'.repeat(62)}`;
    expect(v('monomind', '1.0.0', long).valid).toBe(false);
  });

  it('rejects non-string version input', () => {
    const r = validateUpdate('monomind', null as unknown as string, '1.0.1', {});
    expect(r.valid).toBe(false);
  });

  it('rejects when fromVersion is invalid', () => {
    const r = v('monomind', 'not-a-version', '1.0.1');
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Compatibility matrix / breaking change detection (functional correctness)
// ---------------------------------------------------------------------------

describe('validateUpdate — compatibility checks', () => {
  it('warns on major version bump', () => {
    const r = v('monomind', '1.9.9', '2.0.0');
    expect(r.warnings.some((w) => w.includes('Major version update'))).toBe(true);
  });

  it('includes known breaking changes for monomind 2.0.0', () => {
    const r = v('monomind', '1.9.9', '2.0.0');
    expect(r.warnings.some((w) => w.includes('CLI commands renamed'))).toBe(true);
  });

  it('detects incompatible installed dependency', () => {
    // monomind requires @monoes/monomindcli >= 1.11.0
    const r = validateUpdate('monomind', '2.0.0', '2.1.0', {
      '@monoes/monomindcli': '1.5.0',
    });
    expect(r.valid).toBe(false);
    expect(r.incompatibilities.some((i) => i.includes('@monoes/monomindcli'))).toBe(true);
  });

  it('passes when installed deps satisfy requirements', () => {
    const r = validateUpdate('monomind', '2.0.0', '2.1.0', {
      '@monoes/monomindcli': '1.11.0',
    });
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bulk update validation
// ---------------------------------------------------------------------------

describe('validateBulkUpdate', () => {
  it('rejects when more than 50 updates are submitted', () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({
      package: `pkg-${i}`,
      from: '1.0.0',
      to: '1.0.1',
    }));
    const r = validateBulkUpdate(updates, {});
    expect(r.valid).toBe(false);
    expect(r.incompatibilities.some((i) => i.includes('Too many updates'))).toBe(true);
  });

  it('accepts exactly 50 updates', () => {
    const updates = Array.from({ length: 50 }, (_, i) => ({
      package: `pkg${i}`,
      from: '1.0.0',
      to: '1.0.1',
    }));
    const r = validateBulkUpdate(updates, {});
    expect(r.valid).toBe(true);
  });

  it('rejects non-array input', () => {
    const r = validateBulkUpdate(
      'not-an-array' as unknown as Array<{ package: string; from: string; to: string }>,
      {},
    );
    expect(r.valid).toBe(false);
  });

  it('propagates single-update validation failures', () => {
    const r = validateBulkUpdate([{ package: '; rm -rf /', from: '1.0.0', to: '1.0.1' }], {});
    expect(r.valid).toBe(false);
  });
});
