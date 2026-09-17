// packages/@monomind/cli/src/orgrt/git-guard.ts
/**
 * Git-level enforcement of `policy.git` for role sessions (#258).
 *
 * policy.ts classifies Bash command TEXT, which cannot see git calls that
 * reach a shell as data (`echo "git push" | sh`), scripts written in one tool
 * call and run in the next, `node -e`, npm scripts — and non-Claude runtimes
 * never consult it for their native shell at all. This module enforces the
 * level where git itself runs: every git process a role starts inherits the
 * session env, so the guard lives there.
 *
 * Below 'push' the guard env sets, via GIT_CONFIG_COUNT (command-scope config,
 * which beats system/global/repo config):
 *   - core.hooksPath → a monomind-managed hooks dir. `pre-push` denies every
 *     push; at 'read'/'none', `reference-transaction` aborts every ref update
 *     in the org's protected repositories (git has no --no-verify for it, so
 *     it also stops `commit --no-verify`, `update-ref`, `commit-tree` +
 *     `update-ref`). Every other hook passes through to the repository's own
 *     hooks, so husky/lint hooks keep running.
 *   - protocol.file.allow=never — local-path pushes (`push --no-verify` to a
 *     bare repo, `send-pack`) have no hook to stop them.
 *   - credential.helper reset, failing askpass/ssh commands, no terminal
 *     prompt, and blank SSH_AUTH_SOCK / GitHub tokens — network pushes need
 *     credentials the role no longer gets.
 *
 * All of this is same-user, environment-level defense: a role that knows to
 * pass `-c core.hooksPath=…`, unset GIT_CONFIG_COUNT, or read a credential
 * file from disk gets past it. Only the OS sandbox (role-sandbox.ts) closes
 * those; see doc/concepts/org-runtime.md "Git policy enforcement".
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type GitLevel = 'none' | 'read' | 'commit' | 'push';

export interface GitGuard {
  level: Exclude<GitLevel, 'push'>;
  /** Directory holding the generated hooks and deny scripts. */
  dir: string;
  hooksDir: string;
  /** Realpaths of the git common dirs the level protects. */
  protectedGitDirs: string[];
  /** Env overlay for the role session (merged over process.env by runners). */
  env: Record<string, string>;
}

/** Client-side hooks the guard dir provides. Receive-side hooks never see the
 *  guard env (git strips GIT_CONFIG_* for local transports), and hooks whose
 *  mere presence changes git behavior (push-to-checkout, proc-receive,
 *  fsmonitor-watchman) or fire on every index write (post-index-change) are
 *  left out. */
const HOOKS = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'post-rewrite',
  'reference-transaction',
  'pre-auto-gc',
  'sendemail-validate',
];

/** Marks a generated hook so one guard never chains to another guard's. */
const GUARD_MARKER = 'monomind-git-guard-hook';

/** Env tokens that authenticate git hosts outside git's own credential system. */
const TOKEN_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];

/** Realpath of the git common dir for `path` (the main repo's .git for a
 *  worktree), or undefined when `path` is not inside a git repository. */
export function gitCommonDir(path: string): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: path,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    return out ? realpathSync(out) : undefined;
  } catch {
    return undefined;
  }
}

/** Local filesystem paths the repository's remotes (url/pushurl) point at.
 *  The sandbox keeps them read-only so a role can't write refs into a local
 *  "remote" directly. Network remotes are left reachable: fetching is
 *  legitimate at every level, and the push barrier there is withheld
 *  credentials (role-sandbox.ts). */
export function gitLocalRemotePaths(gitDir: string): string[] {
  let out = '';
  try {
    out = execFileSync(
      'git',
      [`--git-dir=${gitDir}`, 'config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    );
  } catch {
    return [];
  }
  const paths = new Set<string>();
  for (const line of out.split('\n')) {
    const space = line.indexOf(' ');
    const path = space < 0 ? undefined : localRemotePath(line.slice(space + 1).trim());
    // relative remote paths resolve against the repository's work tree
    if (path) paths.add(resolve(dirname(gitDir), path));
  }
  return [...paths];
}

function localRemotePath(url: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('file://')) return url.slice('file://'.length);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return undefined; // https://, ssh://, git://
  // scp-like `user@host:path` — a colon before any slash
  if (!isAbsolute(url) && /^(?:[^@/]*@)?[^:/]+:/.test(url)) return undefined;
  return url;
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function hookScript(
  level: GitGuard['level'],
  hooksDir: string,
  protectedGitDirs: string[],
): string {
  const blockRefs = level === 'read' || level === 'none';
  return `#!/bin/sh
# ${GUARD_MARKER}
# Generated by monomind (#258) for a role with policy.git '${level}'. Regenerated
# at every session start; edits are overwritten.
hook=$(basename "$0")
deny() {
  echo "monomind git-guard: $1 (policy.git: ${level})" >&2
  exit 1
}
is_protected() {
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  common=$(cd "$common" 2>/dev/null && pwd -P) || return 1
  for p in ${protectedGitDirs.map(shQuote).join(' ')}; do
    [ "$common" = "$p" ] && return 0
  done
  return 1
}
case "$hook" in
  pre-push) deny "git push is not allowed for this role" ;;
  reference-transaction)
    if [ ${blockRefs ? 1 : 0} = 1 ] && [ "$1" = prepared ] && is_protected; then
      deny "updating refs in this repository is not allowed for this role"
    fi ;;
esac
# Pass through to the repository's own hook: the last core.hooksPath from any
# scope that is not a monomind guard, else <common dir>/hooks. Guard dirs are
# skipped while searching rather than at the end — a role session nested inside
# another one leaves both hooksPath values in the config, and picking the other
# guard made the two dispatchers exec each other forever.
orig=
while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  case "$candidate" in "~/"*) candidate="$HOME/\${candidate#"~/"}" ;; esac
  [ "$candidate" = ${shQuote(hooksDir)} ] && continue
  if [ -f "$candidate/$hook" ] && head -n 5 "$candidate/$hook" 2>/dev/null |
    grep -q ${shQuote(GUARD_MARKER)}; then
    continue
  fi
  orig=$candidate
done <<HOOKS_EOF
$(git config --get-all core.hooksPath 2>/dev/null)
HOOKS_EOF
if [ -z "$orig" ]; then
  orig="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/hooks"
fi
if [ "$orig" != ${shQuote(hooksDir)} ] && [ -f "$orig/$hook" ] && [ -x "$orig/$hook" ]; then
  exec "$orig/$hook" "$@"
fi
exit 0
`;
}

function denyScript(level: GitGuard['level'], what: string): string {
  return `#!/bin/sh
echo "monomind git-guard: ${what} withheld from this role (policy.git: ${level}; requires 'push')" >&2
exit 1
`;
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

/** The git config entries the guard adds, continuing any GIT_CONFIG_COUNT the
 *  base env already carries so an operator's own entries survive. */
function gitConfigEnv(
  entries: Array<[string, string]>,
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  // Re-emit the operator's own entries ahead of the guard's instead of just
  // continuing their numbering: the block then stands on its own. Continuing
  // the count breaks every git command with "missing config key
  // GIT_CONFIG_KEY_0" as soon as the child's env doesn't carry the inherited
  // pairs (a runner that doesn't merge process.env, or a wrapper that strips
  // them). The guard's entries come last, so they win.
  const inherited: Array<[string, string]> = [];
  const count = Number.parseInt(baseEnv.GIT_CONFIG_COUNT ?? '', 10);
  for (let i = 0; Number.isInteger(count) && i < count; i++) {
    const key = baseEnv[`GIT_CONFIG_KEY_${i}`];
    const value = baseEnv[`GIT_CONFIG_VALUE_${i}`];
    if (key !== undefined && value !== undefined) inherited.push([key, value]);
  }
  const all = [...inherited, ...entries];
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(all.length) };
  all.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/**
 * Write the guard's hooks and deny scripts under `stateDir` and return the
 * session env overlay. Returns undefined for 'push' — push roles get no guard.
 */
export function prepareGitGuard(opts: {
  level: GitLevel;
  stateDir: string;
  protectedGitDirs: string[];
  baseEnv?: NodeJS.ProcessEnv;
}): GitGuard | undefined {
  if (opts.level === 'push') return undefined;
  const level = opts.level;
  const dir = resolve(opts.stateDir);
  const hooksDir = join(dir, 'hooks');
  // A path with a newline can't be matched by the hook's shell comparison.
  const protectedGitDirs = [...new Set(opts.protectedGitDirs)].filter((p) => !p.includes('\n'));
  mkdirSync(hooksDir, { recursive: true });
  const hook = hookScript(level, hooksDir, protectedGitDirs);
  for (const name of HOOKS) writeExecutable(join(hooksDir, name), hook);
  const askpass = join(dir, 'deny-credentials');
  const ssh = join(dir, 'deny-ssh');
  writeExecutable(askpass, denyScript(level, 'git credentials are'));
  writeExecutable(ssh, denyScript(level, 'ssh transport is'));

  const env: Record<string, string> = {
    ...gitConfigEnv(
      [
        ['core.hooksPath', hooksDir],
        ['protocol.file.allow', 'never'],
        // `git commit` otherwise spawns `git maintenance run --auto --detach`,
        // which inherits the caller's stdout/stderr and stays alive inside the
        // OS sandbox — every caller that captures output (a test harness, a
        // script) then waits on the pipe until it times out. A role session is
        // short-lived; repository maintenance is the operator's business.
        ['maintenance.auto', 'false'],
        ['gc.auto', '0'],
        // an empty value resets the helper list from every other scope
        ['credential.helper', ''],
        ['core.askPass', askpass],
        ['core.sshCommand', ssh],
      ],
      opts.baseEnv ?? process.env,
    ),
    GIT_ASKPASS: askpass,
    SSH_ASKPASS: askpass,
    GIT_SSH_COMMAND: ssh,
    GIT_TERMINAL_PROMPT: '0',
    // Blank rather than delete: runners merge this over process.env.
    SSH_AUTH_SOCK: '',
    MONOMIND_GIT_LEVEL: level,
  };
  for (const k of TOKEN_VARS) env[k] = '';
  return { level, dir, hooksDir, protectedGitDirs, env };
}
