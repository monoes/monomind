/**
 * `deleteByKeyPrefix` conformance — the backend primitive behind Second Brain
 * item 4 ("delete superseded chunks").
 *
 * Why this exists
 * ---------------
 * Document chunks are keyed `doc:<contentHash>:<chunkIndex>`. Re-ingesting a
 * changed file mints a NEW contentHash, so its chunks land under new keys and
 * the previous version's rows are simply orphaned — nothing ever deletes them.
 * Measured on this repo's own store on 2026-07-28: 11,465 `doc:`-keyed rows in
 * `knowledge:shared`, of which 617 were current. 10,848 rows (94.6%) were dead
 * versions, up from 94.2% two days earlier. Every one of them is cosine-scored
 * on every query and then filtered out.
 *
 * The fix needs exactly one new backend capability: delete every entry whose
 * key starts with a given prefix, within one namespace. That is what this
 * suite pins down.
 *
 * It runs against BOTH drivers deliberately. `createDatabase()` picks
 * SQLiteBackend or SqlJsBackend based on whether the native binary loads, so a
 * difference between them is a bug that only manifests on the machines least
 * likely to run these tests. (This is not hypothetical: the tag-filter
 * semantics in backend-conformance.test.ts had already drifted between the
 * two.) It matters more than usual here — a delete that behaves differently
 * per driver corrupts stores rather than merely returning odd results.
 *
 * THE INCIDENT THIS GUARDS AGAINST
 * --------------------------------
 * An over-broad prefix is the one way item 4 turns from cheapest win into worst
 * incident. `doc:` deletes every document in the store. A prefix carrying a SQL
 * LIKE metacharacter (`%`, `_`) silently widens the match. Both are tested
 * below and both must be impossible by construction, not by caller discipline.
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

/** Deterministic unit vector so search() has something real to score. */
function vec(seed: number, dims = 8): Float32Array {
  const v = new Float32Array(dims);
  for (let i = 0; i < dims; i++) v[i] = Math.sin(seed + i);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) v[i] /= norm;
  return v;
}

// ─── STAGED RED — skipped until item 4 lands ──────────────────────────────
// These pin the contract for `markSupersededByKeyPrefix` / `deleteByKeyPrefix`,
// which do not exist yet. They are skipped so one author's red tests do not
// become every other role's red test run. Un-skip in the commit that
// implements them.
for (const backendCase of BACKENDS) {
  describe.skip(`deleteByKeyPrefix — ${backendCase.name}`, () => {
    let backend: IMemoryBackend & {
      deleteByKeyPrefix?(namespace: string, prefix: string): Promise<number>;
    };

    beforeEach(async () => {
      backend = backendCase.create() as typeof backend;
      await backend.initialize();
    });

    afterEach(async () => {
      await backend.shutdown();
    });

    async function store(
      key: string,
      namespace = 'knowledge:shared',
      embedding?: Float32Array,
    ) {
      const entry = createDefaultEntry({ key, content: `content for ${key}`, namespace });
      if (embedding) (entry as { embedding?: Float32Array }).embedding = embedding;
      await backend.store(entry);
      return entry;
    }

    /** Keys currently present in a namespace, sorted. */
    async function keysIn(namespace: string): Promise<string[]> {
      const rows = await backend.query({ type: 'exact' as never, namespace, limit: 10_000 });
      return rows.map((r) => r.key).sort();
    }

    // ---- The capability exists at all ------------------------------------

    it.skip('is implemented on the backend interface', () => {
      expect(
        typeof backend.deleteByKeyPrefix,
        'deleteByKeyPrefix must exist on every IMemoryBackend implementation — ' +
          'a delete path that exists on only one driver is worse than none',
      ).toBe('function');
    });

    // ---- Core semantics ---------------------------------------------------

    describe('deletes exactly the matching prefix', () => {
      beforeEach(async () => {
        // Two versions of one document, plus an unrelated document.
        await store('doc:oldhash:0');
        await store('doc:oldhash:1');
        await store('doc:oldhash:2');
        await store('doc:newhash:0');
        await store('doc:newhash:1');
        await store('doc:otherdoc:0');
        await store('pattern:oldhash:0'); // not a document chunk at all
      });

      it.skip('removes every chunk of the superseded version and nothing else', async () => {
        const deleted = await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:oldhash:');
        expect(deleted).toBe(3);
        expect(await keysIn('knowledge:shared')).toEqual([
          'doc:newhash:0',
          'doc:newhash:1',
          'doc:otherdoc:0',
          'pattern:oldhash:0',
        ]);
      });

      it.skip('matches only at the START of the key, never as a substring', async () => {
        // 'oldhash:' appears inside 'pattern:oldhash:0' but not at position 0.
        await backend.deleteByKeyPrefix!('knowledge:shared', 'oldhash:');
        expect(await keysIn('knowledge:shared')).toContain('pattern:oldhash:0');
      });

      it.skip('reports the number of rows actually deleted', async () => {
        expect(await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:newhash:')).toBe(2);
        expect(await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:newhash:')).toBe(0);
      });

      it.skip('is idempotent — deleting an already-deleted prefix is a no-op, not an error', async () => {
        await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:oldhash:');
        await expect(
          backend.deleteByKeyPrefix!('knowledge:shared', 'doc:oldhash:'),
        ).resolves.toBe(0);
      });

      it.skip('a prefix matching nothing leaves the store untouched', async () => {
        const before = await keysIn('knowledge:shared');
        expect(await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:nosuchhash:')).toBe(0);
        expect(await keysIn('knowledge:shared')).toEqual(before);
      });
    });

    // ---- Namespace scoping ------------------------------------------------

    it.skip('never crosses a namespace boundary', async () => {
      await store('doc:samehash:0', 'knowledge:shared');
      await store('doc:samehash:0', 'knowledge:global');
      await store('doc:samehash:1', 'knowledge:global');

      const deleted = await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:samehash:');

      expect(deleted).toBe(1);
      expect(await keysIn('knowledge:shared')).toEqual([]);
      // The global brain is a separate store surface; a project re-ingest must
      // never reach into it.
      expect(await keysIn('knowledge:global')).toEqual(['doc:samehash:0', 'doc:samehash:1']);
    });

    // ---- Embeddings must go too -------------------------------------------

    it.skip('deletes the embedding rows, not just the entries', async () => {
      await store('doc:oldhash:0', 'knowledge:shared', vec(1));
      await store('doc:oldhash:1', 'knowledge:shared', vec(2));
      await store('doc:newhash:0', 'knowledge:shared', vec(3));

      // Sanity: all three are scored before the delete.
      const before = await backend.search(vec(1), { k: 10, filters: { namespace: 'knowledge:shared' } as never });
      expect(before).toHaveLength(3);

      await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:oldhash:');

      // The whole point of item 4: dead vectors stop being cosine-scored.
      // An orphaned memory_embeddings row would keep costing us on every query
      // even though its entry is gone.
      const after = await backend.search(vec(1), { k: 10, filters: { namespace: 'knowledge:shared' } as never });
      expect(after.map((r) => r.entry.key)).toEqual(['doc:newhash:0']);
    });

    // ---- Guards against the catastrophic case -----------------------------

    describe('refuses prefixes that could wipe live data', () => {
      beforeEach(async () => {
        await store('doc:aaa:0');
        await store('doc:bbb:0');
        await store('note:ccc:0');
      });

      it.skip('rejects an empty prefix instead of deleting the namespace', async () => {
        await expect(backend.deleteByKeyPrefix!('knowledge:shared', '')).rejects.toThrow();
        expect(await keysIn('knowledge:shared')).toHaveLength(3);
      });

      it.skip('rejects a whitespace-only prefix', async () => {
        await expect(backend.deleteByKeyPrefix!('knowledge:shared', '   ')).rejects.toThrow();
        expect(await keysIn('knowledge:shared')).toHaveLength(3);
      });

      it.skip('treats LIKE metacharacters literally — `%` must not widen the match', async () => {
        // If the implementation interpolates into LIKE without escaping, this
        // deletes every doc chunk in the namespace. It must instead match the
        // literal key prefix "doc:%" — which nothing has — and delete nothing.
        const deleted = await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:%');
        expect(deleted).toBe(0);
        expect(await keysIn('knowledge:shared')).toEqual(['doc:aaa:0', 'doc:bbb:0', 'note:ccc:0']);
      });

      it.skip('treats `_` as a literal character, not a single-char wildcard', async () => {
        // Unescaped, "doc_aaa:" LIKE-matches "doc:aaa:" and deletes it.
        const deleted = await backend.deleteByKeyPrefix!('knowledge:shared', 'doc_aaa:');
        expect(deleted).toBe(0);
        expect(await keysIn('knowledge:shared')).toContain('doc:aaa:0');
      });

      it.skip('does not treat a backslash in the prefix as an escape character', async () => {
        await store('doc:a\\b:0');
        const deleted = await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:a\\b:');
        expect(deleted).toBe(1);
      });
    });

    // ---- Scale ------------------------------------------------------------

    it.skip('deletes a realistic superseded version in one call', async () => {
      // A large markdown file chunks into the low hundreds; the real store had
      // 10,848 dead rows across ~840 dead hashes.
      for (let i = 0; i < 250; i++) await store(`doc:bulkhash:${i}`);
      await store('doc:livehash:0');

      expect(await backend.deleteByKeyPrefix!('knowledge:shared', 'doc:bulkhash:')).toBe(250);
      expect(await keysIn('knowledge:shared')).toEqual(['doc:livehash:0']);
    });
  });
}
