/**
 * Temporary Chrome profile directories monobrowse creates, and their removal
 * (#395).
 *
 * Every launch without a caller-supplied `userDataDir` (and every CLI
 * session) gets a fresh `--user-data-dir` directly under `os.tmpdir()`.
 * Nothing used to delete them, so they piled up until /tmp ran out of space
 * (81 profiles, 4.4 GB on one machine). Two paths remove them now:
 *
 *   - removeOwnedProfileDir(): when monobrowse closes or kills a browser it
 *     launched in a directory it created — after Chrome has exited, since
 *     Chrome writes into its profile until then.
 *   - sweepStaleProfileDirs(): at the next launch, for directories whose
 *     owner crashed or was killed before it could close its browser.
 *
 * Both touch only real directories directly inside the tmp root whose name
 * matches one of the exact patterns below. A caller-supplied `userDataDir`
 * never matches them unless the caller copied our naming, and even then the
 * close path also needs the explicit ownership flag launchBrowser records.
 */

import { lstat, readdir, readFile, readlink, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** `monomind-browser-<port>-<pid>-<uuid8>` (launchBrowser's default profile). */
const LAUNCH_PROFILE_RE = /^monomind-browser-\d+-(\d+)-[0-9a-f]{8}$/;
/** `monomind-browse-<pid>-<uuid8>` (a CLI browse session's profile). */
const SESSION_PROFILE_RE = /^monomind-browse-(\d+)-[0-9a-f]{8}$/;

/** A directory younger than this is never swept: its launch may still be
 *  starting (Chrome has not yet put its pid anywhere we can see). */
export const PROFILE_SWEEP_GRACE_MS = 10 * 60 * 1000;
// Bounded waits for removeOwnedProfileDir(): for the browser pid to go, then
// for any other process still holding the profile (Chrome's helpers).
const EXIT_WAIT_MS = 5000;
const HOLDER_WAIT_MS = 2000;
const POLL_MS = 50;
const RM_RETRY_DELAY_MS = 250;

/** Longest unix socket path Chrome's singleton lock can bind (sun_path is 104
 *  bytes on macOS, 108 on Linux; both include the NUL). */
const MAX_SOCKET_PATH = 103;
/** `/org.chromium.Chromium.XXXXXX/SingletonSocket` — what Chrome appends to TMPDIR. */
const SINGLETON_SOCKET_SUFFIX_LEN = '/org.chromium.Chromium.XXXXXX/SingletonSocket'.length;

/**
 * Environment to spawn Chrome with (#663). Chrome binds its singleton lock
 * socket under $TMPDIR regardless of --user-data-dir, and aborts at startup
 * (`FATAL: Socket path too long`, SIGABRT) once that path passes the unix
 * socket limit — which a deep TMPDIR (CI work dirs, sandboxed runners) does.
 * Only then is TMPDIR redirected to /tmp; otherwise the env is untouched.
 */
export function chromeSpawnEnv(env: NodeJS.ProcessEnv, tmp = tmpdir()): NodeJS.ProcessEnv {
  if (process.platform === 'win32') return env;
  if (Buffer.byteLength(tmp) + SINGLETON_SOCKET_SUFFIX_LEN <= MAX_SOCKET_PATH) return env;
  return { ...env, TMPDIR: '/tmp' };
}

/** Name for a new default launch profile, directly under `root`. */
export function launchProfileDirPath(port: number, id: string, root = tmpdir()): string {
  return join(root, `monomind-browser-${port}-${process.pid}-${id}`);
}

/** Name for a new CLI session profile, directly under `root`. */
export function sessionProfileDirPath(id: string, root = tmpdir()): string {
  return join(root, `monomind-browse-${process.pid}-${id}`);
}

/** The pid encoded in a profile directory name we create, or null when
 *  `name` is not one of ours. */
export function profileDirOwnerPid(name: string): number | null {
  const m = LAUNCH_PROFILE_RE.exec(name) ?? SESSION_PROFILE_RE.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Whether `dir` is a directory monobrowse created: its name matches our
 * pattern, it is a real directory (not a symlink), and its resolved parent
 * is `root`. Anything else is never deleted.
 */
export async function isOwnedProfileDir(dir: string, root = tmpdir()): Promise<boolean> {
  try {
    if (profileDirOwnerPid(basename(dir)) === null) return false;
    const st = await lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) return false;
    return dirname(await realpath(dir)) === (await realpath(root));
  } catch {
    return false;
  }
}

/** Whether `pid` is a live process. EPERM means it exists but is not ours. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Pids of live processes whose command line passes `--user-data-dir=<dir>`,
 * read from `procDir` (Linux /proc). Null when it cannot be read at all, so
 * the caller falls back to other evidence instead of reading "nobody".
 */
export async function profileDirHolders(dir: string, procDir = '/proc'): Promise<number[] | null> {
  let entries: string[];
  try {
    entries = await readdir(procDir);
  } catch {
    return null;
  }
  const wanted = new Set([`--user-data-dir=${dir}`]);
  try {
    wanted.add(`--user-data-dir=${await realpath(dir)}`);
  } catch {
    /* gone already — the literal path is all there is to match */
  }
  const holders: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const args = (await readFile(join(procDir, entry, 'cmdline'), 'utf8')).split('\0');
      if (args.some((a) => wanted.has(a))) holders.push(Number(entry));
    } catch {
      /* exited while we looked, or not readable */
    }
  }
  return holders;
}

/** The live pid Chrome's `SingletonLock` (a `<host>-<pid>` symlink) names,
 *  or null when there is no lock or its pid is gone. */
async function singletonLockHolder(dir: string): Promise<number | null> {
  try {
    const m = /-(\d+)$/.exec(await readlink(join(dir, 'SingletonLock')));
    const pid = m ? Number(m[1]) : Number.NaN;
    return isPidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Whether any live process still uses `dir` as its Chrome profile. `procDir`
 *  null skips the /proc scan (non-Linux), leaving only the SingletonLock. */
export async function isProfileDirInUse(
  dir: string,
  opts: { procDir?: string | null } = {},
): Promise<boolean> {
  const procDir = opts.procDir === undefined ? defaultProcDir() : opts.procDir;
  if (procDir !== null) {
    const holders = await profileDirHolders(dir, procDir);
    if (holders?.some(isPidAlive)) return true;
  }
  return (await singletonLockHolder(dir)) !== null;
}

function defaultProcDir(): string | null {
  return process.platform === 'linux' ? '/proc' : null;
}

/**
 * Delete a profile directory monobrowse created, once the browser `pid` that
 * used it has exited (bounded wait) and no other process still holds it.
 * Removal is retried once — Chrome's helpers can still be flushing a file
 * as the first attempt runs. Returns whether the directory is gone. Never
 * throws: a directory left behind is swept at a later launch.
 */
export async function removeOwnedProfileDir(
  dir: string,
  opts: { pid?: number; root?: string; procDir?: string | null } = {},
): Promise<boolean> {
  try {
    if (!(await isOwnedProfileDir(dir, opts.root))) return false;
    if (opts.pid !== undefined && !(await waitUntil(() => !isPidAlive(opts.pid!), EXIT_WAIT_MS))) {
      return false;
    }
    if (!(await waitUntil(async () => !(await isProfileDirInUse(dir, opts)), HOLDER_WAIT_MS))) {
      return false;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await rm(dir, { recursive: true, force: true });
        return true;
      } catch {
        await delay(RM_RETRY_DELAY_MS);
      }
    }
  } catch {
    /* best-effort */
  }
  return false;
}

export interface ProfileSweepOptions {
  /** Directory to sweep. Default os.tmpdir(); tests inject their own. */
  root?: string;
  /** Minimum age (by mtime) before a directory may be swept. */
  graceMs?: number;
  /** See isProfileDirInUse. */
  procDir?: string | null;
  now?: number;
}

/**
 * Delete profile directories left behind by a monobrowse process that died
 * without closing its browser. A directory directly in `root` is removed
 * only when ALL of these hold:
 *   - its name matches one of our exact patterns and it is a real directory
 *     (symlinks, files and anything else are never touched);
 *   - its mtime is older than the grace period, so a concurrent launch that
 *     is still starting is left alone;
 *   - the pid in its name is not a live process;
 *   - no live Chrome uses it (/proc command lines on Linux, plus the
 *     profile's SingletonLock everywhere). A CLI `open` process exits right
 *     after launching, so this check is what keeps a live session's profile.
 *
 * Best-effort: any error skips that entry, and the sweep never throws.
 * Returns the directories removed.
 */
export async function sweepStaleProfileDirs(opts: ProfileSweepOptions = {}): Promise<string[]> {
  const root = opts.root ?? tmpdir();
  const cutoff = (opts.now ?? Date.now()) - (opts.graceMs ?? PROFILE_SWEEP_GRACE_MS);
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return removed;
  }
  for (const name of entries) {
    try {
      const pid = profileDirOwnerPid(name);
      if (pid === null) continue;
      const dir = join(root, name);
      const st = await lstat(dir);
      if (!st.isDirectory() || st.mtimeMs >= cutoff) continue;
      if (isPidAlive(pid)) continue;
      if (!(await isOwnedProfileDir(dir, root))) continue;
      if (await isProfileDirInUse(dir, opts)) continue;
      await rm(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      /* skip this entry */
    }
  }
  return removed;
}

/** Poll `cond` until it holds or `ms` elapses. The timer is ref'd on purpose
 *  (see waitForProcessExit in browser-lifecycle.ts): callers await it. */
async function waitUntil(cond: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() >= deadline) return false;
    await delay(POLL_MS);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
