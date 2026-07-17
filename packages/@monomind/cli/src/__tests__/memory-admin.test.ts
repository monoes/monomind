import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';

// See memory-crud.test.ts for why the LanceDB bridge is mocked away rather
// than left real: it lazily loads a HuggingFace embedding model on first
// use, which would attempt a network fetch in this environment.
vi.mock('@monoes/memory', () => {
  throw new Error('mocked: LanceDB backend unavailable in test environment');
});

import { deleteCommand, statsCommand, configureCommand } from '../commands/memory-admin.js';
import { storeCommand } from '../commands/memory-crud.js';
import { initializeMemoryDatabase } from '../memory/memory-initializer.js';
import { configManager } from '../services/config-file-manager.js';

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

describe('memory-admin commands', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-admin-test-'));
    originalCwd = process.cwd();
    process.chdir(dir);
    // Reset the config-file-manager singleton's cached path/state so it
    // doesn't carry over a stale configPath from a previous test's tmpdir
    // (it caches configPath across calls regardless of cwd otherwise).
    configManager.load(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  describe('delete — source=lancedb (routes through sql.js fallback, see memory-crud.test.ts for store/retrieve/delete round trip)', () => {
    it('requires a key', async () => {
      await initializeMemoryDatabase({});
      const result = await run(deleteCommand, ctx({ flags: { _: [], force: true } }));
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('delete — source=palace/knowledge (real JSONL file on disk)', () => {
    it('rejects an id with disallowed characters before touching the filesystem', async () => {
      const result = await run(deleteCommand, 
        ctx({ flags: { _: [], source: 'palace', id: '../../etc/passwd', force: true } }),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('errors clearly (not a crash) when the target file does not exist', async () => {
      const result = await run(deleteCommand, 
        ctx({ flags: { _: [], source: 'palace', id: 'abc123', force: true } }),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('removes the matching entry and leaves the rest of the JSONL file intact', async () => {
      const palaceDir = join(dir, '.monomind', 'palace');
      mkdirSync(palaceDir, { recursive: true });
      const filePath = join(palaceDir, 'drawers.jsonl');
      const entries = [
        { id: 'keep-1', note: 'first' },
        { id: 'remove-me', note: 'second' },
        { id: 'keep-2', note: 'third' },
      ];
      writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const result = await run(deleteCommand, 
        ctx({ flags: { _: [], source: 'palace', id: 'remove-me', force: true } }),
      );
      expect(result.success).toBe(true);
      expect((result.data as any).deleted).toBe(true);
      expect((result.data as any).remainingEntries).toBe(2);

      const remaining = readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(remaining.map((e: any) => e.id)).toEqual(['keep-1', 'keep-2']);
    });

    it('reports a clear error (not a crash) on a malformed JSONL line instead of deleting anything', async () => {
      const knowledgeDir = join(dir, '.monomind', 'knowledge');
      mkdirSync(knowledgeDir, { recursive: true });
      const filePath = join(knowledgeDir, 'chunks.jsonl');
      writeFileSync(filePath, '{ this is not valid json\n{"id":"chunk-1"}\n');

      const result = await run(deleteCommand, 
        ctx({ flags: { _: [], source: 'knowledge', id: 'chunk-1', force: true } }),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      // File must be untouched — malformed content isn't silently dropped.
      expect(readFileSync(filePath, 'utf-8')).toContain('this is not valid json');
    });

    it('reports not-found (not a crash) for an id that is not present', async () => {
      const knowledgeDir = join(dir, '.monomind', 'knowledge');
      mkdirSync(knowledgeDir, { recursive: true });
      const filePath = join(knowledgeDir, 'chunks.jsonl');
      writeFileSync(filePath, JSON.stringify({ id: 'chunk-1' }) + '\n');

      const result = await run(deleteCommand, 
        ctx({ flags: { _: [], source: 'knowledge', id: 'does-not-exist', force: true } }),
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('stats', () => {
    it('reports a clear failure (not a crash) when the memory backend is unavailable', async () => {
      // The stats command reads exclusively through bridgeListEntries
      // (memory-bridge.ts) — unlike store/retrieve/search/delete, it has no
      // sql.js fallback path. With the LanceDB bridge mocked unavailable
      // (see top of file), this is the real, honest behavior of the command
      // in an environment without a working LanceDB backend.
      const result = await run(statsCommand, ctx({}));
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('configure', () => {
    it('creates a config file on first run with the requested backend', async () => {
      const result = await run(configureCommand, 
        ctx({ cwd: dir, flags: { _: [], backend: 'hybrid', 'cache-size': 128, 'hnsw-m': 16, 'hnsw-ef': 200 } }),
      );
      expect(result.success).toBe(true);

      const configPath = join(dir, 'monomind.config.json');
      const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(onDisk.memory.backend).toBe('hybrid');
      expect(onDisk.memory.cacheSize).toBe(128);
      expect(onDisk.memory.hnsw).toEqual({ m: 16, ef: 200 });
      // Other config sections should still be present (defaults), not
      // clobbered by a memory-only write.
      expect(onDisk.agents).toBeDefined();
      expect(onDisk.swarm).toBeDefined();
    });

    it('is idempotent: running twice with the same backend does not duplicate or corrupt the file', async () => {
      await run(configureCommand, 
        ctx({ cwd: dir, flags: { _: [], backend: 'sqlite', 'cache-size': 64 } }),
      );
      const firstRun = JSON.parse(readFileSync(join(dir, 'monomind.config.json'), 'utf-8'));

      await run(configureCommand, 
        ctx({ cwd: dir, flags: { _: [], backend: 'sqlite', 'cache-size': 64 } }),
      );
      const secondRun = JSON.parse(readFileSync(join(dir, 'monomind.config.json'), 'utf-8'));

      expect(secondRun).toEqual(firstRun);
      expect(Object.keys(secondRun)).toEqual(Object.keys(firstRun));
    });

    it('running with a new backend overwrites the memory section cleanly without duplicating keys', async () => {
      await run(configureCommand, 
        ctx({ cwd: dir, flags: { _: [], backend: 'lancedb' } }),
      );
      await run(configureCommand, 
        ctx({ cwd: dir, flags: { _: [], backend: 'memory' } }),
      );
      const onDisk = JSON.parse(readFileSync(join(dir, 'monomind.config.json'), 'utf-8'));
      expect(onDisk.memory.backend).toBe('memory');
      // Exactly one `memory` key, not an array/duplicate structure.
      expect(typeof onDisk.memory).toBe('object');
      expect(Array.isArray(onDisk.memory)).toBe(false);
    });

    it(
      'KNOWN GAP (not fixed by this test suite, see report): a config file that fails to parse ' +
        'is silently replaced with defaults-plus-the-new-key, discarding whatever else was on disk ' +
        '(e.g. provider API keys) instead of aborting the write — same class of bug as the ' +
        'task-tools.ts agent-store issue documented in task-tools-agent-store.test.ts, but unfixed here',
      async () => {
        const configPath = join(dir, 'monomind.config.json');
        // Simulate a transiently/corruptly unreadable config file that still
        // holds real data on disk (e.g. a provider API key written by
        // `monomind providers configure`).
        writeFileSync(configPath, '{ "providers": { "openai": { "apiKey": "sk-real-secret" } }, this is truncated');

        const result = await run(configureCommand, 
          ctx({ cwd: dir, flags: { _: [], backend: 'hybrid' } }),
        );
        expect(result.success).toBe(true);

        const onDisk = JSON.parse(readFileSync(configPath, 'utf-8'));
        // Demonstrates current behavior: config-file-manager.ts's set()
        // catches the JSON.parse failure and falls back to
        // cloneDefaultConfig() instead of aborting, so the write proceeds
        // and the previously-real `providers` data (with the API key) is
        // gone from the file that gets written back to disk.
        expect(onDisk.providers).toBeUndefined();
        expect(onDisk.memory.backend).toBe('hybrid');
      },
    );
  });
});
