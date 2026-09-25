// packages/@monomind/cli/src/orgrt/bash-timeout.ts
/**
 * Claude Code's Bash tool times a command out after 2 minutes unless the call
 * passes `timeout`, and caps that at 10 minutes. Org roles doing release work
 * (installs, full builds, test suites) hit the 2-minute default even when told
 * to run in the foreground. Claude Code reads both limits from its environment
 * (BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS — confirmed in the CLI bundled
 * with @anthropic-ai/claude-agent-sdk 0.3.226), so a Claude role's session env
 * sets them. Other runtimes have their own shell tools and ignore these names.
 */

export const DEFAULT_CLAUDE_BASH_TIMEOUT_MS = 600_000;

/** Upper bound for run_config.bash_timeout_ms. */
export const MAX_CLAUDE_BASH_TIMEOUT_MS = 3_600_000;

export function claudeBashTimeoutEnv(timeoutMs?: number): Record<string, string> {
  const ms = String(timeoutMs ?? DEFAULT_CLAUDE_BASH_TIMEOUT_MS);
  return { BASH_DEFAULT_TIMEOUT_MS: ms, BASH_MAX_TIMEOUT_MS: ms };
}

/**
 * #339: Claude Code's sandbox makes an existing `hooks` or `config` entry
 * read-only in every directory from the session's cwd down to the Bash
 * shell's current directory (its guard against a planted bare git repo; same
 * CLI). The shell's directory persists between Bash calls, so after
 * `cd <worktree>/packages/@monomind/memory` the sibling package
 * `packages/@monomind/hooks` became read-only for the following commands, and
 * which directory got hit depended on where earlier commands had left the
 * shell. With CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR the shell returns to
 * the session's cwd after every command, so only the cwd itself is ever
 * walked. The role prompt says so, since the Bash tool's own description still
 * claims the directory persists.
 */
export const CLAUDE_SANDBOX_CWD_ENV = { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1' };

export const claudeSandboxCwdNote = (cwd: string): string =>
  `Every Bash command starts in ${cwd}: a \`cd\` lasts only for the command it is in, so run \`cd <dir> && <command>\` in one call, or use absolute paths.`;
