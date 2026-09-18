/**
 * Native-addon (better-sqlite3) load diagnosis and recovery.
 *
 * Issue #231: `monograph build` died with a raw NODE_MODULE_VERSION dump and the
 * reporter then ran `npm rebuild better-sqlite3` five times — from their project
 * directory and against a *separate* global `@monoes/monograph` install — while the
 * binary that actually gets loaded lives several node_modules levels deeper, under
 * the globally installed `monomind` -> `@monoes/monomindcli` -> `@monoes/monograph`.
 * Every attempt left the file byte-identical because none of them ever touched it.
 *
 * So the useful thing to report is not "run npm rebuild" — it is *which physical
 * file* is being loaded and *which directory* owns the node_modules tree it lives
 * in, which is what these helpers derive.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname } from 'node:path';

export type NativeBindingStatus = 'ok' | 'abi-mismatch' | 'missing-binary' | 'load-error';

export interface RebuildTarget {
  /** Which tool owns the tree the binary lives in — they need different commands. */
  packageManager: 'npm' | 'pnpm';
  /** Directory to run the rebuild from: the package owning that node_modules. */
  rebuildCwd: string;
  /** The module's own directory under node_modules. */
  packageDir: string;
}

export interface NativeBindingDiagnosis {
  status: NativeBindingStatus;
  module: string;
  /** Node currently running (`process.version`). */
  nodeVersion: string;
  /** ABI this Node requires (`process.versions.modules`). */
  runtimeAbi: string;
  /** ABI the binary on disk was compiled for, when the error reported it. */
  builtForAbi?: string;
  /** The exact `.node` file that failed to load, when the error named it. */
  binaryPath?: string;
  target?: RebuildTarget;
  /** One-line summary, safe to use as a doctor check message. */
  summary: string;
  /** Exact command to run, including the directory it must run in. */
  fix?: string;
  /** Raw error text, for logs. */
  raw?: string;
}

export interface RuntimeInfo {
  nodeVersion: string;
  runtimeAbi: string;
}

function currentRuntime(): RuntimeInfo {
  return { nodeVersion: process.version, runtimeAbi: process.versions.modules };
}

/**
 * Works out where a `.node` binary's package lives and which directory a rebuild
 * has to run from. `rebuildCwd` is the part users can't guess: for a nested
 * global install it is not the project, and not the top-level global package,
 * but the intermediate package that owns the node_modules holding the binary.
 */
export function deriveRebuildTarget(binaryPath: string): RebuildTarget | null {
  const norm = binaryPath.replace(/\\/g, '/');
  const lastIdx = norm.lastIndexOf('/node_modules/');
  if (lastIdx === -1) return null;

  const rest = norm.slice(lastIdx + '/node_modules/'.length).split('/');
  if (rest.length === 0 || rest[0] === '') return null;
  const nameSegs = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1);
  if (nameSegs.length === 2 && !nameSegs[1]) return null;
  const packageDir = `${norm.slice(0, lastIdx)}/node_modules/${nameSegs.join('/')}`;

  // pnpm keeps every package in a content-addressed store at
  // <root>/node_modules/.pnpm/<name>@<version>/node_modules/<name>. Rebuilding
  // from inside the store is not how pnpm works — the rebuild is driven from the
  // project/workspace root that owns the store.
  const pnpmMarker = '/node_modules/.pnpm/';
  const pnpmIdx = norm.indexOf(pnpmMarker);
  if (pnpmIdx !== -1) {
    return { packageManager: 'pnpm', rebuildCwd: norm.slice(0, pnpmIdx), packageDir };
  }

  return { packageManager: 'npm', rebuildCwd: norm.slice(0, lastIdx), packageDir };
}

function fixCommand(module: string, status: NativeBindingStatus, target?: RebuildTarget): string {
  // `--build-from-source` matters for the ABI case specifically: a plain rebuild
  // can resolve a cached prebuilt of the wrong ABI and change nothing at all.
  const rebuild =
    target?.packageManager === 'pnpm'
      ? `pnpm rebuild ${module}`
      : `npm rebuild ${module}${status === 'abi-mismatch' ? ' --build-from-source' : ''}`;
  return target ? `cd ${target.rebuildCwd} && ${rebuild}` : rebuild;
}

/** Message of an error plus its immediate cause, on one line. */
function firstLine(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause === undefined) return err.message;
  return `${err.message}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

/**
 * Flattens an error and its `.cause` chain into one searchable blob. The native
 * failure arrives wrapped (MonographError('Failed to open database at …', cause)),
 * and neither `.message` nor `.stack` of the wrapper contains the cause's text.
 */
function errorText(err: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const head = `${err.message}\n${err.stack ?? ''}`;
  return cause === undefined ? head : `${head}\n${errorText(cause, depth + 1)}`;
}

/**
 * Turns a native-addon load failure into a diagnosis naming the running Node, the
 * ABI the binary was built for, the file itself, and the exact fix command.
 * Pure — takes the runtime facts rather than reading them, so it is testable.
 */
export function diagnoseNativeLoadError(
  err: unknown,
  module: string,
  runtime: RuntimeInfo = currentRuntime(),
  /**
   * Absolute path of the module as resolved by the caller. The "bindings file not
   * found" error lists only *candidate* paths, most of them relative, so there is
   * nothing trustworthy in its text to locate the install from.
   */
  resolvedModulePath?: string,
): NativeBindingDiagnosis {
  const raw = errorText(err);
  const base = { module, nodeVersion: runtime.nodeVersion, runtimeAbi: runtime.runtimeAbi, raw };

  const binaryPath = raw.match(/The module '([^']+)'/)?.[1];
  const target =
    (binaryPath ? deriveRebuildTarget(binaryPath) : null) ??
    (resolvedModulePath ? deriveRebuildTarget(resolvedModulePath) : null) ??
    undefined;

  // build.log is append-only, so several failures can pile up; match bounded
  // pairs and take the last (most recent) one.
  const pairs = [
    ...raw.matchAll(/NODE_MODULE_VERSION (\d+)[\s\S]{0,200}?NODE_MODULE_VERSION (\d+)/g),
  ];
  if (pairs.length > 0) {
    const [, builtForAbi] = pairs[pairs.length - 1];
    return {
      ...base,
      status: 'abi-mismatch',
      builtForAbi,
      binaryPath,
      target,
      summary:
        `\`${module}\`'s native binary was built for Node ABI ${builtForAbi}, but this ` +
        `process is Node ${runtime.nodeVersion} (ABI ${runtime.runtimeAbi})`,
      fix: fixCommand(module, 'abi-mismatch', target),
    };
  }

  if (/Could not locate the bindings file/i.test(raw)) {
    return {
      ...base,
      status: 'missing-binary',
      binaryPath,
      target,
      summary:
        `\`${module}\`'s native binary was never built for this platform (it does not exist — ` +
        'not an ABI mismatch). Its install script was most likely blocked or failed silently',
      fix: fixCommand(module, 'missing-binary', target),
    };
  }

  return {
    ...base,
    status: 'load-error',
    binaryPath,
    target,
    summary: `\`${module}\` failed to load: ${firstLine(err)}`,
    fix: target ? fixCommand(module, 'load-error', target) : undefined,
  };
}

/** Multi-line, human-facing rendering of a failed diagnosis. */
export function formatNativeDiagnosis(diag: NativeBindingDiagnosis): string {
  const lines = [diag.summary];
  if (diag.binaryPath) lines.push(`  binary  : ${diag.binaryPath}`);
  if (diag.target) lines.push(`  owned by: ${diag.target.rebuildCwd}`);
  if (diag.fix) lines.push(`  fix     : ${diag.fix}`);
  if (diag.status === 'abi-mismatch') {
    lines.push(
      '  note    : rebuilding from your project directory, or reinstalling a different copy ' +
        'of the package, will not touch the file above — the command must run in the ' +
        'directory named there.',
    );
  }
  return lines.join('\n');
}

/**
 * A `require` rooted at @monoes/monograph, so `better-sqlite3` resolves exactly as
 * it does for the code that actually uses it. Monograph is ESM-only (its exports
 * map has no `require` condition), so `require.resolve` can't find it and
 * `import.meta.resolve` has to do the locating. Falls back to resolving from this
 * package when that isn't available.
 */
function requireFromMonograph(): NodeJS.Require {
  const here = createRequire(import.meta.url);
  try {
    const url = (import.meta as { resolve?: (s: string) => string }).resolve?.('@monoes/monograph');
    if (url) return createRequire(url);
  } catch {
    /* fall back to this package's own resolution below */
  }
  return here;
}

/** Where `@monoes/monograph` resolves a module to, or undefined if it can't. */
function resolveFromMonograph(module: string): string | undefined {
  try {
    return requireFromMonograph().resolve(module);
  } catch {
    return undefined;
  }
}

/**
 * Diagnoses a failure thrown while monograph was using better-sqlite3, locating the
 * install through monograph's own resolution rather than guessing from error text.
 */
export function diagnoseMonographNativeError(err: unknown): NativeBindingDiagnosis {
  return diagnoseNativeLoadError(
    err,
    'better-sqlite3',
    currentRuntime(),
    resolveFromMonograph('better-sqlite3'),
  );
}

/**
 * Loads the very same `better-sqlite3` copy `@monoes/monograph` will load (resolved
 * from monograph's own location, not the CLI's — under nested installs they can
 * differ, which is the whole point) and opens an in-memory database to force the
 * addon binding.
 *
 * Runs in a child process on purpose. Once an addon has failed to dlopen in a
 * process, later attempts report a useless "Module did not self-register" instead
 * of the real ABI error — and doctor has other checks that touch sqlite before
 * this one. A fresh process also means a binary that segfaults on load can't take
 * doctor down with it.
 */
export function probeMonographSqliteBinding(
  runtime: RuntimeInfo = currentRuntime(),
): NativeBindingDiagnosis {
  const module = 'better-sqlite3';
  const base = { module, nodeVersion: runtime.nodeVersion, runtimeAbi: runtime.runtimeAbi };
  const entry = resolveFromMonograph(module);
  if (!entry) {
    return {
      ...base,
      status: 'load-error',
      summary: `\`${module}\` could not be resolved from @monoes/monograph — is it installed?`,
    };
  }

  const res = spawnSync(
    process.execPath,
    ['-e', `new (require(${JSON.stringify(entry)}))(':memory:').close()`],
    { encoding: 'utf8', timeout: 60_000 },
  );
  if (res.status === 0) {
    return {
      ...base,
      status: 'ok',
      binaryPath: entry,
      summary: `${module} loads under Node ${runtime.nodeVersion} (ABI ${runtime.runtimeAbi})`,
    };
  }

  const text = `${res.stderr ?? ''}\n${res.stdout ?? ''}`.trim();
  const crashed = res.signal ? ` (killed by ${res.signal})` : '';
  return diagnoseNativeLoadError(
    new Error(text || `probe exited with status ${res.status}${crashed}`),
    module,
    runtime,
    entry,
  );
}

export interface AutoRebuildDecision {
  attempt: boolean;
  reason: string;
}

/**
 * Decides whether monomind may rebuild the module itself. Deliberately
 * conservative: a native rebuild mutates an install tree that may be a shared or
 * root-owned global one, so it only runs when the current user can actually
 * write there and the user hasn't opted out.
 */
export function planAutoRebuild(
  diag: NativeBindingDiagnosis,
  opts: { disabled?: boolean; isWritable?: (dir: string) => boolean } = {},
): AutoRebuildDecision {
  if (diag.status === 'ok') return { attempt: false, reason: 'binding already loads' };
  if (opts.disabled) return { attempt: false, reason: 'MONOMIND_NO_NATIVE_REBUILD is set' };
  if (!diag.target) return { attempt: false, reason: 'could not locate the install directory' };
  const writable = opts.isWritable ?? defaultIsWritable;
  if (!writable(diag.target.rebuildCwd)) {
    return { attempt: false, reason: `${diag.target.rebuildCwd} is not writable by this user` };
  }
  return { attempt: true, reason: `rebuilding in ${diag.target.rebuildCwd}` };
}

function defaultIsWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export interface RebuildResult {
  ok: boolean;
  command: string;
  output: string;
}

/** Runs the single rebuild `planAutoRebuild` approved. */
export function runNativeRebuild(diag: NativeBindingDiagnosis): RebuildResult {
  const target = diag.target;
  if (!target) return { ok: false, command: '', output: 'no rebuild target' };
  const bin = target.packageManager === 'pnpm' ? 'pnpm' : 'npm';
  const args = ['rebuild', diag.module];
  if (bin === 'npm' && diag.status === 'abi-mismatch') args.push('--build-from-source');
  const res = spawnSync(bin, args, {
    cwd: target.rebuildCwd,
    encoding: 'utf8',
    timeout: 15 * 60_000,
    // node-gyp compiles against whichever `node` it finds on PATH. If monomind
    // is running under a different Node than the PATH default — the exact
    // situation that produces an ABI mismatch — an inherited PATH would rebuild
    // for the wrong ABI again, so put the running Node first.
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    },
  });
  return {
    ok: res.status === 0,
    command: `cd ${target.rebuildCwd} && ${bin} ${args.join(' ')}`,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
  };
}
