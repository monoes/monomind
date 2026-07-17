import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../mcp-tools/agent-tools.js';
import { getMonomindDataRoot } from '../mcp-tools/types.js';

// Regression test: agent_pool's 'drain' branch used to compute
// `remaining: agents.length - drained` where `agents` was ALL non-terminated
// agents (any type) but `drained` only counted idle agents of the
// agentType-filtered population — mixing two different scopes produced a
// meaningless number whenever a type filter was supplied. Fixed by scoping
// both the drain loop and the remaining count to the same (optionally
// type-filtered) population.
function seedAgentStore(dir: string, agents: Array<{ agentId: string; agentType: string; status: string }>) {
  const agentsDir = join(getMonomindDataRoot(dir), 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const store = {
    agents: Object.fromEntries(agents.map((a) => [a.agentId, {
      agentId: a.agentId,
      agentType: a.agentType,
      status: a.status,
      health: 1.0,
      taskCount: 0,
      config: {},
      createdAt: new Date().toISOString(),
    }])),
    version: '3.0.0',
  };
  writeFileSync(join(agentsDir, 'store.json'), JSON.stringify(store, null, 2), 'utf-8');
}

describe('agent_pool drain — remaining count scoped by agentType filter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-pool-drain-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports remaining scoped to the filtered agentType, not the whole store', async () => {
    seedAgentStore(dir, [
      { agentId: 'w1', agentType: 'worker', status: 'idle' },
      { agentId: 'w2', agentType: 'worker', status: 'idle' },
      { agentId: 'w3', agentType: 'worker', status: 'busy' },
      { agentId: 'c1', agentType: 'coder', status: 'idle' },
      { agentId: 'c2', agentType: 'coder', status: 'idle' },
    ]);

    const pool = agentTools.find((t) => t.name === 'agent_pool')!;
    const result = (await pool.handler({ action: 'drain', agentType: 'worker' }, {} as never)) as {
      drained: number;
      remaining: number;
    };

    // 2 idle workers drained; 1 busy worker remains in the 'worker' scope.
    // The unrelated 2 coder agents must not leak into either count.
    expect(result.drained).toBe(2);
    expect(result.remaining).toBe(1);
  });

  // Note: unlike the filtered case above, this doesn't distinguish the fix
  // from the old behavior (scoped === agents when there's no filter, so
  // `agents.length - drained` and `scoped.length - drained` agree) — it's a
  // sanity check on the unfiltered path, not a regression guard for the bug.
  it('reports remaining across all types when no agentType filter is supplied', async () => {
    seedAgentStore(dir, [
      { agentId: 'w1', agentType: 'worker', status: 'idle' },
      { agentId: 'w2', agentType: 'worker', status: 'busy' },
      { agentId: 'c1', agentType: 'coder', status: 'idle' },
    ]);

    const pool = agentTools.find((t) => t.name === 'agent_pool')!;
    const result = (await pool.handler({ action: 'drain' }, {} as never)) as {
      drained: number;
      remaining: number;
    };

    // Both idle agents (across types) drained; 1 busy agent remains overall.
    expect(result.drained).toBe(2);
    expect(result.remaining).toBe(1);
  });
});
