import { applyClaudePathFlag, claudePathOption } from '../orgrt/claude-selection.js';
// packages/@monomind/cli/src/commands/agent-test.ts
/**
 * `monomind agent test <runtime> [--model M] [--timeout 60s] [--json]` —
 * one "Reply with the single word: ok" turn, reported as a single result
 * (doc/agent-exec-protocol.md "agent test --json", capability `agent-test-json`,
 * issue #390).
 * `--json` prints the result object; `--sandbox` and `--env` go to the turn as
 * in `agent exec` (#474, capability `agent-test-sandbox`). Without it, `agent test` is unchanged: the
 * pre-rev-18 smoke turn that streams `agent exec`'s NDJSON events (§6).
 */

import { type AgentTestOptions, agentTestExitCode, runAgentTest } from '../orgrt/agent-test.js';
import type { SandboxFallback, SandboxMode } from '../orgrt/runner-sandbox.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import {
  parseDuration,
  parseEnvFlags,
  sandboxFallbackFlagError,
  sandboxFlagError,
  testCommand as streamTestCommand,
} from './agent-exec.js';

const DEFAULT_TIMEOUT_MS = 60_000;

/** `--json` (or the global `--format json`) selects the structured result. */
export function isJsonTest(ctx: CommandContext): boolean {
  return Boolean(ctx.flags.json || ctx.flags.format === 'json');
}

/**
 * Run the `--json` test for a parsed context and print it. Returns the exit code
 * (2 for usage errors); `seams` lets tests inject a runner.
 */
export async function runAgentTestCommand(
  ctx: CommandContext,
  seams: Partial<AgentTestOptions> = {},
): Promise<number> {
  applyClaudePathFlag(ctx.flags);
  const runtime = ctx.args[0];
  if (!runtime) {
    process.stderr.write(
      'agent test: runtime id required: monomind agent test <id> (see agent scan)\n',
    );
    return 2;
  }
  let timeoutMs: number;
  let env: Record<string, string>;
  try {
    timeoutMs = parseDuration(ctx.flags.timeout, 'timeout') ?? DEFAULT_TIMEOUT_MS;
    env = parseEnvFlags(ctx.flags.env); // #474: same rules as agent exec --env
  } catch (e) {
    process.stderr.write(`agent test: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  // #474: same values as agent exec --sandbox; the test turn is always scoped.
  const sandbox = ctx.flags.sandbox;
  const fallback = ctx.flags['sandbox-fallback']; // #482
  const sandboxError = sandboxFlagError(sandbox, 'scoped') ?? sandboxFallbackFlagError(fallback);
  if (sandboxError) {
    process.stderr.write(`agent test: ${sandboxError}\n`);
    return 2;
  }
  const result = await runAgentTest({
    runtime,
    model: ctx.flags.model ? String(ctx.flags.model) : undefined,
    timeoutMs,
    ...(sandbox !== undefined ? { sandbox: sandbox as SandboxMode } : {}),
    ...(fallback !== undefined ? { sandboxFallback: fallback as SandboxFallback } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...seams,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return agentTestExitCode(result.status);
}

/** Flush queued stdout writes (pipes are async) before an explicit exit. */
function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write('', () => resolve());
  });
}

export const testCommand: Command = {
  name: 'test',
  description:
    'Smoke-test a runtime (and model) with one tiny turn; --json for a structured result',
  options: [
    claudePathOption,
    {
      name: 'model',
      short: 'm',
      description: 'Model to test (default: the runtime default)',
      type: 'string',
    },
    {
      name: 'timeout',
      description: 'Overall timeout, e.g. 60s (default 60s with --json, else 90s)',
      type: 'string',
    },
    {
      name: 'sandbox',
      description:
        "The vendor CLI's own sandbox, as agent exec --sandbox (read-only, workspace-write or full); reported as native_sandbox",
      type: 'string',
    },
    {
      name: 'sandbox-fallback',
      description:
        'As agent exec --sandbox-fallback: fail (default), strictest or run when the runtime lacks the --sandbox mode; the mode used is reported as sandbox_applied',
      type: 'string',
    },
    {
      name: 'env',
      description: 'Extra env for the agent process, KEY=V (repeatable), as agent exec --env',
      type: 'array',
    },
    {
      name: 'json',
      description:
        'Print one JSON result (status, reply, latency, tokens, cost) instead of the NDJSON event stream',
      type: 'boolean',
    },
  ],
  examples: [
    {
      command: 'monomind agent test codex',
      description: 'One smoke turn through the codex runner',
    },
    {
      command: 'monomind agent test claude --model claude-sonnet-5 --json',
      description: 'Check one model and print the structured result',
    },
    {
      command: 'monomind agent test codex --sandbox workspace-write --json',
      description: "Test a turn inside the CLI's own workspace-write sandbox",
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    if (!isJsonTest(ctx)) return (await streamTestCommand.action?.(ctx)) ?? { success: true };
    const code = await runAgentTestCommand(ctx);
    await flushStdout();
    // A runner's internal timers can keep the event loop alive after the turn.
    process.exit(code);
  },
};
