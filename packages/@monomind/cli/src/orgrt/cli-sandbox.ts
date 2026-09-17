// packages/@monomind/cli/src/orgrt/cli-sandbox.ts
/**
 * Each non-claude CLI runtime's OWN sandbox, wired to the role's `policy.git`
 * level (#263).
 *
 * #258 gave the claude runtime OS-level enforcement through the Agent SDK's
 * sandbox. Every other runtime was launched with its own sandbox disabled
 * (codex `--sandbox danger-full-access`, grok `--always-approve`, copilot
 * `--allow-all-tools`, antigravity `--dangerously-skip-permissions`, qwen
 * `--yolo`) and never consults `canUseTool`, so a role below `'push'` had only
 * the git guard env (git-guard.ts) — which a same-user role can strip.
 *
 * Only two of those CLIs expose a per-session sandbox mode that can be wired
 * from the command line. Both were verified against the installed binary
 * before being wired here; the rest are deliberately left as they are rather
 * than guessing a flag, and keep emitting `git-sandbox-unsupported-runtime`:
 *
 * - **codex** (codex-cli 0.154.0) — `-s/--sandbox read-only|workspace-write|
 *   danger-full-access`. Verified with `codex sandbox` (no model call):
 *   `workspace-write` writes the cwd and `$TMPDIR` but not `$HOME`, and blocks
 *   network until `-c sandbox_workspace_write.network_access=true` (verified:
 *   curl fails to resolve without it, HTTP 200 with it). `read-only` makes the
 *   WHOLE filesystem read-only — the cwd, `$TMPDIR` and the role's own logs
 *   included — and drops network, which breaks legitimate read-level work, so
 *   'read'/'none' get `workspace-write` too. That is not weaker than the
 *   claude runtime at the same level: #258's SDK sandbox also keeps the cwd,
 *   `$HOME` and the temp dir writable at 'read' and relies on the guard hooks
 *   and withheld credentials for git itself.
 * - **grok** (grok 1.0.13) — `--sandbox <PROFILE>` (Landlock/Seatbelt, applied
 *   to the whole process, irreversible). Built-in profiles per the CLI's own
 *   shipped README: `workspace` (read everywhere, write cwd + /tmp + ~/.grok,
 *   child network allowed), `read-only` (write ~/.grok only, child network
 *   BLOCKED), `strict`, `off` (default). `read-only` there would stop a role
 *   writing logs or fixtures anywhere and cut installs off the network, so
 *   every level below 'push' gets `workspace`. Verified that `workspace` and
 *   `read-only` resolve as profile names while an unknown one is rejected
 *   ("Custom sandbox profile '…' not found"); behaviour is the CLI's
 *   documented profile table — this host has no grok credentials for an
 *   end-to-end run.
 *
 * `'push'` is unchanged everywhere: those roles get no guard and no sandbox.
 */

import type { GitLevel } from './git-guard.js';

/**
 * The role's `policy.git` level as the session env carries it. git-guard.ts
 * sets `MONOMIND_GIT_LEVEL` for every level below 'push' and returns no guard
 * at all for 'push', so a missing variable means 'push' (the wide-open path
 * each runner used before this change).
 */
export function roleGitLevel(env: Record<string, string> | undefined): GitLevel {
  const level = env?.MONOMIND_GIT_LEVEL;
  return level === 'none' || level === 'read' || level === 'commit' ? level : 'push';
}

/**
 * Runtimes whose own sandbox is wired above, and the mode a role below 'push'
 * runs in. The session's audit event and `monomind org validate` read this so
 * all three report the same reality.
 */
export const CLI_SANDBOX_MODES: Record<string, string> = {
  codex: 'workspace-write',
  grok: 'workspace',
};

/** `codex exec` sandbox flags for a role at `level`. */
export function codexSandboxArgs(level: GitLevel): string[] {
  if (level === 'push') return ['--sandbox', 'danger-full-access'];
  // Network stays on: installs, builds and `git fetch` are legitimate at every
  // level, and the barrier against publishing is the withheld credentials.
  return ['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true'];
}

/** `grok` sandbox flags for a role at `level` (none at 'push' — the profile
 *  defaults to `off`, exactly what the runner passed before). */
export function grokSandboxArgs(level: GitLevel): string[] {
  return level === 'push' ? [] : ['--sandbox', 'workspace'];
}
