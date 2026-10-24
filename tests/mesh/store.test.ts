import { beforeEach, describe, expect, it } from 'vitest';
import type { HelloFields } from '../../packages/@monomind/cli/src/mesh/protocol.js';
import { MeshStore, StoreError } from '../../packages/@monomind/cli/src/mesh/store.js';

const base: HelloFields = {
  tier: 'session',
  runtime: 'claude-code',
  pid: 100,
  project: 'p1',
  projectPath: '/w/p1',
  sessionId: 's1',
  capabilities: [],
  tags: [],
};
const alive = () => true;
let store: MeshStore;
beforeEach(async () => {
  store = await MeshStore.open(':memory:');
});

describe('MeshStore', () => {
  it('registers an agent as active and lists it', () => {
    store.upsertAgent('h/p1/s1', { ...base, capabilities: ['review'] }, 1000);
    const [a] = store.list();
    expect(a).toMatchObject({
      addr: 'h/p1/s1',
      status: 'active',
      lastSeen: 1000,
      joinedAt: 1000,
      capabilities: ['review'],
    });
  });

  it('keeps joinedAt on re-register and refreshes the rest', () => {
    store.upsertAgent('h/p1/s1', base, 1000);
    store.upsertAgent('h/p1/s1', { ...base, task: 'fix bug' }, 5000);
    expect(store.list()[0]).toMatchObject({ joinedAt: 1000, lastSeen: 5000, task: 'fix bug' });
  });

  it('rejects an alias already used by a live agent in the same project', () => {
    store.upsertAgent('h/p1/s1', { ...base, alias: 'reviewer' }, 1);
    expect(() =>
      store.upsertAgent('h/p1/s2', { ...base, sessionId: 's2', alias: 'reviewer' }, 2),
    ).toThrow(StoreError);
    // same alias in another project is fine
    store.upsertAgent('h/p2/s3', { ...base, project: 'p2', sessionId: 's3', alias: 'reviewer' }, 3);
  });

  it('frees an alias once its owner is gone', () => {
    store.upsertAgent('h/p1/s1', { ...base, alias: 'reviewer' }, 1);
    store.bye('h/p1/s1');
    store.upsertAgent('h/p1/s2', { ...base, sessionId: 's2', alias: 'reviewer' }, 2);
    expect(store.list({ project: 'p1' })).toHaveLength(1);
  });

  it('heartbeat revives a stale agent, updates task, and refuses a gone one', () => {
    store.upsertAgent('h/p1/s1', base, 0);
    store.sweep(40_000, 30_000, 90_000, alive);
    expect(store.list({ includeGone: true })[0].status).toBe('stale');
    expect(store.heartbeat('h/p1/s1', 41_000, 'task B')).toBe(true);
    expect(store.list()[0]).toMatchObject({ status: 'active', task: 'task B' });
    store.bye('h/p1/s1');
    expect(store.heartbeat('h/p1/s1', 42_000)).toBe(false);
  });

  it('sweeps by age and by dead pid', () => {
    store.upsertAgent('h/p1/s1', base, 0);
    store.upsertAgent('h/p1/s2', { ...base, sessionId: 's2', pid: 200 }, 0);
    const r = store.sweep(100_000, 30_000, 90_000, (pid) => pid !== 200);
    expect(r.gone.sort()).toEqual(['h/p1/s1', 'h/p1/s2']);
    expect(store.liveCount()).toBe(0);
  });

  it('marks stale between the thresholds and reports it once', () => {
    store.upsertAgent('h/p1/s1', base, 0);
    expect(store.sweep(35_000, 30_000, 90_000, alive).stale).toEqual(['h/p1/s1']);
    expect(store.sweep(36_000, 30_000, 90_000, alive).stale).toEqual([]);
  });

  it('filters by project, tier, status, capability, tag, parent and hides gone by default', () => {
    store.upsertAgent('h/p1/s1', { ...base, capabilities: ['test'], tags: ['x'] }, 1);
    store.upsertAgent(
      'h/p1/s2',
      { ...base, sessionId: 's2', tier: 'subagent', parent: 'h/p1/s1' },
      1,
    );
    store.upsertAgent('h/p2/s3', { ...base, project: 'p2', sessionId: 's3' }, 1);
    store.bye('h/p2/s3');
    expect(
      store
        .list()
        .map((a) => a.addr)
        .sort(),
    ).toEqual(['h/p1/s1', 'h/p1/s2']);
    expect(store.list({ includeGone: true })).toHaveLength(3);
    expect(store.list({ tier: 'subagent' }).map((a) => a.addr)).toEqual(['h/p1/s2']);
    expect(store.list({ capability: 'test' }).map((a) => a.addr)).toEqual(['h/p1/s1']);
    expect(store.list({ tag: 'x' }).map((a) => a.addr)).toEqual(['h/p1/s1']);
    expect(store.list({ parent: 'h/p1/s1' }).map((a) => a.addr)).toEqual(['h/p1/s2']);
    expect(store.list({ project: 'p2', status: 'gone' }).map((a) => a.addr)).toEqual(['h/p2/s3']);
  });
});
