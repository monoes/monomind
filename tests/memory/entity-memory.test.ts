/**
 * Tests for EntityMemory (Task 09)
 *
 * Run: npx vitest run --globals tests/memory/entity-memory.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EntityMemory, type EntityFact } from '../../packages/@monobrain/memory/src/tiers/entity.js';

function makeFact(overrides: Partial<EntityFact> = {}): EntityFact {
  return {
    entity: 'user:alice',
    factType: 'role',
    value: 'admin',
    confidence: 0.95,
    sourceRunId: 'run-1',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('EntityMemory', () => {
  let tmpDir: string;
  let dbPath: string;
  let mem: EntityMemory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-test-'));
    dbPath = path.join(tmpDir, 'entities.jsonl');
    mem = new EntityMemory(dbPath);
  });

  afterEach(() => {
    mem.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves by entity', () => {
    const fact = makeFact();
    mem.store(fact);
    const results = mem.retrieve('user:alice');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('admin');
  });

  it('returns empty array for unknown entity', () => {
    expect(mem.retrieve('unknown')).toHaveLength(0);
  });

  it('upserts on duplicate entity+factType', () => {
    mem.store(makeFact({ value: 'admin' }));
    mem.store(makeFact({ value: 'superadmin', confidence: 0.99 }));

    const results = mem.retrieve('user:alice');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('superadmin');
    expect(results[0].confidence).toBe(0.99);
  });

  it('stores multiple fact types for the same entity', () => {
    mem.store(makeFact({ factType: 'role', value: 'admin' }));
    mem.store(makeFact({ factType: 'email', value: 'alice@example.com' }));

    const results = mem.retrieve('user:alice');
    expect(results).toHaveLength(2);
  });

  it('respects expiresAt TTL', () => {
    const past = Date.now() - 10_000;
    mem.store(makeFact({ factType: 'temp', expiresAt: past }));
    mem.store(makeFact({ factType: 'perm' }));

    const results = mem.retrieve('user:alice');
    expect(results).toHaveLength(1);
    expect(results[0].factType).toBe('perm');
  });

  it('deletes by entity', () => {
    mem.store(makeFact({ entity: 'user:alice' }));
    mem.store(makeFact({ entity: 'user:bob', factType: 'role' }));

    const removed = mem.delete('user:alice');
    expect(removed).toBe(1);
    expect(mem.retrieve('user:alice')).toHaveLength(0);
    expect(mem.retrieve('user:bob')).toHaveLength(1);
  });

  it('deletes by entity+factType', () => {
    mem.store(makeFact({ factType: 'role' }));
    mem.store(makeFact({ factType: 'email', value: 'alice@x.com' }));

    const removed = mem.delete('user:alice', 'role');
    expect(removed).toBe(1);

    const results = mem.retrieve('user:alice');
    expect(results).toHaveLength(1);
    expect(results[0].factType).toBe('email');
  });

  it('pruneExpired removes expired facts', () => {
    const past = Date.now() - 10_000;
    const future = Date.now() + 60_000;

    mem.store(makeFact({ factType: 'expired', expiresAt: past }));
    mem.store(makeFact({ factType: 'valid', expiresAt: future }));
    mem.store(makeFact({ factType: 'forever' }));

    const pruned = mem.pruneExpired();
    expect(pruned).toBe(1);

    // Only non-expired remain
    const results = mem.retrieve('user:alice');
    expect(results).toHaveLength(2);
  });

  it('findByFactType returns matching facts', () => {
    mem.store(makeFact({ entity: 'user:alice', factType: 'role', value: 'admin' }));
    mem.store(makeFact({ entity: 'user:bob', factType: 'role', value: 'viewer' }));
    mem.store(makeFact({ entity: 'user:alice', factType: 'email', value: 'a@x.com' }));

    const roles = mem.findByFactType('role');
    expect(roles).toHaveLength(2);
  });

  it('retrieve sorts by confidence descending', () => {
    mem.store(makeFact({ factType: 'a', confidence: 0.5 }));
    mem.store(makeFact({ factType: 'b', confidence: 0.9 }));
    mem.store(makeFact({ factType: 'c', confidence: 0.7 }));

    const results = mem.retrieve('user:alice');
    expect(results.map((r) => r.confidence)).toEqual([0.9, 0.7, 0.5]);
  });

  it('persists data across instances', () => {
    mem.store(makeFact({ factType: 'role', value: 'admin' }));
    mem.close();

    const mem2 = new EntityMemory(dbPath);
    const results = mem2.retrieve('user:alice');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('admin');
    mem2.close();
  });
});
