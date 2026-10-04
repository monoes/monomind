#!/usr/bin/env node
/**
 * Release lock: at most one release org run per clone at a time.
 *
 * Several Claude sessions can work in the same clone (the main checkout and
 * its worktrees) and each may start `org run release`. release-captain takes
 * this lock before PREFLIGHT and releases it at the end of the run (GO or
 * NO-GO); a second run finds it held and ends without doing anything.
 *
 * The lock is an atomic `mkdir` of `<lock root>/<repo>-<hash>.lock`, where the
 * hash is of the clone's git common dir (`git rev-parse --git-common-dir`),
 * which every worktree of the clone shares. The lock root is
 * `~/.monomind/release-locks` (override: --lock-root or
 * MONOMIND_RELEASE_LOCK_ROOT), not the git common dir itself, because
 * release-captain runs with `policy.git: read`, where `.git` is read-only.
 * `info.json` inside it records run id, pid, host, start time and the git
 * common dir.
 *
 * A held lock is taken over only on positive evidence that its holder is gone:
 *   - it is older than --max-age-hours (default 12);
 *   - it was taken before the machine last booted;
 *   - its pid is not running (checked only from the pid namespace it was
 *     recorded in; an org role's sandbox has its own and cannot see it);
 *   - its org run ended: runtime.json still names that run, not 'running', or the
 *     run's own bus.jsonl records org-stopped (runtime.json is replaced by the next run);
 *   - its heartbeat (the run's bus.jsonl) has not changed for
 *     --heartbeat-minutes (default 30; the org stops itself after 15 idle).
 * Takeover is serialized by a second `mkdir` (`<lock>.break`), so two
 * contenders can never both remove the stale lock and both win.
 *
 * Usage:
 *   node scripts/release-lock.mjs acquire [--runtime <org runtime.json>] [--run <id>] [--pid <n>]
 *   node scripts/release-lock.mjs release [--runtime <org runtime.json>] [--run <id>] [--force]
 *   node scripts/release-lock.mjs status
 * Common options: --lock-root <dir>, --max-age-hours <n>, --heartbeat-minutes <n>.
 * --runtime takes run id and daemon pid from an org's runtime.json (e.g.
 * .monomind/orgs/release/runtime.json) and uses <org dir>/<run>/bus.jsonl as
 * heartbeat; --run defaults to $MONOMIND_ORG_RUN, then to runtime.json's run.
 *
 * Exit: 0 acquired / released / free (or stale) on status; 3 held by another
 * run; 2 usage or git error.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';

const HELD = 3;
const USAGE = 2;
/** A lock or break dir with no info.json yet is being created, unless older than this. */
const CREATING_MS = 60_000;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--force') opts.force = true;
    else if (a.startsWith('--') && i + 1 < rest.length) opts[a.slice(2)] = rest[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return { cmd, opts };
}

const readText = (p) => {
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return undefined;
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
};
const mtimeMs = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return undefined;
  }
};
const pidNamespace = () => {
  try {
    return readlinkSync('/proc/self/ns/pid');
  } catch {
    return undefined;
  }
};
const bootId = () => readText('/proc/sys/kernel/random/boot_id');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function lockPath(opts) {
  const common = realpathSync(
    execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
  );
  const root =
    opts['lock-root'] ??
    process.env.MONOMIND_RELEASE_LOCK_ROOT ??
    join(homedir(), '.monomind', 'release-locks');
  const hash = createHash('sha256').update(common).digest('hex').slice(0, 16);
  return { common, root, dir: join(root, `${basename(dirname(common))}-${hash}.lock`) };
}

/** Who this invocation acts for: run id, pid, and the org files that prove liveness. */
function identity(opts) {
  const runtime = opts.runtime ? readJson(opts.runtime) : undefined;
  if (opts.runtime && !runtime) throw new Error(`cannot read ${opts.runtime}`);
  const run = opts.run || process.env.MONOMIND_ORG_RUN || runtime?.run;
  const sameRun = runtime && runtime.run === run;
  const pid = Number(opts.pid ?? (sameRun ? runtime.pid : process.ppid));
  const out = { run: run || `manual-${hostname()}-${pid}`, pid };
  if (sameRun) {
    out.runtimeFile = opts.runtime;
    out.heartbeat = join(dirname(opts.runtime), run, 'bus.jsonl');
  }
  return out;
}

/** Why the holder is gone, or undefined while it may still be running. */
function staleReason(info, lockDir, opts) {
  const now = Date.now();
  if (!info) {
    const m = mtimeMs(lockDir);
    return m !== undefined && now - m > CREATING_MS ? 'no info.json' : undefined;
  }
  const maxAgeH = Number(opts['max-age-hours'] ?? 12);
  if (now - Date.parse(info.startedAt) > maxAgeH * 3600_000) return `older than ${maxAgeH}h`;
  if (info.bootId && bootId() && info.bootId !== bootId()) return 'the machine rebooted since';
  if (info.pidNamespace && info.pidNamespace === pidNamespace() && !alive(info.pid))
    return `pid ${info.pid} is not running`;
  if (info.runtimeFile) {
    const rt = readJson(info.runtimeFile);
    if (rt && rt.run === info.run && rt.status !== 'running') return `its run ended: ${rt.status}`;
  }
  if (info.heartbeat && endedInBus(info.heartbeat)) return 'its run ended: org-stopped';
  if (info.heartbeat) {
    const limit = Number(opts['heartbeat-minutes'] ?? 30);
    const m = mtimeMs(info.heartbeat);
    const quiet = m === undefined ? Infinity : Math.floor((now - m) / 60_000);
    if (quiet >= limit)
      return m === undefined
        ? `${info.heartbeat} is gone`
        : `no activity in ${info.heartbeat} for ${quiet} min`;
  }
  return undefined;
}

/**
 * True when the run's own bus log ends with an org-stopped event. runtime.json
 * is per org, so a later run replaces it and the holder's end state is lost;
 * the bus log is per run and says how that run ended.
 */
function endedInBus(file) {
  try {
    const tail = readFileSync(file, 'utf8').slice(-65536);
    return tail
      .split('\n')
      .reverse()
      .some((l) => l.includes('"reason":"org-stopped"'));
  } catch {
    return false;
  }
}

const describe = (info) =>
  `run ${info.run} (pid ${info.pid} on ${info.host}, since ${info.startedAt})`;

/** One mkdir attempt; true when this process now holds the lock. */
function tryCreate(lock, me) {
  try {
    mkdirSync(lock.dir);
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
  const pidVisible = alive(me.pid);
  const info = {
    ...me,
    host: hostname(),
    startedAt: new Date().toISOString(),
    gitCommonDir: lock.common,
    bootId: bootId(),
    // Only a pid this namespace can see is ever checked for liveness.
    pidNamespace: pidVisible ? pidNamespace() : undefined,
  };
  const tmp = join(lock.dir, `info.json.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(info, null, 2)}\n`);
  renameSync(tmp, join(lock.dir, 'info.json'));
  return true;
}

/** Removes the lock if it is still the same stale one; serialized by <lock>.break. */
function breakStale(lock, seen, opts) {
  const brk = `${lock.dir}.break`;
  try {
    mkdirSync(brk);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const m = mtimeMs(brk);
    if (m !== undefined && Date.now() - m > CREATING_MS)
      rmSync(brk, { recursive: true, force: true });
    return false;
  }
  try {
    const now = readJson(join(lock.dir, 'info.json'));
    const same = now?.run === seen?.run && now?.startedAt === seen?.startedAt;
    if (!same || !staleReason(now, lock.dir, opts)) return false;
    const grave = `${lock.dir}.stale-${Date.now()}-${process.pid}`;
    renameSync(lock.dir, grave);
    rmSync(grave, { recursive: true, force: true });
    return true;
  } finally {
    rmSync(brk, { recursive: true, force: true });
  }
}

function acquire(opts) {
  const lock = lockPath(opts);
  const me = identity(opts);
  mkdirSync(lock.root, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (tryCreate(lock, me)) {
      console.log(
        `release lock acquired: ${describe(readJson(join(lock.dir, 'info.json')))} at ${lock.dir}`,
      );
      return 0;
    }
    const info = readJson(join(lock.dir, 'info.json'));
    if (info?.run === me.run) {
      console.log(`release lock already held by this run: ${describe(info)}`);
      return 0;
    }
    const reason = staleReason(info, lock.dir, opts);
    if (!reason) {
      console.log(
        info
          ? `release already in progress by ${describe(info)}`
          : `release already in progress (lock ${lock.dir} is being created)`,
      );
      return HELD;
    }
    if (breakStale(lock, info, opts))
      console.log(`release lock: took over stale lock of run ${info?.run ?? '?'} (${reason})`);
  }
  console.log(`release already in progress (lock ${lock.dir} changed hands while acquiring)`);
  return HELD;
}

function release(opts) {
  const lock = lockPath(opts);
  const info = readJson(join(lock.dir, 'info.json'));
  if (mtimeMs(lock.dir) === undefined) {
    console.log('release lock is not held');
    return 0;
  }
  const me = identity(opts);
  if (!opts.force && info?.run !== me.run) {
    console.log(
      `release lock is held by ${info ? describe(info) : 'an unknown run'}, not run ${me.run}; not released (use --force to override)`,
    );
    return HELD;
  }
  const grave = `${lock.dir}.released-${Date.now()}-${process.pid}`;
  renameSync(lock.dir, grave);
  rmSync(grave, { recursive: true, force: true });
  console.log(`release lock released${info ? `: ${describe(info)}` : ''}`);
  return 0;
}

function status(opts) {
  const lock = lockPath(opts);
  if (mtimeMs(lock.dir) === undefined) {
    console.log(`free (${lock.dir})`);
    return 0;
  }
  const info = readJson(join(lock.dir, 'info.json'));
  const reason = staleReason(info, lock.dir, opts);
  if (reason) {
    console.log(`stale: run ${info?.run ?? '?'} (${reason}); the next acquire takes it over`);
    return 0;
  }
  console.log(info ? `held by ${describe(info)}` : `held (lock ${lock.dir} is being created)`);
  return HELD;
}

function main(argv) {
  try {
    const { cmd, opts } = parseArgs(argv);
    const run = { acquire, release, status }[cmd];
    if (!run) throw new Error('usage: release-lock.mjs acquire|release|status [options]');
    return run(opts);
  } catch (e) {
    console.error(`release-lock: ${e.message}`);
    return USAGE;
  }
}

process.exit(main(process.argv.slice(2)));
