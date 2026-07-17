import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';

// The real memory store tries a LanceDB bridge first (ADR-053) before
// falling back to sql.js. The bridge lazily reaches out to @monoes/memory
// (real embedder init, filesystem state under the user's home directory) —
// exactly the kind of external dependency that should be mocked out while
// everything else (sql.js storage, real temp-dir filesystem, real command
// actions) stays real. Neutralizing the bridge functions forces every code
// path onto the deterministic sql.js + hash-embedding fallback.
vi.mock('../memory/memory-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../memory/memory-bridge.js')>();
  return {
    ...actual,
    bridgeStoreEntry: async () => null,
    bridgeListEntries: async () => null,
    bridgeGetEntry: async () => null,
    bridgeGenerateEmbedding: async () => null,
    bridgeLoadEmbeddingModel: async () => null,
    getControllerRegistry: async () => null,
  };
});

import { listCommand, editCommand, templatesCommand, formatRelativeTime } from '../commands/memory-list.js';

function makeCtx(flags: Record<string, unknown> = {}, args: string[] = [], cwd: string = process.cwd()): CommandContext {
  return { args, flags: { _: [], ...flags } as CommandContext['flags'], cwd, interactive: false };
}

async function run(cmd: Command, ctx: CommandContext): Promise<CommandResult> {
  return (await cmd.action!(ctx)) as CommandResult;
}

describe('memory-list commands', () => {
  let dir: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'memory-list-test-'));
    originalCwd = process.cwd;
    process.cwd = () => dir;

    const { initializeMemoryDatabase } = await import('../memory/memory-initializer.js');
    const init = await initializeMemoryDatabase({ backend: 'hybrid' });
    expect(init.success).toBe(true);
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  async function seed(key: string, value: string, namespace = 'default', tags: string[] = []) {
    const { storeEntry } = await import('../memory/memory-initializer.js');
    const result = await storeEntry({ key, value, namespace, generateEmbeddingFlag: false, tags });
    expect(result.success).toBe(true);
    return result;
  }

  describe('formatRelativeTime', () => {
    it('formats elapsed time in the largest applicable unit', () => {
      const now = Date.now();
      expect(formatRelativeTime(new Date(now).toISOString())).toBe('just now');
      expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
      expect(formatRelativeTime(new Date(now - 3 * 60 * 60_000).toISOString())).toBe('3h ago');
      expect(formatRelativeTime(new Date(now - 2 * 24 * 60 * 60_000).toISOString())).toBe('2d ago');
    });
  });

  describe('listCommand', () => {
    it('returns an empty list — not an error — when the store has no entries', async () => {
      const result = await run(listCommand, makeCtx({ limit: 20 }));
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('lists seeded entries across namespaces and filters by namespace', async () => {
      await seed('alpha', 'value-a', 'ns1');
      await seed('beta', 'value-b', 'ns1');
      await seed('gamma', 'value-c', 'ns2');

      const all = await run(listCommand, makeCtx({ limit: 20 }));
      expect(all.success).toBe(true);
      expect((all.data as Array<{ key: string }>).length).toBe(3);

      const filtered = await run(listCommand, makeCtx({ namespace: 'ns1', limit: 20 }));
      expect(filtered.success).toBe(true);
      const entries = filtered.data as Array<{ key: string; namespace: string }>;
      expect(entries.map((e) => e.key).sort()).toEqual(['alpha', 'beta']);
      expect(entries.every((e) => e.namespace === 'ns1')).toBe(true);
    });

    it('respects the limit option', async () => {
      for (let i = 0; i < 5; i++) await seed(`key-${i}`, `value-${i}`, 'ns-limit');

      const result = await run(listCommand, makeCtx({ namespace: 'ns-limit', limit: 2 }));
      expect(result.success).toBe(true);
      expect((result.data as unknown[]).length).toBe(2);
    });

    it('emits JSON-formatted output when --format json is requested', async () => {
      await seed('json-key', 'json-value', 'ns-json');
      const result = await run(listCommand, makeCtx({ namespace: 'ns-json', limit: 20, format: 'json' }));
      expect(result.success).toBe(true);
      expect((result.data as Array<{ key: string }>)[0].key).toBe('json-key');
    });
  });

  describe('editCommand', () => {
    // Regression test: storeEntry's sql.js fallback used to always mint a
    // fresh row id, even with upsert:true (INSERT OR REPLACE only replaces
    // on an id collision) — editCommand's write succeeded but left a second
    // row behind for the same key/namespace instead of truly replacing the
    // original. Fixed by having storeEntry look up the existing row's real
    // id by key+namespace first when upserting.
    it('performs a real write for a lancedb-backed edit, replacing the row in place (not appending)', async () => {
      await seed('edit-me', 'original value', 'default');
      const before = await run(listCommand, makeCtx({ namespace: 'default', limit: 20 }));
      expect((before.data as unknown[]).length).toBe(1);

      const result = await run(editCommand, makeCtx({ key: 'edit-me', namespace: 'default', value: 'updated value' }));
      expect(result.success).toBe(true);

      const after = await run(listCommand, makeCtx({ namespace: 'default', limit: 20 }));
      expect((after.data as unknown[]).length).toBe(1);
      // listEntries only returns a `size` (content length), not the content
      // itself — 'updated value' (14 chars) vs. the seeded 'original value' (15).
      expect((after.data as Array<{ size?: number }>)[0].size).toBe('updated value'.length);
    });

    it('errors when key is missing for the lancedb source', async () => {
      const result = await run(editCommand, makeCtx({ value: 'x' }));
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('errors when value is missing (non-interactive)', async () => {
      await seed('needs-value', 'orig', 'default');
      const result = await run(editCommand, makeCtx({ key: 'needs-value' }));
      expect(result.success).toBe(false);
    });

    it('edits a palace JSONL entry on disk', async () => {
      const palaceDir = join(dir, '.monomind', 'palace');
      mkdirSync(palaceDir, { recursive: true });
      const filePath = join(palaceDir, 'drawers.jsonl');
      writeFileSync(filePath, `${JSON.stringify({ id: 'drawer-1', content: 'old content' })}\n`);

      const result = await run(editCommand, makeCtx({ source: 'palace', id: 'drawer-1', value: 'new content' }));
      expect(result.success).toBe(true);

      const written = readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(written).toHaveLength(1);
      expect(written[0].content).toBe('new content');
      expect(written[0].id).toBe('drawer-1');
    });

    it('rejects an invalid id for a palace edit', async () => {
      const result = await run(editCommand, makeCtx({ source: 'palace', id: 'bad id!', value: 'x' }));
      expect(result.success).toBe(false);
    });

    it('reports failure for a missing palace id', async () => {
      const palaceDir = join(dir, '.monomind', 'palace');
      mkdirSync(palaceDir, { recursive: true });
      writeFileSync(join(palaceDir, 'drawers.jsonl'), `${JSON.stringify({ id: 'other', content: 'x' })}\n`);

      const result = await run(editCommand, makeCtx({ source: 'palace', id: 'missing-id', value: 'y' }));
      expect(result.success).toBe(false);
    });

    it('errors when the palace/knowledge file does not exist', async () => {
      const result = await run(editCommand, makeCtx({ source: 'knowledge', id: 'anything', value: 'y' }));
      expect(result.success).toBe(false);
    });
  });

  describe('templatesCommand', () => {
    it('succeeds for a known type', async () => {
      const result = await run(templatesCommand, makeCtx({ type: 'feedback' }));
      expect(result.success).toBe(true);
    });

    it('fails for an unknown type', async () => {
      const result = await run(templatesCommand, makeCtx({ type: 'bogus' }));
      expect(result.success).toBe(false);
    });

    it('succeeds with no filter and shows all templates', async () => {
      const result = await run(templatesCommand, makeCtx({}));
      expect(result.success).toBe(true);
    });
  });
});
