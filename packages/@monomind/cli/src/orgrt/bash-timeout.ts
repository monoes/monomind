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
