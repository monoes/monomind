/**
 * Tests for EntityMemory
 *
 * Covers: blank-line guard in readAll(), upsert semantics,
 * expiry filtering, and prune.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EntityMemory } from './entity.js';
import type { EntityFact } from './entity.js';

const DB_PATH = join(tmpdir(), `entity-test-${Date.now()}.jsonl`);

function cleanUp() {
  if (existsSync(DB_PATH)) {
    try { unlinkSync(DB_PATH); } catch { /* ignore */ }
  }
}

function makeFact(entity: string, type: string, value = 'v'): EntityFact {
  return {
    entity,
    factType: type,
    value,
    confidence: 0.9,
    sourceRunId: 'r1',
    createdAt: Date.now(),
  };
}

describe('EntityMemory', () => {
  beforeEach(cleanUp);
  afterEach(cleanUp);

  describe('blank-line guard in readAll()', () => {
    it('does not throw when file has blank lines', () => {
      // Simulate a partially-written file with blank lines
      writeFileSync(DB_PATH,
        JSON.stringify(makeFact('Alice', 'role')) + '\n\n' +
        JSON.stringify(makeFact('Bob', 'role')) + '\n',
        'utf-8'
      );

      const mem = new EntityMemory(DB_PATH);
      expect(() => mem.retrieve('Alice')).not.toThrow();
      const facts = mem.retrieve('Alice');
      expect(facts).toHaveLength(1);
      expect(facts[0].entity).toBe('Alice');
    });

    it('handles file with only blank lines gracefully', () => {
      writeFileSync(DB_PATH, '\n\n\n', 'utf-8');
      const mem = new EntityMemory(DB_PATH);
      expect(() => mem.retrieve('anyone')).not.toThrow();
      expect(mem.retrieve('anyone')).toHaveLength(0);
    });
  });

  describe('store and retrieve', () => {
    it('stores and retrieves a fact', () => {
      const mem = new EntityMemory(DB_PATH);
      mem.store(makeFact('Alice', 'role', 'engineer'));
      const facts = mem.retrieve('Alice');
      expect(facts).toHaveLength(1);
      expect(facts[0].value).toBe('engineer');
    });

    it('upserts when same entity+factType stored twice', () => {
      const mem = new EntityMemory(DB_PATH);
      mem.store(makeFact('Alice', 'role', 'engineer'));
      mem.store(makeFact('Alice', 'role', 'manager'));
      const facts = mem.retrieve('Alice');
      expect(facts).toHaveLength(1);
      expect(facts[0].value).toBe('manager');
    });

    it('delete removes matching facts', () => {
      const mem = new EntityMemory(DB_PATH);
      mem.store(makeFact('Alice', 'role', 'engineer'));
      mem.store(makeFact('Alice', 'dept', 'eng'));
      const removed = mem.delete('Alice', 'role');
      expect(removed).toBe(1);
      expect(mem.retrieve('Alice')).toHaveLength(1);
    });
  });

  describe('expiry', () => {
    it('pruneExpired removes expired facts', () => {
      const mem = new EntityMemory(DB_PATH);
      const expired: EntityFact = { ...makeFact('Alice', 'role'), expiresAt: Date.now() - 1000 };
      mem.store(expired);
      mem.store(makeFact('Bob', 'role'));
      const removed = mem.pruneExpired();
      expect(removed).toBe(1);
      expect(mem.retrieve('Alice')).toHaveLength(0);
      expect(mem.retrieve('Bob')).toHaveLength(1);
    });
  });
});
