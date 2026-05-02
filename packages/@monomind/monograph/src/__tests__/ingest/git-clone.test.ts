import { describe, it, expect } from 'vitest';
import { validateGitUrl, extractRepoName, getCloneDir } from '../../ingest/git-clone.js';
import os from 'os';
import path from 'path';

// ── validateGitUrl ─────────────────────────────────────────────────────────────

describe('validateGitUrl', () => {
  // ── Allowed ──────────────────────────────────────────────────────────────────
  it('allows https:// URLs', () => {
    expect(() => validateGitUrl('https://github.com/org/repo.git')).not.toThrow();
  });

  it('allows http:// URLs', () => {
    expect(() => validateGitUrl('http://github.com/org/repo.git')).not.toThrow();
  });

  // ── Scheme blocks ─────────────────────────────────────────────────────────────
  it('blocks git:// scheme', () => {
    expect(() => validateGitUrl('git://github.com/org/repo.git')).toThrow();
  });

  it('blocks ssh:// scheme', () => {
    expect(() => validateGitUrl('ssh://github.com/org/repo.git')).toThrow();
  });

  it('blocks file:// scheme', () => {
    expect(() => validateGitUrl('file:///etc/passwd')).toThrow();
  });

  // ── Blocked hostnames ─────────────────────────────────────────────────────────
  it('blocks localhost', () => {
    expect(() => validateGitUrl('https://localhost/repo')).toThrow();
  });

  it('blocks metadata.google.internal', () => {
    expect(() => validateGitUrl('https://metadata.google.internal/repo')).toThrow();
  });

  it('blocks metadata.azure.com', () => {
    expect(() => validateGitUrl('https://metadata.azure.com/repo')).toThrow();
  });

  // ── Private IPv4 ──────────────────────────────────────────────────────────────
  it('blocks 127.0.0.1', () => {
    expect(() => validateGitUrl('https://127.0.0.1/repo')).toThrow();
  });

  it('blocks 10.0.0.1', () => {
    expect(() => validateGitUrl('https://10.0.0.1/repo')).toThrow();
  });

  it('blocks 192.168.1.1', () => {
    expect(() => validateGitUrl('https://192.168.1.1/repo')).toThrow();
  });

  it('blocks 172.16.0.1 (RFC1918)', () => {
    expect(() => validateGitUrl('https://172.16.0.1/repo')).toThrow();
  });

  it('blocks 172.31.255.255 (RFC1918)', () => {
    expect(() => validateGitUrl('https://172.31.255.255/repo')).toThrow();
  });

  it('blocks 169.254.169.254 (link-local)', () => {
    expect(() => validateGitUrl('https://169.254.169.254/repo')).toThrow();
  });

  // ── IPv6 private ──────────────────────────────────────────────────────────────
  it('blocks IPv6 loopback ::1', () => {
    expect(() => validateGitUrl('https://[::1]/repo')).toThrow();
  });

  it('blocks IPv6 Unique Local fc00::', () => {
    expect(() => validateGitUrl('https://[fc00::1]/repo')).toThrow();
  });

  it('blocks IPv6 link-local fe80::', () => {
    expect(() => validateGitUrl('https://[fe80::1]/repo')).toThrow();
  });

  it('blocks IPv4-mapped IPv6 ::ffff:127.0.0.1', () => {
    expect(() => validateGitUrl('https://[::ffff:127.0.0.1]/repo')).toThrow();
  });

  // ── Numeric IP encodings ───────────────────────────────────────────────────────
  it('blocks decimal IP encoding 2130706433 (127.0.0.1)', () => {
    expect(() => validateGitUrl('https://2130706433/repo')).toThrow();
  });

  it('blocks hex IP encoding 0x7f000001 (127.0.0.1)', () => {
    expect(() => validateGitUrl('https://0x7f000001/repo')).toThrow();
  });

  // ── Invalid URL ───────────────────────────────────────────────────────────────
  it('throws for an invalid URL', () => {
    expect(() => validateGitUrl('not a url')).toThrow();
  });
});

// ── extractRepoName ────────────────────────────────────────────────────────────

describe('extractRepoName', () => {
  it('extracts repo name from https URL with .git suffix', () => {
    expect(extractRepoName('https://github.com/org/my-repo.git')).toBe('my-repo');
  });

  it('extracts repo name from https URL without .git suffix', () => {
    expect(extractRepoName('https://github.com/org/my-repo')).toBe('my-repo');
  });

  it('extracts repo name from https URL with trailing slash', () => {
    expect(extractRepoName('https://github.com/org/my-repo/')).toBe('my-repo');
  });

  it('extracts repo name from SSH URL', () => {
    expect(extractRepoName('git@github.com:org/my-repo.git')).toBe('my-repo');
  });
});

// ── getCloneDir ────────────────────────────────────────────────────────────────

describe('getCloneDir', () => {
  it('returns path under ~/.monograph/repos/<name>', () => {
    const expected = path.join(os.homedir(), '.monograph', 'repos', 'my-repo');
    expect(getCloneDir('my-repo')).toBe(expected);
  });
});
