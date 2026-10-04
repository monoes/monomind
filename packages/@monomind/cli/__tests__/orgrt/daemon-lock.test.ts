// packages/@monomind/cli/__tests__/orgrt/daemon-lock.test.ts
// GA row R1 (spec 9.3): an OS-held single-daemon lock for a sections org, and a
// refusal on a filesystem that cannot give one. The OS drops the lock when the
// holder dies, so a crash never needs a stale-lock cleanup.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import {
  acquireDaemonLock,
  assertSupportedFilesystem,
  DaemonLockError,
  mountFsTypeOf,
} from '../../src/orgrt/daemon-lock.js';
import { sectionsRaw } from './support/sections-defs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK_TS = join(HERE, '..', '..', 'src', 'orgrt', 'daemon-lock.ts');

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'daemon-lock-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const MOUNTINFO = [
  '24 1 8:2 / / rw,relatime - ext4 /dev/sda2 rw',
  '31 24 0:27 / /mnt/share rw,relatime - nfs4 srv:/export rw,vers=4.2',
  '32 24 0:28 / /mnt/win rw,relatime - cifs //srv/s rw',
  '33 31 0:29 / /mnt/share/local rw,relatime - ext4 /dev/sdb1 rw',
  '34 24 0:30 / /mnt/with\\040space rw,relatime - nfs /srv rw',
].join('\n');

describe('mountFsTypeOf', () => {
  it('finds the filesystem of the longest mount point containing the path', () => {
    expect(mountFsTypeOf(MOUNTINFO, '/home/u/org')).toBe('ext4');
    expect(mountFsTypeOf(MOUNTINFO, '/mnt/share/org')).toBe('nfs4');
    expect(mountFsTypeOf(MOUNTINFO, '/mnt/share/local/org')).toBe('ext4');
    expect(mountFsTypeOf(MOUNTINFO, '/mnt/share')).toBe('nfs4');
    expect(mountFsTypeOf(MOUNTINFO, '/mnt/sharex/org')).toBe('ext4');
    expect(mountFsTypeOf(MOUNTINFO, '/mnt/with space/org')).toBe('nfs');
  });
});

describe('assertSupportedFilesystem', () => {
  it('refuses a network filesystem with a named error', () => {
    for (const where of ['/mnt/share/org', '/mnt/win/org']) {
      expect(() => assertSupportedFilesystem(where, { mountinfo: MOUNTINFO })).toThrow(DaemonLockError);
      expect(() => assertSupportedFilesystem(where, { mountinfo: MOUNTINFO })).toThrow(/network filesystem/);
    }
    try {
      assertSupportedFilesystem('/mnt/share/org', { mountinfo: MOUNTINFO });
    } catch (e) {
      expect((e as DaemonLockError).code).toBe('UNSUPPORTED_FILESYSTEM');
    }
  });

  it('accepts a local filesystem, and a path it cannot classify', () => {
    expect(() => assertSupportedFilesystem('/home/u/org', { mountinfo: MOUNTINFO })).not.toThrow();
    expect(() => assertSupportedFilesystem('/x', { mountinfo: '' })).not.toThrow();
  });
});

describe('acquireDaemonLock', () => {
  it('lets one holder in and refuses a second for the same root and org', async () => {
    const a = await acquireDaemonLock(root, 'sec-org');
    const err = await acquireDaemonLock(root, 'sec-org').catch((e) => e);
    expect(err).toBeInstanceOf(DaemonLockError);
    expect(err.code).toBe('HELD');
    expect(err.message).toMatch(/already owned by another daemon/);
    a.release();
  });

  it('is independent per org and per root', async () => {
    const other = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'daemon-lock-b-'));
    try {
      const a = await acquireDaemonLock(root, 'sec-org');
      const b = await acquireDaemonLock(root, 'other-org');
      const c = await acquireDaemonLock(other, 'sec-org');
      for (const h of [a, b, c]) h.release();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('frees the lock on release (idempotent) so the next daemon can start', async () => {
    const a = await acquireDaemonLock(root, 'sec-org');
    a.release();
    a.release();
    (await acquireDaemonLock(root, 'sec-org')).release();
  });

  it('keys by the real path, so a symlinked root is the same lock', async () => {
    const link = `${root}-link`;
    (await import('node:fs')).symlinkSync(root, link);
    try {
      const a = await acquireDaemonLock(root, 'sec-org');
      await expect(acquireDaemonLock(link, 'sec-org')).rejects.toMatchObject({ code: 'HELD' });
      a.release();
    } finally {
      rmSync(link, { force: true });
    }
  });

  it('is held across processes and dropped by the OS when the holder is killed', async () => {
    const script = join(root, 'hold.mjs');
    writeFileSync(
      script,
      `import { acquireDaemonLock } from ${JSON.stringify(LOCK_TS)};
       await acquireDaemonLock(process.argv[2], 'sec-org');
       process.stdout.write('held\\n');
       setInterval(() => {}, 1000);`,
    );
    const child = spawn(process.execPath, ['--experimental-strip-types', script, root], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (d) => String(d).includes('held') && resolve());
        child.on('exit', (c) => reject(new Error(`child exited early (${c})`)));
        setTimeout(() => reject(new Error('child never took the lock')), 15_000);
      });
      await expect(acquireDaemonLock(root, 'sec-org')).rejects.toMatchObject({ code: 'HELD' });
      child.removeAllListeners('exit');
      const gone = new Promise<void>((r) => child.once('exit', () => r()));
      child.kill('SIGKILL');
      await gone;
      (await acquireDaemonLock(root, 'sec-org')).release();
    } finally {
      child.kill('SIGKILL');
    }
  }, 30_000);
});

describe('a sections org start (real daemon)', () => {
  const queryFn = ({ prompt }: any) =>
    (async function* () {
      for await (const m of prompt) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();
  const daemons: OrgDaemon[] = [];
  const mk = () => {
    const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(d);
    return d;
  };
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  });

  it('a second daemon on the same root cannot start the same sections org, until the first stops it', async () => {
    writeFileSync(join(root, '.monomind/orgs/sec-org.json'), JSON.stringify(sectionsRaw()));
    const first = mk();
    const second = mk();
    await first.startOrg('sec-org', undefined, { evalGate: true });
    await expect(second.startOrg('sec-org', undefined, { evalGate: true })).rejects.toThrow(/already owned by another daemon/);
    expect(second.getOrg('sec-org')).toBeUndefined();
    await first.stopOrg('sec-org');
    await second.startOrg('sec-org', undefined, { evalGate: true });
    expect(second.getOrg('sec-org')).toBeDefined();
  });
});
