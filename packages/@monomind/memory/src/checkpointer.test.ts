/**
 * Tests for SwarmCheckpointer
 *
 * Covers: saveFull/saveIncremental correctness, latest()/list()/load()/diff(),
 * purge(), and that a fresh instance re-opening an existing file resumes
 * from the correct step + latest checkpoint (the in-memory cache introduced
 * to avoid an O(n) file read on every saveIncremental() call must stay
 * consistent with what's actually on disk).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwarmCheckpointer } from './checkpointer.js';
import type { AgentState } from './types/checkpoint.js';

function makeAgent(agentId: string, overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId,
    agentSlug: agentId,
    status: 'active',
    messageHistory: [],
    toolCallStack: [],
    metadata: {},
    snapshotAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('SwarmCheckpointer', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'checkpointer-test-'));
    dbPath = join(dir, 'checkpoints.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saveFull appends a checkpoint and latest() returns it', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    const id = cp.saveFull([makeAgent('a1')], {}, {}, 'manual');
    const latest = cp.latest();
    expect(latest?.checkpointId).toBe(id);
    expect(latest?.step).toBe(1);
    expect(latest?.agentStates).toHaveLength(1);
  });

  it('saveIncremental patches one agent without dropping others', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp.saveFull([makeAgent('a1', { status: 'active' }), makeAgent('a2', { status: 'idle' })], {}, {}, 'manual');
    cp.saveIncremental('a1', makeAgent('a1', { status: 'completed' }));

    const latest = cp.latest();
    expect(latest?.agentStates).toHaveLength(2);
    const a1 = latest?.agentStates.find((a) => a.agentId === 'a1');
    const a2 = latest?.agentStates.find((a) => a.agentId === 'a2');
    expect(a1?.status).toBe('completed');
    expect(a2?.status).toBe('idle');
  });

  it('saveIncremental appends a new agent when the id is not already present', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp.saveFull([makeAgent('a1')], {}, {}, 'manual');
    cp.saveIncremental('a2', makeAgent('a2'));

    expect(cp.latest()?.agentStates.map((a) => a.agentId).sort()).toEqual(['a1', 'a2']);
  });

  it('step numbers increment monotonically across saveFull and saveIncremental', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp.saveFull([makeAgent('a1')], {}, {}, 'manual');
    cp.saveIncremental('a1', makeAgent('a1', { status: 'idle' }));
    cp.saveIncremental('a1', makeAgent('a1', { status: 'completed' }));

    expect(cp.latest()?.step).toBe(3);
    expect(cp.list(10).map((c) => c.step)).toEqual([3, 2, 1]);
  });

  it('a fresh instance reopening an existing file resumes from the correct step and latest checkpoint', () => {
    const cp1 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp1.saveFull([makeAgent('a1')], {}, {}, 'manual');
    cp1.saveIncremental('a1', makeAgent('a1', { status: 'completed' }));

    // Simulates a process restart: new instance, same file on disk.
    const cp2 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    expect(cp2.latest()?.step).toBe(2);
    expect(cp2.latest()?.agentStates[0]?.status).toBe('completed');

    // Continuing to save from cp2 must not restart step numbering from 0/1.
    const id3 = cp2.saveFull([makeAgent('a1', { status: 'idle' })], {}, {}, 'manual');
    expect(cp2.latest()?.checkpointId).toBe(id3);
    expect(cp2.latest()?.step).toBe(3);
  });

  it('a concurrently-open second instance writing to the same file is visible to the first instance (cross-process crash-recovery scenario)', () => {
    // SwarmCheckpointer exists specifically so a *new* process can resume
    // what a *previous* process wrote — two live instances on the same
    // dbPath is the expected case, not an edge case. The in-memory
    // lastCheckpoint cache must not let cp1 keep serving a stale latest()
    // once cp2 has appended a new checkpoint to the shared file.
    const cp1 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp1.saveFull([makeAgent('a1')], {}, {}, 'manual');
    expect(cp1.latest()?.step).toBe(1);

    const cp2 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess2' });
    expect(cp2.latest()?.step).toBe(1);
    cp2.saveFull([makeAgent('a1'), makeAgent('a2')], {}, {}, 'manual');
    expect(cp2.latest()?.step).toBe(2);

    // cp1 never wrote again itself, but must observe cp2's write via the
    // mtime-based staleness check rather than trusting its own stale cache.
    expect(cp1.latest()?.step).toBe(2);
    expect(cp1.latest()?.agentStates).toHaveLength(2);

    // cp1 continuing to save must build on cp2's step, not collide with it.
    const id3 = cp1.saveFull([makeAgent('a1'), makeAgent('a2'), makeAgent('a3')], {}, {}, 'manual');
    expect(cp1.latest()?.checkpointId).toBe(id3);
    expect(cp1.latest()?.step).toBe(3);
  });

  it('saveIncremental patches onto a checkpoint another instance wrote, not a stale cached one', () => {
    const cp1 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp1.saveFull([makeAgent('a1', { status: 'active' })], {}, {}, 'manual');

    const cp2 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess2' });
    cp2.saveFull([makeAgent('a1', { status: 'active' }), makeAgent('a2', { status: 'active' })], {}, {}, 'manual');

    // cp1's cache still thinks the latest checkpoint only has a1. Its
    // incremental save must pick up cp2's write (including a2) rather than
    // reverting the file to a1-only.
    cp1.saveIncremental('a1', makeAgent('a1', { status: 'completed' }));

    const finalState = cp1.latest();
    expect(finalState?.agentStates).toHaveLength(2);
    const a1 = finalState?.agentStates.find((a) => a.agentId === 'a1');
    const a2 = finalState?.agentStates.find((a) => a.agentId === 'a2');
    expect(a1?.status).toBe('completed');
    expect(a2?.status).toBe('active');
  });

  it('latest() returns null when no checkpoints exist yet', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    expect(cp.latest()).toBeNull();
    expect(existsSync(dbPath)).toBe(false);
  });

  it('load() finds a checkpoint by id, including non-latest ones', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    const id1 = cp.saveFull([makeAgent('a1')], {}, {}, 'manual');
    cp.saveFull([makeAgent('a1'), makeAgent('a2')], {}, {}, 'manual');

    expect(cp.load(id1)?.checkpointId).toBe(id1);
    expect(cp.load('nonexistent')).toBeNull();
  });

  it('diff() reports added/removed/changed agents between two checkpoints', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    const id1 = cp.saveFull([makeAgent('a1', { status: 'active' }), makeAgent('a2', { status: 'active' })], {}, {}, 'manual');
    const id2 = cp.saveFull([makeAgent('a1', { status: 'completed' }), makeAgent('a3', { status: 'active' })], {}, {}, 'manual');

    const d = cp.diff(id1, id2);
    expect(d.addedAgents).toEqual(['a3']);
    expect(d.removedAgents).toEqual(['a2']);
    expect(d.changedAgents).toEqual(['a1']);
  });

  it('purge() removes only checkpoints older than the cutoff and keeps latest() consistent', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    // Manually construct an old + a recent checkpoint via saveFull, then
    // rewrite the old one's createdAt directly on disk to simulate age
    // (saveFull always stamps "now").
    cp.saveFull([makeAgent('a1')], {}, {}, 'manual');
    cp.saveFull([makeAgent('a1'), makeAgent('a2')], {}, {}, 'manual');

    const raw = readFileSync(dbPath, 'utf-8').trim().split('\n');
    const oldLine = JSON.parse(raw[0]);
    oldLine.createdAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    raw[0] = JSON.stringify(oldLine);
    writeFileSync(dbPath, raw.join('\n') + '\n', 'utf-8');

    const cp2 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    const removed = cp2.purge(7);
    expect(removed).toBe(1);
    expect(cp2.list(10)).toHaveLength(1);
    // latest() cache must reflect the post-purge state, not the pre-purge one.
    expect(cp2.latest()?.step).toBe(2);
  });

  it('purge() sets latest() to null when everything is purged', () => {
    const cp = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp.saveFull([makeAgent('a1')], {}, {}, 'manual');

    const raw = readFileSync(dbPath, 'utf-8').trim().split('\n');
    const line = JSON.parse(raw[0]);
    line.createdAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    writeFileSync(dbPath, JSON.stringify(line) + '\n', 'utf-8');

    const cp2 = new SwarmCheckpointer({ dbPath, swarmId: 's1', sessionId: 'sess1' });
    cp2.purge(7);
    expect(cp2.latest()).toBeNull();
    expect(cp2.list(10)).toHaveLength(0);
  });
});
