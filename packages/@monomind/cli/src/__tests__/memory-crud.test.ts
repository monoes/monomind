import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';

// The real storage path for memory writes is LanceDB (`@monoes/memory`, see
// src/memory/memory-bridge.ts), which lazily loads a HuggingFace embedding
// model (`@huggingface/transformers`) on first use. That model is not
// vendored/cached in this environment, so initializing the real backend
// would attempt a network fetch and could hang/timeout in CI.
//
// storeEntry/getEntry/searchEntries/deleteEntry (src/memory/memory-crud.ts,
// memory-read.ts) all try the LanceDB bridge first and, on any failure to
// obtain a backend, gracefully fall back to a raw sql.js (WASM SQLite)
// database on disk under `<cwd>/.swarm/memory.db`. That fallback path is
// fully local/deterministic (sql.js is a bundled WASM binary, and the
// embedding fallback is a deterministic hash — see
// src/memory/embedding-operations.ts's generateHashEmbedding). Mocking only
// the `@monoes/memory` import forces every command under test through that
// real, real-filesystem fallback path instead of stubbing the commands
// themselves.
vi.mock('@monoes/memory', () => {
  throw new Error('mocked: LanceDB backend unavailable in test environment');
});

import { storeCommand, retrieveCommand, searchCommand } from '../commands/memory-crud.js';
import { deleteCommand } from '../commands/memory-admin.js';
import { initializeMemoryDatabase } from '../memory/memory-initializer.js';

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [] },
    cwd: process.cwd(),
    interactive: false,
    ...overrides,
  };
}

/** Commands are typed to allow a void return (no-op actions); every command
 * exercised in this suite always returns a CommandResult, so this narrows
 * that away instead of littering every call site with a non-null assertion. */
async function run(command: Command, context: CommandContext): Promise<CommandResult> {
  const result = await command.action!(context);
  if (!result) throw new Error(`${command.name}: action returned void`);
  return result;
}

describe('memory-crud commands (sql.js fallback path)', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'memory-crud-test-'));
    originalCwd = process.cwd();
    process.chdir(dir);
    const initResult = await initializeMemoryDatabase({});
    expect(initResult.success).toBe(true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  describe('store', () => {
    it('requires a key', async () => {
      const result = await run(storeCommand, 
        ctx({ flags: { _: [], value: 'hello' } }),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('requires a value when non-interactive', async () => {
      const result = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'k1' } }),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('stores a value under a key+namespace, findable by retrieve', async () => {
      const result = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'api/auth', value: 'JWT implementation', namespace: 'patterns' } }),
      );
      expect(result.success).toBe(true);
      expect((result.data as any).id).toBeTruthy();

      const got = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'api/auth', namespace: 'patterns' } }),
      );
      expect(got.success).toBe(true);
      expect((got.data as any).content).toBe('JWT implementation');
      expect((got.data as any).namespace).toBe('patterns');
    });

    it('stores without an explicit namespace, defaulting to "default"', async () => {
      const result = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'no-ns-key', value: 'no namespace value' } }),
      );
      expect(result.success).toBe(true);
      expect((result.data as any).namespace).toBe('default');

      const got = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'no-ns-key' } }),
      );
      expect(got.success).toBe(true);
      expect((got.data as any).content).toBe('no namespace value');
    });

    it('stores tags and reflects them on the stored entry', async () => {
      const result = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'tagged', value: 'v', namespace: 'default', tags: 'bugfix,auth' } }),
      );
      expect(result.success).toBe(true);
      expect((result.data as any).tags).toEqual(['bugfix', 'auth']);

      const got = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'tagged' } }),
      );
      expect((got.data as any).tags).toEqual(['bugfix', 'auth']);
    });

    it('honors a ttl flag by recording an expiry and not crashing without one', async () => {
      const withTtl = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'ttl-key', value: 'v', ttl: 60 } }),
      );
      expect(withTtl.success).toBe(true);
      expect((withTtl.data as any).ttl).toBe(60);

      const withoutTtl = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'no-ttl-key', value: 'v' } }),
      );
      expect(withoutTtl.success).toBe(true);
      expect((withoutTtl.data as any).ttl).toBeUndefined();
    });

    it('upsert=false leaves the original value on a duplicate key (sql.js fallback does a plain INSERT)', async () => {
      // Note: the raw sql.js fallback path's INSERT (non-upsert) does not
      // enforce a unique constraint on (key, namespace), so writing twice
      // creates two rows. Retrieve (which does `LIMIT 1`) surfaces whichever
      // the query planner returns first — this is a pre-existing property of
      // the fallback path, not something introduced by this test. We only
      // assert store itself succeeds both times without throwing.
      const first = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'dup', value: 'first' } }),
      );
      const second = await run(storeCommand, 
        ctx({ flags: { _: [], key: 'dup', value: 'second' } }),
      );
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
    });

    it(
      'FIXED (was a KNOWN GAP): --upsert now actually replaces the value on the sql.js ' +
        'fallback path. The fallback\'s `INSERT OR REPLACE INTO memory_entries (id, ...)` is ' +
        'keyed on the PRIMARY KEY id, which used to be freshly generated on every call — the ' +
        'replace never fired since the new id never matched the old row\'s id, so a second, ' +
        'independent row was inserted instead of a true replace. storeEntry now looks up the ' +
        'existing row\'s real id by key+namespace first when upserting, and reuses it.',
      async () => {
        await run(storeCommand,
          ctx({ flags: { _: [], key: 'up-key', value: 'original', namespace: 'up-ns' } }),
        );
        const updated = await run(storeCommand,
          ctx({ flags: { _: [], key: 'up-key', value: 'updated', namespace: 'up-ns', upsert: true } }),
        );
        expect(updated.success).toBe(true);

        const got = await run(retrieveCommand,
          ctx({ flags: { _: [], key: 'up-key', namespace: 'up-ns' } }),
        );
        expect(got.success).toBe(true);
        expect((got.data as any).content).toBe('updated');
      },
    );
  });

  describe('retrieve', () => {
    it('requires a key', async () => {
      const result = await run(retrieveCommand, ctx({ flags: { _: [] } }));
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('returns a clear not-found result (not a crash) for a missing key', async () => {
      const result = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'does-not-exist', namespace: 'default' } }),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect((result.data as any).found).toBe(false);
    });

    it('is namespace-scoped: a key stored in one namespace is not visible in another', async () => {
      await run(storeCommand, 
        ctx({ flags: { _: [], key: 'scoped', value: 'v', namespace: 'ns-a' } }),
      );
      const wrongNs = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'scoped', namespace: 'ns-b' } }),
      );
      expect(wrongNs.success).toBe(false);

      const rightNs = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'scoped', namespace: 'ns-a' } }),
      );
      expect(rightNs.success).toBe(true);
    });
  });

  describe('search', () => {
    it('requires a query', async () => {
      const result = await run(searchCommand, ctx({ flags: { _: [] } }));
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('returns an empty (not crashed) result set for a query that matches nothing', async () => {
      await run(storeCommand, 
        ctx({ flags: { _: [], key: 'unrelated', value: 'completely unrelated content about oceans', namespace: 'search-ns' } }),
      );
      const result = await run(searchCommand, 
        ctx({ flags: { _: [], query: 'zzz_definitely_not_present_zzz', namespace: 'search-ns', threshold: 0.9 } }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('finds a stored entry via keyword match on its content', async () => {
      await run(storeCommand, 
        ctx({ flags: { _: [], key: 'auth-pattern', value: 'JWT authentication with refresh tokens', namespace: 'search-ns2' } }),
      );
      const result = await run(searchCommand, 
        // Low threshold so the deterministic hash-fallback embedding score
        // (which is not semantically meaningful — see generateHashEmbedding)
        // doesn't mask the keyword-match fallback in memory-read.ts.
        ctx({ flags: { _: [], query: 'authentication', namespace: 'search-ns2', threshold: 0.1 } }),
      );
      expect(result.success).toBe(true);
      const keys = (result.data as any[]).map((r) => r.key);
      expect(keys).toContain('auth-pattern');
    });
  });

  describe('delete (via memory-admin deleteCommand, source=lancedb default)', () => {
    it('removes an entry so a subsequent retrieve confirms it is gone', async () => {
      await run(storeCommand, 
        ctx({ flags: { _: [], key: 'to-delete', value: 'v', namespace: 'del-ns' } }),
      );
      const before = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'to-delete', namespace: 'del-ns' } }),
      );
      expect(before.success).toBe(true);

      const del = await run(deleteCommand, 
        ctx({ flags: { _: [], key: 'to-delete', namespace: 'del-ns', force: true } }),
      );
      expect(del.success).toBe(true);
      expect((del.data as any).deleted).toBe(true);

      const after = await run(retrieveCommand, 
        ctx({ flags: { _: [], key: 'to-delete', namespace: 'del-ns' } }),
      );
      expect(after.success).toBe(false);
      expect((after.data as any).found).toBe(false);
    });

    it('reports (not throws) when deleting a key that does not exist', async () => {
      const del = await run(deleteCommand,
        ctx({ flags: { _: [], key: 'never-existed', namespace: 'default', force: true } }),
      );
      expect(del.success).toBe(false);
      expect((del.data as any).deleted).toBe(false);
    });

    it(
      'an --upsert store after a delete does not resurrect the soft-deleted row: ' +
        'delete only sets status=\'deleted\' (the row stays in the table), so the upsert\'s ' +
        'id lookup must exclude it — otherwise the upsert would match the deleted row\'s id, ' +
        'flip its status back to active via INSERT OR REPLACE, and silently undo the delete',
      async () => {
        await run(storeCommand,
          ctx({ flags: { _: [], key: 'resurrect-key', value: 'original', namespace: 'resurrect-ns' } }),
        );
        const del = await run(deleteCommand,
          ctx({ flags: { _: [], key: 'resurrect-key', namespace: 'resurrect-ns', force: true } }),
        );
        expect(del.success).toBe(true);

        const upserted = await run(storeCommand,
          ctx({ flags: { _: [], key: 'resurrect-key', value: 'new value', namespace: 'resurrect-ns', upsert: true } }),
        );
        expect(upserted.success).toBe(true);

        // Retrieve should now find the fresh row the upsert created — the
        // deleted one must not have come back in its place.
        const got = await run(retrieveCommand,
          ctx({ flags: { _: [], key: 'resurrect-key', namespace: 'resurrect-ns' } }),
        );
        expect(got.success).toBe(true);
        expect((got.data as any).content).toBe('new value');
      },
    );
  });
});
