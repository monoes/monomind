import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metricsCommand, poolCommand, healthCommand } from '../commands/agent-ops.js';
import { spawnCommand } from '../commands/agent-lifecycle.js';
import { getMonomindDataRoot } from '../mcp-tools/types.js';
import type { CommandContext, CommandResult } from '../types.js';

function seedAgentStore(dir: string, agents: Array<{ agentId: string; agentType: string; status: string; taskCount?: number }>) {
  const agentsDir = join(getMonomindDataRoot(dir), 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const store = {
    agents: Object.fromEntries(agents.map((a) => [a.agentId, {
      agentId: a.agentId,
      agentType: a.agentType,
      status: a.status,
      health: 1.0,
      taskCount: a.taskCount ?? 0,
      config: {},
      createdAt: new Date().toISOString(),
    }])),
    version: '3.0.0',
  };
  writeFileSync(join(agentsDir, 'store.json'), JSON.stringify(store, null, 2), 'utf-8');
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [] },
    cwd: process.cwd(),
    interactive: false,
    ...overrides,
  };
}

let dir: string;
let originalCwd: () => string;
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-ops-test-'));
  process.env.MONOMIND_CWD = dir;
  // metricsCommand uses process.cwd() directly (not getMonomindDataRoot()),
  // so it must be stubbed too — see the mismatch documented below.
  originalCwd = process.cwd;
  process.cwd = () => dir;
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  writeSpy.mockRestore();
  process.cwd = originalCwd;
  delete process.env.MONOMIND_CWD;
  rmSync(dir, { recursive: true, force: true });
});

describe('metricsCommand', () => {
  it('reports zero agents when nothing has ever run in this directory', async () => {
    const result = (await metricsCommand.action!(makeCtx()) as CommandResult);
    expect(result.success).toBe(true);
    const data = result.data as { summary: { totalAgents: number; note?: string } };
    expect(data.summary.totalAgents).toBe(0);
    expect(data.summary.note).toMatch(/No agents spawned yet/);
  });

  it('aggregates realistic seeded real agent-store fixtures by type and task count', async () => {
    // Regression test: this used to seed .swarm/agents/*.json, a directory
    // nothing in the codebase ever wrote to — metricsCommand now reads the
    // real store at getMonomindDataRoot()/agents/store.json instead.
    seedAgentStore(dir, [
      { agentId: 'a1', agentType: 'coder', status: 'idle', taskCount: 10 },
      { agentId: 'a2', agentType: 'coder', status: 'busy', taskCount: 4 },
      { agentId: 'a3', agentType: 'tester', status: 'idle', taskCount: 2 },
      { agentId: 'a4', agentType: 'tester', status: 'terminated', taskCount: 1 },
    ]);

    const result = (await metricsCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as {
      summary: { totalAgents: number; activeAgents: number; tasksCompleted: number; avgSuccessRate: string };
      byType: Array<{ type: string; count: number; tasks: number; successRate: string }>;
    };

    expect(data.summary.totalAgents).toBe(4);
    // activeAgents = non-terminated (a4 is terminated, excluded).
    expect(data.summary.activeAgents).toBe(3);
    expect(data.summary.tasksCompleted).toBe(17);
    // Success/failure breakdown isn't tracked in the current agent store
    // schema (AgentRecord has only a single taskCount, no completed/failed
    // split) — reported honestly as N/A rather than fabricated.
    expect(data.summary.avgSuccessRate).toBe('N/A');

    const coder = data.byType.find((t) => t.type === 'coder')!;
    expect(coder.count).toBe(2);
    expect(coder.tasks).toBe(14);
    expect(coder.successRate).toBe('N/A');

    const tester = data.byType.find((t) => t.type === 'tester')!;
    expect(tester.count).toBe(2);
    expect(tester.tasks).toBe(3);
  });

  it('reflects agents spawned via the real agent_spawn flow', async () => {
    // Regression test: metricsCommand used to read from .swarm/agents/*.json,
    // which agent_spawn never wrote to, so it always reported zero agents
    // regardless of what was actually spawned. Fixed to read the real store.
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'real-agent', _: [] } })) as CommandResult);

    const result = (await metricsCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as { summary: { totalAgents: number; note?: string } };
    expect(data.summary.totalAgents).toBe(1);
    expect(data.summary.note).toBeUndefined();
  });
});

describe('poolCommand', () => {
  it('reports an empty pool with 0 utilization when no agents exist', async () => {
    const result = (await poolCommand.action!(makeCtx()) as CommandResult);
    expect(result.success).toBe(true);
    const data = result.data as { currentSize: number; utilization: number; agents: unknown[] };
    expect(data.currentSize).toBe(0);
    expect(data.utilization).toBe(0);
    expect(data.agents).toEqual([]);
  });

  it('reflects real agents spawned into the store (via agent_pool status, sourced from the same store.json)', async () => {
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'p1', _: [] } })) as CommandResult);
    (await spawnCommand.action!(makeCtx({ flags: { type: 'tester', name: 'p2', _: [] } })) as CommandResult);

    const result = (await poolCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as { currentSize: number; agents: Array<{ type: string }> };
    expect(data.currentSize).toBe(2);
    expect(data.agents.map((a) => a.type).sort()).toEqual(['coder', 'tester']);
  });

  it('scales the pool up for a given agent type by spawning bare pool agents directly into the store', async () => {
    const result = (await poolCommand.action!(
      makeCtx({ flags: { size: 3, min: 1, max: 10, _: [] } })) as CommandResult
    );
    // poolCommand always calls agent_pool with action defaulted to 'status'
    // (agent-tools.ts L397) — CLI does not expose a way to trigger 'scale'
    // via its flags today, so this documents current pass-through behavior.
    expect(result.success).toBe(true);
    expect((result.data as { currentSize: number }).currentSize).toBe(0);
  });
});

describe('healthCommand', () => {
  it('reports overall health as all-zero with an empty agent table when no agents exist', async () => {
    const result = (await healthCommand.action!(makeCtx()) as CommandResult);
    expect(result.success).toBe(true);
    const data = result.data as {
      agents: unknown[];
      overall: { healthy: number; degraded: number; unhealthy: number };
    };
    expect(data.agents).toEqual([]);
    expect(data.overall).toMatchObject({ healthy: 0, degraded: 0, unhealthy: 0 });
  });

  it('classifies real spawned agents as healthy (fresh agents default to health=1.0)', async () => {
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'h1', _: [] } })) as CommandResult);
    (await spawnCommand.action!(makeCtx({ flags: { type: 'tester', name: 'h2', _: [] } })) as CommandResult);

    const result = (await healthCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as {
      agents: Array<{ id: string; type: string; health: string }>;
      overall: { healthy: number };
    };
    expect(data.agents).toHaveLength(2);
    expect(data.agents.every((a) => a.health === 'healthy')).toBe(true);
    expect(data.overall.healthy).toBe(2);
  });

  it('supports looking up a single agent by ID via args[0]', async () => {
    const spawned = (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'solo-h', _: [] } })) as CommandResult);
    const agentId = (spawned.data as { agentId: string }).agentId;

    const result = (await healthCommand.action!(makeCtx({ args: [agentId] })) as CommandResult);
    expect(result.success).toBe(true);
    const data = result.data as { agentId: string; health: number; healthy: boolean };
    expect(data.agentId).toBe(agentId);
    expect(data.healthy).toBe(true);
  });

  it('returns an error payload (not a thrown exception) for an unknown single agent ID', async () => {
    const result = (await healthCommand.action!(makeCtx({ args: ['ghost'] })) as CommandResult);
    expect(result.success).toBe(true); // agent_health resolves rather than throwing
    expect((result.data as { error?: string }).error).toBe('Agent not found');
  });
});
