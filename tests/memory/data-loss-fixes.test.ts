/**
 * Regression tests for the verified data-loss cluster (GitHub #85, #89, #90).
 *
 * #85: MemoryMigrator.loadFromMemoryManager verified a discovered file with
 *      fs.access but then called loadFromJSON() with no argument, which read
 *      this.config.sourcePath (the search *directory*) — readFile threw,
 *      the catch swallowed it, and the migration silently returned [].
 *
 * #89: ControllerRegistry.shutdown() tore down controllers but never closed
 *      this.backend; SqlBackend.shutdown() is where the final persist()
 *      happens, so buffered writes were lost on process exit.
 *
 * #90: KnowledgeStore.filterJsonl and PromptVersionStore writeVersions /
 *      writeExperiments rewrote JSONL index files with bare writeFileSync —
 *      a crash mid-rewrite destroyed the whole index. Both now go through
 *      writeFileAtomicSync (tmp + rename).
 *
 * Uses vitest globals. Temp directories via mkdtempSync / rmSync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { MemoryMigrator } from '../../packages/@monomind/memory/src/migration.js';
import { ControllerRegistry, INIT_LEVELS } from '../../packages/@monomind/memory/src/controller-registry.js';
import { KnowledgeStore } from '../../packages/@monomind/memory/src/knowledge/knowledge-store.js';
import { PromptVersionStore } from '../../packages/@monomind/memory/src/prompt-version-store.js';
import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
} from '../../packages/@monomind/memory/src/types.js';

/** Minimal in-memory IMemoryBackend — records stores, counts shutdowns. */
class FakeBackend implements IMemoryBackend {
  stored: MemoryEntry[] = [];
  shutdownCalls = 0;

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> { this.shutdownCalls++; }
  async store(entry: MemoryEntry): Promise<void> { this.stored.push(entry); }
  async get(id: string): Promise<MemoryEntry | null> {
    return this.stored.find((e) => e.id === id) ?? null;
  }
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    return this.stored.find((e) => e.namespace === namespace && e.key === key) ?? null;
  }
  async update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null> {
    const entry = await this.get(id);
    if (!entry) return null;
    Object.assign(entry, update);
    return entry;
  }
  async delete(id: string): Promise<boolean> {
    const before = this.stored.length;
    this.stored = this.stored.filter((e) => e.id !== id);
    return this.stored.length < before;
  }
  async query(_query: MemoryQuery): Promise<MemoryEntry[]> { return this.stored; }
  async search(_embedding: Float32Array, _options: SearchOptions): Promise<SearchResult[]> { return []; }
  async bulkInsert(entries: MemoryEntry[]): Promise<void> { this.stored.push(...entries); }
  async bulkDelete(ids: string[]): Promise<number> {
    const before = this.stored.length;
    this.stored = this.stored.filter((e) => !ids.includes(e.id));
    return before - this.stored.length;
  }
  async count(namespace?: string): Promise<number> {
    return namespace ? this.stored.filter((e) => e.namespace === namespace).length : this.stored.length;
  }
  async listNamespaces(): Promise<string[]> {
    return [...new Set(this.stored.map((e) => e.namespace))];
  }
  async clearNamespace(namespace: string): Promise<number> {
    const before = this.stored.length;
    this.stored = this.stored.filter((e) => e.namespace !== namespace);
    return before - this.stored.length;
  }
  async getStats(): Promise<BackendStats> {
    return {
      totalEntries: this.stored.length,
      entriesByNamespace: {},
      totalSize: 0,
      avgEntrySize: 0,
      cacheHitRate: 0,
      lastCompaction: 0,
    } as unknown as BackendStats;
  }
  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true, latencyMs: 0 } as unknown as HealthCheckResult;
  }
}

describe('#85 MemoryMigrator memory-manager source', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrator-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads entries from a discovered JSON store file instead of reading the source directory', async () => {
    // Fixture: a legacy memory.json store at one of the probed paths.
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify([
        { key: 'alpha', value: 'first entry' },
        { key: 'beta', value: { nested: true }, namespace: 'custom' },
      ]),
      'utf-8',
    );

    const backend = new FakeBackend();
    const migrator = new MemoryMigrator(backend, {
      source: 'memory-manager',
      sourcePath: dir, // a directory — the old code readFile()'d this and silently returned []
      generateEmbeddings: false,
    });

    const result = await migrator.migrate();

    expect(result.success).toBe(true);
    expect(result.progress.migrated).toBe(2);
    expect(backend.stored).toHaveLength(2);
    const alpha = backend.stored.find((e) => e.key === 'alpha');
    const beta = backend.stored.find((e) => e.key === 'beta');
    expect(alpha?.content).toBe('first entry');
    expect(beta?.namespace).toBe('custom');
    expect(beta?.content).toBe(JSON.stringify({ nested: true }));
  });

  it('skips non-JSON candidate files (e.g. a SQLite .db) without crashing', async () => {
    writeFileSync(join(dir, 'memory.json'), JSON.stringify([{ key: 'x', value: 'y' }]), 'utf-8');
    // A binary blob at the .db candidate path must not abort the search.
    const swarmDir = join(dir, '.swarm');
    mkdirSync(swarmDir, { recursive: true });
    writeFileSync(join(swarmDir, 'memory.db'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const backend = new FakeBackend();
    const migrator = new MemoryMigrator(backend, {
      source: 'memory-manager',
      sourcePath: dir,
      generateEmbeddings: false,
    });

    const result = await migrator.migrate();
    expect(result.progress.migrated).toBe(1);
    expect(backend.stored[0]?.key).toBe('x');
  });
});

describe('#89 ControllerRegistry.shutdown closes the backend', () => {
  it('calls backend.shutdown() after controller teardown', async () => {
    const backend = new FakeBackend();
    const registry = new ControllerRegistry();

    // Disable every controller so initialize() touches nothing but the backend.
    const controllers = Object.fromEntries(
      INIT_LEVELS.flatMap((level) => level.controllers).map((name) => [name, false]),
    );

    await registry.initialize({ backend, controllers });
    expect(backend.shutdownCalls).toBe(0);

    await registry.shutdown();
    expect(backend.shutdownCalls).toBe(1);
  });
});

describe('#90 atomic JSONL rewrites', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jsonl-atomic-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function expectNoTmpLeftovers(targetDir: string) {
    const leftovers = readdirSync(targetDir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  }

  it('KnowledgeStore.removeDocument leaves a valid, complete JSONL index', () => {
    const store = new KnowledgeStore(dir);
    const docA = join(dir, 'a.md');
    const docB = join(dir, 'b.md');
    writeFileSync(docA, '# Doc A\n\nSome content for doc A.\n', 'utf-8');
    writeFileSync(docB, '# Doc B\n\nSome content for doc B.\n', 'utf-8');

    store.indexDocument(docA, 'shared');
    store.indexDocument(docB, 'shared');
    store.removeDocument(docA, 'shared');

    const metadataPath = join(dir, 'metadata.jsonl');
    const chunksPath = join(dir, 'chunks.jsonl');
    expect(existsSync(metadataPath)).toBe(true);

    // Every line must still parse — a truncated rewrite would throw here.
    const metadata = readFileSync(metadataPath, 'utf-8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(metadata).toHaveLength(1);
    expect(metadata[0].filePath).toBe(docB);

    const chunks = readFileSync(chunksPath, 'utf-8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.metadata.filePath).toBe(docB);
    }

    // Atomic helper must clean up its tmp files.
    expectNoTmpLeftovers(dir);
  });

  it('PromptVersionStore rewrites keep versions/experiments JSONL valid', () => {
    const store = new PromptVersionStore(dir);
    const now = new Date();

    store.save({
      agentSlug: 'coder',
      version: 'v1',
      prompt: 'line one\nline two',
      changelog: 'initial',
      activeFrom: now,
      traceCount: 0,
      publishedBy: 'test',
      createdAt: now,
    });
    store.saveExperiment({
      agentSlug: 'coder',
      control: 'v1',
      candidate: 'v2',
      trafficPct: 50,
      startedAt: now,
    });

    store.updateQualityScore('coder', 'v1', 0.9);
    store.concludeExperiment('coder', 'v1');

    const versions = readFileSync(join(dir, 'versions.jsonl'), 'utf-8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(versions).toHaveLength(1);
    expect(versions[0].qualityScore).toBe(0.9);

    const experiments = readFileSync(join(dir, 'experiments.jsonl'), 'utf-8').split('\n').filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(experiments).toHaveLength(1);
    expect(experiments[0].winnerId).toBe('v1');

    expectNoTmpLeftovers(dir);
  });
});
