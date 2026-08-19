import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandContext, CommandResult } from '../types.js';
import { statusCommand } from '../commands/status.js';
import { getMonomindDataRoot } from '../mcp-tools/types.js';
import { systemTools } from '../mcp-tools/system-tools.js';

function makeCtx(cwd: string, flags: Record<string, unknown> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [], ...flags } as CommandContext['flags'],
    cwd,
    interactive: false,
  };
}

function seedAgentStore(dir: string, agents: Array<{ agentId: string; agentType: string; status: string }>) {
  const agentsDir = join(getMonomindDataRoot(dir), 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const store = {
    agents: Object.fromEntries(agents.map((a) => [a.agentId, {
      agentId: a.agentId,
      agentType: a.agentType,
      status: a.status,
      health: 0.9,
      taskCount: 3,
      config: {},
      createdAt: new Date().toISOString(),
    }])),
    version: '3.0.0',
  };
  writeFileSync(join(agentsDir, 'store.json'), JSON.stringify(store, null, 2), 'utf-8');
}

function seedSwarmStore(dir: string, swarmId: string, opts: { status: string; topology: string; agentCount: number }) {
  const swarmDir = join(getMonomindDataRoot(dir), 'swarm');
  mkdirSync(swarmDir, { recursive: true });
  const now = new Date().toISOString();
  const store = {
    swarms: {
      [swarmId]: {
        swarmId,
        topology: opts.topology,
        maxAgents: 8,
        status: opts.status,
        agents: Array.from({ length: opts.agentCount }, (_, i) => `agent-${i}`),
        tasks: [],
        config: {},
        createdAt: now,
        updatedAt: now,
      },
    },
    version: '3.0.0',
  };
  writeFileSync(join(swarmDir, 'swarm-state.json'), JSON.stringify(store, null, 2), 'utf-8');
}

describe('ASL-18: `status agents` crash guard', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'status-agents-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw when a real agent exists in the store, and renders it', async () => {
    seedAgentStore(dir, [{ agentId: 'agent-1', agentType: 'coder', status: 'idle' }]);

    const agentsCommand = statusCommand.subcommands!.find((c) => c.name === 'agents')!;

    // Before the fix, agentsCommand.action mapped `a.metrics.successRate` —
    // a field the real agent_list handler never returns — which threw
    // "Cannot read properties of undefined (reading 'successRate')" for
    // every agent in the store. This must complete without throwing.
    const result = (await agentsCommand.action!(makeCtx(dir, { format: 'json' }))) as CommandResult;

    expect(result.success).toBe(true);
    const data = result.data as { agents: Array<{ agentId: string; agentType: string; taskCount: number }> };
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].agentId).toBe('agent-1');
    expect(data.agents[0].agentType).toBe('coder');
    expect(data.agents[0].taskCount).toBe(3);
  });

  it('does not throw when rendering the human-readable table (not just JSON)', async () => {
    seedAgentStore(dir, [
      { agentId: 'agent-1', agentType: 'coder', status: 'idle' },
      { agentId: 'agent-2', agentType: 'researcher', status: 'busy' },
    ]);

    const agentsCommand = statusCommand.subcommands!.find((c) => c.name === 'agents')!;

    await expect(agentsCommand.action!(makeCtx(dir))).resolves.toMatchObject({ success: true });
  });
});

describe('ASL-17: swarm panel maps real swarm_status fields', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'status-swarm-test-'));
    process.env.MONOMIND_CWD = dir;
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(join(dir, '.monomind', 'config.yaml'), 'version: 1\n', 'utf-8');
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports real agentCount as agents.total instead of a fake zero, and does not hardcode running:true', async () => {
    seedSwarmStore(dir, 'swarm-abc', { status: 'running', topology: 'mesh', agentCount: 4 });

    const result = (await statusCommand.action!(makeCtx(dir, { format: 'json' }))) as CommandResult;
    expect(result.success).toBe(true);

    const data = result.data as {
      running: boolean;
      swarm: { id: string; topology: string; status: string; agents: { total: number } };
    };

    // agentCount (real field) must map to agents.total.
    expect(data.swarm.agents.total).toBe(4);
    expect(data.swarm.id).toBe('swarm-abc');
    expect(data.swarm.topology).toBe('mesh');
    expect(data.swarm.status).toBe('running');

    // No `monomind start --daemon` process was started for this test, so
    // `running` must be false — not a hardcoded `true`.
    expect(data.running).toBe(false);
  });

  it('does not throw and reports agents.total: 0 when no swarm has been initialized', async () => {
    // No swarm-state.json seeded at all.
    const result = (await statusCommand.action!(makeCtx(dir, { format: 'json' }))) as CommandResult;
    expect(result.success).toBe(true);

    const data = result.data as { swarm: { id: string | null; agents: { total: number } } };
    expect(data.swarm.id).toBeNull();
    expect(data.swarm.agents.total).toBe(0);
  });
});

describe('ASL-15: system_reset only accepts components it can actually reset', () => {
  it('accepts "all" and "metrics" and resets metrics', async () => {
    const tool = systemTools.find((t) => t.name === 'system_reset')!;

    for (const component of ['all', 'metrics']) {
      const result = (await tool.handler({ confirm: true, component }, {} as never)) as {
        success: boolean;
        component: string;
      };
      expect(result.success).toBe(true);
      expect(result.component).toBe(component);
    }
  });

  it('rejects "agents" and "tasks" with an explicit unsupported-component error instead of silently claiming success', async () => {
    const tool = systemTools.find((t) => t.name === 'system_reset')!;

    for (const component of ['agents', 'tasks']) {
      const result = (await tool.handler({ confirm: true, component }, {} as never)) as {
        success: boolean;
        error?: string;
      };
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unsupported component/i);
    }
  });
});
