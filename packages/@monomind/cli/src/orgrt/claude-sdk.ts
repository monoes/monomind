// packages/@monomind/cli/src/orgrt/claude-sdk.ts
/**
 * The Claude Agent SDK and the Claude Code binary it runs (#428, #522).
 *
 * The SDK is installed into ~/.monomind/deps on first use
 * (utils/optional-deps.ts). Most of its 300 MB is its own copy of Claude Code.
 * When a usable Claude Code is already installed, it is passed to the SDK as
 * `pathToClaudeCodeExecutable`, and the SDK is installed without its bundled
 * binary.
 *
 * Where to look, in order (nothing is run to find it):
 *   1. $MONOMIND_CLAUDE_PATH. Set to `bundled`, it turns detection off.
 *   2. `claude` on PATH;
 *   3. ~/.local/bin/claude;
 *   4. ~/.claude/local/claude.
 *
 * What is accepted. The binary's real path is what the SDK runs, so a
 * symlink swapped later changes nothing in this process. The org daemons run
 * it outside every role sandbox, so a role that could rewrite it would run
 * code as the operator:
 *   - A binary found on its own (2-4) must be a system install: the file and
 *     every directory above it owned by root and not writable by group or
 *     others, and not under $HOME, a temp dir or the cwd. Org roles run as
 *     the operator's user, and the bwrap mask (authority-mask.ts) leaves
 *     everything that user can write writable, so nothing the user owns can
 *     be trusted cheaply. That excludes the usual per-user installs
 *     (~/.local/share/claude, mise, nvm, Homebrew); see #527. Running as
 *     root, roles are root too, so ownership proves nothing: no binary is
 *     picked up on its own then.
 *   - $MONOMIND_CLAUDE_PATH is the operator's own choice and may point
 *     anywhere. The file only has to be owned by this user or root and not
 *     writable by group or others (not checked on Windows). When it is not a
 *     system install, a warning says so, and org roles get it read-only:
 *     `protectedClaudeBinary()` feeds the Claude sandbox, the bwrap mask and
 *     the file tools.
 *   - The file must not be a script (`#!`): Claude Code 2.1.226 and later is
 *     a native binary, and a script would run whatever PATH finds. Its name
 *     must be `claude`/`claude.exe` or the native installer's
 *     `versions/<x.y.z>`, so a multi-call binary behind a shim (mise) is
 *     never run.
 * Then `claude --version` runs once per process (no shell, short timeout).
 * It must print `x.y.z (Claude Code)` with the same major as the Claude Code
 * the pinned SDK bundles, that version or newer: the SDK passes the CLI flags
 * and control messages of its own Claude Code release, and an older CLI
 * rejects the flags it does not know. Newer 2.x releases keep accepting them.
 * Anything refused falls back to the SDK's bundled binary. An explicit path
 * that is refused is reported on stderr; it is never replaced by another
 * candidate.
 */
import { execFile } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
  statSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { type EnsureOptions, ensureOptionalDependency } from '../utils/optional-deps.js';
import { withPinnedExecutable } from './claude-sdk-pin.js';

export const CLAUDE_PATH_ENV = 'MONOMIND_CLAUDE_PATH';
/** The Claude Code version bundled with the pinned SDK (its manifest.json);
 *  claude-sdk.test.ts checks it against the installed SDK. */
export const SDK_BUNDLED_CLAUDE_VERSION = '2.1.289';
const SDK = '@anthropic-ai/claude-agent-sdk';
const VERSION_TIMEOUT_MS = 5_000;

export interface ClaudeProbe {
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  /** This process's uid; undefined where there is none (Windows). */
  uid: number | undefined;
  /** Real paths roles can write whatever the ownership: $HOME, temp dirs,
   *  the cwd. */
  roleWritableRoots: string[];
  realpath: (p: string) => string;
  stat: (p: string) => Stats;
  isExecutable: (p: string) => boolean;
  /** The file's first two bytes. */
  head: (p: string) => string;
  /** Stdout of `<file> --version`. */
  version: (file: string) => Promise<string>;
  log: (line: string) => void;
}

export interface InstalledClaude {
  /** Real path of the binary to use; undefined means the SDK's own. */
  path?: string;
  /** Binaries found but not used, with the reason. */
  skipped: string[];
}

interface Candidate {
  path: string;
  explicit: boolean;
}

const explicitPath = (env: NodeJS.ProcessEnv): string | undefined => {
  const v = env[CLAUDE_PATH_ENV]?.trim();
  return v && v !== 'bundled' ? v : undefined;
};

/** Where to look, in order; empty when detection is off. */
export function claudeCandidates(
  env: NodeJS.ProcessEnv,
  home: string,
  platform: NodeJS.Platform,
): Candidate[] {
  if (env[CLAUDE_PATH_ENV]?.trim() === 'bundled') return [];
  const explicit = explicitPath(env);
  if (explicit) return [{ path: explicit, explicit: true }];
  const bin = platform === 'win32' ? 'claude.exe' : 'claude';
  // Relative PATH entries depend on the cwd; skip them.
  const onPath = (env.PATH ?? '')
    .split(delimiter)
    .filter((d) => d && isAbsolute(d))
    .map((d) => join(d, bin));
  const paths = [...onPath, join(home, '.local', 'bin', bin), join(home, '.claude', 'local', bin)];
  return [...new Set(paths)].map((path) => ({ path, explicit: false }));
}

const VERSION_LINE = /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)/;

/** Whether `claude --version` output names a Claude Code the pinned SDK can
 *  drive: same major as the bundled one, and that version or newer. */
export function compatibleClaudeVersion(output: string): { ok: boolean; version?: string } {
  const m = VERSION_LINE.exec(output.trim());
  if (!m) return { ok: false };
  const have = m.slice(1, 4).map(Number);
  const need = SDK_BUNDLED_CLAUDE_VERSION.split('.').map(Number);
  const version = have.join('.');
  if (have[0] !== need[0]) return { ok: false, version };
  for (let i = 1; i < 3; i++) if (have[i] !== need[i]) return { ok: have[i] > need[i], version };
  return { ok: true, version };
}

/** A Claude Code file name: `claude`, `claude.exe`, or the native
 *  installer's `versions/<x.y.z>`. */
export function looksLikeClaude(real: string): boolean {
  const name = basename(real);
  if (name === 'claude' || name === 'claude.exe') return true;
  return basename(dirname(real)) === 'versions' && /^\d+\.\d+\.\d+$/.test(name);
}

const groupOrOtherWritable = (st: Stats): boolean => (Number(st.mode) & 0o022) !== 0;

const within = (p: string, root: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** Why the binary at `real` is not a system install, or undefined. */
export function notSystemInstalled(real: string, probe: ClaudeProbe): string | undefined {
  if (probe.uid === undefined) return 'file ownership cannot be checked on this platform';
  if (probe.uid === 0)
    return 'running as root: ownership cannot separate a system install from a role-writable one';
  const root = probe.roleWritableRoots.find((r) => within(real, r));
  if (root) return `${real} is under ${root}, which org roles can write`;
  for (let cur = real; ; cur = dirname(cur)) {
    const st = probe.stat(cur);
    if (st.uid !== 0)
      return `${cur} is owned by uid ${st.uid}, not root, so org roles may write it`;
    if (groupOrOtherWritable(st)) return `${cur} is writable by group or others`;
    if (dirname(cur) === cur) return undefined;
  }
}

/** Why an operator-chosen binary is refused, or undefined. On Windows there
 *  is no uid, and the ACLs are not checked. */
function badExplicitBinary(real: string, probe: ClaudeProbe): string | undefined {
  const st = probe.stat(real);
  if (probe.uid !== undefined && st.uid !== probe.uid && st.uid !== 0)
    return `${real} is owned by uid ${st.uid}, not by this user or root`;
  if (probe.platform !== 'win32' && groupOrOtherWritable(st))
    return `${real} is writable by group or others`;
  return undefined;
}

type Checked = { real: string } | { why: string; missing?: boolean };

async function checkCandidate(c: Candidate, probe: ClaudeProbe): Promise<Checked> {
  if (!isAbsolute(c.path)) return { why: 'it is not an absolute path' };
  let real: string;
  try {
    real = probe.realpath(c.path);
  } catch {
    return { why: 'it does not exist', missing: true };
  }
  try {
    if (!probe.stat(real).isFile()) return { why: `${real} is not a file` };
    if (!looksLikeClaude(real))
      return { why: `${real} is not named claude or versions/<x.y.z>, so it is not run` };
    if (!probe.isExecutable(real)) return { why: `${real} is not executable` };
    if (probe.head(real) === '#!')
      return {
        why: `${real} is a script; Claude Code ${SDK_BUNDLED_CLAUDE_VERSION}+ is a native binary`,
      };
    if (c.explicit) {
      const bad = badExplicitBinary(real, probe);
      if (bad) return { why: bad };
      const exposed = notSystemInstalled(real, probe);
      if (exposed)
        probe.log(
          `${CLAUDE_PATH_ENV}: ${real} is not a system install (${exposed}), so org roles can ` +
            'replace it where they are not sandboxed; the Claude sandbox, the bwrap mask and the ' +
            'file tools keep it read-only for roles.',
        );
    } else {
      const bad = notSystemInstalled(real, probe);
      if (bad) return { why: bad };
    }
    const v = compatibleClaudeVersion(await probe.version(real));
    if (!v.ok) {
      const [major] = SDK_BUNDLED_CLAUDE_VERSION.split('.');
      return {
        why:
          `${real} is Claude Code ${v.version ?? 'of an unknown version'}, and the Claude ` +
          `runtime needs ${major}.x, ${SDK_BUNDLED_CLAUDE_VERSION} or newer`,
      };
    }
  } catch (e) {
    return { why: `checking ${real} failed: ${(e as Error).message}` };
  }
  return { real };
}

/** Finds the Claude Code to use (see the file header). */
export async function findInstalledClaude(probe: ClaudeProbe): Promise<InstalledClaude> {
  const skipped: string[] = [];
  for (const c of claudeCandidates(probe.env, probe.home, probe.platform)) {
    const r = await checkCandidate(c, probe);
    if ('real' in r) return { path: r.real, skipped };
    if (c.explicit) {
      probe.log(
        `${CLAUDE_PATH_ENV}=${c.path} is not used: ${r.why}. ` +
          "Using the Claude Agent SDK's bundled Claude Code.",
      );
      return { skipped };
    }
    if (!r.missing) skipped.push(`${c.path}: ${r.why}`);
  }
  return { skipped };
}

/**
 * The operator-chosen binary (its real path) and the directories above it
 * that must become mount points, outermost first, so that a role can
 * neither write it nor rename a directory on the way to it aside and plant
 * another (a rename of a directory that merely contains a mount point
 * succeeds). The list stops below $HOME, which a role cannot rename, or at
 * `/`. Undefined when no explicit path is set or it does not resolve.
 */
export function protectedClaudeBinary(
  env: NodeJS.ProcessEnv,
  home: string,
): { file: string; dirs: string[] } | undefined {
  const p = explicitPath(env);
  if (!p || !isAbsolute(p)) return undefined;
  let file: string;
  let stop: string;
  try {
    file = realpathSync(p);
    stop = realpathSync(home);
  } catch {
    return undefined;
  }
  const dirs: string[] = [];
  for (let d = dirname(file); d !== stop && dirname(d) !== d; d = dirname(d)) dirs.unshift(d);
  return { file, dirs };
}

const runVersion = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      ['--version'],
      { timeout: VERSION_TIMEOUT_MS, shell: false, windowsHide: true, maxBuffer: 64 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
    );
  });

const readHead = (p: string): string => {
  const fd = openSync(p, 'r');
  try {
    const buf = Buffer.alloc(2);
    return buf.subarray(0, readSync(fd, buf, 0, 2, 0)).toString('latin1');
  } finally {
    closeSync(fd);
  }
};

const realOrSelf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

export const defaultClaudeProbe = (env: NodeJS.ProcessEnv = process.env): ClaudeProbe => {
  const home = homedir();
  return {
    env,
    home,
    platform: process.platform,
    uid: process.getuid?.(),
    roleWritableRoots: [
      ...new Set(
        [home, tmpdir(), '/tmp', '/var/tmp', '/dev/shm', process.cwd()]
          .filter((r) => existsSync(r))
          .map(realOrSelf),
      ),
    ],
    realpath: realpathSync,
    stat: statSync,
    isExecutable: (p) => {
      try {
        accessSync(p, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    head: readHead,
    version: runVersion,
    log: (line) => process.stderr.write(`[monomind] ${line}\n`),
  };
};

/** How to load the SDK given what `findInstalledClaude` found. */
export function sdkLoadOptions(found: InstalledClaude): EnsureOptions {
  if (found.path) return { withoutSdkBinary: true };
  if (!found.skipped.length) return {};
  return {
    note:
      `An installed Claude Code was not used (${found.skipped.join('; ')}); ` +
      `set ${CLAUDE_PATH_ENV} to a Claude Code binary to use it instead.`,
  };
}

export type ClaudeSdk = Pick<
  typeof import('@anthropic-ai/claude-agent-sdk'),
  'createSdkMcpServer' | 'query' | 'tool'
> & {
  /** Set when an installed Claude Code is used; `query` then always passes
   *  it as `pathToClaudeCodeExecutable`. */
  executable?: string;
};

let claudeSdk: Promise<ClaudeSdk> | undefined;

/** `query` with `pathToClaudeCodeExecutable` always set to `executable`.
 *  The SDK was installed without its own binary, so there is nothing to
 *  fall back to when the file is gone (an update pruned that version): the
 *  call fails with a message saying so, and the next load looks again. */
export function queryWithExecutable(
  query: ClaudeSdk['query'],
  executable: string,
): ClaudeSdk['query'] {
  return ((params: Parameters<ClaudeSdk['query']>[0]) => {
    if (!existsSync(executable)) {
      claudeSdk = undefined;
      throw new Error(
        `The installed Claude Code this process chose, ${executable}, no longer exists ` +
          '(an update may have removed that version). The next session looks for Claude Code ' +
          `again; if ${CLAUDE_PATH_ENV} names that file, point it at the current binary.`,
      );
    }
    return query({
      ...params,
      options: { ...params.options, pathToClaudeCodeExecutable: executable },
    });
  }) as ClaudeSdk['query'];
}

/** The Claude Agent SDK, installed into ~/.monomind/deps on first use
 *  (#428; not a dependency of the published package), running the installed
 *  Claude Code if there is a usable one (#522). Loaded once per process; a
 *  failure is not cached, so a later session retries. `probe` is for tests;
 *  `requested` marks the operator's own `monomind deps install` (#559). */
export const loadClaudeSdk = (
  probe?: ClaudeProbe,
  { requested = false }: { requested?: boolean } = {},
): Promise<ClaudeSdk> =>
  (claudeSdk ??= (async () => {
    const found = await findInstalledClaude(probe ?? defaultClaudeProbe());
    const sdk = await ensureOptionalDependency<ClaudeSdk>(SDK, {
      ...sdkLoadOptions(found),
      ...(requested ? { requested } : {}),
    });
    const { createSdkMcpServer, query, tool } = sdk;
    // #526: the SDK's own binary, pinned by hash, is passed to and rechecked
    // at every query (claude-sdk-pin.ts). An installed Claude Code below is
    // not ours to pin: #522's checks above cover it.
    if (!found.path) return withPinnedExecutable({ createSdkMcpServer, query, tool });
    return {
      createSdkMcpServer,
      tool,
      query: queryWithExecutable(query, found.path),
      executable: found.path,
    };
  })().catch((err) => {
    claudeSdk = undefined;
    throw err;
  }));
