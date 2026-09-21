/**
 * `monobrowse report` exited 0, and printed nothing at all, on a page that
 * FAILED its budgets — while the report JSON it had already written on disk
 * said `"verdict": "fail"`. Anything gating on exit status (CI, an agent, a
 * shell `&&` chain) saw green on a broken page, which defeats the entire
 * point of the budgets feature.
 *
 * Two things combined to cause it:
 *
 *   1. closeBrowser() could hang. Its timers were unref'd, so once Chrome's
 *      CDP socket went away nothing was left holding the event loop open and
 *      Node exited before those timers ever fired. (browser.ts; the poll-loop
 *      half of this is #314's launch-close-settle.test.ts.)
 *
 *   2. commands-report.ts awaited that teardown in a `finally` positioned
 *      BETWEEN producing the result and printing it. So a hung teardown took
 *      the verdict down with it: the print never ran, `exitCode: 1` was never
 *      returned, and Node drained the loop and exited 0.
 *
 * (1) alone is not enough to make this safe — any future teardown hang would
 * silently reintroduce it. (2) is the ordering fix: print the verdict and fix
 * process.exitCode BEFORE teardown, so a teardown that never settles can no
 * longer turn a failing page green.
 *
 * WHY THIS IS A SUBPROCESS TEST. The bug only exists in the semantics of a
 * real process exit — "the event loop drained while a promise was still
 * pending, so Node exited with the code it had". An in-process test cannot
 * observe that: vitest's own runner pins the event loop, so the hang simply
 * becomes a pending promise and the exit code is never consulted. (#314's
 * test says the same thing about fake timers.) So this spawns a real `node`
 * and asserts the code the OS sees.
 *
 * WHY IT NEEDS NO CHROME. The suite is deliberately browser-free (see the
 * monobrowse note in .github/workflows/tests.yml) and this keeps it that way.
 * The child imports the REAL built commands-report.js, but next to stub
 * `session.js` / `report/index.js` modules in a temp sandbox — commands-report
 * has only those two static imports, and output.js has none, so copying three
 * files reproduces its module graph exactly with no loader hooks and no
 * Node-version-specific API. The stub's closeBrowser() is the hang, modelled
 * as a promise that never settles — which is precisely what an unref'd timer
 * on a dead socket degrades into.
 *
 * Requires `npm run build` (CI's monobrowse job builds before `npm test`).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const distCli = join(here, '..', '..', 'dist', 'src', 'cli');
const hasBuild = existsSync(join(distCli, 'commands-report.js'));

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'monobrowse-report-exit-'));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

/** Stub `cli/session.js`. `closeBrowser` is the failure under test. */
function sessionStub(mode: 'hang' | 'clean'): string {
  const close =
    mode === 'hang'
      ? // Never settles — a teardown that is wedged forever. An unref'd timer
        // racing a dead socket degrades into exactly this.
        'closeBrowser: () => new Promise(() => {}),'
      : 'closeBrowser: async () => {},';
  return `
export const session = {
  client: null, sessionId: '', targetId: '', port: 9222,
  refs: new Map(), parentSessionId: '',
};
export async function ensureConnected(port) {
  session.client = {}; session.sessionId = 'stub-session';
  return { client: session.client, sessionId: session.sessionId };
}
export function print(line) { console.log(line); }
export async function getBrowser() {
  return {
    // Non-undefined so the teardown branch actually runs (it is skipped for
    // a browser this process did not launch).
    getLaunchedPid: () => 4242,
    stopRequestCapture: () => {},
    teardownConsoleCapture: () => {},
    ${close}
    clearActivePort: async () => {},
    clearRefCache: async () => {},
  };
}
export function ensureSignalCleanupHandlers() {}
`;
}

/** Stub `report/index.js` — a run that FAILED its budgets. */
const reportStub = `
const report = {
  verdict: 'fail',
  failures: [{ budget: 'maxConsoleErrors', expected: '<= 0', actual: 3, detail: 'boom' }],
  notes: [],
  trend: undefined,
  diff: undefined,
};
export async function runReport() {
  return {
    report,
    htmlPath: '/stub/r.html',
    jsonPath: '/stub/r.json',
    summary: '✗ FAIL — 1 budget failure(s)',
    historyDir: undefined,
    flake: undefined,
  };
}
export const runReportRepeated = runReport;
export async function readHistory() { return { dir: '/stub', runs: [] }; }
export function toJsonReport(r) { return r; }
`;

/** Harness: mirrors cli.ts's real shape — `main().then(() => process.exit(...))`,
 *  NOT a top-level await. That distinction is the whole bug: with a top-level
 *  await Node notices the unsettled promise and exits 13, but cli.ts's promise
 *  chain simply never runs its `.then`, so the loop drains and the process
 *  exits with whatever process.exitCode holds — 0, unless someone set it. */
const harness = `
import { reportCommand } from './cli/commands-report.js';

async function main() {
  const result = await reportCommand.action({
    args: ['http://127.0.0.1:1/broken.html'],
    flags: { out: '/stub/r.html' },
    cwd: process.cwd(),
    interactive: false,
  });
  // Only reached when teardown settles. cli.ts does exactly this.
  if (result && !result.success) process.exitCode = result.exitCode ?? 1;
}

main()
  .then(() => { process.exit(process.exitCode ?? 0); })
  .catch((err) => { console.error(err?.message ?? String(err)); process.exit(1); });
`;

async function runChild(mode: 'hang' | 'clean'): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  await mkdir(join(sandbox, 'cli'), { recursive: true });
  await mkdir(join(sandbox, 'report'), { recursive: true });
  await cp(join(distCli, 'commands-report.js'), join(sandbox, 'cli', 'commands-report.js'));
  await cp(join(distCli, 'output.js'), join(sandbox, 'cli', 'output.js'));
  await writeFile(join(sandbox, 'cli', 'session.js'), sessionStub(mode), 'utf-8');
  await writeFile(join(sandbox, 'report', 'index.js'), reportStub, 'utf-8');
  await writeFile(join(sandbox, 'run.mjs'), harness, 'utf-8');

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(sandbox, 'run.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: sandbox,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    // A hung teardown must still let the process EXIT (by draining), so if
    // the child is genuinely still alive here the test should fail loudly
    // rather than hang the suite.
    const kill = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.on('close', (code) => {
      clearTimeout(kill);
      resolve({ code, stdout, stderr });
    });
  });
}

describe.skipIf(!hasBuild)('report exit code survives a hung browser teardown', () => {
  it('exits non-zero and prints the verdict even when closeBrowser never settles', async () => {
    const { code, stdout, stderr } = await runChild('hang');

    // THE BUG: this was 0 — a failing page reported as success, with the
    // process exiting cleanly because the loop drained mid-teardown.
    expect(code).toBe(1);
    // ...and the verdict was never printed at all.
    expect(stderr + stdout).toContain('FAIL');
    expect(stdout).toContain('maxConsoleErrors');
  }, 30_000);

  it('still exits non-zero on the normal path where teardown completes', async () => {
    const { code, stdout, stderr } = await runChild('clean');

    expect(code).toBe(1);
    expect(stderr + stdout).toContain('FAIL');
  }, 30_000);
});

describe.skipIf(hasBuild)('report exit code subprocess test', () => {
  it('is skipped because dist/ is not built (run `npm run build`)', () => {
    expect(hasBuild).toBe(false);
  });
});
