import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiveMindTools } from '../mcp-tools/hive-mind-tools.js';
import { getMonomindDataRoot } from '../mcp-tools/types.js';

// Regression test: hive-mind_spawn and hive-mind_shutdown both mutate and
// save the shared agent store (the same store.json task_assign and
// agent_spawn/terminate/update/pool write to), but were still calling the
// non-null-safe loadAgentStore() instead of loadAgentStoreOrNull() — found
// during a review pass on this session's agent-store data-loss fix, which
// migrated agent-tools.ts's own handlers but missed this file (explicitly
// named in agent-tools.ts's own doc comment as a consumer of the hardened
// loader). A corrupt/oversized store.json would silently be treated as
// empty and then overwritten, wiping every real agent.

describe('hive-mind_spawn / hive-mind_shutdown do not wipe a corrupt agent store', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-mind-agent-store-test-'));
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

  it('hive-mind_spawn refuses to spawn workers into a corrupt agent store, leaving it untouched', async () => {
    const init = hiveMindTools.find((t) => t.name === 'hive-mind_init')!;
    await init.handler({}, {} as never);

    const { path, content } = corruptAgentStore();
    const spawn = hiveMindTools.find((t) => t.name === 'hive-mind_spawn')!;

    const result = (await spawn.handler({ count: 1 }, {} as never)) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(readFileSync(path, 'utf-8')).toBe(content);
  });

  it('hive-mind_shutdown refuses to clear workers from a corrupt agent store, leaving it untouched', async () => {
    const init = hiveMindTools.find((t) => t.name === 'hive-mind_init')!;
    await init.handler({}, {} as never);

    const { path, content } = corruptAgentStore();
    const shutdown = hiveMindTools.find((t) => t.name === 'hive-mind_shutdown')!;

    const result = (await shutdown.handler({ force: true }, {} as never)) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(readFileSync(path, 'utf-8')).toBe(content);
  });

  it('hive-mind_spawn writes normally when the agent store is absent or valid', async () => {
    const init = hiveMindTools.find((t) => t.name === 'hive-mind_init')!;
    await init.handler({}, {} as never);

    const spawn = hiveMindTools.find((t) => t.name === 'hive-mind_spawn')!;
    const result = (await spawn.handler({ count: 2 }, {} as never)) as {
      success?: boolean;
      workers?: Array<{ agentId: string }>;
    };

    expect(result.success).toBe(true);
    expect(result.workers?.length).toBe(2);

    const storePath = join(getMonomindDataRoot(dir), 'agents', 'store.json');
    const store = JSON.parse(readFileSync(storePath, 'utf-8'));
    expect(Object.keys(store.agents)).toHaveLength(2);
  });
});
