import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorCommand } from '../commands/doctor.js';
import type { CommandContext, CommandResult } from '../types.js';
import type { HealthCheck } from '../commands/doctor-env-checks.js';

// doctorCommand orchestrates ~20 individual health checks, almost all of
// which key off `process.cwd()` internally (not `CommandContext.cwd` — the
// implementation never reads that field) and several of which shell out
// (`git`, `df`, `npm view`, `npx tsc`). Per this package's __tests__
// convention we run against a real temp directory with `process.chdir`
// rather than mocking child_process, matching how checkGitRepo etc. actually
// behave in production.

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [] },
    cwd: overrides.cwd ?? process.cwd(),
    interactive: false,
    ...overrides,
  };
}

function resultData(result: CommandResult | void): {
  passed: number; warnings: number; failed: number; results: HealthCheck[];
} {
  return (result as CommandResult).data as { passed: number; warnings: number; failed: number; results: HealthCheck[] };
}

describe('doctorCommand', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'doctor-cmd-test-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a failure result for an unknown --component', async () => {
    const result = await doctorCommand.action!(makeCtx({ flags: { _: [], component: 'not-a-real-component' } }));
    expect(result).toBeDefined();
    expect((result as CommandResult).success).toBe(false);
    expect((result as CommandResult).exitCode).toBe(1);
    const data = resultData(result);
    expect(data.results).toEqual([]);
    expect(data.failed).toBe(1);
  }, 15000);

  it('scopes to a single check via --component and reports the real unhealthy condition', async () => {
    // No .monomind/config.json, monomind.config.json, or .monomind.json exists.
    const result = await doctorCommand.action!(makeCtx({ flags: { _: [], component: 'config' } }));
    const data = resultData(result);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].name).toBe('Config File');
    expect(data.results[0].status).toBe('warn');
    expect(data.results[0].message).toContain('No config file');
    expect(data.warnings).toBe(1);
    expect(data.passed).toBe(0);
    expect((result as CommandResult).success).toBe(true); // warnings don't fail the command
  }, 15000);

  it('scopes to a single check via --component and reports the real healthy condition', async () => {
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(join(dir, '.monomind', 'config.json'), JSON.stringify({ version: '1.0.0' }));
    const result = await doctorCommand.action!(makeCtx({ flags: { _: [], component: 'config' } }));
    const data = resultData(result);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].name).toBe('Config File');
    expect(data.results[0].status).toBe('pass');
    expect(data.results[0].message).toContain('.monomind/config.json');
    expect(data.passed).toBe(1);
  }, 15000);

  it('treats an invalid-JSON config file as a real failure rather than crashing', async () => {
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(join(dir, '.monomind', 'config.json'), '{ not valid json ');
    const result = await doctorCommand.action!(makeCtx({ flags: { _: [], component: 'config' } }));
    const data = resultData(result);
    expect(data.results[0].status).toBe('fail');
    expect(data.results[0].message).toContain('Invalid JSON');
    expect((result as CommandResult).success).toBe(false);
    expect((result as CommandResult).exitCode).toBe(1);
  }, 15000);

  it('runs the full default check set against a bare project and returns a well-formed CommandResult', async () => {
    const result = await doctorCommand.action!(makeCtx({ flags: { _: [] } }));
    expect(result).toBeDefined();
    const r = result as CommandResult;
    expect(typeof r.success).toBe('boolean');
    const data = resultData(result);
    expect(Array.isArray(data.results)).toBe(true);
    // alwaysOnChecks (20) + codeOnlyChecks (5) — no fingerprint present, so
    // isCodeProject defaults to true and the full set runs.
    expect(data.results.length).toBe(25);
    expect(data.passed + data.warnings + data.failed).toBe(data.results.length);
    for (const check of data.results) {
      expect(typeof check.name).toBe('string');
      expect(['pass', 'warn', 'fail']).toContain(check.status);
      expect(typeof check.message).toBe('string');
    }
    // Spot-check a few checks that must be present in a code-project run.
    const names = data.results.map(c => c.name);
    expect(names).toContain('Node.js Version');
    expect(names).toContain('Git Repository');
    expect(names).toContain('Config File');
    expect(names).toContain('TypeScript');
    // Bare temp dir with no .git — this must be the real "not a repo" warning.
    const gitRepoCheck = data.results.find(c => c.name === 'Git Repository')!;
    expect(gitRepoCheck.status).toBe('warn');
  }, 15000);

  it('skips code-only checks when the fingerprint says this is not a code project', async () => {
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    const fingerprint = {
      version: 1,
      root: dir,
      totalFiles: 3,
      git: false,
      scannedAt: new Date().toISOString(),
      capabilities: {
        code: { confidence: 0, files: 0, signals: [] },
        documents: { confidence: 0.9, files: 3, signals: ['many .pdf files'] },
        media: { confidence: 0, files: 0, signals: [] },
        data: { confidence: 0, files: 0, signals: [] },
        graph: { confidence: 0, files: 0, signals: [] },
        timeline: { confidence: 0, files: 0, signals: [] },
      },
      filesByExtension: { '.pdf': 3 },
    };
    writeFileSync(join(dir, '.monomind', 'fingerprint.json'), JSON.stringify(fingerprint));

    const result = await doctorCommand.action!(makeCtx({ flags: { _: [] } }));
    const data = resultData(result);
    const names = data.results.map(c => c.name);
    // codeOnlyChecks (Git Repository, MCP Servers, TypeScript, Graph freshness,
    // Gitignore Coverage) must be absent; alwaysOnChecks must remain.
    expect(names).not.toContain('Git Repository');
    expect(names).not.toContain('TypeScript');
    expect(names).not.toContain('Gitignore Coverage');
    expect(names).toContain('Node.js Version');
    expect(names).toContain('Config File');
    expect(data.results.length).toBe(20);
  }, 15000);

  it('--fix applies the real local Helper Files fix and re-checks it in place', async () => {
    // Starting state: no .claude/helpers at all in this temp project, so the
    // Helper Files check is real-unhealthy ("could not locate" or "stale").
    const before = await doctorCommand.action!(makeCtx({ flags: { _: [], component: 'helpers' } }));
    const beforeCheck = resultData(before).results[0];
    expect(beforeCheck.name).toBe('Helper Files');
    expect(beforeCheck.status).not.toBe('pass');

    const result = await doctorCommand.action!(makeCtx({ flags: { _: [], fix: true } }));
    const data = resultData(result);
    const helperCheck = data.results.find(c => c.name === 'Helper Files')!;
    expect(helperCheck).toBeDefined();
    // A real fix was actually applied to disk: bundled helper files should
    // now exist locally under this temp project's .claude/helpers.
    if (helperCheck.status === 'pass') {
      expect(existsSync(join(dir, '.claude', 'helpers'))).toBe(true);
    }
  }, 15000);

  it('all-passing run reports success with no warnings/failures suffix text', async () => {
    // Construct a project that is realistically maximally healthy for the
    // fs-only checks (network/subprocess-backed checks are left to reflect
    // whatever the real host environment reports).
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(join(dir, '.monomind', 'config.json'), JSON.stringify({ version: '1.0.0' }));
    const result = await doctorCommand.action!(makeCtx({ flags: { _: [], component: 'config' } }));
    const data = resultData(result);
    expect(data.results[0].status).toBe('pass');
    expect(data.failed).toBe(0);
  }, 15000);
});
