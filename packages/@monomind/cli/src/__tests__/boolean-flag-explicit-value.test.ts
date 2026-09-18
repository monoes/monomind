/**
 * Regression tests for issue #269 — `hooks post-task --task-id x --success true`
 * printed "Recording task completion: true" and "Task true recorded".
 *
 * Root cause is in the parser, not in the message template. A declared boolean
 * flag was set to `true` and its following token left untouched, so the literal
 * `true`/`false` the user wrote fell through to the positional list. post-task
 * reads `ctx.args[0] || ctx.flags['task-id']`, so that stray `true` won the
 * precedence and became the task ID.
 *
 * That made the damage wider than the wrong label:
 *
 *   hooks post-task --task-id abc --success true   → recorded under ID "true"
 *   hooks post-task --task-id abc --success false  → "recorded as successful"
 *
 * i.e. the documented invocation in CLAUDE.md silently discarded the real task
 * ID, and an explicit `--success false` recorded the opposite outcome.
 *
 * A declared boolean flag now consumes an immediately following literal
 * `true`/`false` as its value. Bare `--flag` is unchanged, and a following
 * token that is anything else still stays positional.
 */

import { describe, expect, it, vi } from 'vitest';
import { hooksCommand } from '../commands/hooks.js';
import { loadAllCommands } from '../commands/index.js';
import { CommandParser } from '../parser.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

vi.mock('../mcp-client.js', () => ({
  callMCPTool: vi.fn(async () => ({
    taskId: 'task-123',
    success: true,
    recorded: true,
    learningUpdates: {
      agentPatternsUpdated: 1,
      taskStrategiesLearned: 0,
      complexityModelUpdated: false,
    },
  })),
  MCPClientError: class MCPClientError extends Error {},
}));

async function realParser(): Promise<CommandParser> {
  const parser = new CommandParser({ allowUnknownFlags: true });
  for (const cmd of await loadAllCommands()) parser.registerCommand(cmd);
  return parser;
}

describe('boolean flags with an explicit true/false value', () => {
  it('consumes `--success true` instead of leaking "true" into the positionals', async () => {
    const parser = await realParser();
    const result = parser.parse(['hooks', 'post-task', '--task-id', 'abc', '--success', 'true']);

    expect(result.flags.success).toBe(true);
    expect(result.flags['task-id']).toBe('abc');
    expect(result.positional).toEqual([]);
  });

  it('honours `--success false` instead of forcing it to true', async () => {
    const parser = await realParser();
    const result = parser.parse(['hooks', 'post-task', '--task-id', 'abc', '--success', 'false']);

    expect(result.flags.success).toBe(false);
    expect(result.positional).toEqual([]);
  });

  it('accepts the short form too (`-s false`)', async () => {
    const parser = await realParser();
    const result = parser.parse(['hooks', 'post-task', '--task-id', 'abc', '-s', 'false']);

    expect(result.flags.success).toBe(false);
    expect(result.positional).toEqual([]);
  });

  it('leaves a bare boolean flag alone', async () => {
    const parser = await realParser();
    const result = parser.parse(['hooks', 'post-task', '--task-id', 'abc', '--success']);

    expect(result.flags.success).toBe(true);
    expect(result.positional).toEqual([]);
  });

  it('does not swallow a following token that is not true/false', async () => {
    const parser = await realParser();
    const result = parser.parse(['hooks', 'post-task', '--success', 'abc']);

    expect(result.flags.success).toBe(true);
    expect(result.positional).toEqual(['abc']);
  });
});

describe('hooks post-task output', () => {
  const postTaskCommand = hooksCommand.subcommands?.find((c) => c.name === 'post-task') as Command;

  function makeCtx(flags: Record<string, unknown>, args: string[] = []): CommandContext {
    return {
      args,
      flags: { _: [], ...flags },
      cwd: process.cwd(),
      interactive: false,
    } as CommandContext;
  }

  /** printInfo goes to stderr and printSuccess to stdout — capture both. */
  function captureOutput() {
    const chunks: string[] = [];
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      });
    }
    return () => chunks.join('');
  }

  it('names the task ID, not the success flag', async () => {
    const text = captureOutput();
    const result = (await postTaskCommand.action?.(
      makeCtx({ 'task-id': 'task-123', success: true }),
    )) as CommandResult;
    vi.restoreAllMocks();

    expect(result.success).toBe(true);
    expect(text()).toContain('Recording task completion: task-123');
    expect(text()).toContain('Task task-123 recorded as successful');
  });

  it('reports a failed task as failed', async () => {
    const text = captureOutput();
    await postTaskCommand.action?.(makeCtx({ 'task-id': 'task-123', success: false }));
    vi.restoreAllMocks();

    expect(text()).toContain('Task task-123 recorded as failed');
  });
});
