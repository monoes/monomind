/**
 * `spawnRunnerProcess` (orgrt/process-group-spawn.ts): the shared
 * process-group spawn/kill helper subprocess runners use for `--access
 * full`. Real short-lived processes; cleanup only by recorded pid.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawnRunnerProcess } from '../orgrt/process-group-spawn.js';
import { EXEC_TREE_ENV } from '../orgrt/process-tree-marker.js';
import { psReadsProcessTable } from './ps-probe.js';

const posix = process.platform !== 'win32';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(fn: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function readAll(stream: NodeJS.ReadableStream | null | undefined): Promise<string> {
  let out = '';
  for await (const c of stream ?? []) out += String(c);
  return out;
}

describe('spawnRunnerProcess', () => {
  let cleanup: number[] = [];
  afterEach(() => {
    for (const pid of cleanup) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    cleanup = [];
  });

  it('scoped: plain spawn, no marker, no onProcessSpawned, target kills the child', async () => {
    let called = false;
    const proc = spawnRunnerProcess(
      'sh',
      ['-c', `echo "[$${EXEC_TREE_ENV}]"; sleep 30`],
      { stdio: ['ignore', 'pipe', 'ignore'] },
      { access: 'scoped', onProcessSpawned: () => (called = true) },
    );
    const pid = proc.child.pid!;
    cleanup.push(pid);
    const firstLine = await new Promise<string>((res) =>
      proc.child.stdout!.once('data', (c) => res(String(c))),
    );
    expect(firstLine.trim()).toBe('[]');
    expect(called).toBe(false);
    proc.target.kill('SIGKILL');
    await waitFor(() => !isAlive(pid), 3000);
    proc.stop();
  });

  // reason: finds the survivor with `ps`, which a macOS Seatbelt sandbox denies (#798)
  it.runIf(posix && psReadsProcessTable('process-group-spawn'))(
    'full: marker set, onProcessSpawned reports a background survivor, target kills the whole tree',
    async () => {
      let survivors: (() => { pids: number[]; supported: boolean }) | undefined;
      let spawnedPid = 0;
      const proc = spawnRunnerProcess(
        'sh',
        ['-c', `echo "$${EXEC_TREE_ENV}"; sleep 1000 & echo $!; wait`],
        { stdio: ['ignore', 'pipe', 'ignore'] },
        {
          access: 'full',
          onProcessSpawned: (info) => {
            spawnedPid = info.pid;
            survivors = info.getBackgroundSurvivors;
          },
        },
      );
      const leader = proc.child.pid!;
      cleanup.push(leader);
      expect(spawnedPid).toBe(leader);
      let buf = '';
      await new Promise<void>((res) =>
        proc.child.stdout!.on('data', (c) => {
          buf += String(c);
          if (buf.trim().split('\n').length >= 2) res();
        }),
      );
      const [token, bgPid] = buf.trim().split('\n');
      expect(token).toMatch(/^[0-9a-f-]{36}$/);
      const bg = Number(bgPid);
      cleanup.push(bg);
      await waitFor(() => survivors!().pids.includes(bg), 3000);

      proc.target.kill('SIGKILL');
      await waitFor(() => !isAlive(bg), 3000);
      proc.stop();
      await readAll(proc.child.stdout);
    },
  );

  it('full: a spawn failure still surfaces as a child error, not a throw', async () => {
    const proc = spawnRunnerProcess(
      '/nonexistent/binary-for-test',
      [],
      { stdio: ['ignore', 'pipe', 'pipe'] },
      { access: 'full' },
    );
    const err = await new Promise<Error>((res) => proc.child.on('error', res));
    expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    proc.target.kill('SIGTERM');
    proc.stop();
  });
});
