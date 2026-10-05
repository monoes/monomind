/**
 * Heavy dependencies installed on first use (#428).
 *
 * `npm install monomind` used to pull a 232 MB native Claude binary (through
 * @anthropic-ai/claude-agent-sdk) and 657 MB of Chrome (through puppeteer's
 * postinstall) whether or not the user ever ran a Claude org role or a
 * browser command. They are no longer dependencies of the published packages.
 * The feature that needs one calls `ensureOptionalDependency()`, which:
 *
 *   1. imports the package if monomind's own node_modules has it at the
 *      pinned version (a source checkout keeps it as a devDependency);
 *   2. otherwise imports it from `~/.monomind/deps/<name>@<version>/`
 *      (`$MONOMIND_HOME/deps` when that is set);
 *   3. otherwise installs it there, once, with a notice on stderr, unless
 *      MONOMIND_NO_AUTO_INSTALL is set, in which case it throws with the exact
 *      command that does the same install by hand.
 *
 * When a usable Claude Code is installed (orgrt/claude-sdk.ts, #522), the
 * SDK is installed with `--omit=optional`: its JS package only, without the
 * platform package that carries the native binary.
 *
 * Safety:
 *   - Only the packages in OPTIONAL_DEPENDENCIES can be installed, each at
 *     the exact version pinned there; nothing from input reaches npm.
 *   - npm runs `npm ci` against a lockfile shipped with monomind
 *     (optional-deps-locks.ts), in a staging directory under the deps root,
 *     with `--ignore-scripts`, never in the user's project. Every tarball must
 *     match the lockfile's integrity hash, whatever registry npm is pointed at.
 *   - The deps directory is monomind's code, loaded by unsandboxed daemons, so
 *     org roles must not write it: it is in HOME_DENY_WRITE (file tools and
 *     the SDK sandbox) and read-only in the authority mask (#518 review, B1).
 *     Before loading anything from it, the deps root and the entry are checked
 *     here as well: no symlink on the way to it or leading out of it, every
 *     file owned by this user and not group- or other-writable.
 *   - That cannot tell a same-user plant from a real install, so the file
 *     it imports and, for the SDK, the Claude binary the SDK will spawn must
 *     also match SHA-256 hashes shipped beside the lockfiles, whether the
 *     copy is in the deps dir or up monomind's own module path; and no
 *     directory above the deps root may be a symlink this user could
 *     replace (optional-deps-verify.ts, #526).
 *   - The staging directory is renamed into place only once complete, so a
 *     crashed or concurrent install never leaves a half-populated directory
 *     where a later run would find it. A lock directory next to it keeps two
 *     processes from downloading the same thing at once.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultIdentity } from '../orgrt/sandbox-stubs-ledger.js';
import { npmInvocation } from './npm-command.js';
import {
  type CodePins,
  OPTIONAL_DEPENDENCY_CODE_PINS,
  OPTIONAL_DEPENDENCY_LOCKS,
} from './optional-deps-locks.js';
import { assertNoSymlinkAncestor, type PinHost, verifyPinnedCode } from './optional-deps-verify.js';

interface OptionalDependencySpec {
  /** Exact version; keep in step with the CLI's devDependencies. */
  version: string;
  /** Rough installed size, for the notice. */
  size: string;
  /** What needs it, for the notice and errors. */
  feature: string;
}

export const OPTIONAL_DEPENDENCIES = {
  '@anthropic-ai/claude-agent-sdk': {
    version: '0.3.289',
    size: 'about 300 MB, nearly all of it the native Claude binary',
    feature: 'The Claude runtime (Claude org roles, `agent exec --runtime claude`)',
  },
  '@puppeteer/browsers': {
    version: '3.0.6',
    size: 'about 2 MB',
    feature: 'The Chrome download for `monomind browse`',
  },
  'monofence-ai': {
    version: '2.24.0',
    size: 'under 1 MB',
    feature: 'MonoFence (the monofence_* MCP tools, `security defend`, org role fences)',
  },
} as const satisfies Record<string, OptionalDependencySpec>;

export type OptionalDependencyName = keyof typeof OPTIONAL_DEPENDENCIES;

export const NO_AUTO_INSTALL_ENV = 'MONOMIND_NO_AUTO_INSTALL';
/** The operator's command that installs the Claude Agent SDK outside any org
 *  role (commands/deps.ts, #559). */
export const DEPS_INSTALL_COMMAND = 'monomind deps install';

/** A missing dependency that was not (or could not be) installed. */
export class OptionalDependencyError extends Error {
  override name = 'OptionalDependencyError';
}

type Env = NodeJS.ProcessEnv;
type Log = (line: string) => void;
export type NpmRunner = (args: string[], cwd: string, env: Env) => Promise<void>;
type Host = PinHost;

export interface EnsureOptions {
  env?: Env;
  /** Resolves `name` from monomind's own module graph to its entry file.
   *  Tests replace it. */
  resolveOwn?: (name: string) => string;
  runNpm?: NpmRunner;
  log?: Log;
  /** For the SDK's platform-package check; tests replace it. */
  host?: Host;
  /** The hashes loaded code must match (#526); tests replace them. */
  pins?: Partial<Record<string, CodePins>>;
  /** #522: an installed Claude Code runs instead of the SDK's bundled
   *  binary, so the SDK is installed without its platform package
   *  (`--omit=optional`), and an install that lacks it counts as installed. */
  withoutSdkBinary?: boolean;
  /** Appended to the install notice. */
  note?: string;
  /** The operator asked for this install (`monomind deps install`), so
   *  MONOMIND_NO_AUTO_INSTALL does not stop it. */
  requested?: boolean;
  /** Install into the deps cache even when monomind resolves the pinned copy itself (a checkout's own
   *  node_modules, say). `monomind deps install` sets it: an org role's sandbox can only use the cache,
   *  so a copy that merely sits in the operator's checkout is not what the operator asked for. */
  intoCache?: boolean;
}

/** Flags for the printed manual command (plain `npm install`, no lockfile). */
const NPM_MANUAL_FLAGS = [
  '--global=false',
  '--ignore-scripts',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
  '--save-exact',
];
/** Flags for the automatic install: `npm ci` against the shipped lockfile.
 *  One fetch attempt with a short timeout, so an offline machine fails in
 *  seconds instead of sitting in npm's retry backoff. */
const NPM_CI_FLAGS = [
  '--global=false',
  '--ignore-scripts',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
  '--fetch-retries=0',
  '--fetch-timeout=15000',
];
const LOCK_STALE_MS = 60 * 60 * 1000;
const LOCK_POLL_MS = 500;
/** Errors that mean "this process may not write here" (an org role's
 *  sandbox mounts the deps directory read-only). */
const READ_ONLY_CODES = new Set(['EROFS', 'EACCES', 'EPERM']);

const defaultLog: Log = (line) => process.stderr.write(`[monomind] ${line}\n`);
const thisHost = (): Host => ({ platform: process.platform, arch: process.arch });

export function autoInstallDisabled(env: Env = process.env): boolean {
  const v = env[NO_AUTO_INSTALL_ENV]?.trim().toLowerCase();
  return !!v && v !== '0' && v !== 'false';
}

export function monomindHome(env: Env = process.env, home: string = homedir()): string {
  return env.MONOMIND_HOME || join(home, '.monomind');
}

export function depsRoot(env: Env = process.env, home: string = homedir()): string {
  return join(monomindHome(env, home), 'deps');
}

/** Creates the deps root (owner-only) if missing. The authority mask and the
 *  SDK sandbox bind it read-only, which needs it to exist. */
export function ensureDepsRoot(env: Env = process.env, home: string = homedir()): string {
  const root = depsRoot(env, home);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

/** The deps root for a sandbox to protect, created if possible. When this
 *  process cannot create it, a role running as the same user cannot either,
 *  so there is nothing to protect yet. */
export function protectableDepsRoot(env: Env, home: string): string | undefined {
  try {
    return ensureDepsRoot(env, home);
  } catch {
    return undefined;
  }
}

export function dependencyDir(name: OptionalDependencyName, env: Env = process.env): string {
  return join(depsRoot(env), `${name.replace('/', '+')}@${OPTIONAL_DEPENDENCIES[name].version}`);
}

/** Single-quotes `s` for a POSIX shell. */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** The command that performs the same install by hand. */
export function manualInstallCommand(
  name: OptionalDependencyName,
  env: Env = process.env,
  withoutSdkBinary = false,
): string {
  const { version } = OPTIONAL_DEPENDENCIES[name];
  const flags = [...NPM_MANUAL_FLAGS, ...omitFlags(name, withoutSdkBinary)];
  return `npm install --prefix ${shellQuote(dependencyDir(name, env))} ${flags.join(' ')} ${name}@${version}`;
}

/** `--omit=optional` skips the SDK's platform packages (the native binary);
 *  the shipped lockfile still pins and checks everything else. */
const omitFlags = (name: OptionalDependencyName, withoutSdkBinary: boolean): string[] =>
  withoutSdkBinary && name === '@anthropic-ai/claude-agent-sdk' ? ['--omit=optional'] : [];

function readVersion(pkgJson: string): string | undefined {
  try {
    return JSON.parse(readFileSync(pkgJson, 'utf8')).version;
  } catch {
    return undefined;
  }
}

/** The SDK's native binary comes in a per-platform optional package; an
 *  install without the one for this machine (interrupted, or copied from
 *  another OS) cannot run Claude, so it does not count as installed. */
function hasSdkPlatformPackage(dir: string, host: Host): boolean {
  const scope = join(dir, 'node_modules', '@anthropic-ai');
  const version = OPTIONAL_DEPENDENCIES['@anthropic-ai/claude-agent-sdk'].version;
  let entries: string[];
  try {
    entries = readdirSync(scope);
  } catch {
    return false;
  }
  return entries.some((e) => {
    if (!e.startsWith('claude-agent-sdk-')) return false;
    try {
      const pkg = JSON.parse(readFileSync(join(scope, e, 'package.json'), 'utf8'));
      const bin = host.platform === 'win32' ? 'claude.exe' : 'claude';
      return (
        pkg.version === version &&
        (pkg.os ?? []).includes(host.platform) &&
        (pkg.cpu ?? []).includes(host.arch) &&
        existsSync(join(scope, e, bin))
      );
    } catch {
      return false;
    }
  });
}

export function isInstalled(
  name: OptionalDependencyName,
  dir: string,
  host: Host = thisHost(),
  withoutSdkBinary = false,
): boolean {
  const pj = join(dir, 'node_modules', name, 'package.json');
  if (readVersion(pj) !== OPTIONAL_DEPENDENCIES[name].version) return false;
  return (
    name !== '@anthropic-ai/claude-agent-sdk' ||
    withoutSdkBinary ||
    hasSdkPlatformPackage(dir, host)
  );
}

/** Whether `name` loads without an install (#559): monomind resolves the
 *  pinned copy itself, or the deps dir holds a complete one. The pins are
 *  checked when it loads. */
export function optionalDependencyPresent(
  name: OptionalDependencyName,
  opts: Pick<EnsureOptions, 'env' | 'resolveOwn' | 'host' | 'withoutSdkBinary'> = {},
): boolean {
  try {
    if (ownEntry(name, opts.resolveOwn ?? defaultResolveOwn)) return true;
  } catch {
    // not resolvable from here: the deps dir decides
  }
  const dir = dependencyDir(name, opts.env ?? process.env);
  return isInstalled(name, dir, opts.host ?? thisHost(), !!opts.withoutSdkBinary);
}

/** The errno code when this process cannot write the deps root (an org
 *  role's sandbox binds it read-only), else undefined. */
function depsRootReadOnly(env: Env): string | undefined {
  try {
    accessSync(ensureDepsRoot(env), constants.W_OK);
    return undefined;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code && READ_ONLY_CODES.has(code) ? code : undefined;
  }
}

/** Why `p` may not be trusted as monomind's own file, or undefined. */
function untrustedReason(p: string, st: Stats): string | undefined {
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid) return `${p} is owned by uid ${st.uid}, not ${uid}`;
  if (process.platform !== 'win32' && !st.isSymbolicLink() && (Number(st.mode) & 0o022) !== 0)
    return `${p} is writable by group or others (mode ${(Number(st.mode) & 0o777).toString(8)})`;
  return undefined;
}

/**
 * Throws unless `entry` (a directory under `root`) is safe to load code
 * from: `root`, every directory between it and `entry`, and `entry` itself
 * are real directories (not symlinks); everything inside is owned by this
 * user and not group- or other-writable; and a symlink inside (npm's `.bin`
 * links, macOS framework links) resolves to a path inside `entry`.
 */
export function assertTrustedTree(root: string, entry: string): void {
  const refuse = (why: string): never => {
    throw new OptionalDependencyError(
      `Refusing to load code from ${entry}: ${why}. monomind only loads what it installed ` +
        `itself; delete ${entry} (or fix its permissions) and run the command again.`,
    );
  };
  const rel = relative(root, entry);
  if (rel === '..' || rel.startsWith(`..${sep}`)) refuse(`it is not under ${root}`);
  let cur = root;
  for (const part of ['', ...(rel ? rel.split(sep) : [])]) {
    if (part) cur = join(cur, part);
    const st = lstatSync(cur);
    if (st.isSymbolicLink()) refuse(`${cur} is a symlink`);
    if (!st.isDirectory()) refuse(`${cur} is not a directory`);
    const why = untrustedReason(cur, st);
    if (why) refuse(why);
  }
  if (!rel) return; // the root alone: its contents are the entries
  const realEntry = realpathSync(entry);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      const why = untrustedReason(p, st);
      if (why) refuse(why);
      if (st.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(p);
        } catch {
          continue; // dangling: loads nothing
        }
        if (target !== realEntry && !target.startsWith(realEntry + sep))
          refuse(`${p} links outside it, to ${target}`);
      } else if (st.isDirectory()) walk(p);
    }
  };
  walk(entry);
}

/** Removes group/other write from everything monomind just installed, so a
 *  permissive umask (002) does not make its own install fail the check. */
export function hardenTree(p: string): void {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) return;
  if (st.mode & 0o022) chmodSync(p, st.mode & 0o7755);
  if (st.isDirectory()) for (const name of readdirSync(p)) hardenTree(join(p, name));
}

/** The installed package.json for `name` above its resolved entry file. */
function packageJsonAbove(entryFile: string, name: string): string | undefined {
  let dir = dirname(entryFile);
  for (;;) {
    const pj = join(dir, 'package.json');
    try {
      if (JSON.parse(readFileSync(pj, 'utf8')).name === name) return pj;
    } catch {
      // not here
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

const importFile = async (file: string): Promise<unknown> => import(pathToFileURL(file).href);

function isModuleNotFound(err: unknown, name: string): boolean {
  const e = err as { code?: string; message?: string };
  return (
    (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND') &&
    String(e.message).includes(name)
  );
}

/** A copy monomind itself resolves, if it is the pinned version: the
 *  project's own, older or newer SDK must not stand in for the pin. */
function ownEntry(
  name: OptionalDependencyName,
  resolveOwn: (n: string) => string,
): { entry: string; pkgDir: string } | undefined {
  let entry: string;
  try {
    entry = resolveOwn(name);
  } catch (err) {
    if (isModuleNotFound(err, name)) return undefined;
    throw err;
  }
  const pj = packageJsonAbove(entry, name);
  return pj && readVersion(pj) === OPTIONAL_DEPENDENCIES[name].version
    ? { entry, pkgDir: dirname(pj) }
    : undefined;
}

const refuseLoad = (message: string): never => {
  throw new OptionalDependencyError(message);
};

/** The "import" entry of a package's exports (or its main), relative to it. */
function esmEntry(pkg: { exports?: unknown; main?: string }): string | undefined {
  let target = pkg.exports;
  if (target && typeof target === 'object' && Object.keys(target).some((k) => k.startsWith('.'))) {
    target = (target as Record<string, unknown>)['.'];
  }
  while (target && typeof target === 'object' && !Array.isArray(target)) {
    const c = target as Record<string, unknown>;
    target = c.import ?? c.node ?? c.default;
  }
  if (typeof target === 'string') return target;
  return pkg.exports === undefined ? (pkg.main ?? 'index.js') : undefined;
}

/**
 * Resolves `name` from `from` as `import` would. require.resolve covers
 * packages with a require (or default) condition; an ESM-only package such
 * as monofence-ai, whose exports have only an "import" condition, throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED there, so its entry is read from the
 * package.json on the same node_modules lookup path.
 */
function resolveEntry(name: string, from: string): string {
  const req = createRequire(from);
  try {
    return req.resolve(name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw err;
    for (const base of req.resolve.paths(name) ?? []) {
      const pkgDir = join(base, name);
      let pkg: { exports?: unknown; main?: string };
      try {
        pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
      } catch {
        continue;
      }
      const entry = esmEntry(pkg);
      if (entry) return join(pkgDir, entry);
      break;
    }
    throw err;
  }
}

const defaultResolveOwn = (name: string): string => resolveEntry(name, import.meta.url);

/**
 * Loads one of OPTIONAL_DEPENDENCIES, installing it into monomind's deps
 * directory first if needed (see the file header).
 */
export async function ensureOptionalDependency<T = unknown>(
  name: OptionalDependencyName,
  opts: EnsureOptions = {},
): Promise<T> {
  if (!Object.hasOwn(OPTIONAL_DEPENDENCIES, name)) {
    throw new OptionalDependencyError(`${String(name)} is not a dependency monomind installs`);
  }
  const env = opts.env ?? process.env;
  const log = opts.log ?? defaultLog;
  const host = opts.host ?? thisHost();
  const spec: OptionalDependencySpec = OPTIONAL_DEPENDENCIES[name];
  const noBinary = !!opts.withoutSdkBinary && name === '@anthropic-ai/claude-agent-sdk';
  const size = noBinary ? 'about 4 MB without its bundled Claude binary' : spec.size;

  const pins = (opts.pins ?? OPTIONAL_DEPENDENCY_CODE_PINS)[name];

  // #526: a copy found up the module path (~/node_modules, say) is held to
  // the same pins as one in the deps dir.
  const own = opts.intoCache ? undefined : ownEntry(name, opts.resolveOwn ?? defaultResolveOwn);
  if (own) {
    if (pins) {
      const where = { ...own, remove: own.pkgDir, checkBinary: !noBinary };
      await verifyPinnedCode(name, pins, where, host, refuseLoad);
    }
    return (await importFile(own.entry)) as T;
  }

  const root = depsRoot(env);
  const dir = dependencyDir(name, env);
  const load = async (): Promise<T> => {
    assertNoSymlinkAncestor(root, (why) =>
      refuseLoad(`Refusing to load code from ${root}: ${why}.`),
    );
    assertTrustedTree(root, dir);
    const entry = resolveEntry(name, join(dir, 'package.json'));
    if (pins) {
      const pkgDir = join(dir, 'node_modules', name);
      const where = { entry, pkgDir, remove: dir, checkBinary: !noBinary };
      await verifyPinnedCode(name, pins, where, host, refuseLoad);
    }
    return (await importFile(entry)) as T;
  };
  if (isInstalled(name, dir, host, noBinary)) return load();

  if (autoInstallDisabled(env) && !opts.requested) {
    throw new OptionalDependencyError(
      `${spec.feature} needs ${name}@${spec.version} (${size}), which is not installed, ` +
        `and ${NO_AUTO_INSTALL_ENV} is set, so monomind will not install it. Install it with:\n` +
        `  ${manualInstallCommand(name, env, noBinary)}`,
    );
  }

  // #559: in an org role the deps dir is read-only; say so before trying.
  const readOnly = depsRootReadOnly(env);
  if (readOnly) throw readOnlyError(name, readOnly, env, noBinary);

  log(
    `${spec.feature} needs ${name}@${spec.version} (${size}). Installing it once into ${dir} ` +
      `(set ${NO_AUTO_INSTALL_ENV}=1 to install by hand instead)...${opts.note ? ` ${opts.note}` : ''}`,
  );
  const runNpm = opts.runNpm ?? defaultRunNpm;
  try {
    ensureDepsRoot(env);
    assertTrustedTree(root, root);
    await installOnce(
      dir,
      (d) => isInstalled(name, d, host, noBinary),
      async (staging) => {
        const lock = OPTIONAL_DEPENDENCY_LOCKS[name];
        const manifest = { ...lock.packages[''], private: true };
        writeFileSync(join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        writeFileSync(join(staging, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
        const args = ['ci', `--prefix=${staging}`, ...NPM_CI_FLAGS, ...omitFlags(name, noBinary)];
        await runNpm(args, staging, env);
        if (!isInstalled(name, staging, host, noBinary)) {
          throw new Error(`npm finished but ${name}@${spec.version} is not complete in ${staging}`);
        }
      },
      log,
    );
  } catch (err) {
    throw installError(name, err, env, noBinary);
  }
  log(`Installed ${name}@${spec.version}.`);
  return load();
}

function installError(
  name: OptionalDependencyName,
  err: unknown,
  env: Env,
  noBinary: boolean,
): Error {
  if (err instanceof OptionalDependencyError) return err;
  const spec = OPTIONAL_DEPENDENCIES[name];
  const code = (err as NodeJS.ErrnoException).code;
  if (code && READ_ONLY_CODES.has(code)) return readOnlyError(name, code, env, noBinary);
  return new OptionalDependencyError(
    `Could not install ${name}@${spec.version}: ${(err as Error).message}\n` +
      `Install it by hand with:\n  ${manualInstallCommand(name, env, noBinary)}`,
  );
}

function readOnlyError(
  name: OptionalDependencyName,
  code: string,
  env: Env,
  noBinary: boolean,
): OptionalDependencyError {
  const spec = OPTIONAL_DEPENDENCIES[name];
  const operator =
    name === '@anthropic-ai/claude-agent-sdk' ? `  ${DEPS_INSTALL_COMMAND}\nor by hand:\n` : '';
  return new OptionalDependencyError(
    `${spec.feature} needs ${name}@${spec.version}, which is not installed, and ` +
      `${depsRoot(env)} is not writable here (${code}). Org roles cannot install into it; ` +
      `ask the operator to run this outside the org:\n${operator}` +
      `  ${manualInstallCommand(name, env, noBinary)}`,
  );
}

/**
 * Populates `finalDir` exactly once across processes: `populate` fills a
 * fresh staging directory beside it, which is then renamed into place. A
 * `finalDir` that exists but fails `isDone` (an interrupted manual install)
 * is replaced; one that became done meanwhile is kept and the staging copy
 * discarded.
 */
export async function installOnce(
  finalDir: string,
  isDone: (dir: string) => boolean,
  populate: (stagingDir: string) => Promise<void>,
  log: Log = defaultLog,
): Promise<void> {
  const parent = dirname(finalDir);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  await withLock(`${finalDir}.lock`, log, async () => {
    if (isDone(finalDir)) return; // another process finished while we waited
    const staging = join(
      parent,
      `.staging-${basename(finalDir)}-${process.pid}-${randomUUID().slice(0, 8)}`,
    );
    mkdirSync(staging, { mode: 0o700 });
    try {
      await populate(staging);
      hardenTree(staging);
      if (isDone(finalDir)) return; // a taken-over lock's first owner finished
      if (existsSync(finalDir)) moveAsideAndRemove(finalDir);
      renameSync(staging, finalDir);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
}

/** Renames `p` to a unique sibling, then deletes that. Of several racing
 *  callers only one wins the rename; the rest see ENOENT and move on. */
function moveAsideAndRemove(p: string): void {
  const aside = `${p}.old-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    renameSync(p, aside);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  rmSync(aside, { recursive: true, force: true });
}

interface LockOwner {
  pid: number;
  token: string;
  ns?: string;
  boot?: string;
}

export type LockIdentity = Pick<typeof defaultIdentity, 'pidNamespace' | 'bootId'>;

/** Whether the owner recorded in `lockDir` is gone. A pid is judged only in
 *  our own pid namespace and boot: an org role's sandbox has its own pid
 *  namespace, where the daemon's pid always looks dead, and the reverse. */
export function lockIsStale(lockDir: string, id: LockIdentity = defaultIdentity): boolean {
  let age: number;
  try {
    age = Date.now() - statSync(lockDir).mtimeMs;
  } catch {
    return false; // released
  }
  if (age > LOCK_STALE_MS) return true;
  let owner: LockOwner;
  try {
    owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    return age > 10_000; // owner not written yet, or never will be
  }
  const boot = id.bootId();
  if (owner.boot && boot && owner.boot !== boot) return true;
  if (!owner.ns || owner.ns !== id.pidNamespace()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function withLock<T>(lockDir: string, log: Log, fn: () => Promise<T>): Promise<T> {
  let announced = false;
  const me: LockOwner = {
    pid: process.pid,
    token: randomUUID(),
    ns: defaultIdentity.pidNamespace(),
    boot: defaultIdentity.bootId(),
  };
  const ownerFile = join(lockDir, 'owner.json');
  const ours = (): boolean => {
    try {
      return JSON.parse(readFileSync(ownerFile, 'utf8')).token === me.token;
    } catch {
      return false;
    }
  };
  for (;;) {
    let made = false;
    try {
      mkdirSync(lockDir);
      made = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    if (made) {
      writeFileSync(ownerFile, JSON.stringify(me));
      // A process that judged the lock stale between our mkdir and this
      // write may have taken it over; go on only while it is still ours.
      if (ours()) break;
      continue;
    }
    if (lockIsStale(lockDir)) {
      moveAsideAndRemove(lockDir);
      continue;
    }
    if (!announced) {
      log(
        `Waiting for another monomind process to finish installing into ${lockDir.slice(0, -5)}...`,
      );
      announced = true;
    }
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
  try {
    return await fn();
  } finally {
    if (ours()) moveAsideAndRemove(lockDir);
  }
}

/** Runs npm with its output on stderr (stdout may be an MCP stdio channel). */
const defaultRunNpm: NpmRunner = (args, cwd, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(...npmInvocation(args), {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let tail = '';
    const forward = (chunk: Buffer) => {
      process.stderr.write(chunk);
      tail = (tail + chunk.toString()).slice(-2000);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`npm exited ${code}: ${tail.trim()}`)),
    );
  });
