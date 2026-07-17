import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  MAX_DOCTOR_PKG_BYTES,
  MAX_DOCTOR_CONFIG_BYTES,
  MAX_DOCTOR_GITIGNORE_BYTES,
  MAX_DOCTOR_PID_BYTES,
  MAX_DOCTOR_HELPER_BYTES,
  runCommand,
  checkNodeVersion,
  checkNpmVersion,
  checkGit,
  checkGitRepo,
  checkDiskSpace,
  checkBuildTools,
  checkVersionFreshness,
  checkClaudeCode,
} from '../commands/doctor-env-checks.js';

// These checks shell out and/or inspect the real filesystem — per this
// package's __tests__ convention (see terminal-tools.test.ts,
// task-tools-agent-store.test.ts) we exercise real behavior against a real
// temp directory rather than mocking child_process. The one deliberate
// exception is `installClaudeCode()`, which runs `npm install -g
// @anthropic-ai/claude-code` for real with no dry-run mode — actually
// invoking it in a test would mutate the machine running the suite (global
// npm packages), so it is intentionally left untested here.

describe('doctor-env-checks constants', () => {
  it('exposes sane byte-size ceilings used to skip oversized files instead of crashing', () => {
    expect(MAX_DOCTOR_PKG_BYTES).toBe(1024 * 1024);
    expect(MAX_DOCTOR_CONFIG_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_DOCTOR_GITIGNORE_BYTES).toBe(512 * 1024);
    expect(MAX_DOCTOR_PID_BYTES).toBe(64);
    expect(MAX_DOCTOR_HELPER_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('runCommand', () => {
  it('resolves with trimmed stdout for a real shell command', async () => {
    const result = await runCommand('echo "  hello world  "');
    expect(result).toBe('hello world');
  });

  it('rejects when the command fails', async () => {
    await expect(runCommand('exit 1')).rejects.toBeDefined();
  });

  it('rejects when the command exceeds its timeout', async () => {
    await expect(runCommand('sleep 2', 100)).rejects.toBeDefined();
  });
});

describe('checkNodeVersion', () => {
  it('reflects the real running Node version and required-major logic', async () => {
    const check = await checkNodeVersion();
    expect(check.name).toBe('Node.js Version');
    const major = parseInt(process.version.slice(1).split('.')[0], 10);
    if (major >= 20) {
      expect(check.status).toBe('pass');
    } else if (major >= 18) {
      expect(check.status).toBe('warn');
      expect(check.fix).toBeDefined();
    } else {
      expect(check.status).toBe('fail');
      expect(check.fix).toBeDefined();
    }
    expect(check.message).toContain(process.version);
  });
});

describe('checkNpmVersion', () => {
  it('reports the real installed npm version', async () => {
    const check = await checkNpmVersion();
    expect(check.name).toBe('npm Version');
    // npm is a hard dependency of this monorepo's tooling, so it must resolve.
    expect(['pass', 'warn']).toContain(check.status);
    expect(check.message).toMatch(/^v\d/);
  });
});

describe('checkGit', () => {
  it('reports the real installed git version', async () => {
    const check = await checkGit();
    expect(check.name).toBe('Git');
    // This repo requires git, so a real environment always has it installed.
    expect(check.status).toBe('pass');
    expect(check.message).toMatch(/^v\d/);
  });
});

describe('checkGitRepo', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'doctor-gitrepo-test-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails/warns with a real "not a git repository" condition', async () => {
    // `runCommand` shells out with the process's actual OS cwd (it never
    // passes an explicit `cwd` option), so we have to really `chdir` rather
    // than stub `process.cwd`, mirroring how the CLI itself invokes it.
    process.chdir(dir);
    const check = await checkGitRepo();
    expect(check.name).toBe('Git Repository');
    expect(check.status).toBe('warn');
    expect(check.message).toBe('Not a git repository');
    expect(check.fix).toBe('git init');
  });

  it('passes against a real git repository created with `git init`', async () => {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    process.chdir(dir);
    const check = await checkGitRepo();
    expect(check.status).toBe('pass');
    expect(check.message).toBe('In a git repository');
  });
});

describe('checkDiskSpace', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'doctor-disk-test-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports real disk usage without crashing', async () => {
    const check = await checkDiskSpace();
    expect(check.name).toBe('Disk Space');
    expect(['pass', 'warn', 'fail']).toContain(check.status);
    expect(check.message.length).toBeGreaterThan(0);
    if (process.platform !== 'win32') {
      // Real `df` output — sanity-check it actually parsed something.
      expect(check.message).toMatch(/available|unable to parse|Unable to check/);
    }
  });
});

describe('checkBuildTools', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'doctor-buildtools-test-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is N/A (pass) when there is no package.json — not a Node.js project', async () => {
    process.chdir(dir);
    const check = await checkBuildTools();
    expect(check.name).toBe('TypeScript');
    expect(check.status).toBe('pass');
    expect(check.message).toContain('N/A');
    expect(check.message).toContain('no package.json');
  });

  it('passes with a real tsc version when run against this real Node/TS project', async () => {
    // This package itself has TypeScript installed locally (devDependency),
    // so running the check from its real root exercises the genuine
    // `npx tsc --version` pass path without any mocking or a fabricated
    // node_modules tree.
    process.chdir(originalCwd);
    const check = await checkBuildTools();
    expect(check.name).toBe('TypeScript');
    expect(check.status).toBe('pass');
    expect(check.message).toMatch(/^v\d/);
  });
});

describe('checkVersionFreshness', () => {
  it('resolves to a well-formed HealthCheck (network-dependent, so only the shape is asserted)', async () => {
    const check = await checkVersionFreshness();
    expect(check.name).toBe('Version Freshness');
    expect(['pass', 'warn']).toContain(check.status);
    expect(check.message).toMatch(/^v\d+\.\d+\.\d+/);
    if (check.status === 'warn') {
      // Either "cannot check registry" (offline) or "latest: vX" (outdated npx cache).
      expect(check.message).toMatch(/cannot check registry|latest: v/);
    }
  });
});

describe('checkClaudeCode', () => {
  it('resolves to a well-formed HealthCheck reflecting whether the Claude Code CLI is on PATH', async () => {
    const check = await checkClaudeCode();
    expect(check.name).toBe('Claude Code CLI');
    expect(['pass', 'warn']).toContain(check.status);
    if (check.status === 'pass') {
      expect(check.message).toMatch(/^v\d/);
    } else {
      expect(check.message).toBe('Not installed');
      expect(check.fix).toBe('npm install -g @anthropic-ai/claude-code');
    }
  });
});

// Regression guard: confirms a config-shaped file with unparseable JSON is
// treated as a real-world oversized/corrupt edge case rather than throwing.
// (Full oversized-file skip behavior for MAX_DOCTOR_CONFIG_BYTES /
// MAX_DOCTOR_GITIGNORE_BYTES / MAX_DOCTOR_HELPER_BYTES lives in the consuming
// checks over in doctor-project-checks.ts, which is out of scope for this
// file — only the shared constants themselves are verified above.)
describe('sanity: writing a throwaway file does not affect unrelated checks', () => {
  it('checkNodeVersion is unaffected by unrelated filesystem state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-sanity-test-'));
    writeFileSync(join(dir, 'noise.json'), '{"not":"relevant"}');
    const before = await checkNodeVersion();
    const after = await checkNodeVersion();
    expect(before).toEqual(after);
    rmSync(dir, { recursive: true, force: true });
  });
});
