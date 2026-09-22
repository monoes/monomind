/**
 * #318: two uncoordinated `browse open` invocations with no `--port` raced on
 * the shared default CDP port (9222) and the userDataDir derived from it —
 * one failed outright ("Chrome exited before the CDP endpoint opened on port
 * 9222"), or both attached to ONE Chrome and a single `browse close` killed
 * the other caller's browser too.
 *
 * This is a real-process test on purpose: the bug lives in the interaction
 * between two separate CLI processes and the session state they share on
 * disk, which no in-process unit test can reproduce. It spawns the built CLI
 * (dist/src/cli.js) against a file:// fixture page, so it is skipped when the
 * package has not been built or no Chrome/Chromium is installed.
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CHROME_EXECUTABLES } from '../browser/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', 'dist', 'src', 'cli.js');

function chromeAvailable(): boolean {
  if (CHROME_EXECUTABLES.some((p) => existsSync(p))) return true;
  try {
    return (
      execFileSync('which', ['google-chrome', 'chromium-browser', 'chromium'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().length > 0
    );
  } catch {
    return false;
  }
}

const runnable = existsSync(CLI) && chromeAvailable();

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, profileRoot: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      // Per-trial TMPDIR: every browser profile this invocation creates lands
      // under it, so the sweep in afterEach can identify (and only kill) the
      // Chrome processes this test started.
      env: { ...process.env, TMPDIR: profileRoot, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** The CDP port `open` reports for the session it started. */
function reportedPort(run: Run): number | null {
  const m = /\[port (\d+)\]/.exec(run.stdout);
  return m ? Number(m[1]) : null;
}

async function cdpAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    // Kill anything still running out of this trial's profile root before the
    // directory goes away — a leaked Chrome would otherwise outlive the run.
    await new Promise<void>((resolve) => {
      execFile('pkill', ['-f', dir], () => resolve());
    });
    // A killed Chrome keeps writing out its profile for a moment; retry the
    // removal instead of failing the test on ENOTEMPTY.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

describe.skipIf(!runnable)('#318 concurrent browse sessions (real processes)', () => {
  for (const trial of [1, 2, 3, 4, 5]) {
    it(`trial ${trial}: two bare \`open\` calls each get their own browser, and each close kills only its own`, async () => {
      const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'monobrowse-318-'));
      dirs.push(root);
      const page = join(root, 'fixture.html');
      await writeFile(page, '<!doctype html><title>Fixture</title><h1>hello</h1>');
      const url = `file://${page}`;

      // The reported race: two uncoordinated invocations, same cwd, no --port.
      const [a, b] = await Promise.all([
        runCli(['open', url], root, root),
        runCli(['open', url], root, root),
      ]);

      expect(a.code, `open A failed: ${a.stdout}${a.stderr}`).toBe(0);
      expect(b.code, `open B failed: ${b.stdout}${b.stderr}`).toBe(0);

      const portA = reportedPort(a);
      const portB = reportedPort(b);
      expect(portA, `open A did not report a session port: ${a.stdout}`).not.toBeNull();
      expect(portB, `open B did not report a session port: ${b.stdout}`).not.toBeNull();
      expect(portA).not.toBe(portB);

      expect(await cdpAlive(portA!)).toBe(true);
      expect(await cdpAlive(portB!)).toBe(true);

      // Closing A must leave B's browser running.
      const closeA = await runCli(['close', '--port', String(portA)], root, root);
      expect(closeA.code, `close A failed: ${closeA.stdout}${closeA.stderr}`).toBe(0);
      expect(await cdpAlive(portA!)).toBe(false);
      expect(await cdpAlive(portB!)).toBe(true);

      const closeB = await runCli(['close', '--port', String(portB)], root, root);
      expect(closeB.code, `close B failed: ${closeB.stdout}${closeB.stderr}`).toBe(0);
      expect(await cdpAlive(portB!)).toBe(false);
    }, 90_000);
  }
});

/**
 * Upgrading monobrowse while a session was open used to strand its Chrome:
 * the handle lived in `active-port.json`, which the per-port store replaced.
 * The new CLI adopts that record instead — the same real-process shape as
 * above, since the whole point is what a *later* process can still do.
 */
describe.skipIf(!runnable)('#318 adoption of a pre-#318 session (real processes)', () => {
  /** Open a session, then rewrite its state as a pre-#318 install left it. */
  async function openThenDowngradeState(root: string, url: string): Promise<number> {
    const opened = await runCli(['open', url], root, root);
    expect(opened.code, `open failed: ${opened.stdout}${opened.stderr}`).toBe(0);
    const port = reportedPort(opened);
    expect(port).not.toBeNull();

    const stateDir = join(root, '.monomind', 'monobrowse');
    const record = await readFile(join(stateDir, 'sessions', `${port}.json`), 'utf8');
    await writeFile(join(stateDir, 'active-port.json'), record);
    await rm(join(stateDir, 'sessions'), { recursive: true, force: true });
    return port!;
  }

  it('a later command adopts the legacy session, and close then kills that browser', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'monobrowse-318-legacy-'));
    dirs.push(root);
    const page = join(root, 'fixture.html');
    await writeFile(page, '<!doctype html><title>Fixture</title><h1>hello</h1>');
    const port = await openThenDowngradeState(root, `file://${page}`);

    // A later, separate process with no --port finds it.
    const title = await runCli(['get', 'title'], root, root);
    expect(title.code, `get title failed: ${title.stdout}${title.stderr}`).toBe(0);
    expect(title.stdout).toContain('Fixture');

    // Adopted: it is an ordinary per-port record now, and the old file is gone.
    const stateDir = join(root, '.monomind', 'monobrowse');
    expect(existsSync(join(stateDir, 'sessions', `${port}.json`))).toBe(true);
    expect(existsSync(join(stateDir, 'active-port.json'))).toBe(false);

    // And `--port` works on it exactly like a native session.
    const closed = await runCli(['close', '--port', String(port)], root, root);
    expect(closed.code, `close failed: ${closed.stdout}${closed.stderr}`).toBe(0);
    expect(await cdpAlive(port)).toBe(false);
  }, 90_000);

  it('a legacy record whose browser is gone is cleaned up, and the command still works', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'monobrowse-318-legacy-'));
    dirs.push(root);
    const stateDir = join(root, '.monomind', 'monobrowse');
    await mkdir(stateDir, { recursive: true });
    // A port nothing is listening on — the state an upgrade finds after the
    // old browser died (or was killed) with its record left behind.
    await writeFile(
      join(stateDir, 'active-port.json'),
      JSON.stringify({ port: 23499, launched: true, pid: 999999, savedAt: Date.now() }),
    );

    const closed = await runCli(['close'], root, root);
    expect(closed.code, `close failed: ${closed.stdout}${closed.stderr}`).toBe(0);
    expect(closed.stdout).toContain('No active browser session');
    expect(existsSync(join(stateDir, 'active-port.json'))).toBe(false);
  }, 60_000);

  it('adoption does not change bare `open`: it still starts a browser of its own', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'monobrowse-318-legacy-'));
    dirs.push(root);
    const page = join(root, 'fixture.html');
    await writeFile(page, '<!doctype html><title>Fixture</title><h1>hello</h1>');
    const url = `file://${page}`;
    const legacyPort = await openThenDowngradeState(root, url);

    const fresh = await runCli(['open', url], root, root);
    expect(fresh.code, `open failed: ${fresh.stdout}${fresh.stderr}`).toBe(0);
    const freshPort = reportedPort(fresh);
    expect(freshPort).not.toBe(legacyPort);
    // Neither joined nor disturbed: both browsers are up, and the legacy
    // record is still waiting to be adopted by whoever needs it.
    expect(await cdpAlive(legacyPort)).toBe(true);
    expect(await cdpAlive(freshPort!)).toBe(true);
    expect(existsSync(join(root, '.monomind', 'monobrowse', 'active-port.json'))).toBe(true);

    // Closing the new session leaves the legacy browser alone; a second
    // close then adopts and ends it.
    const closeFresh = await runCli(['close', '--port', String(freshPort)], root, root);
    expect(closeFresh.code).toBe(0);
    expect(await cdpAlive(legacyPort)).toBe(true);

    const closeLegacy = await runCli(['close'], root, root);
    expect(closeLegacy.code, `close failed: ${closeLegacy.stdout}${closeLegacy.stderr}`).toBe(0);
    expect(await cdpAlive(legacyPort)).toBe(false);
  }, 90_000);
});
