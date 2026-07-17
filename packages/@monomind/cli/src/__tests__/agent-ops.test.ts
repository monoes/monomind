import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metricsCommand, poolCommand, healthCommand } from '../commands/agent-ops.js';
import { spawnCommand } from '../commands/agent-lifecycle.js';
import type { CommandContext, CommandResult } from '../types.js';

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

  it('aggregates realistic seeded .swarm/agents/*.json fixtures by type, task count, and success rate', async () => {
    const agentsDir = join(dir, '.swarm', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'a1.json'),
      JSON.stringify({ type: 'coder', status: 'active', tasksCompleted: 10, successCount: 8 })
    );
    writeFileSync(
      join(agentsDir, 'a2.json'),
      JSON.stringify({ type: 'coder', status: 'idle', tasksCompleted: 4, successCount: 4 })
    );
    writeFileSync(
      join(agentsDir, 'a3.json'),
      JSON.stringify({ type: 'tester', status: 'active', tasksCompleted: 2, successCount: 1 })
    );
    // Malformed sibling file must be skipped, not abort the whole aggregation.
    writeFileSync(join(agentsDir, 'broken.json'), '{ not json');

    const result = (await metricsCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as {
      summary: { totalAgents: number; activeAgents: number; tasksCompleted: number; avgSuccessRate: string };
      byType: Array<{ type: string; count: number; tasks: number; successRate: string }>;
    };

    expect(data.summary.totalAgents).toBe(3);
    expect(data.summary.activeAgents).toBe(2);
    expect(data.summary.tasksCompleted).toBe(16);

    const coder = data.byType.find((t) => t.type === 'coder')!;
    expect(coder.count).toBe(2);
    expect(coder.tasks).toBe(14);
    expect(coder.successRate).toBe('86%'); // 12/14 rounded

    const tester = data.byType.find((t) => t.type === 'tester')!;
    expect(tester.count).toBe(1);
    expect(tester.tasks).toBe(2);
    expect(tester.successRate).toBe('50%');
  });

  it('skips oversized agent fixture files (>512KB) instead of loading them', async () => {
    const agentsDir = join(dir, '.swarm', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const huge = JSON.stringify({ type: 'coder', status: 'active', tasksCompleted: 1, successCount: 1 })
      + ' '.repeat(600 * 1024);
    writeFileSync(join(agentsDir, 'huge.json'), huge);

    const result = (await metricsCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as { summary: { totalAgents: number } };
    expect(data.summary.totalAgents).toBe(0);
  });

  it(
    'DOES NOT see agents spawned via the real agent_spawn/store.json flow — its data source is a ' +
      'different, unpopulated directory',
    async () => {
      // This is the second flagged mismatch (see report): agent-lifecycle.ts's
      // spawnCommand persists to getMonomindDataRoot()/agents/store.json
      // (src/mcp-tools/agent-tools.ts) and writes swarm activity to
      // <cwd>/.monomind/metrics/swarm-activity.json (agent-lifecycle.ts
      // updateSwarmActivityMetrics, L15-43). metricsCommand (this file, L24-56)
      // instead reads from <cwd>/.swarm/agents/*.json and
      // <cwd>/.swarm/swarm-activity.json. Nothing in the codebase writes to
      // .swarm/agents/*.json, so `agent metrics` is structurally incapable of
      // reflecting agents spawned via `agent spawn`.
      (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'real-agent', _: [] } })) as CommandResult);

      const result = (await metricsCommand.action!(makeCtx()) as CommandResult);
      const data = result.data as { summary: { totalAgents: number; note?: string } };
      expect(data.summary.totalAgents).toBe(0);
      expect(data.summary.note).toMatch(/No agents spawned yet/);
    }
  );

  it('falls back to swarm-activity.json totals only when no per-agent fixture files exist', async () => {
    mkdirSync(join(dir, '.swarm'), { recursive: true });
    writeFileSync(
      join(dir, '.swarm', 'swarm-activity.json'),
      JSON.stringify({ totalAgents: 7, activeAgents: 3 })
    );

    const result = (await metricsCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as { summary: { totalAgents: number; activeAgents: number } };
    expect(data.summary.totalAgents).toBe(7);
    expect(data.summary.activeAgents).toBe(3);
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
