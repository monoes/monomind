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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteBackend } from './sqlite-backend.js';
import { SqlJsBackend } from './sqljs-backend.js';
import type { IMemoryBackend, MemoryEntry } from './types.js';
import { createDefaultEntry } from './types.js';

/** storeIfVersion/storeIfAbsent (K5) are SqlBackend-only additions, not part
 *  of IMemoryBackend — both concrete backends here extend SqlBackend, so both
 *  have them; this local type just gives the tests below a typed handle. */
interface CasBackend extends IMemoryBackend {
  storeIfVersion(entry: MemoryEntry, expectedVersion: number): Promise<boolean>;
  storeIfAbsent(entry: MemoryEntry): Promise<boolean>;
}

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
        const results = await backend.query({
          namespace: 'conformance',
          tags: ['alpha', 'nonexistent'],
        });
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
          tags: [`has${String.fromCharCode(1)}ctrl`],
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
        expect(Array.from(found?.embedding!)).toEqual(Array.from(embedding));
      });
    });

    // ---- Compare-and-swap primitives (K5) --------------------------------
    // memory-KG review 2026-09-05: a getByKey() + store() read-merge-write has
    // no atomicity guarantee, so two concurrent callers merging onto (or
    // creating) the same row can silently lose one's update. These are the
    // single-statement SQL primitives memory-kg.ts's claim-ledger merge is
    // built on to detect that instead.
    describe('compare-and-swap primitives (K5)', () => {
      it('storeIfAbsent creates a row that did not exist yet', async () => {
        const entry = createDefaultEntry({
          key: 'cas-new',
          content: 'first',
          namespace: 'conformance',
          tags: [],
        });
        const created = await (backend as CasBackend).storeIfAbsent(entry);
        expect(created).toBe(true);
        expect((await backend.getByKey('conformance', 'cas-new'))?.content).toBe('first');
      });

      it('storeIfAbsent refuses a row a concurrent writer already created at the same key', async () => {
        const first = createDefaultEntry({
          key: 'cas-race',
          content: 'winner',
          namespace: 'conformance',
          tags: [],
        });
        await (backend as CasBackend).storeIfAbsent(first);

        // A second caller minted a DIFFERENT random row id for the same
        // deterministic namespace+key — exactly what two concurrent creators
        // of the same new KG entity do.
        const second = createDefaultEntry({
          key: 'cas-race',
          content: 'loser',
          namespace: 'conformance',
          tags: [],
        });
        const created = await (backend as CasBackend).storeIfAbsent(second);

        expect(created).toBe(false);
        expect((await backend.getByKey('conformance', 'cas-race'))?.content).toBe('winner');
      });

      it('storeIfVersion writes only when the row is still at the expected version', async () => {
        const entry = await store('cas-versioned', ['t']);
        const casBackend = backend as CasBackend;

        const stale = await casBackend.storeIfVersion(
          { ...entry, content: 'stale-write', version: 2 },
          99,
        );
        expect(stale).toBe(false);
        expect((await backend.getByKey('conformance', 'cas-versioned'))?.content).toBe(
          'content for cas-versioned',
        );

        const fresh = await casBackend.storeIfVersion(
          { ...entry, content: 'fresh-write', version: 2 },
          1,
        );
        expect(fresh).toBe(true);
        expect((await backend.getByKey('conformance', 'cas-versioned'))?.content).toBe(
          'fresh-write',
        );
      });
    });
  });
}
