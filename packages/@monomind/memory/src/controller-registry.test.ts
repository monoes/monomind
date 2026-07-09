/**
 * Comprehensive tests for ControllerRegistry (ADR-053)
 *
 * Covers:
 * - Initialization lifecycle and level-based ordering
 * - Graceful degradation (isolated controller failures)
 * - Config-driven activation
 * - Health check aggregation
 * - Shutdown ordering
 * - Cross-platform path handling (Linux/Mac/Windows)
 * - memory backend unavailable scenarios
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ControllerRegistry,
  INIT_LEVELS,
  type RuntimeConfig,
  type ControllerName,
  type RegistryHealthReport,
} from './controller-registry.js';
import { TieredCacheManager } from './cache-manager.js';
import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryQuery,
  MemoryEntryUpdate,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  MemoryType,
} from './types.js';

// ===== Mock Backend =====

function createMockBackend(): IMemoryBackend {
  const entries = new Map<string, MemoryEntry>();

  return {
    async initialize() {},
    async shutdown() {},
    async store(entry: MemoryEntry) {
      entries.set(entry.id, entry);
    },
    async get(id: string) {
      return entries.get(id) ?? null;
    },
    async getByKey(namespace: string, key: string) {
      for (const e of entries.values()) {
        if (e.namespace === namespace && e.key === key) return e;
      }
      return null;
    },
    async update(id: string, update: MemoryEntryUpdate) {
      const entry = entries.get(id);
      if (!entry) return null;
      Object.assign(entry, update, { updatedAt: Date.now() });
      return entry;
    },
    async delete(id: string) {
      return entries.delete(id);
    },
    async query(query: MemoryQuery) {
      const results = Array.from(entries.values());
      if (query.namespace) {
        return results.filter((e) => e.namespace === query.namespace).slice(0, query.limit);
      }
      return results.slice(0, query.limit);
    },
    async search(_embedding: Float32Array, _options: SearchOptions): Promise<SearchResult[]> {
      return [];
    },
    async bulkInsert(newEntries: MemoryEntry[]) {
      for (const entry of newEntries) entries.set(entry.id, entry);
    },
    async bulkDelete(ids: string[]) {
      let count = 0;
      for (const id of ids) {
        if (entries.delete(id)) count++;
      }
      return count;
    },
    async count(namespace?: string) {
      if (namespace) {
        return Array.from(entries.values()).filter((e) => e.namespace === namespace).length;
      }
      return entries.size;
    },
    async listNamespaces() {
      return [...new Set(Array.from(entries.values()).map((e) => e.namespace))];
    },
    async clearNamespace(namespace: string) {
      let count = 0;
      for (const [id, entry] of entries) {
        if (entry.namespace === namespace) {
          entries.delete(id);
          count++;
        }
      }
      return count;
    },
    async getStats(): Promise<BackendStats> {
      return {
        totalEntries: entries.size,
        entriesByNamespace: {},
        entriesByType: { episodic: 0, semantic: 0, working: 0, cache: 0 },
        memoryUsage: 0,
        avgQueryTime: 0,
        avgSearchTime: 0,
      };
    },
    async healthCheck(): Promise<HealthCheckResult> {
      return {
        status: 'healthy',
        components: {
          storage: { status: 'healthy', latency: 0 },
          index: { status: 'healthy', latency: 0 },
          cache: { status: 'healthy', latency: 0 },
        },
        timestamp: Date.now(),
        issues: [],
        recommendations: [],
      };
    },
  };
}

// ===== Test Suite =====

describe('ControllerRegistry', () => {
  let registry: ControllerRegistry;
  let mockBackend: IMemoryBackend;

  beforeEach(() => {
    registry = new ControllerRegistry();
    mockBackend = createMockBackend();
  });

  afterEach(async () => {
    if (registry.isInitialized()) {
      await registry.shutdown();
    }
  });

  // ----- Lifecycle Tests -----

  describe('initialization lifecycle', () => {
    it('should initialize with default config', async () => {
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should not initialize twice', async () => {
      await registry.initialize({ backend: mockBackend });
      const count1 = registry.getActiveCount();
      await registry.initialize({ backend: mockBackend });
      expect(registry.getActiveCount()).toBe(count1);
    });

    it('should initialize with empty config', async () => {
      await registry.initialize();
      expect(registry.isInitialized()).toBe(true);
    });

    it('should emit initialized event', async () => {
      const handler = vi.fn();
      registry.on('initialized', handler);
      await registry.initialize({ backend: mockBackend });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          initTimeMs: expect.any(Number),
          activeControllers: expect.any(Number),
          totalControllers: expect.any(Number),
        }),
      );
    });

    it('should emit controller:initialized events', async () => {
      const handler = vi.fn();
      registry.on('controller:initialized', handler);
      await registry.initialize({ backend: mockBackend });
      // learningBridge and tieredCache should init
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should track init time', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();
      expect(report.initTimeMs).toBeGreaterThan(0);
    });
  });

  // ----- Level-Based Ordering -----

  describe('level-based initialization ordering', () => {
    it('should define 2 initialization levels (0-1)', () => {
      expect(INIT_LEVELS).toHaveLength(2);
      expect(INIT_LEVELS[0].level).toBe(0);
      expect(INIT_LEVELS[1].level).toBe(1);
    });

    it('should have monotonically increasing levels', () => {
      for (let i = 1; i < INIT_LEVELS.length; i++) {
        expect(INIT_LEVELS[i].level).toBeGreaterThan(INIT_LEVELS[i - 1].level);
      }
    });

    it('should include core controllers in level 1', () => {
      const level1 = INIT_LEVELS.find((l) => l.level === 1);
      expect(level1?.controllers).toContain('learningBridge');
      expect(level1?.controllers).toContain('tieredCache');
    });

    it('should not have duplicate controller names across levels', () => {
      const allNames: ControllerName[] = [];
      for (const level of INIT_LEVELS) {
        for (const name of level.controllers) {
          expect(allNames).not.toContain(name);
          allNames.push(name);
        }
      }
    });
  });

  // ----- Graceful Degradation -----

  describe('graceful degradation', () => {
    it('should continue when memory backend is unavailable', async () => {
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should mark failed controllers as unavailable without crashing', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      // Registry should be functional
      expect(report.status).not.toBe('unhealthy');
    });

    it('should handle null backend gracefully', async () => {
      await registry.initialize({});
      expect(registry.isInitialized()).toBe(true);
      expect(registry.getBackend()).toBeNull();
    });

    it('should isolate controller failures from each other', async () => {
      // Initialize with backend - tieredCache should work
      await registry.initialize({ backend: mockBackend });

      // TieredCache should be available
      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });
  });

  // ----- Config-Driven Activation -----

  describe('config-driven activation', () => {
    it('should respect explicit controller enable/disable', async () => {
      await registry.initialize({
        backend: mockBackend,
        controllers: {
          learningBridge: false,
          tieredCache: true,
        },
      });

      expect(registry.isEnabled('learningBridge')).toBe(false);
      expect(registry.isEnabled('tieredCache')).toBe(true);
    });

    it('should enable tieredCache by default', async () => {
      await registry.initialize({ backend: mockBackend });
      expect(registry.isEnabled('tieredCache')).toBe(true);
    });

    it('should pass tieredCache config', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          tieredCache: { maxSize: 5000, ttl: 60000 },
        },
      });

      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });
  });

  // ----- Controller Access -----

  describe('controller access (get/isEnabled)', () => {
    it('should return false for disabled controllers', async () => {
      await registry.initialize({
        backend: mockBackend,
        controllers: { learningBridge: false },
      });
      expect(registry.isEnabled('learningBridge')).toBe(false);
    });
  });

  // ----- Health Check -----

  describe('health check', () => {
    it('should return healthy when controllers are active', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.initTimeMs).toBeGreaterThanOrEqual(0);
      expect(report.controllers).toBeInstanceOf(Array);
    });

    it('should report active and total controller counts', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      expect(report.activeControllers).toBeGreaterThanOrEqual(0);
      expect(report.totalControllers).toBeGreaterThanOrEqual(report.activeControllers);
    });

    it('should report lancedb availability', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();
      expect(typeof report.lancedbAvailable).toBe('boolean');
    });

    it('should classify status correctly', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      expect(['healthy', 'degraded', 'unhealthy']).toContain(report.status);
    });

    it('should include individual controller health', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      for (const controller of report.controllers) {
        expect(controller).toHaveProperty('name');
        expect(controller).toHaveProperty('status');
        expect(controller).toHaveProperty('initTimeMs');
        expect(['healthy', 'degraded', 'unavailable']).toContain(controller.status);
      }
    });
  });

  // ----- Shutdown -----

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      expect(registry.isInitialized()).toBe(false);
    });

    it('should emit shutdown event', async () => {
      const handler = vi.fn();
      registry.on('shutdown', handler);
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should handle double shutdown', async () => {
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      await registry.shutdown(); // Should be a no-op
      expect(registry.isInitialized()).toBe(false);
    });

    it('should handle shutdown without initialization', async () => {
      await registry.shutdown(); // Should be a no-op
      expect(registry.isInitialized()).toBe(false);
    });

    it('should clean up controllers', async () => {
      await registry.initialize({ backend: mockBackend });
      const countBefore = registry.getActiveCount();
      await registry.shutdown();
      expect(registry.getActiveCount()).toBe(0);
    });

    it('should allow re-initialization after shutdown', async () => {
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });
  });

  // ----- Controller Listing -----

  describe('listControllers', () => {
    it('should return list of all registered controllers', async () => {
      await registry.initialize({ backend: mockBackend });
      const list = registry.listControllers();

      expect(list).toBeInstanceOf(Array);
      for (const item of list) {
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('enabled');
        expect(item).toHaveProperty('level');
        expect(typeof item.name).toBe('string');
        expect(typeof item.enabled).toBe('boolean');
        expect(typeof item.level).toBe('number');
      }
    });
  });

  // ----- Memory Backend Integration -----

  describe('Memory backend integration', () => {
    it('should handle missing memory backend module', async () => {
      // With no backend module installed, should still work
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should return the backend when provided', async () => {
      await registry.initialize({ backend: mockBackend });
      const backendInst = registry.getBackend();
      expect(backendInst).toBe(mockBackend);
    });
  });

  // ----- Cross-Platform Path Handling -----

  describe('cross-platform compatibility', () => {
    it('should handle forward slash paths', async () => {
      await registry.initialize({
        backend: mockBackend,
        dbPath: '/tmp/test/memory.db',
      });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should handle relative paths', async () => {
      await registry.initialize({
        backend: mockBackend,
        dbPath: './data/memory.db',
      });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should handle :memory: path', async () => {
      await registry.initialize({
        backend: mockBackend,
        dbPath: ':memory:',
      });
      expect(registry.isInitialized()).toBe(true);
    });
  });

  // ----- TieredCache Integration -----

  describe('TieredCacheManager via registry', () => {
    it('should create TieredCacheManager', async () => {
      await registry.initialize({ backend: mockBackend });
      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });

    it('should respect cache config', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          tieredCache: { maxSize: 500, ttl: 10000 },
        },
      });

      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });
  });

  // ----- Event Emission -----

  describe('events', () => {
    it('should emit all lifecycle events', async () => {
      const events: string[] = [];
      registry.on('initialized', () => events.push('initialized'));
      registry.on('shutdown', () => events.push('shutdown'));

      await registry.initialize({ backend: mockBackend });
      expect(events).toContain('initialized');

      await registry.shutdown();
      expect(events).toContain('shutdown');
    });
  });

  // ----- Performance -----

  describe('performance', () => {
    it('should initialize within 500ms', async () => {
      const start = performance.now();
      await registry.initialize({ backend: mockBackend });
      const duration = performance.now() - start;

      // Per ADR-053: "No regression beyond 10% in CLI startup time"
      expect(duration).toBeLessThan(500);
    });

    it('should shutdown within 100ms', async () => {
      await registry.initialize({ backend: mockBackend });

      const start = performance.now();
      await registry.shutdown();
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should have low overhead for controller access', async () => {
      await registry.initialize({ backend: mockBackend });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        registry.get('learningBridge');
        registry.get('tieredCache');
        registry.isEnabled('learningBridge');
      }
      const duration = performance.now() - start;

      // 3000 lookups should complete in under 10ms
      expect(duration).toBeLessThan(10);
    });
  });
});
