import { mkdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname } from 'node:path';

// Cross-process build mutex. Callers arrive from several independent entry points
// (session-start hook, MCP staleness auto-build, CLI, watcher), each with its own
// ad-hoc lock file that the others don't know about — concurrent builds then fail
// with "database is locked". Serialize in the one place all builders pass through.
//
// The file holds the holder's pid on line 1 (older readers parseInt the whole
// file) and when it took the lock on line 2. A lock is taken over when its
// holder is dead, when it predates the last boot (a recycled pid), or when
// nobody has refreshed it for STALE_AFTER_MS (#340). The holder touches it
// every HEARTBEAT_MS whenever the build yields the event loop, so a long build
// is not taken over for its age alone.
const HEARTBEAT_MS = 30_000;
const STALE_AFTER_MS = 30 * 60_000;

export interface BuildLockHolder {
  pid: number;
  /** When the holder took the lock (epoch ms). */
  startedAt: number;
  lockPath: string;
}

export type BuildLock =
  | { acquired: true; release: () => void }
  | { acquired: false; holder: BuildLockHolder | null };

export const buildLockPath = (dbPath: string): string => `${dbPath}.build-lock`;

interface LockFile {
  raw: string;
  mtimeMs: number;
  holder: BuildLockHolder;
}

function readLockFile(lockPath: string): LockFile | null {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const { mtimeMs } = statSync(lockPath);
    const [pidLine = '', startedLine = ''] = raw.split('\n');
    const startedAt = Number.parseInt(startedLine, 10);
    return {
      raw,
      mtimeMs,
      holder: {
        pid: Number.parseInt(pidLine, 10),
        startedAt: Number.isFinite(startedAt) ? startedAt : mtimeMs,
        lockPath,
      },
    };
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

function isStale(lock: LockFile): boolean {
  if (!isPidAlive(lock.holder.pid)) return true;
  const bootedAt = Date.now() - uptime() * 1000;
  return lock.mtimeMs < bootedAt || Date.now() - lock.mtimeMs > STALE_AFTER_MS;
}

/** The process holding the build lock for `dbPath`, or null when no live build holds it. */
export function liveBuildLockHolder(dbPath: string): BuildLockHolder | null {
  const lock = readLockFile(buildLockPath(dbPath));
  return lock && !isStale(lock) ? lock.holder : null;
}

/** "(pid 123, running 2m)" — who holds a build lock, for log lines. */
export function describeBuildLockHolder(holder: BuildLockHolder): string {
  const secs = Math.max(0, Math.round((Date.now() - holder.startedAt) / 1000));
  const age =
    secs < 60
      ? `${secs}s`
      : secs < 3600
        ? `${Math.floor(secs / 60)}m`
        : `${Math.floor(secs / 3600)}h`;
  return `(pid ${holder.pid}, running ${age})`;
}

export function acquireBuildLock(dbPath: string): BuildLock {
  const lockPath = buildLockPath(dbPath);
  mkdirSync(dirname(lockPath), { recursive: true });
  const content = `${process.pid}\n${Date.now()}\n`;
  const tryCreate = (): boolean => {
    try {
      writeFileSync(lockPath, content, { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  };

  if (!tryCreate()) {
    const current = readLockFile(lockPath);
    if (current && !isStale(current)) return { acquired: false, holder: current.holder };
    // Re-read before removing, so a lock another reclaimer just took is left alone.
    if (current && readLockFile(lockPath)?.raw === current.raw) {
      try {
        unlinkSync(lockPath);
      } catch {
        /* raced with another reclaimer */
      }
    }
    if (!tryCreate()) return { acquired: false, holder: readLockFile(lockPath)?.holder ?? null };
  }

  const isOurs = (): boolean => {
    try {
      return readFileSync(lockPath, 'utf8') === content;
    } catch {
      return false;
    }
  };
  const heartbeat = setInterval(() => {
    if (!isOurs()) return;
    try {
      const now = new Date();
      utimesSync(lockPath, now, now);
    } catch {
      /* removed underneath us */
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  // process.exit() mid-build (an MCP server shutting down) skips the caller's
  // finally, so release on 'exit'. A signal's default
  // action skips 'exit' listeners too, but a JS signal handler would only run
  // once the build yields the event loop, delaying the kill; that lock is left
  // with a dead pid and the next build takes it over.
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    process.off('exit', release);
    if (!isOurs()) return;
    try {
      unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', release);
  return { acquired: true, release };
}
