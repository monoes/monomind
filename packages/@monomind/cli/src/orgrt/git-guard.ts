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

/** Hosts and local paths the repository's remotes point at, for the sandbox
 *  deny lists. Parses url/pushurl of every remote. */
export function gitRemoteTargets(gitDir: string): { hosts: string[]; localPaths: string[] } {
  const hosts = new Set<string>();
  const localPaths = new Set<string>();
  let out = '';
  try {
    out = execFileSync(
      'git',
      [`--git-dir=${gitDir}`, 'config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 },
    );
  } catch {
    return { hosts: [], localPaths: [] };
  }
  for (const line of out.split('\n')) {
    const url = line.slice(line.indexOf(' ') + 1).trim();
    if (!url || !line.includes(' ')) continue;
    const target = classifyRemoteUrl(url);
    if (target.host) hosts.add(target.host);
    // relative remote paths resolve against the repository's work tree
    if (target.path) localPaths.add(resolve(dirname(gitDir), target.path));
  }
  return { hosts: [...hosts], localPaths: [...localPaths] };
}

function classifyRemoteUrl(url: string): { host?: string; path?: string } {
  if (url.startsWith('file://')) return { path: url.slice('file://'.length) };
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/]+)/i.exec(url);
  if (scheme) return { host: scheme[1].replace(/^\[|\]$/g, '').toLowerCase() };
  // scp-like `user@host:path` — a colon before any slash
  const scp = /^(?:[^@/]*@)?([^:/]+):/.exec(url);
  if (scp && !isAbsolute(url)) return { host: scp[1].toLowerCase() };
  return { path: url };
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function hookScript(
  level: GitGuard['level'],
  hooksDir: string,
  protectedGitDirs: string[],
): string {
  const blockRefs = level === 'read' || level === 'none';
  return `#!/bin/sh
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
# Pass through to the repository's own hook (core.hooksPath from any scope
# other than this guard, else <common dir>/hooks).
orig=$(git config --get-all core.hooksPath 2>/dev/null | grep -Fvx ${shQuote(hooksDir)} | tail -n 1)
case "$orig" in "~/"*) orig="$HOME/\${orig#"~/"}" ;; esac
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
  const existing = Number.parseInt(baseEnv.GIT_CONFIG_COUNT ?? '', 10);
  const start = Number.isInteger(existing) && existing > 0 ? existing : 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(start + entries.length) };
  entries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${start + i}`] = key;
    env[`GIT_CONFIG_VALUE_${start + i}`] = value;
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
