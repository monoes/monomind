/**
 * #340: a build lock left behind by an interrupted watch/build blocked the
 * next `monograph watch` runs. A lock whose holder is gone must be taken over
 * at once, a live holder's lock must still be respected, and a holder that
 * exits or is killed mid-build must not block the next build.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireBuildLock, buildLockPath, liveBuildLockHolder } from '../../src/pipeline/build-lock.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'build-lock-holder.fixture.ts');

let dir: string;
let dbPath: string;
let lockPath: string;
const children: ChildProcess[] = [];

function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', '']);
  return r.pid ?? 999_999;
}

function liveChild(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.push(child);
  return child;
}

/** Starts a separate process that takes the lock, resolving once it holds it. */
async function holderProcess(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, dbPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  const line = await new Promise<string>((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => {
      out += String(d);
      if (out.includes('\n')) resolve(out.trim());
    });
    child.stderr?.on('data', (d) => {
      err += String(d);
    });
    child.on('exit', (code) => reject(new Error(`holder exited ${code}: ${err}`)));
  });
  expect(line).toBe('held');
  return child;
}

const exited = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mg-build-lock-'));
  dbPath = join(dir, '.monomind', 'monograph.db');
  lockPath = buildLockPath(dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });
});

afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

describe('acquireBuildLock (#340)', () => {
  it('takes over a lock whose holder pid is dead', () => {
    writeFileSync(lockPath, `${deadPid()}\n${Date.now()}\n`);
    const lock = acquireBuildLock(dbPath);
    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8').split('\n')[0]).toBe(String(process.pid));
    if (lock.acquired) lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('takes over a legacy pid-only lock whose holder is dead', () => {
    writeFileSync(lockPath, String(deadPid()));
    expect(acquireBuildLock(dbPath).acquired).toBe(true);
  });

  it('defers to a live holder and reports its pid and start time', () => {
    const child = liveChild();
    const startedAt = Date.now() - 5000;
    writeFileSync(lockPath, `${child.pid}\n${startedAt}\n`);
    const lock = acquireBuildLock(dbPath);
    expect(lock.acquired).toBe(false);
    if (lock.acquired) return;
    expect(lock.holder).toEqual({ pid: child.pid, startedAt, lockPath });
    expect(liveBuildLockHolder(dbPath)?.pid).toBe(child.pid);
  });

  it('takes over a live pid’s lock written before this boot (recycled pid)', () => {
    const child = liveChild();
    writeFileSync(lockPath, `${child.pid}\n0\n`);
    const beforeBoot = new Date(Date.now() - (uptime() + 3600) * 1000);
    utimesSync(lockPath, beforeBoot, beforeBoot);
    expect(liveBuildLockHolder(dbPath)).toBeNull();
    expect(acquireBuildLock(dbPath).acquired).toBe(true);
  });

  it('takes over a live pid’s lock that has not been refreshed for over 30 minutes', () => {
    const child = liveChild();
    writeFileSync(lockPath, `${child.pid}\n${Date.now()}\n`);
    const old = new Date(Date.now() - 31 * 60_000);
    utimesSync(lockPath, old, old);
    expect(acquireBuildLock(dbPath).acquired).toBe(true);
  });

  it('release leaves alone a lock another process has since taken over', () => {
    const lock = acquireBuildLock(dbPath);
    expect(lock.acquired).toBe(true);
    writeFileSync(lockPath, `${liveChild().pid}\n${Date.now()}\n`);
    if (lock.acquired) lock.release();
    expect(existsSync(lockPath)).toBe(true);
  });

  it('a holder that calls process.exit() mid-build removes its lock', async () => {
    const child = await holderProcess();
    child.stdin?.write('exit\n');
    await exited(child);
    expect(child.exitCode).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
  }, 20000);

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGKILL'] as const) {
    it(`a holder killed by ${signal} dies at once and its lock is taken over by the next build`, async () => {
      const child = await holderProcess();
      child.kill(signal);
      await exited(child);
      expect(child.signalCode).toBe(signal);
      expect(acquireBuildLock(dbPath).acquired).toBe(true);
    }, 20000);
  }
});

// #370: sandboxed tools give each command its own pid namespace with small,
// reused pids — a lock left by a killed sandboxed build named "pid 47", and in
// the next sandbox an unrelated process was pid 47, so the lock looked live.
describe.skipIf(process.platform !== 'linux')('acquireBuildLock across pid namespaces and boots (#370)', () => {
  const ownNs = readlinkSync('/proc/self/ns/pid');
  const ownBoot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const foreignNs = 'pid:[4026599999]';
  const ago = (ms: number) => new Date(Date.now() - ms);

  it('records its pid namespace and boot id', () => {
    const lock = acquireBuildLock(dbPath);
    expect(readFileSync(lockPath, 'utf8').split('\n').slice(2, 4)).toEqual([ownNs, ownBoot]);
    if (lock.acquired) lock.release();
  });

  it('takes over a lock from another namespace once its heartbeat is silent, even if that pid is alive here', () => {
    const child = liveChild(); // the "pid 47" that is alive in OUR namespace
    writeFileSync(lockPath, `${child.pid}\n${Date.now() - 600_000}\n${foreignNs}\n${ownBoot}\n`);
    utimesSync(lockPath, ago(3 * 60_000), ago(3 * 60_000));
    expect(acquireBuildLock(dbPath).acquired).toBe(true);
  });

  it('respects a lock from another namespace while its heartbeat is fresh', () => {
    writeFileSync(lockPath, `${deadPid()}\n${Date.now()}\n${foreignNs}\n${ownBoot}\n`);
    const lock = acquireBuildLock(dbPath);
    expect(lock.acquired).toBe(false);
  });

  it('takes over a lock written in another boot even when its pid is alive', () => {
    const child = liveChild();
    writeFileSync(lockPath, `${child.pid}\n${Date.now()}\n${ownNs}\n00000000-0000-0000-0000-000000000000\n`);
    expect(acquireBuildLock(dbPath).acquired).toBe(true);
  });
});

