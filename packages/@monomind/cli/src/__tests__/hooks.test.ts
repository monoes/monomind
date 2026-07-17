/**
 * Tests for src/commands/hooks.ts — the top-level `hooksCommand` registration
 * and dispatch wiring for all hook subcommands.
 *
 * Scope: this file exercises the CLI-side registration/dispatch layer, not
 * the full intelligence/pattern-store subsystem. Where a subcommand's action
 * calls a real in-process MCP tool handler (see src/mcp-tools/hooks-routing.ts),
 * we let it run for real against a temp project dir (MONOMIND_CWD) rather than
 * mocking callMCPTool — this matches the "prefer real filesystem" pattern used
 * in terminal-tools.test.ts and task-tools-agent-store.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext } from '../types.js';
import { hooksCommand } from '../commands/hooks.js';
import {
  preEditCommand,
  postEditCommand,
  preCommandCommand,
  postCommandCommand,
} from '../commands/hooks-core-commands.js';
import { routeCommand } from '../commands/hooks-routing-commands.js';

// The full set of subcommand names actually wired into hooksCommand.subcommands
// (source of truth is the registration array in hooks.ts, cross-checked
// against CLAUDE.md's documented hooks table). Note: CLAUDE.md documents a
// `progress` hook subcommand that does not actually exist in the codebase —
// there is no `name: 'progress'` Command registered anywhere under
// src/commands/. This list reflects the real, current registration.
const EXPECTED_SUBCOMMANDS = [
  'pre-edit',
  'post-edit',
  'pre-command',
  'post-command',
  'pre-task',
  'post-task',
  'session-end',
  'session-restore',
  'route',
  'explain',
  'pretrain',
  'build-agents',
  'metrics',
  'transfer',
  'list',
  'intelligence',
  'notify',
  'worker',
  'statusline',
  'coverage-route',
  'coverage-suggest',
  'coverage-gaps',
  'model-route',
  'model-outcome',
  'model-stats',
  // Backward-compatible v2 aliases
  'route-task',
  'session-start',
  'pre-bash',
  'post-bash',
];

function makeCtx(args: string[], flags: Record<string, unknown> = {}, cwd?: string): CommandContext {
  return {
    args,
    flags: { _: [], ...flags },
    cwd: cwd ?? process.cwd(),
    interactive: false,
  };
}

describe('hooksCommand registration', () => {
  it('registers exactly the expected 29 subcommands, each with an action handler', () => {
    const names = (hooksCommand.subcommands ?? []).map((c) => c.name);
    expect(names.sort()).toEqual([...EXPECTED_SUBCOMMANDS].sort());
    expect(names.length).toBe(29);

    for (const sub of hooksCommand.subcommands ?? []) {
      expect(typeof sub.action, `${sub.name} must have an action`).toBe('function');
    }
  });

  it('has no duplicate subcommand names', () => {
    const names = (hooksCommand.subcommands ?? []).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('top-level "hooks" action prints usage and succeeds without dispatching MCP tools', async () => {
    const result = await hooksCommand.action!(makeCtx([]));
    expect(result?.success).toBe(true);
  });
});

describe('hooksCommand alias wiring (v2 backward compatibility)', () => {
  it('pre-bash is wired to the exact same handler as pre-command', () => {
    const preBash = hooksCommand.subcommands!.find((c) => c.name === 'pre-bash')!;
    expect(preBash.action).toBe(preCommandCommand.action);
  });

  it('post-bash is wired to the exact same handler as post-command', () => {
    const postBash = hooksCommand.subcommands!.find((c) => c.name === 'post-bash')!;
    expect(postBash.action).toBe(postCommandCommand.action);
  });

  it('route-task delegates to routeCommand and forwards its result', async () => {
    const routeTask = hooksCommand.subcommands!.find((c) => c.name === 'route-task')!;
    const ctx = makeCtx([], { task: 'Fix a small typo', format: 'json' });
    const result = await routeTask.action!(ctx);
    expect(result?.success).toBe(true);
    // Same shape as calling routeCommand directly. Note: the real
    // hooks_route MCP tool response nests the top pick under
    // `primaryAgent.type`, not the flat `topAgent` field routeCommand's own
    // text-mode display code reads off `result.topAgent` — that field is
    // simply absent from the real payload (a pre-existing display bug in
    // hooks-routing-commands.ts, out of scope to fix here).
    const data = result?.data as { task?: string; primaryAgent?: { type?: string } } | undefined;
    expect(data?.task).toBe('Fix a small typo');
    expect(typeof data?.primaryAgent?.type).toBe('string');
  });

  it('session-start delegates to session-restore\'s handler (same underlying MCP call)', async () => {
    const sessionStart = hooksCommand.subcommands!.find((c) => c.name === 'session-start')!;
    const sessionRestore = hooksCommand.subcommands!.find((c) => c.name === 'session-restore')!;
    // Both currently fail identically: sessionRestoreCommand calls the MCP
    // tool 'hooks_session-restore', which is not registered in TOOL_REGISTRY
    // (only 'hooks_session-start' / 'hooks_session-end' exist — see
    // src/mcp-tools/hooks-routing.ts). This documents that real (broken)
    // behavior rather than asserting an idealized success path.
    const [startResult, restoreResult] = await Promise.all([
      sessionStart.action!(makeCtx([])),
      sessionRestore.action!(makeCtx([])),
    ]);
    expect(startResult?.success).toBe(false);
    expect(restoreResult?.success).toBe(false);
    expect(startResult?.exitCode).toBe(1);
    expect(restoreResult?.exitCode).toBe(1);
  });
});

describe('hooks pre-command dispatch (real risk-assessment logic)', () => {
  it('flags a recursive rm as high/critical risk and recommends not proceeding', async () => {
    const ctx = makeCtx([], { command: 'rm -rf /tmp/some-target', format: 'json' });
    const result = await preCommandCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as {
      riskLevel: string;
      shouldProceed: boolean;
      risks: Array<{ description: string }>;
    };
    expect(['high', 'critical']).toContain(data.riskLevel);
    expect(data.shouldProceed).toBe(false);
    expect(data.risks.some((r) => /recursive deletion/i.test(r.description))).toBe(true);
  });

  it('treats an ordinary git command as low risk and safe to proceed', async () => {
    const ctx = makeCtx([], { command: 'git status', format: 'json' });
    const result = await preCommandCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as { riskLevel: string; shouldProceed: boolean };
    expect(data.riskLevel).toBe('low');
    expect(data.shouldProceed).toBe(true);
  });

  it('fails cleanly when no command is provided', async () => {
    const ctx = makeCtx([], { format: 'json' });
    const result = await preCommandCommand.action!(ctx);
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});

describe('hooks post-command dispatch (real outcome recording)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-post-command-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('derives success from a zero exit code and records the outcome', async () => {
    const ctx = makeCtx([], { command: 'npm test', 'exit-code': 0, success: true, format: 'json' }, dir);
    const result = await postCommandCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as { success: boolean; recorded: boolean; command: string };
    expect(data.success).toBe(true);
    expect(data.command).toBe('npm test');
  });

  it('derives failure from a non-zero exit code', async () => {
    const ctx = makeCtx([], { command: 'npm run build', 'exit-code': 1, success: false, format: 'json' }, dir);
    const result = await postCommandCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as { success: boolean };
    expect(data.success).toBe(false);
  });

  it('fails cleanly when no command is provided', async () => {
    const ctx = makeCtx([], { format: 'json' }, dir);
    const result = await postCommandCommand.action!(ctx);
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});

describe('hooks pre-task / post-task dispatch (real task-suggestion logic)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-task-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('pre-task classifies a short, simple description as low complexity and suggests agents', async () => {
    const preTaskCommand = hooksCommand.subcommands!.find((c) => c.name === 'pre-task')!;
    const ctx = makeCtx(['Fix a small typo'], { format: 'json' }, dir);
    const result = await preTaskCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as {
      complexity: string;
      description: string;
      suggestedAgents: Array<{ type: string }>;
    };
    expect(data.description).toBe('Fix a small typo');
    expect(data.complexity).toBe('low');
    expect(data.suggestedAgents.length).toBeGreaterThan(0);
  });

  it('pre-task classifies a long/complex/architecture description as high complexity', async () => {
    const preTaskCommand = hooksCommand.subcommands!.find((c) => c.name === 'pre-task')!;
    const description = 'Design a complex new architecture for the payments subsystem '
      + 'spanning multiple services and requiring careful migration planning across teams';
    const ctx = makeCtx([description], { format: 'json' }, dir);
    const result = await preTaskCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as { complexity: string; risks: string[] };
    expect(data.complexity).toBe('high');
    expect(data.risks.length).toBeGreaterThan(0);
  });

  it('pre-task fails cleanly with no description', async () => {
    const preTaskCommand = hooksCommand.subcommands!.find((c) => c.name === 'pre-task')!;
    const result = await preTaskCommand.action!(makeCtx([], { format: 'json' }, dir));
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });

  it('post-task records success by default and echoes the task id', async () => {
    const postTaskCommand = hooksCommand.subcommands!.find((c) => c.name === 'post-task')!;
    const ctx = makeCtx(['task-abc'], { format: 'json' }, dir);
    const result = await postTaskCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as { taskId: string; success: boolean };
    expect(data.taskId).toBe('task-abc');
    expect(data.success).toBe(true);
  });

  it('post-task fails cleanly with no task id', async () => {
    const postTaskCommand = hooksCommand.subcommands!.find((c) => c.name === 'post-task')!;
    const result = await postTaskCommand.action!(makeCtx([], { format: 'json' }, dir));
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});

describe('hooks route dispatch (real keyword routing)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-route-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('routes a task and returns a primary agent with a confidence score', async () => {
    const ctx = makeCtx([], { task: 'Fix authentication bug', format: 'json' }, dir);
    const result = await routeCommand.action!(ctx);
    expect(result?.success).toBe(true);
    // The real hooks_route response nests the pick under primaryAgent.type
    // plus alternativeAgents — routeCommand's TypeScript annotation claims a
    // flat topAgent/recommendations shape that the actual handler never
    // returns (see the route-task test above for the same finding).
    const data = result?.data as {
      primaryAgent: { type: string; confidence: number };
      alternativeAgents: unknown[];
    };
    expect(typeof data.primaryAgent.type).toBe('string');
    expect(data.primaryAgent.type.length).toBeGreaterThan(0);
    expect(typeof data.primaryAgent.confidence).toBe('number');
    expect(Array.isArray(data.alternativeAgents)).toBe(true);
  });

  it('fails cleanly when no task is provided', async () => {
    const result = await routeCommand.action!(makeCtx([], { format: 'json' }, dir));
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});

// Sanity check that pre-edit/post-edit are at least reachable and wired to
// the hooks_pre-edit / hooks_post-edit MCP tools (both real, registered
// handlers) without crashing — deeper coverage of their pattern/AST-context
// logic is out of scope here (that lives in the MCP tool's own tests, if any).
describe('hooks pre-edit / post-edit smoke dispatch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-edit-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('pre-edit does not throw and returns a CommandResult', async () => {
    const ctx = makeCtx([], { file: 'src/example.ts', format: 'json' }, dir);
    const result = await preEditCommand.action!(ctx);
    expect(result).toBeDefined();
    expect(typeof result?.success).toBe('boolean');
  });

  it('post-edit does not throw and returns a CommandResult', async () => {
    const ctx = makeCtx([], { file: 'src/example.ts', success: true, format: 'json' }, dir);
    const result = await postEditCommand.action!(ctx);
    expect(result).toBeDefined();
    expect(typeof result?.success).toBe('boolean');
  });
});
