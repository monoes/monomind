/**
 * `init` must not leave a permanent background watcher behind in a
 * non-interactive run (#50).
 *
 * The background `monograph watch` is an interactive convenience — it exists so
 * a developer's next `monograph query` sees fresh data. Started from a script it
 * becomes a process nobody will ever stop: `monograph watch` has no exit
 * condition by design, so it runs until the machine reboots.
 *
 * That accumulated. Ten orphaned watchers were found on one machine spanning
 * 12+ hours, spawned by throwaway `init` runs in /tmp sandboxes that verify a
 * published package. Each held an fs watch open. The existing PID-file guard
 * cannot help there: every sandbox is a fresh directory in which no PID file has
 * ever existed, so the guard sees nothing and spawns another.
 *
 * These tests run the real CLI as a child process, because that is the only way
 * to observe the spawn decision — it depends on process.stdout.isTTY, which is
 * false for a piped child exactly as it is for the sandboxes that leaked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cli.js');

/**
 * Run the CLI with stdio piped — i.e. no TTY, like CI and smoke-test sandboxes.
 *
 * Returns stdout AND stderr combined: output.printInfo writes to stderr, so a
 * stdout-only capture silently misses the very line under test. spawnSync
 * rather than execFileSync because init may legitimately exit non-zero for
 * unrelated environment reasons, and the watcher decision is still observable.
 */
function runInit(cwd: string, args: string[] = []): string {
  const res = spawnSync(process.execPath, [CLI, 'init', ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, CI: '' }, // prove the TTY check alone is sufficient
  });
  return `${res.stdout ?? ''}${res.stderr ?? ''}`;
}

function readWatcherPid(cwd: string): number | undefined {
  const pidFile = join(cwd, '.monomind', 'monograph.watch.pid');
  if (!existsSync(pidFile)) return undefined;
  const pid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
  return Number.isNaN(pid) ? undefined : pid;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('init does not orphan a watcher in a non-interactive run', () => {
  let cwd: string;
  const spawned: number[] = [];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'init-watch-'));
    mkdirSync(join(cwd, '.git'), { recursive: true }); // look like a repo
  });

  afterEach(() => {
    // Never let this suite become the thing it is testing for.
    for (const pid of spawned.splice(0)) {
      try { process.kill(pid); } catch { /* already gone */ }
    }
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('starts no watcher and writes no PID file', () => {
    const out = runInit(cwd);

    const pid = readWatcherPid(cwd);
    if (pid !== undefined) spawned.push(pid);

    expect(
      pid,
      'a non-interactive init spawned a detached watcher that nothing will ever stop',
    ).toBeUndefined();
    expect(out).toMatch(/watch not started \(non-interactive run\)/i);
  }, 130_000);

  it('still honours an explicit --watch', () => {
    // The gate must not disable the feature for someone who asked for it.
    runInit(cwd, ['--watch']);

    const pid = readWatcherPid(cwd);
    if (pid !== undefined) spawned.push(pid);

    expect(pid, '--watch should force the watcher even without a TTY').toBeDefined();
    expect(isAlive(pid as number)).toBe(true);
  }, 130_000);

  it('still honours --no-watch', () => {
    runInit(cwd, ['--no-watch']);
    const pid = readWatcherPid(cwd);
    if (pid !== undefined) spawned.push(pid);
    expect(pid).toBeUndefined();
  }, 130_000);
});
