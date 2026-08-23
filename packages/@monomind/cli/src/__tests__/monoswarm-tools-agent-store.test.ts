import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { monoswarmTools } from '../mcp-tools/monoswarm-tools.js';
import { getMonomindDataRoot } from '../mcp-tools/types.js';

// Regression test: monoswarm_agent_add and monoswarm_shutdown both mutate and
// save the shared agent store (the same store.json task_assign and
// agent_spawn/terminate/update/pool write to), and must use the null-safe
// loadAgentStoreOrNull() rather than the non-null-safe loadAgentStore() —
// found during a review pass on this session's agent-store data-loss fix.
// A corrupt/oversized store.json would otherwise silently be treated as
// empty and then overwritten, wiping every real agent.

describe('monoswarm_agent_add / monoswarm_shutdown do not wipe a corrupt agent store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monoswarm-agent-store-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  function corruptAgentStore(): { path: string; content: string } {
    const agentsDir = join(getMonomindDataRoot(dir), 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const path = join(agentsDir, 'store.json');
    const content = '{ not valid json !!!';
    writeFileSync(path, content, 'utf-8');
    return { path, content };
  }

  it('monoswarm_agent_add refuses to add agents into a corrupt agent store, leaving it untouched', async () => {
    const init = monoswarmTools.find((t) => t.name === 'monoswarm_init')!;
    await init.handler({}, {} as never);

    const { path, content } = corruptAgentStore();
    const add = monoswarmTools.find((t) => t.name === 'monoswarm_agent_add')!;

    const result = (await add.handler({ count: 1 }, {} as never)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(readFileSync(path, 'utf-8')).toBe(content);
  });

  it('monoswarm_shutdown refuses to clear workers from a corrupt agent store, leaving it untouched', async () => {
    const init = monoswarmTools.find((t) => t.name === 'monoswarm_init')!;
    await init.handler({}, {} as never);

    const { path, content } = corruptAgentStore();
    const shutdown = monoswarmTools.find((t) => t.name === 'monoswarm_shutdown')!;

    const result = (await shutdown.handler({ force: true }, {} as never)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(readFileSync(path, 'utf-8')).toBe(content);
  });

  it('monoswarm_agent_add writes normally when the agent store is absent or valid', async () => {
    const init = monoswarmTools.find((t) => t.name === 'monoswarm_init')!;
    await init.handler({}, {} as never);

    const add = monoswarmTools.find((t) => t.name === 'monoswarm_agent_add')!;
    const result = (await add.handler({ count: 2 }, {} as never)) as {
      success?: boolean;
      agents?: Array<{ agentId: string }>;
    };

    expect(result.success).toBe(true);
    expect(result.agents?.length).toBe(2);

    const storePath = join(getMonomindDataRoot(dir), 'agents', 'store.json');
    const store = JSON.parse(readFileSync(storePath, 'utf-8'));
    expect(Object.keys(store.agents)).toHaveLength(2);
  });
});

describe('monoswarm tools are registered unconditionally', () => {
  const originalEnv = process.env.MONOMIND_MCP_SPECULATIVE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MONOMIND_MCP_SPECULATIVE;
    else process.env.MONOMIND_MCP_SPECULATIVE = originalEnv;
  });

  const EXPECTED_NAMES = [
    'monoswarm_init',
    'monoswarm_status',
    'monoswarm_scale',
    'monoswarm_health',
    'monoswarm_shutdown',
    'monoswarm_agent_add',
    'monoswarm_join',
    'monoswarm_leave',
    'monoswarm_vote',
    'monoswarm_notice',
    'monoswarm_memory',
    'monoswarm_audit_list',
    'monoswarm_audit_verify',
  ];

  it('exposes all monoswarm tools via `monoswarmTools` with MONOMIND_MCP_SPECULATIVE unset', async () => {
    delete process.env.MONOMIND_MCP_SPECULATIVE;
    vi.resetModules();
    const { monoswarmTools: exported } = await import('../mcp-tools/monoswarm-tools.js');

    expect(exported).toHaveLength(EXPECTED_NAMES.length);
    expect(exported.map((t) => t.name).sort()).toEqual([...EXPECTED_NAMES].sort());
    for (const tool of exported) {
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('still exposes all tools even when MONOMIND_MCP_SPECULATIVE=1 is set (no behavior change from the old speculative flag)', async () => {
    process.env.MONOMIND_MCP_SPECULATIVE = '1';
    vi.resetModules();
    const { monoswarmTools: exported } = await import('../mcp-tools/monoswarm-tools.js');

    expect(exported).toHaveLength(EXPECTED_NAMES.length);
  });
});
