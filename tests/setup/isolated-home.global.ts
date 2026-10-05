/**
 * Vitest globalSetup: run every test worker against a throwaway HOME (#347).
 *
 * Memory and init code write per-project data to ~/.monomind/projects and
 * register projects in ~/.monomind-projects.json; test runs used to leave
 * thousands of folders in the developer's home. This runs in the main vitest
 * process before any worker starts, so the change is in the real process
 * environment: forked workers and child processes inherit it, and in the
 * `threads` pool os.homedir() (which reads the process environment, not a
 * worker's copy of process.env) sees it as well.
 *
 * Moving HOME alone is not enough (#544): XDG_* and toolchain variables such
 * as CARGO_HOME or MISE_DATA_DIR hold absolute paths into the real home, and
 * tools follow them before HOME. The XDG base dirs move into the temp home,
 * the toolchain overrides are unset so they fall back to HOME-derived
 * defaults, and PATH loses its entries under the real home (the running
 * node's own bin dir goes first, so `node` and `npm` match the run). real-home-guard.ts
 * then checks that the real home's top level did not change during the run.
 *
 * The real home stays available as MONOMIND_TEST_REAL_HOME for suites that
 * need credentials from it (live, env-gated suites); the npm cache keeps
 * pointing at the real one so spawned npm/npx do not re-download packages.
 * A nested run (a test that starts a child vitest) keeps the outer run's
 * MONOMIND_TEST_REAL_HOME, unless the parent removes it on purpose.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, sep } from 'node:path';
import { checkHome, snapshotHome } from './real-home-guard.js';
import { removeTree } from './remove-tree.js';

/** XDG base dirs and where they go under the test home. */
export const XDG_DIRS = {
  XDG_DATA_HOME: '.local/share',
  XDG_STATE_HOME: '.local/state',
  XDG_CONFIG_HOME: '.config',
  XDG_CACHE_HOME: '.cache',
  XDG_RUNTIME_DIR: '.run',
} as const;

/** Overrides whose default, when unset, derives from HOME. */
export const UNSET_KEYS = [
  'CARGO_HOME',
  'RUSTUP_HOME',
  'NVM_DIR',
  'MISE_DATA_DIR',
  'MISE_CONFIG_DIR',
  'MISE_STATE_DIR',
  'MISE_CACHE_DIR',
  'PNPM_HOME',
  'VOLTA_HOME',
  'BUN_INSTALL',
  'DENO_DIR',
  'GOPATH',
  'GOBIN',
  'GNUPGHOME',
  'GH_CONFIG_DIR',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'MONOMIND_HOME',
] as const;

/**
 * Markers an org role's session (session-stream.ts) and the runners inside
 * it set (#560). A suite run from inside a role inherits them, and code that
 * branches on them (cline-runner-host.ts's scoped dir, for one) then fails
 * tests that assume a plain operator shell. A test that needs one sets it.
 */
export const ORG_ROLE_ENV_KEYS = [
  'MONOMIND_ORG_ROLE',
  'MONOMIND_ROLE_ID',
  'MONOMIND_ORG_NAME',
  'MONOMIND_ORG_DIR',
  'MONOMIND_ORG_RUN',
  'MONOMIND_ORG_ROOT',
  'MONOMIND_AGENT_EXEC',
  'MONOMIND_SDK_AGENT',
  'MONOMIND_CLINE_TURN',
  'MONOMIND_AIDER',
  'MONOMIND_HOOK_QUIET',
  'MONOMIND_GRAPH_GATE',
  'MONOMIND_GIT_LEVEL',
  'MONOMIND_EXEC_TREE',
] as const;

const KEYS = [
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'MONOMIND_TEST_OUTER_TMP',
  'TMP',
  'TEMP',
  'MONOMIND_GLOBAL_BRAIN_DIR',
  'MONOMIND_TEST_REAL_HOME',
  'npm_config_cache',
  'PATH',
  ...Object.keys(XDG_DIRS),
  ...UNSET_KEYS,
  ...ORG_ROLE_ENV_KEYS,
];

/**
 * `path` without entries under `realHome`, led by the running node's bin dir,
 * so a spawned `node`, `npm` or `npx` is the toolchain that runs the tests
 * (not a different system copy), even where it is only installed in the home.
 */
export function pathWithoutHome(path: string, realHome: string): string {
  const inHome = (p: string) => p === realHome || p.startsWith(realHome + sep);
  const nodeBin = dirname(process.execPath);
  const kept = path.split(delimiter).filter((p) => p && p !== nodeBin && !inHome(p));
  return [nodeBin, ...kept].join(delimiter);
}

/**
 * Points HOME, the global brain and the XDG base dirs at `home`, and drops the
 * toolchain overrides and the org-role markers. Shared with the per-file setup.
 */
export function useTestHome(home: string): void {
  process.env.HOME = home;
  if (process.platform === 'win32') process.env.USERPROFILE = home;
  process.env.MONOMIND_GLOBAL_BRAIN_DIR = join(home, '.monomind', 'global-brain');
  for (const [key, rel] of Object.entries(XDG_DIRS)) {
    const dir = join(home, rel);
    // XDG_RUNTIME_DIR must be private to the user; 0700 does no harm elsewhere.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    process.env[key] = dir;
  }
  for (const key of UNSET_KEYS) delete process.env[key];
  for (const key of ORG_ROLE_ENV_KEYS) delete process.env[key];
}

/** Points the temp dir at `tmp` (a sibling of the home, not inside it: suites
 *  that sandbox a process deny writes under HOME). */
export function useTestTmp(tmp: string): void {
  process.env.TMPDIR = tmp;
  if (process.platform === 'win32') process.env.TMP = process.env.TEMP = tmp;
}

export default function setup(): () => void {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const realHome =
    process.env.MONOMIND_TEST_REAL_HOME ??
    (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME);
  if (realHome) {
    process.env.MONOMIND_TEST_REAL_HOME = realHome;
    // Windows keeps the npm cache under LOCALAPPDATA, which HOME does not move.
    if (process.platform !== 'win32') {
      process.env.npm_config_cache ??= join(realHome, '.npm');
      if (process.env.PATH) process.env.PATH = pathWithoutHome(process.env.PATH, realHome);
    }
  }
  const snapshot = realHome ? snapshotHome(realHome) : null;
  const home = mkdtempSync(join(tmpdir(), 'mm-test-run-home-'));
  useTestHome(home);
  // One temp root for the run, removed with it: nothing a test leaves reaches /tmp.
  // (A forked file makes its own dir next to it, under the outer temp dir: a shorter
  // path, which suites that start Chrome need for its socket paths.)
  process.env.MONOMIND_TEST_OUTER_TMP = tmpdir();
  const tmp = mkdtempSync(join(tmpdir(), 't-'));
  useTestTmp(tmp);
  return () => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    removeTree(home);
    removeTree(tmp);
    if (realHome && snapshot) checkHome(realHome, snapshot);
  };
}
