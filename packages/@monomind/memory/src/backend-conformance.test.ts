/**
 * Backend conformance suite.
 *
 * SQLiteBackend (better-sqlite3, native) and SqlJsBackend (sql.js, WASM) both
 * implement IMemoryBackend, and `createDatabase()` picks between them based on
 * whether the native binary loads. That makes them interchangeable in principle
 * — so any behavioural difference is a bug that only shows up on the machines
 * that fall back to WASM (typically Windows without a build toolchain), which
 * are exactly the machines least likely to be running these tests.
 *
 * They had already drifted. `MemoryQuery.tags` is documented in types.ts as
 * "entries must have all specified tags", but SQLiteBackend implemented it as
 * `t.tag IN (...)` inside an EXISTS — which matches entries having ANY of the
 * tags. The same query returned different result sets depending on which driver
 * loaded. SqlJsBackend also accepted tag values that SQLiteBackend rejects, so
 * whether a store succeeded depended on the driver too.
 *
 * This suite runs identical assertions against both so that class of drift
 * fails CI instead of shipping. Add new backend behaviour here, not to a
 * single-backend test file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteBackend } from './sqlite-backend.js';
import { SqlJsBackend } from './sqljs-backend.js';
import { createDefaultEntry } from './types.js';
import type { IMemoryBackend } from './types.js';

interface BackendCase {
  name: string;
  create: () => IMemoryBackend;
}

const BACKENDS: BackendCase[] = [
  {
    name: 'SQLiteBackend (better-sqlite3)',
    create: () => new SQLiteBackend({ databasePath: ':memory:', walMode: false, verbose: false }),
  },
  {
    name: 'SqlJsBackend (sql.js WASM)',
    create: () => new SqlJsBackend({ databasePath: ':memory:', verbose: false }),
  },
];

for (const backendCase of BACKENDS) {
  describe(`backend conformance — ${backendCase.name}`, () => {
    let backend: IMemoryBackend;

    beforeEach(async () => {
      backend = backendCase.create();
      await backend.initialize();
    });

    afterEach(async () => {
      await backend.shutdown();
    });

    async function store(key: string, tags: string[], namespace = 'conformance') {
      const entry = createDefaultEntry({ key, content: `content for ${key}`, namespace, tags });
      await backend.store(entry);
      return entry;
    }

    // ---- Tag filtering semantics ----------------------------------------
    // types.ts: "Tag filters (entries must have all specified tags)"

    describe('tag filtering requires ALL specified tags', () => {
      beforeEach(async () => {
        await store('has-both', ['alpha', 'beta']);
        await store('has-alpha-only', ['alpha']);
        await store('has-beta-only', ['beta']);
        await store('has-neither', ['gamma']);
      });

      it('returns only entries carrying every requested tag', async () => {
        const results = await backend.query({ namespace: 'conformance', tags: ['alpha', 'beta'] });
        const keys = results.map((r) => r.key).sort();
        expect(keys).toEqual(['has-both']);
      });

      it('a single tag filter matches every entry carrying it', async () => {
        const results = await backend.query({ namespace: 'conformance', tags: ['alpha'] });
        expect(results.map((r) => r.key).sort()).toEqual(['has-alpha-only', 'has-both']);
      });

      it('an unmatched tag in the set excludes the entry', async () => {
        const results = await backend.query({ namespace: 'conformance', tags: ['alpha', 'nonexistent'] });
        expect(results).toEqual([]);
      });

      it('no tag filter returns everything in the namespace', async () => {
        const results = await backend.query({ namespace: 'conformance' });
        expect(results).toHaveLength(4);
      });
    });

    // ---- Tag validation parity ------------------------------------------

    describe('tag validation', () => {
      // Allowed charset is [a-zA-Z0-9_-.:/~ ] — spaces ARE valid, so '!' is
      // the discriminator here; a space-containing tag would wrongly pass.
      it('rejects a tag outside the allowed charset rather than storing it', async () => {
        const entry = createDefaultEntry({
          key: 'bad-tag',
          content: 'x',
          namespace: 'conformance',
          tags: ['bad!tag'],
        });
        await expect(backend.store(entry)).rejects.toThrow();
      });

      it('rejects a tag containing a control character', async () => {
        const entry = createDefaultEntry({
          key: 'ctrl-tag',
          content: 'x',
          namespace: 'conformance',
          tags: ['has' + String.fromCharCode(1) + 'ctrl'],
        });
        await expect(backend.store(entry)).rejects.toThrow();
      });

      it('accepts a tag containing ordinary spaces', async () => {
        const entry = createDefaultEntry({
          key: 'space-tag',
          content: 'x',
          namespace: 'conformance',
          tags: ['contains ordinary spaces'],
        });
        await expect(backend.store(entry)).resolves.not.toThrow();
      });

      it('accepts src: provenance tags containing path characters', async () => {
        const entry = createDefaultEntry({
          key: 'src-tag',
          content: 'x',
          namespace: 'conformance',
          tags: ['src:/Users/someone/My Project (v2)/file.ts'],
        });
        await expect(backend.store(entry)).resolves.not.toThrow();
      });
    });

    // ---- Core CRUD parity -------------------------------------------------

    describe('core operations', () => {
      it('round-trips an entry by key within a namespace', async () => {
        await store('roundtrip', ['t1']);
        const found = await backend.getByKey('conformance', 'roundtrip');
        expect(found?.key).toBe('roundtrip');
        expect(found?.tags).toContain('t1');
      });

      it('treats namespace as an isolation boundary', async () => {
        await store('shared-key', ['t1'], 'ns-a');
        await store('shared-key', ['t2'], 'ns-b');
        const a = await backend.getByKey('ns-a', 'shared-key');
        const b = await backend.getByKey('ns-b', 'shared-key');
        expect(a?.tags).toContain('t1');
        expect(b?.tags).toContain('t2');
      });

      it('re-storing the same namespace+key updates rather than duplicating', async () => {
        await store('dup', ['first']);
        await store('dup', ['second']);
        const all = await backend.query({ namespace: 'conformance' });
        expect(all.filter((e) => e.key === 'dup')).toHaveLength(1);
      });

      it('deletes an entry by id', async () => {
        const entry = await store('to-delete', ['t']);
        expect(await backend.delete(entry.id)).toBe(true);
        expect(await backend.getByKey('conformance', 'to-delete')).toBeNull();
      });

      it('counts entries in a namespace', async () => {
        await store('c1', ['t']);
        await store('c2', ['t']);
        expect(await backend.count('conformance')).toBe(2);
      });

      it('round-trips an embedding without corruption', async () => {
        const embedding = new Float32Array([0.5, -0.25, 0.125, 1]);
        const entry = createDefaultEntry({
          key: 'with-embedding',
          content: 'x',
          namespace: 'conformance',
          tags: [],
        });
        entry.embedding = embedding;
        await backend.store(entry);

        const found = await backend.getByKey('conformance', 'with-embedding');
        expect(found?.embedding).toBeDefined();
        expect(Array.from(found!.embedding!)).toEqual(Array.from(embedding));
      });
    });
  });
}
