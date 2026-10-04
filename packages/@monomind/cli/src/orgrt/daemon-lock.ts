// packages/@monomind/cli/src/orgrt/daemon-lock.ts
/**
 * GA row R1 (spec 9.3): an OS-held lock that lets exactly one daemon own a
 * sections org for a root, and a refusal on a filesystem that cannot give one.
 *
 * The lock is a listening local socket, not a lock file: the OS closes it when
 * the holder dies, however it dies, so a crash never leaves a stale lock to
 * clean up and a killed daemon is replaced at once. Linux uses an abstract
 * socket (no file at all), Windows a named pipe, other POSIX systems a socket
 * file that a failed connect shows to be abandoned. The key is the real path
 * of the root plus the org name, so a symlinked root is the same lock.
 *
 * A socket excludes only daemons of this host. A root on a network filesystem
 * can be opened from another host, which this lock cannot see, so such a root
 * is refused instead of silently half-protected.
 *
 * Only node builtins and no relative imports, so the module loads standalone.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class DaemonLockError extends Error {
  code: 'HELD' | 'UNSUPPORTED_FILESYSTEM';
  constructor(code: 'HELD' | 'UNSUPPORTED_FILESYSTEM', message: string) {
    super(message);
    this.name = 'DaemonLockError';
    this.code = code;
  }
}

export interface DaemonLockHandle {
  /** Frees the lock; calling it again does nothing. */
  release(): void;
}

/** Filesystems whose files other hosts can open at the same time. */
const NETWORK_FS = new Set([
  'nfs',
  'nfs4',
  'cifs',
  'smb3',
  'smbfs',
  'ncpfs',
  'afs',
  'ceph',
  'glusterfs',
  'lustre',
  'fuse.sshfs',
  'fuse.glusterfs',
  'fuse.nfs',
]);

const unescapeMount = (s: string): string =>
  s.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(Number.parseInt(o, 8)));

/** The filesystem type of the mount that contains `path`, from /proc/self/mountinfo text. */
export function mountFsTypeOf(mountinfo: string, path: string): string | undefined {
  let best: { len: number; type: string } | undefined;
  for (const line of mountinfo.split('\n')) {
    const sep = line.indexOf(' - ');
    if (sep < 0) continue;
    const left = line.slice(0, sep).split(' ');
    const type = line.slice(sep + 3).split(' ')[0];
    const mount = left[4] === undefined ? undefined : unescapeMount(left[4]);
    if (!mount || !type) continue;
    const inside = mount === '/' || path === mount || path.startsWith(`${mount}/`);
    if (inside && (!best || mount.length > best.len)) best = { len: mount.length, type };
  }
  return best?.type;
}

const realOrSelf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** Throws UNSUPPORTED_FILESYSTEM when `root` is on a network filesystem. A
 *  platform or path the check cannot classify is allowed. */
export function assertSupportedFilesystem(root: string, opts?: { mountinfo?: string }): void {
  let info = opts?.mountinfo;
  if (info === undefined) {
    if (process.platform !== 'linux') return;
    try {
      info = readFileSync('/proc/self/mountinfo', 'utf8');
    } catch {
      return;
    }
  }
  const type = mountFsTypeOf(info, realOrSelf(root));
  if (type && NETWORK_FS.has(type))
    throw new DaemonLockError(
      'UNSUPPORTED_FILESYSTEM',
      `org root ${root} is on a network filesystem (${type}); a sections org needs a local filesystem so one daemon can own it`,
    );
}

function endpointFor(root: string, org: string): { path: string; file: boolean } {
  const key = createHash('sha256')
    .update(`${realOrSelf(root)}\0${org}`)
    .digest('hex')
    .slice(0, 32);
  if (process.platform === 'linux') return { path: `\0monomind-org-lock-${key}`, file: false };
  if (process.platform === 'win32')
    return { path: `\\\\.\\pipe\\monomind-org-lock-${key}`, file: false };
  const dir = join(tmpdir(), `monomind-org-locks-${process.getuid?.() ?? 0}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { path: join(dir, `${key}.sock`), file: true };
}

function listen(path: string): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve, reject) => {
    const server = createServer((s) => s.destroy());
    server.once('error', reject);
    server.listen(path, () => {
      server.removeListener('error', reject);
      // Holding the lock must not keep the process alive.
      server.unref();
      resolve(server);
    });
  });
}

/** True when something answers on a socket file (a live holder). */
function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect(path);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

/**
 * Takes the lock for (root, org) or throws DaemonLockError: HELD when another
 * daemon owns it, UNSUPPORTED_FILESYSTEM when the root is on a network mount.
 */
export async function acquireDaemonLock(root: string, org: string): Promise<DaemonLockHandle> {
  assertSupportedFilesystem(root);
  const { path, file } = endpointFor(root, org);
  const held = () =>
    new DaemonLockError('HELD', `org "${org}" is already owned by another daemon on ${root}`);
  let server: Awaited<ReturnType<typeof listen>>;
  try {
    server = await listen(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    // A socket file outlives a daemon that was killed; only a live holder answers.
    if (!file || (await answers(path))) throw held();
    try {
      unlinkSync(path);
    } catch {
      /* another contender removed it first */
    }
    try {
      server = await listen(path);
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === 'EADDRINUSE') throw held();
      throw e2;
    }
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      server.close();
      if (file) {
        try {
          unlinkSync(path);
        } catch {
          /* already gone */
        }
      }
    },
  };
}
