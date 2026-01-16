/**
 * Tests for SwarmCheckpointer (Task 08 — Graph Checkpointing + Resume).
 *
 * Uses vitest globals (describe, it, expect, beforeEach, afterEach, vi).
 * Temp directories via mkdtempSync / rmSync from 'fs'.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SwarmCheckpointer } from '../../packages/@monobrain/memory/src/checkpointer.js';
import type { AgentState } from '../../packages/@monobrain/memory/src/types/checkpoint.js';

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId: overrides.agentId ?? 'agent-1',
    agentSlug: overrides.agentSlug ?? 'coder',
    status: overrides.status ?? 'active',
    messageHistory: overrides.messageHistory ?? [],
    toolCallStack: overrides.toolCallStack ?? [],
    metadata: overrides.metadata ?? {},
    snapshotAt: overrides.snapshotAt ?? new Date().toISOString(),
    ...(overrides.taskId !== undefined ? { taskId: overrides.taskId } : {}),
  };
}

describe('SwarmCheckpointer', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
    dbPath = join(tmpDir, 'checkpoints.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createCheckpointer() {
    return new SwarmCheckpointer({
      dbPath,
      swarmId: 'swarm-1',
      sessionId: 'session-1',
    });
  }

  // -------------------------------------------------------------------------

  it('saveFull() persists and load() retrieves identical data', () => {
    const cp = createCheckpointer();
    const agents = [makeAgent({ agentId: 'a1' }), makeAgent({ agentId: 'a2' })];
    const queues = { q1: [{ msg: 'hello' }] };
    const results = { task1: { ok: true } };

    const id = cp.saveFull(agents, queues, results, 'manual');
    const loaded = cp.load(id);

    expect(loaded).not.toBeNull();
    expect(loaded!.checkpointId).toBe(id);
    expect(loaded!.swarmId).toBe('swarm-1');
    expect(loaded!.sessionId).toBe('session-1');
    expect(loaded!.step).toBe(1);
    expect(loaded!.trigger).toBe('manual');
    expect(loaded!.agentStates).toEqual(agents);
    expect(loaded!.messageQueues).toEqual(queues);
    expect(loaded!.taskResults).toEqual(results);
    expect(loaded!.stateHash).toBeTruthy();
    expect(loaded!.createdAt).toBeTruthy();
  });

  it('saveIncremental() patches agent status', () => {
    const cp = createCheckpointer();
    const agent = makeAgent({ agentId: 'a1', status: 'active' });
    cp.saveFull([agent], {}, {}, 'manual');

    const updated = makeAgent({ agentId: 'a1', status: 'completed' });
    cp.saveIncremental('a1', updated);

    const latest = cp.latest();
    expect(latest).not.toBeNull();
    expect(latest!.agentStates).toHaveLength(1);
    expect(latest!.agentStates[0].status).toBe('completed');
    expect(latest!.parentCheckpointId).toBeTruthy();
  });

  it('latest() returns highest step number', () => {
    const cp = createCheckpointer();
    cp.saveFull([makeAgent()], {}, {}, 'manual');
    cp.saveFull([makeAgent()], {}, {}, 'post-task');
    cp.saveFull([makeAgent()], {}, {}, 'session-end');

    const latest = cp.latest();
    expect(latest).not.toBeNull();
    expect(latest!.step).toBe(3);
    expect(latest!.trigger).toBe('session-end');
  });

  it('list() returns ordered results newest-first', () => {
    const cp = createCheckpointer();
    cp.saveFull([makeAgent()], {}, {}, 'manual');
    cp.saveFull([makeAgent()], {}, {}, 'post-task');
    cp.saveFull([makeAgent()], {}, {}, 'session-end');

    const metas = cp.list();
    expect(metas).toHaveLength(3);
    expect(metas[0].step).toBe(3);
    expect(metas[1].step).toBe(2);
    expect(metas[2].step).toBe(1);
  });

  it('list() respects limit parameter', () => {
    const cp = createCheckpointer();
    for (let i = 0; i < 5; i++) {
      cp.saveFull([makeAgent()], {}, {}, 'manual');
    }

    const metas = cp.list(2);
    expect(metas).toHaveLength(2);
    expect(metas[0].step).toBe(5);
    expect(metas[1].step).toBe(4);
  });

  it('purge(0) removes all checkpoints', () => {
    const cp = createCheckpointer();
    cp.saveFull([makeAgent()], {}, {}, 'manual');
    cp.saveFull([makeAgent()], {}, {}, 'post-task');

    const removed = cp.purge(0);
    expect(removed).toBe(2);
    expect(cp.list()).toHaveLength(0);
    expect(cp.latest()).toBeNull();
  });

  it('diff() correctly reports added/removed/changed agents', () => {
    const cp = createCheckpointer();

    const id1 = cp.saveFull(
      [makeAgent({ agentId: 'a1', status: 'active' }), makeAgent({ agentId: 'a2' })],
      {},
      {},
      'manual',
    );

    const id2 = cp.saveFull(
      [makeAgent({ agentId: 'a1', status: 'completed' }), makeAgent({ agentId: 'a3' })],
      {},
      {},
      'manual',
    );

    const result = cp.diff(id1, id2);
    expect(result.addedAgents).toEqual(['a3']);
    expect(result.removedAgents).toEqual(['a2']);
    expect(result.changedAgents).toEqual(['a1']);
  });

  it('load() returns null for non-existent checkpointId', () => {
    const cp = createCheckpointer();
    expect(cp.load('does-not-exist')).toBeNull();
  });

  it('empty db returns empty list', () => {
    const cp = createCheckpointer();
    expect(cp.list()).toHaveLength(0);
    expect(cp.latest()).toBeNull();
  });
});
