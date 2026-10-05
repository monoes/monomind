/**
 * Guard: a test run must not write per-project data into the developer's
 * home (#347). Suites that run memory/init code used to create
 * ~/.monomind/projects/<name>-<hash> folders and ~/.monomind-projects.json
 * entries for every temp project they touched — 23k folders on one machine.
 *
 * Each case runs a few suites known to reach the per-project store in a child
 * vitest whose HOME is a fresh sentinel directory, the way a developer's real
 * home looks to the run. The shared setup must move every test off that home,
 * so afterwards the sentinel must hold no project folder and no registry.
 * Checking a run-unique sentinel instead of the real ~/.monomind keeps the
 * guard exact under other processes writing there concurrently, and never
 * adds litter to the real home when the isolation breaks.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
const base = mkdtempSync(join(tmpdir(), 'mm-home-guard-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** The parent run's environment minus its own vitest and isolation state. */
function childEnv(home: string, tmp: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^VITEST/.test(k) || k === 'TEST' || k === 'NODE_ENV') continue;
    if (k === 'MONOMIND_TEST_REAL_HOME' || k === 'MONOMIND_GLOBAL_BRAIN_DIR') continue;
    env[k] = v;
  }
  return { ...env, HOME: home, USERPROFILE: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
}

function runSuites(name: string, root: string, files: string[], tmpUnderHome = false) {
  const home = join(base, name, 'home');
  const tmp = tmpUnderHome ? join(home, 'tmp') : join(base, name, 'tmp');
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const report = join(base, name, 'report.json');
  const r = spawnSync(
    process.execPath,
    [VITEST, 'run', ...files, '--reporter=json', `--outputFile=${report}`],
    { cwd: root, env: childEnv(home, tmp), encoding: 'utf-8', timeout: 240_000 },
  );
  const summary = existsSync(report)
    ? (JSON.parse(readFileSync(report, 'utf-8')) as { numPassedTests: number; success: boolean })
    : null;
  const projectsDir = join(home, '.monomind', 'projects');
  return {
    status: r.status,
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000),
    summary,
    projects: existsSync(projectsDir) ? readdirSync(projectsDir) : [],
    registry: existsSync(join(home, '.monomind-projects.json')),
  };
}

describe('test runs leave the real home alone (#347)', () => {
  it('isolates the test home when TMPDIR is under the original HOME (#591)', () => {
    const r = runSuites('home-rooted-tmp', REPO, ['tests/setup/env-isolation.test.ts'], true);
    expect(r.summary?.numPassedTests ?? 0, r.output).toBeGreaterThan(0);
    expect(r.status, r.output).toBe(0);
    expect(r.projects).toEqual([]);
    expect(r.registry).toBe(false);
  }, 250_000);

  it('root suites that open the per-project memory store', () => {
    const r = runSuites('root', REPO, [
      'tests/security/memory-tools-validation.test.ts',
      'tests/security/memory-bridge-error-surfacing.test.ts',
    ]);
    expect(r.summary?.numPassedTests ?? 0, r.output).toBeGreaterThan(0);
    expect(r.status, r.output).toBe(0);
    expect(r.projects).toEqual([]);
    expect(r.registry).toBe(false);
  }, 250_000);

  it('CLI suites that create per-project stores for temp projects', () => {
    const r = runSuites('cli', join(REPO, 'packages', '@monomind', 'cli'), [
      'src/__tests__/agent-ops.test.ts',
      'src/__tests__/status-command-regressions.test.ts',
      'src/__tests__/knowledge-mcp-parity.test.ts',
    ]);
    expect(r.summary?.numPassedTests ?? 0, r.output).toBeGreaterThan(0);
    expect(r.status, r.output).toBe(0);
    expect(r.projects).toEqual([]);
    expect(r.registry).toBe(false);
  }, 250_000);
});
