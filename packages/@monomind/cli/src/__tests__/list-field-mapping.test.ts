/**
 * Regression coverage for a field-name mismatch between what `task_list` /
 * `session_list` actually return and what `commands/task.ts`, `commands/session.ts`,
 * and `commands/status.ts` read off the result.
 *
 * `task_list` returns `{ taskId, ... }` (see mcp-tools/task-tools.ts) and
 * `session_list` returns `{ sessionId, name, description, savedAt, stats: { tasks,
 * agents, memoryEntries, totalSize } }` (see mcp-tools/session-tools.ts) — there is
 * no `id`, `status`, `agentCount`, `taskCount`, or `updatedAt` on a session record.
 * The CLI-layer type annotations had drifted to a stale/aspirational shape and read
 * `.id`/`.agentCount`/etc, which are `undefined` at runtime, so `task list` /
 * `session list` / `status tasks` all rendered a blank ID column (and session list
 * also showed a blank Status/Agents/Tasks and "Invalid Date"), and the interactive
 * `session restore` picker's `value: s.id` meant every option restored `undefined`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../types.js';

const { taskListImpl, sessionListImpl } = vi.hoisted(() => {
  const taskListImpl = vi.fn(async () => ({
    tasks: [
      {
        taskId: 'task-real-id-123',
        type: 'implementation',
        description: 'a real task',
        priority: 'normal',
        status: 'pending',
        assignedTo: ['agent-1'],
        progress: 0,
        createdAt: new Date().toISOString(),
      },
    ],
    total: 1,
  }));

  const sessionListImpl = vi.fn(async () => ({
    sessions: [
      {
        sessionId: 'session-real-id-456',
        name: 'my-checkpoint',
        description: undefined,
        savedAt: new Date().toISOString(),
        stats: { tasks: 2, agents: 3, memoryEntries: 0, totalSize: 510 },
      },
    ],
    total: 1,
  }));

  return { taskListImpl, sessionListImpl };
});

vi.mock('../mcp-client.js', () => ({
  callMCPTool: vi.fn(async (toolName: string) => {
    if (toolName === 'task_list') return taskListImpl();
    if (toolName === 'session_list') return sessionListImpl();
    return {};
  }),
  MCPClientError: class MCPClientError extends Error {},
}));

vi.mock('../output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printJson: vi.fn(),
    printList: vi.fn(),
    printBox: vi.fn(),
    createSpinner: vi.fn(() => ({ start: vi.fn(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() })),
    highlight: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
    info: (s: string) => s,
    progressBar: () => '[=====>    ]',
    setColorEnabled: vi.fn(),
  },
}));

vi.mock('../prompt.js', () => ({
  select: vi.fn(async (opts) => opts.options[0]?.value),
  confirm: vi.fn(async () => false),
  input: vi.fn(async () => 'test-input'),
  multiSelect: vi.fn(async () => []),
}));

import { taskCommand } from '../commands/task.js';
import { sessionCommand } from '../commands/session.js';
import { statusCommand } from '../commands/status.js';
import { output } from '../output.js';

function findSub(cmd: { subcommands?: { name: string }[] }, name: string) {
  const sub = cmd.subcommands?.find((c) => c.name === name);
  if (!sub) throw new Error(`subcommand ${name} not found`);
  return sub as { action?: (ctx: CommandContext) => Promise<unknown> };
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { args: [], flags: { _: [] }, cwd: process.cwd(), interactive: false, ...overrides };
}

function lastPrintTableData(): Array<Record<string, unknown>> {
  const calls = (output.printTable as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const [lastCall] = calls.slice(-1);
  return (lastCall?.[0] as { data: Array<Record<string, unknown>> }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('task list renders the real taskId, not undefined', () => {
  it('`task list` table row carries the real ID', async () => {
    const listCmd = findSub(taskCommand, 'list');
    await listCmd.action?.(makeCtx());
    const [row] = lastPrintTableData();
    expect(row.id).toBe('task-real-id-123');
    expect(row.id).not.toBeUndefined();
  });

  it('`status tasks` table row carries the real ID and a real agent field', async () => {
    const tasksCmd = findSub(statusCommand, 'tasks');
    await tasksCmd.action?.(makeCtx());
    const [row] = lastPrintTableData();
    expect(row.id).toBe('task-real-id-123');
    expect(row.agent).toBe('agent-1');
  });
});

describe('session list renders the real sessionId and real stats, not undefined', () => {
  it('`session list` table row carries the real ID, agent/task counts, and a valid date', async () => {
    const listCmd = findSub(sessionCommand, 'list');
    await listCmd.action?.(makeCtx());
    const [row] = lastPrintTableData();
    expect(row.id).toBe('session-real-id-456');
    expect(row.agents).toBe(3);
    expect(row.tasks).toBe(2);
    expect(String(row.updated)).not.toMatch(/Invalid Date/);
  });

  it('interactive `session restore` picker offers the real sessionId as the value', async () => {
    const restoreCmd = findSub(sessionCommand, 'restore');
    // No sessionId arg + interactive:true drives the picker path that calls
    // session_list and builds `select()` options from its result.
    await restoreCmd.action?.(makeCtx({ interactive: true })).catch(() => {
      /* restore itself may fail past the picker in this mocked setup; the
         picker's option construction (asserted via prompt.select's mock
         call args below) is what this test is protecting. */
    });
    const { select } = await import('../prompt.js');
    const call = (select as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const options = (call?.[0] as { options: Array<{ value: string }> })?.options;
    expect(options?.[0]?.value).toBe('session-real-id-456');
    expect(options?.[0]?.value).not.toBeUndefined();
  });
});
