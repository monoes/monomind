/**
 * Sweep after #346: hooks_* tools report a write as done only when it was.
 *
 * Each tool below called a helper that swallows its own errors (or treats a
 * no-op as success) and then reported the write as having happened anyway.
 *
 * Each test calls the real handler against a temp project dir. A plain file
 * where a directory is expected makes the write fail without chmod, so the
 * tests also hold when run as root.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const intel = vi.hoisted(() => ({ trajectoryFails: false }));

vi.mock('../memory/intelligence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../memory/intelligence.js')>();
  return {
    ...actual,
    initializeIntelligence: async () => ({ success: true }),
    recordStep: async () => true,
    recordTrajectory: async () => !intel.trajectoryFails,
    flushPatterns: () => {},
  };
});

vi.mock('../prompt.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../prompt.js')>()),
  confirm: async () => true,
}));

import { intelligenceCommand } from '../commands/hooks-workers.js';
import { hooksIntelligenceReset } from '../mcp-tools/hooks-intelligence.js';
import {
  hooksPostTask,
  hooksPretrain,
  hooksSessionEnd,
  hooksSessionStart,
} from '../mcp-tools/hooks-routing.js';
import type { CommandResult } from '../types.js';

type Payload = Record<string, unknown>;

/** Run `hooks intelligence --reset` and capture everything it wrote. */
async function runReset(cwd: string): Promise<{ text: string; result: CommandResult }> {
  const chunks: string[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
  }
  try {
    const result = (await intelligenceCommand.action?.({
      args: [],
      flags: { _: [], reset: true },
      cwd,
      interactive: false,
    })) as CommandResult;
    return { text: chunks.join(''), result };
  } finally {
    vi.restoreAllMocks();
  }
}

describe('hooks_* tools report only writes that happened (#346 sweep)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-write-'));
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    process.env.MONOMIND_CWD = dir;
    intel.trajectoryFails = false;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  describe('hooks_post-task learningUpdates.outcomePersisted', () => {
    const params = { taskId: 't1', task: 'fix the login bug', agent: 'coder', success: true };

    it('is true when routing-outcomes.json was written', async () => {
      const result = (await hooksPostTask.handler(params)) as { learningUpdates: Payload };
      expect(result.learningUpdates.outcomePersisted).toBe(true);
      expect(existsSync(join(dir, '.monomind', 'routing-outcomes.json'))).toBe(true);
    });

    it('is false when routing-outcomes.json cannot be written', async () => {
      // A directory in the way makes the tmp-file rename fail.
      mkdirSync(join(dir, '.monomind', 'routing-outcomes.json'));
      const result = (await hooksPostTask.handler(params)) as { learningUpdates: Payload };
      expect(result.learningUpdates.outcomePersisted).toBe(false);
    });
  });

  describe('hooks_session-end sessionPersistence.persisted', () => {
    it('is false when no session with that id was ever started', async () => {
      const result = (await hooksSessionEnd.handler({ sessionId: 'never-started' })) as {
        sessionPersistence: { persisted: boolean };
      };
      expect(result.sessionPersistence.persisted).toBe(false);
    });

    it('is true when the started session was marked ended', async () => {
      const started = (await hooksSessionStart.handler({ sessionId: 's-346' })) as {
        sessionMemory: { controller: string };
      };
      expect(started.sessionMemory.controller).toBe('sqlite');
      const result = (await hooksSessionEnd.handler({ sessionId: 's-346' })) as {
        sessionPersistence: { persisted: boolean };
      };
      expect(result.sessionPersistence.persisted).toBe(true);
    });
  });

  describe('hooks_intelligence-reset reset', () => {
    it('is true when every learning file was deleted', async () => {
      mkdirSync(join(dir, '.monomind', 'neural'));
      writeFileSync(join(dir, '.monomind', 'neural', 'patterns.json'), '[]');
      const result = (await hooksIntelligenceReset.handler({})) as Payload;
      expect(result.reset).toBe(true);
      expect(existsSync(join(dir, '.monomind', 'neural', 'patterns.json'))).toBe(false);
    });

    it('is false when a learning file could not be deleted', async () => {
      // unlink cannot remove a directory, even as root.
      mkdirSync(join(dir, '.monomind', 'neural', 'stuck'), { recursive: true });
      const result = (await hooksIntelligenceReset.handler({})) as Payload;
      expect(result.reset).toBe(false);
      expect(result.failedFiles).toEqual([join(dir, '.monomind', 'neural', 'stuck')]);
    });

    it('hooks intelligence --reset says so when the reset was only partial', async () => {
      const ok = await runReset(dir);
      expect(ok.text).toContain('Learning state reset');

      mkdirSync(join(dir, '.monomind', 'neural', 'stuck'), { recursive: true });
      const partial = await runReset(dir);
      expect(partial.text).not.toContain('Learning state reset');
      expect(partial.text).toContain(
        `Learning state only partly reset — could not delete: ${join(dir, '.monomind', 'neural', 'stuck')}`,
      );
    });
  });

  describe('hooks_pretrain stats.neuralPatternsLearned', () => {
    beforeEach(() => {
      writeFileSync(join(dir, 'a.ts'), "import { x } from './x';\nexport const y = x;\n");
    });

    it('counts the patterns when the trajectory was recorded', async () => {
      const result = (await hooksPretrain.handler({ path: dir })) as { stats: Payload };
      expect(result.stats.patternsExtracted).toBe(1);
      expect(result.stats.neuralPatternsLearned).toBe(1);
    });

    it('is 0 when recording the trajectory failed', async () => {
      intel.trajectoryFails = true;
      const result = (await hooksPretrain.handler({ path: dir })) as { stats: Payload };
      expect(result.stats.patternsExtracted).toBe(1);
      expect(result.stats.neuralPatternsLearned).toBe(0);
    });
  });
});
