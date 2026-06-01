/**
 * Tests for QueryBuilder
 *
 * Covers: sortField/sortDirection emission in build(),
 * fluent sort methods, default behavior.
 */

import { describe, it, expect } from 'vitest';
import { QueryBuilder, query, QueryTemplates } from './query-builder.js';

describe('QueryBuilder', () => {
  describe('sortField / sortDirection emitted by build()', () => {
    it('emits sortField when newestFirst (default) is called', () => {
      // newestFirst = sortBy('createdAt', 'desc')
      const q = query().semantic('test').sortBy('createdAt', 'desc').build();
      expect(q.sortField).toBe('createdAt');
      // 'desc' is the default — our build() only emits sortDirection for non-default
      expect(q.sortDirection).toBeUndefined();
    });

    it('emits sortField and sortDirection=asc when oldestFirst is called', () => {
      const q = query().semantic('test').oldestFirst().build();
      expect(q.sortField).toBe('createdAt');
      expect(q.sortDirection).toBe('asc');
    });

    it('emits sortField when sortBy accessCount is called', () => {
      const q = query().semantic('test').sortBy('accessCount', 'desc').build();
      expect(q.sortField).toBe('accessCount');
    });

    it('emits sortField when recentlyAccessed is called', () => {
      const q = query().semantic('test').recentlyAccessed().build();
      expect(q.sortField).toBe('lastAccessedAt');
    });

    it('emits custom sortField via sortBy()', () => {
      const q = query().semantic('test').sortBy('key', 'asc').build();
      expect(q.sortField).toBe('key');
      expect(q.sortDirection).toBe('asc');
    });

    it('does NOT emit sortField when no sort is specified', () => {
      const q = query().semantic('test').build();
      expect(q.sortField).toBeUndefined();
      expect(q.sortDirection).toBeUndefined();
    });

    it('does NOT emit sortDirection for default desc', () => {
      const q = query().semantic('test').sortBy('createdAt', 'desc').build();
      expect(q.sortDirection).toBeUndefined();
    });

    it('emits sortDirection=asc when explicitly set to asc', () => {
      const q = query().semantic('test').sortBy('updatedAt', 'asc').build();
      expect(q.sortDirection).toBe('asc');
    });
  });

  describe('build() includes sortField in output', () => {
    it('roundtrips through clone() preserving sort', () => {
      const original = query().semantic('hello').oldestFirst();
      const cloned = original.clone();
      const q = cloned.build();
      expect(q.sortField).toBe('createdAt');
      expect(q.sortDirection).toBe('asc');
    });

    it('reset() clears sortField', () => {
      const b = new QueryBuilder();
      b.semantic('hi').oldestFirst();
      b.reset();
      const q = b.build();
      expect(q.sortField).toBeUndefined();
    });
  });

  describe('QueryTemplates still work', () => {
    it('recentInNamespace returns valid query', () => {
      const q = QueryTemplates.recentInNamespace('ns', 5);
      expect(q.namespace).toBe('ns');
      expect(q.limit).toBe(5);
    });
  });
});
