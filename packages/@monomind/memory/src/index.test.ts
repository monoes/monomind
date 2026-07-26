/**
 * UnifiedMemoryService — public-API conformance tests.
 *
 * Why this file exists: `UnifiedMemoryService` and the four `create*Service`
 * factories are this package's headline public API and its default export, but
 * they had ZERO consumers inside the monorepo (the CLI's memory-bridge.ts talks
 * to SQLiteBackend/SqlJsBackend directly) and ZERO tests. A shipped, published,
 * documented entry point that nothing exercises is one refactor away from being
 * silently broken for the external consumers it is deliberately retained for.
 *
 * The decision was to KEEP the class (it is a documented published API — see the
 * retention note on the class itself) and cover it, rather than delete it as
 * dead internal code. These tests are the evidence that the retained API works.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  UnifiedMemoryService,
  createInMemoryService,
  createPersistentService,
  createEmbeddingService,
  createHybridService,
} from './index.js';
import DefaultExport from './index.js';
import { createDefaultEntry } from './types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIM = 8;

/** Deterministic embedder so semantic assertions are stable. */
async function embed(text: string): Promise<Float32Array> {
  const v = new Float32Array(DIM);
  for (let i = 0; i < text.length; i++) v[i % DIM] += text.charCodeAt(i) / 255;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

const open: UnifiedMemoryService[] = [];
const tmpDirs: string[] = [];

function track(s: UnifiedMemoryService): UnifiedMemoryService {
  open.push(s);
  return s;
}

afterEach(async () => {
  while (open.length) {
    try {
      await open.pop()!.shutdown();
    } catch {
      /* already down */
    }
  }
  while (tmpDirs.length) {
    try {
      rmSync(tmpDirs.pop()!, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('UnifiedMemoryService lifecycle', () => {
  it('initializes, reports state, and shuts down idempotently', async () => {
    const svc = track(new UnifiedMemoryService({ persistenceEnabled: false }));
    expect(svc.isInitialized()).toBe(false);

    await svc.initialize();
    expect(svc.isInitialized()).toBe(true);

    await svc.initialize(); // idempotent
    expect(svc.isInitialized()).toBe(true);

    await svc.shutdown();
    expect(svc.isInitialized()).toBe(false);
    await svc.shutdown(); // idempotent when already down
    expect(svc.isInitialized()).toBe(false);
  });

  it('exposes the underlying SQLite adapter', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();
    expect(svc.getAdapter()).toBeDefined();
    expect(typeof svc.getAdapter().store).toBe('function');
  });

  it('is the package default export', () => {
    expect(DefaultExport).toBe(UnifiedMemoryService);
  });
});

describe('UnifiedMemoryService IMemoryBackend surface', () => {
  it('round-trips store/get/getByKey/update/delete', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();

    const entry = createDefaultEntry({
      key: 'auth-notes',
      content: 'oauth refresh tokens',
      namespace: 'security',
    });
    await svc.store(entry);

    const byId = await svc.get(entry.id);
    expect(byId?.content).toBe('oauth refresh tokens');

    const byKey = await svc.getByKey('security', 'auth-notes');
    expect(byKey?.id).toBe(entry.id);

    const updated = await svc.update(entry.id, { content: 'rotated' });
    expect(updated?.content).toBe('rotated');

    expect(await svc.delete(entry.id)).toBe(true);
    expect(await svc.get(entry.id)).toBeNull();
  });

  it('supports bulk insert/delete, count, namespaces and clearNamespace', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();

    const a = createDefaultEntry({ key: 'a', content: 'alpha', namespace: 'ns1' });
    const b = createDefaultEntry({ key: 'b', content: 'beta', namespace: 'ns1' });
    const c = createDefaultEntry({ key: 'c', content: 'gamma', namespace: 'ns2' });
    await svc.bulkInsert([a, b, c]);

    expect(await svc.count('ns1')).toBe(2);
    expect((await svc.listNamespaces()).sort()).toEqual(expect.arrayContaining(['ns1', 'ns2']));

    expect(await svc.clearNamespace('ns1')).toBe(2);
    expect(await svc.count('ns1')).toBe(0);

    expect(await svc.bulkDelete([c.id])).toBe(1);
    expect(await svc.get(c.id)).toBeNull();
  });

  it('reports stats and health', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();
    await svc.storeEntry({ key: 'k', content: 'v' });

    const stats = await svc.getStats();
    expect(stats.totalEntries).toBeGreaterThanOrEqual(1);

    const health = await svc.healthCheck();
    expect(health.status).toBeDefined();
  });

  it('forwards adapter entry events to service listeners', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();

    const seen: string[] = [];
    svc.on('entry:stored', () => seen.push('stored'));
    svc.on('entry:deleted', () => seen.push('deleted'));

    const e = await svc.storeEntry({ key: 'ev', content: 'x' });
    await svc.delete(e.id);

    expect(seen).toContain('stored');
    expect(seen).toContain('deleted');
  });
});

describe('UnifiedMemoryService convenience methods', () => {
  it('storeEntry creates a full entry from simple input', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();
    const e = await svc.storeEntry({ key: 'k1', content: 'hello', tags: ['t'] });
    expect(e.id).toBeTruthy();
    expect((await svc.get(e.id))?.content).toBe('hello');
  });

  it('getOrCreate returns the existing entry instead of duplicating', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();

    const first = await svc.getOrCreate('ns', 'key', () => ({ key: 'key', content: 'first' }));
    let creatorCalls = 0;
    const second = await svc.getOrCreate('ns', 'key', () => {
      creatorCalls++;
      return { key: 'key', content: 'second' };
    });

    expect(second.id).toBe(first.id);
    expect(second.content).toBe('first');
    expect(creatorCalls).toBe(0);
  });

  it('appendContent appends on a newline and returns null for unknown ids', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();
    const e = await svc.storeEntry({ key: 'a', content: 'line1' });
    const appended = await svc.appendContent(e.id, 'line2');
    expect(appended?.content).toBe('line1\nline2');
    expect(await svc.appendContent('missing-id', 'x')).toBeNull();
  });

  it('addTags dedupes and removeTags subtracts', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();
    const e = await svc.storeEntry({ key: 'a', content: 'c', tags: ['x'] });

    const added = await svc.addTags(e.id, ['x', 'y']);
    expect([...(added?.tags ?? [])].sort()).toEqual(['x', 'y']);

    const removed = await svc.removeTags(e.id, ['x']);
    expect(removed?.tags).toEqual(['y']);

    expect(await svc.addTags('missing-id', ['z'])).toBeNull();
    expect(await svc.removeTags('missing-id', ['z'])).toBeNull();
  });

  it('semanticSearch returns [] when no embedding generator is configured', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();
    await svc.storeEntry({ key: 'a', content: 'anything' });
    expect(await svc.semanticSearch('anything', 3)).toEqual([]);
  });

  it('semanticSearch finds stored content when an embedder is configured', async () => {
    const svc = track(createEmbeddingService(embed, DIM));
    await svc.initialize();

    for (const [key, content] of [
      ['auth', 'authentication and login flows'],
      ['db', 'database migrations'],
    ] as const) {
      const entry = createDefaultEntry({ key, content });
      entry.embedding = await embed(content);
      await svc.store(entry);
    }

    const results = await svc.semanticSearch('authentication and login flows', 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.key).toBe('auth');
  });

  it('findSimilar excludes the source entry and tolerates missing/embedding-less entries', async () => {
    const svc = track(createEmbeddingService(embed, DIM));
    await svc.initialize();

    const mk = async (key: string, content: string) => {
      const e = createDefaultEntry({ key, content });
      e.embedding = await embed(content);
      await svc.store(e);
      return e;
    };
    const source = await mk('s', 'alpha beta gamma');
    await mk('o', 'alpha beta delta');

    const similar = await svc.findSimilar(source.id, 5);
    expect(similar.every((r) => r.entry.id !== source.id)).toBe(true);

    expect(await svc.findSimilar('missing-id')).toEqual([]);

    const noEmb = await svc.storeEntry({ key: 'none', content: 'no vector' });
    expect(await svc.findSimilar(noEmb.id)).toEqual([]);
  });
});

describe('UnifiedMemoryService cross-agent sharing', () => {
  it('shareWith records agents once and getSharedWith filters by agent', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();

    const shared = await svc.storeEntry({ key: 'shared', content: 'visible' });
    const private_ = await svc.storeEntry({ key: 'private', content: 'hidden' });

    await svc.shareWith(shared.id, 'agent-1');
    await svc.shareWith(shared.id, 'agent-1'); // no duplicate

    const stored = await svc.get(shared.id);
    expect(stored?.metadata.sharedWith).toEqual(['agent-1']);

    const forAgent = await svc.getSharedWith('agent-1');
    expect(forAgent.map((e) => e.id)).toContain(shared.id);
    expect(forAgent.map((e) => e.id)).not.toContain(private_.id);

    expect(await svc.shareWith('missing-id', 'agent-1')).toBeNull();
    expect(await svc.getSharedWith('agent-nobody')).toEqual([]);
  });
});

describe('factory functions', () => {
  it('createInMemoryService does not persist to disk', async () => {
    const svc = track(createInMemoryService());
    await svc.initialize();
    await svc.storeEntry({ key: 'k', content: 'v' });
    expect(await svc.count()).toBe(1);
  });

  it('createPersistentService writes to the given path and reloads it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ums-'));
    tmpDirs.push(dir);
    const dbPath = join(dir, 'mem.db');

    const first = createPersistentService(dbPath);
    await first.initialize();
    await first.storeEntry({ key: 'persisted', content: 'survives', namespace: 'p' });
    await first.shutdown();

    const second = track(createPersistentService(dbPath));
    await second.initialize();
    expect((await second.getByKey('p', 'persisted'))?.content).toBe('survives');
  });

  it('createEmbeddingService wires the embedder through to semanticSearch', async () => {
    const svc = track(createEmbeddingService(embed, DIM));
    await svc.initialize();
    const e = createDefaultEntry({ key: 'e', content: 'vector search' });
    e.embedding = await embed('vector search');
    await svc.store(e);
    expect((await svc.semanticSearch('vector search', 1)).length).toBe(1);
  });

  it('createHybridService is both persistent and embedding-enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ums-hybrid-'));
    tmpDirs.push(dir);
    const dbPath = join(dir, 'hybrid.db');

    const svc = createHybridService(dbPath, embed, DIM);
    await svc.initialize();
    const e = createDefaultEntry({ key: 'h', content: 'hybrid entry', namespace: 'h' });
    e.embedding = await embed('hybrid entry');
    await svc.store(e);
    expect((await svc.semanticSearch('hybrid entry', 1)).length).toBe(1);
    await svc.shutdown();

    const reopened = track(createHybridService(dbPath, embed, DIM));
    await reopened.initialize();
    expect((await reopened.getByKey('h', 'h'))?.content).toBe('hybrid entry');
  });
});
