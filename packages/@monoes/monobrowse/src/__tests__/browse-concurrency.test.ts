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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
