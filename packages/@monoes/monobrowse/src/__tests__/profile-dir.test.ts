/**
 * #395: the crash sweep and ownership checks for the temp Chrome profiles
 * monobrowse creates (profile-dir.ts).
 *
 * Every test sweeps a root of its own made with mkdtemp — never the real
 * /tmp, where other sessions' live Chrome profiles live. (The whole package
 * run also gets a throwaway TMPDIR, see setup/isolated-tmpdir.global.ts.)
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lutimes, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chromeSpawnEnv,
  isOwnedProfileDir,
  isProfileDirInUse,
  profileDirOwnerPid,
  removeOwnedProfileDir,
  sweepStaleProfileDirs,
} from '../browser/profile-dir.js';

let root: string;
let outside: string;
const children: ChildProcess[] = [];
const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'monobrowse-sweep-root-'));
  outside = await mkdtemp(join(tmpdir(), 'monobrowse-sweep-outside-'));
});

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

/** A pid that belonged to a process which has since exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('exit', resolve));
  return child.pid!;
}

/** A live process whose command line passes `--user-data-dir=<dir>`, the way
 *  Chrome's own does. */
async function holder(dir: string): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${dir}`],
    { stdio: 'ignore' },
  );
  children.push(child);
  await new Promise((resolve) => child.once('spawn', resolve));
  return child;
}

/** A profile-looking directory with some content, backdated past the grace. */
async function profile(name: string, opts: { young?: boolean } = {}): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, 'Default'), { recursive: true });
  await writeFile(join(dir, 'Default', 'Preferences'), '{}');
  if (!opts.young) await utimes(dir, HOUR_AGO, HOUR_AGO);
  return dir;
}

describe('#395 profileDirOwnerPid', () => {
  it('reads the pid from exactly our two name patterns', () => {
    expect(profileDirOwnerPid('monomind-browser-9222-1234-0a1b2c3d')).toBe(1234);
    expect(profileDirOwnerPid('monomind-browse-4321-0a1b2c3d')).toBe(4321);
    for (const name of [
      'monomind-browse-4321-0A1B2C3D',
      'monomind-browse-4321-0a1b2c3d0',
      'monomind-browse-x-0a1b2c3d',
      'monomind-browser-4321-0a1b2c3d',
      'xmonomind-browse-4321-0a1b2c3d',
      'org.chromium.Chromium.abc123',
    ]) {
      expect(profileDirOwnerPid(name), name).toBeNull();
    }
  });
});

describe('#395 sweepStaleProfileDirs', () => {
  it('deletes stale dirs whose owner is dead and nothing uses', async () => {
    const pid = await deadPid();
    const a = await profile(`monomind-browser-9222-${pid}-aaaaaaaa`);
    const b = await profile(`monomind-browse-${pid}-bbbbbbbb`);

    const removed = await sweepStaleProfileDirs({ root });

    expect(removed.sort()).toEqual([a, b].sort());
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
  });

  it('keeps young dirs, dirs whose pid is alive, non-matching names, symlinks and files', async () => {
    const pid = await deadPid();
    const young = await profile(`monomind-browse-${pid}-cccccccc`, { young: true });
    const alive = await profile(`monomind-browse-${process.pid}-dddddddd`);
    const foreign = [
      await profile('org.chromium.Chromium.abc123'),
      await profile(`monomind-browse-${pid}-ABCDEF12`),
      await profile(`monomind-browse-${pid}-abcdef12-extra`),
      await profile(`other-monomind-browse-${pid}-abcdef12`),
    ];
    // A symlink with our name, pointing out of the root at a real profile.
    const target = join(outside, 'victim');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'keep');
    const link = join(root, `monomind-browse-${pid}-11111111`);
    await symlink(target, link);
    await lutimes(link, HOUR_AGO, HOUR_AGO);
    // A plain file with our name.
    const file = join(root, `monomind-browse-${pid}-22222222`);
    await writeFile(file, 'not a dir');
    await utimes(file, HOUR_AGO, HOUR_AGO);

    expect(await sweepStaleProfileDirs({ root })).toEqual([]);

    for (const kept of [young, alive, ...foreign, link, file]) expect(existsSync(kept)).toBe(true);
    expect(existsSync(join(target, 'keep.txt'))).toBe(true);
  });

  it.skipIf(process.platform !== 'linux')(
    'keeps a dir a live process uses as --user-data-dir, though its named pid is dead',
    async () => {
      // A CLI `open` exits right after launching, so the pid in the name is
      // dead while its Chrome runs on: only the live user of the dir says so.
      const pid = await deadPid();
      const inUse = await profile(`monomind-browse-${pid}-eeeeeeee`);
      await holder(inUse);

      expect(await sweepStaleProfileDirs({ root })).toEqual([]);
      expect(existsSync(inUse)).toBe(true);
    },
  );

  it('without /proc, keeps a dir whose SingletonLock names a live pid', async () => {
    const pid = await deadPid();
    const locked = await profile(`monomind-browse-${pid}-ffffffff`);
    await symlink(`somehost-${process.pid}`, join(locked, 'SingletonLock'));
    await utimes(locked, HOUR_AGO, HOUR_AGO);
    const staleLock = await profile(`monomind-browse-${pid}-99999999`);
    await symlink(`somehost-${pid}`, join(staleLock, 'SingletonLock'));
    await utimes(staleLock, HOUR_AGO, HOUR_AGO);

    expect(await sweepStaleProfileDirs({ root, procDir: null })).toEqual([staleLock]);
    expect(existsSync(locked)).toBe(true);
  });

  it('never throws, and sweeps nothing, when the root is missing', async () => {
    await expect(sweepStaleProfileDirs({ root: join(root, 'missing') })).resolves.toEqual([]);
  });
});

describe('#395 isOwnedProfileDir / removeOwnedProfileDir', () => {
  it('refuses a caller-supplied dir, a dir outside the root, and a symlink', async () => {
    const caller = join(root, 'my-profile');
    await mkdir(caller);
    const nested = join(root, 'sub', `monomind-browse-${process.pid}-aaaaaaaa`);
    await mkdir(nested, { recursive: true });
    const target = join(outside, 'victim');
    await mkdir(target);
    const link = join(root, `monomind-browse-${process.pid}-bbbbbbbb`);
    await symlink(target, link);

    for (const dir of [caller, nested, link]) {
      expect(await isOwnedProfileDir(dir, root), dir).toBe(false);
      expect(await removeOwnedProfileDir(dir, { root }), dir).toBe(false);
      expect(existsSync(dir), dir).toBe(true);
    }
    expect(existsSync(target)).toBe(true);
  });

  it('removes an owned dir once its browser pid has exited', async () => {
    const dir = await profile(`monomind-browse-${process.pid}-cccccccc`, { young: true });
    const pid = await deadPid();
    expect(await removeOwnedProfileDir(dir, { root, pid })).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it.skipIf(process.platform !== 'linux')(
    'keeps an owned dir while a live process still uses it',
    async () => {
      const dir = await profile(`monomind-browse-${process.pid}-dddddddd`, { young: true });
      const child = await holder(dir);
      expect(await isProfileDirInUse(dir)).toBe(true);
      expect(await removeOwnedProfileDir(dir, { root, pid: child.pid })).toBe(false);
      expect(existsSync(dir)).toBe(true);
    },
    15_000,
  );
});

describe('chromeSpawnEnv (#663)', () => {
  const env = { TMPDIR: '/x', KEEP: '1' };

  it.skipIf(process.platform === 'win32')(
    'leaves the env alone when the singleton socket path fits',
    () => {
      expect(chromeSpawnEnv(env, '/tmp/mb-abcdef')).toBe(env);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'redirects TMPDIR to /tmp when it would overflow the socket path',
    () => {
      expect(chromeSpawnEnv(env, `/tmp/${'x'.repeat(80)}`)).toEqual({ TMPDIR: '/tmp', KEEP: '1' });
    },
  );
});
