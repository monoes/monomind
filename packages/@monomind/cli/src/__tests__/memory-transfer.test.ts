import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';

// See memory-list.test.ts for rationale: neutralize the LanceDB bridge (the
// only external/native dependency reachable from these commands) so storage
// falls through to the real sql.js + hash-embedding path. Nothing else is
// mocked — export/import genuinely read and write real files on disk.
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

import { exportCommand, importCommand } from '../commands/memory-transfer.js';

function makeCtx(flags: Record<string, unknown> = {}, args: string[] = [], cwd: string = process.cwd()): CommandContext {
  return { args, flags: { _: [], ...flags } as CommandContext['flags'], cwd, interactive: false };
}

async function run(cmd: Command, ctx: CommandContext): Promise<CommandResult> {
  return (await cmd.action!(ctx)) as CommandResult;
}

describe('memory-transfer commands', () => {
  let dir: string;
  let originalCwd: () => string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'memory-transfer-test-'));
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

  describe('exportCommand', () => {
    it('requires an output path', async () => {
      const result = await run(exportCommand, makeCtx({}));
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('rejects formats other than the only implemented one (okf)', async () => {
      const result = await run(exportCommand, makeCtx({ output: join(dir, 'out'), format: 'json' }));
      expect(result.success).toBe(false);
    });

    it('writes an OKF bundle of .md files with YAML frontmatter', async () => {
      await seed('auth-pattern', 'JWT with refresh tokens', 'patterns', ['auth', 'jwt']);
      await seed('other', 'plain note', 'notes');

      const outDir = join(dir, 'export-out');
      const result = await run(exportCommand, makeCtx({ output: outDir, format: 'okf' }));
      expect(result.success).toBe(true);
      expect((result.data as { written: number }).written).toBe(2);

      const mdPath = join(outDir, 'patterns', 'auth-pattern.md');
      expect(existsSync(mdPath)).toBe(true);
      const md = readFileSync(mdPath, 'utf8');
      expect(md).toContain('key: "auth-pattern"');
      expect(md).toContain('namespace: "patterns"');
      expect(md).toContain('tags: [auth, jwt]');
      expect(md).toContain('JWT with refresh tokens');

      expect(existsSync(join(outDir, 'notes', 'other.md'))).toBe(true);
    });

    it('exports only the requested namespace when --namespace is given', async () => {
      await seed('a', 'value-a', 'ns-a');
      await seed('b', 'value-b', 'ns-b');

      const outDir = join(dir, 'ns-export');
      const result = await run(exportCommand, makeCtx({ output: outDir, format: 'okf', namespace: 'ns-a' }));
      expect(result.success).toBe(true);
      expect((result.data as { written: number }).written).toBe(1);
      expect(existsSync(join(outDir, 'ns-a', 'a.md'))).toBe(true);
      expect(existsSync(join(outDir, 'ns-b'))).toBe(false);
    });
  });

  describe('importCommand', () => {
    it('requires an input path', async () => {
      const result = await run(importCommand, makeCtx({}));
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('rejects a non-directory / nonexistent input path', async () => {
      const result = await run(importCommand, makeCtx({ input: join(dir, 'does-not-exist') }));
      expect(result.success).toBe(false);
    });

    it('round-trips: export then import into a fresh store reproduces the entries', async () => {
      await seed('roundtrip-key', 'round trip content', 'rt-ns', ['x', 'y']);
      await seed('second-key', 'second content', 'rt-ns');

      const outDir = join(dir, 'rt-export');
      const exportResult = await run(exportCommand, makeCtx({ output: outDir, format: 'okf' }));
      expect(exportResult.success).toBe(true);

      // Import into a completely separate project directory / fresh .swarm db.
      const dir2 = mkdtempSync(join(tmpdir(), 'memory-transfer-import-'));
      process.cwd = () => dir2;
      const { initializeMemoryDatabase, listEntries, getEntry } = await import('../memory/memory-initializer.js');
      const init2 = await initializeMemoryDatabase({ backend: 'hybrid' });
      expect(init2.success).toBe(true);

      try {
        const importResult = await run(importCommand, makeCtx({ input: outDir }));
        expect(importResult.success).toBe(true);
        expect((importResult.data as { imported: number; skipped: number }).imported).toBe(2);

        const listed = await listEntries({ namespace: 'rt-ns', limit: 10 });
        expect(listed.entries.map((e) => e.key).sort()).toEqual(['roundtrip-key', 'second-key']);

        const got = await getEntry({ key: 'roundtrip-key', namespace: 'rt-ns' });
        expect(got.found).toBe(true);
        expect(got.entry?.content).toBe('round trip content');
        expect(got.entry?.tags.sort()).toEqual(['x', 'y']);
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
    });

    it('honors an explicit --namespace override on import', async () => {
      await seed('ns-override-key', 'content', 'orig-ns');
      const outDir = join(dir, 'ns-override-export');
      await run(exportCommand, makeCtx({ output: outDir, format: 'okf' }));

      const dir2 = mkdtempSync(join(tmpdir(), 'memory-transfer-nsimport-'));
      process.cwd = () => dir2;
      const { initializeMemoryDatabase, listEntries } = await import('../memory/memory-initializer.js');
      await initializeMemoryDatabase({ backend: 'hybrid' });

      try {
        const importResult = await run(importCommand, makeCtx({ input: outDir, namespace: 'override-ns' }));
        expect(importResult.success).toBe(true);

        const listed = await listEntries({ namespace: 'override-ns', limit: 10 });
        expect(listed.entries.map((e) => e.key)).toEqual(['ns-override-key']);
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
    });
  });
});
