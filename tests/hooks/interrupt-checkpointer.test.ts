import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { InterruptCheckpointer } from '../../packages/@monomind/hooks/src/interrupt/interrupt-checkpointer.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('InterruptCheckpointer', () => {
  let checkpointer: InterruptCheckpointer;
  let tempDir: string;

  const spawn = {
    agentType: 'coder',
    agentId: 'agent-001',
    priority: 'normal',
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'interrupt-test-'));
    checkpointer = new InterruptCheckpointer(join(tempDir, 'checkpoints.jsonl'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves a checkpoint and retrieves it by id', () => {
    const id = checkpointer.save('swarm-1', 0, spawn);
    const checkpoint = checkpointer.get(id);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.swarmId).toBe('swarm-1');
    expect(checkpoint!.step).toBe(0);
    expect(checkpoint!.status).toBe('pending');
    expect(checkpoint!.pendingSpawn.agentType).toBe('coder');
  });

  it('approve sets status to approved', () => {
    const id = checkpointer.save('swarm-1', 1, spawn);
    checkpointer.approve(id);
    const checkpoint = checkpointer.get(id);
    expect(checkpoint!.status).toBe('approved');
    expect(checkpoint!.resolvedAt).toBeDefined();
  });

  it('reject sets status to rejected', () => {
    const id = checkpointer.save('swarm-1', 2, spawn);
    checkpointer.reject(id);
    const checkpoint = checkpointer.get(id);
    expect(checkpoint!.status).toBe('rejected');
    expect(checkpoint!.resolvedAt).toBeDefined();
  });

  it('listPending returns only pending checkpoints', () => {
    const id1 = checkpointer.save('swarm-1', 0, spawn);
    const id2 = checkpointer.save('swarm-1', 1, spawn);
    checkpointer.save('swarm-1', 2, spawn);
    checkpointer.approve(id1);
    checkpointer.reject(id2);

    const pending = checkpointer.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].step).toBe(2);
  });

  it('get returns undefined for unknown id', () => {
    const result = checkpointer.get('nonexistent');
    expect(result).toBeUndefined();
  });
});
