import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskTools } from '../mcp-tools/task-tools.js';

// Regression test for a real data-loss bug found during a catch{}-block audit:
// task_assign's agent-store loader fell back to an empty in-memory store on
// any read failure (not just "file doesn't exist"), then a later step
// unconditionally overwrote the real on-disk store.json with that empty
// object — silently wiping every agent's state whenever the file was
// transiently corrupt or oversized.

describe('task_assign does not wipe a corrupt/oversized agent store on read failure', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'task-tools-test-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  function taskCreate() {
    const create = taskTools.find((t) => t.name === 'task_create')!;
    return create.handler({ type: 'feature', description: 'test task' }, {} as never) as Promise<{ taskId: string }>;
  }

  function taskAssign(taskId: string, agentIds: string[]) {
    const assign = taskTools.find((t) => t.name === 'task_assign')!;
    return assign.handler({ taskId, agentIds }, {} as never) as Promise<{
      agentStoreSyncSkipped?: boolean;
    }>;
  }

  it('leaves a corrupt agent store.json untouched instead of overwriting it with an empty one', async () => {
    const agentsDir = join(dir, '.monomind', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    const agentStorePath = join(agentsDir, 'store.json');
    const corruptContent = '{ this is not valid json !!!';
    writeFileSync(agentStorePath, corruptContent, 'utf-8');

    const { taskId } = await taskCreate();
    const result = await taskAssign(taskId, ['agent-1']);

    expect(result.agentStoreSyncSkipped).toBe(true);
    // The corrupt file must still be exactly what it was — not overwritten
    // with `{"agents":{}}`.
    expect(readFileSync(agentStorePath, 'utf-8')).toBe(corruptContent);
  });

  it('writes normally when the agent store is absent or valid', async () => {
    const { taskId } = await taskCreate();
    const result = await taskAssign(taskId, ['agent-1']);

    expect(result.agentStoreSyncSkipped).toBeUndefined();

    const agentStorePath = join(dir, '.monomind', 'agents', 'store.json');
    const written = JSON.parse(readFileSync(agentStorePath, 'utf-8'));
    expect(written).toEqual({ agents: {} });
  });
});
