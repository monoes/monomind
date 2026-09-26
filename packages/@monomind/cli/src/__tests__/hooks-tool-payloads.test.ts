/**
 * Follow-up to #341: hooks_* MCP payloads carry only real values.
 *
 * Several tools returned fixed placeholders as if they were measurements —
 * pre-edit's fileExists: true and 85% "<ext> file editing" pattern,
 * model-route's confidence 0.7, post-task's patternsUpdated/newPatterns/
 * trajectoryId, session-end's statePath (never written) and filesModified: 0,
 * post-edit's recorded: true and learningUpdate label. And post-command
 * ignored an explicit `success: false`, recording the command as a success
 * whenever the exit code was 0.
 *
 * Each test calls the real handler against a temp project dir.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ feedbackFails: false }));

vi.mock('../memory/memory-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../memory/memory-bridge.js')>();
  return {
    ...actual,
    bridgeRecordFeedback: async (opts: Parameters<typeof actual.bridgeRecordFeedback>[0]) =>
      bridge.feedbackFails
        ? { success: false, id: '', error: 'write refused' }
        : actual.bridgeRecordFeedback(opts),
  };
});

import { hooksModelRoute } from '../mcp-tools/hooks-intelligence.js';
import {
  hooksPostCommand,
  hooksPostEdit,
  hooksPostTask,
  hooksPreEdit,
  hooksSessionEnd,
} from '../mcp-tools/hooks-routing.js';
import { deriveRecentSuccess, readCommandOutcomes } from '../monovector/command-outcomes.js';

type Payload = Record<string, unknown>;

describe('hooks_* MCP payloads carry only real values (#341 follow-up)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-payload-'));
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    process.env.MONOMIND_CWD = dir;
    bridge.feedbackFails = false;
  });

  afterEach(() => {
    delete process.env.MONOMIND_CWD;
    rmSync(dir, { recursive: true, force: true });
  });

  describe('hooks_post-command', () => {
    it('records an explicit success: false as a failure even with exit code 0', async () => {
      const result = (await hooksPostCommand.handler({
        command: 'npm test',
        exitCode: 0,
        success: false,
      })) as Payload;
      expect(result.success).toBe(false);
      expect(await deriveRecentSuccess(join(dir, '.monomind'))).toBe(false);
      const [rec] = await readCommandOutcomes(join(dir, '.monomind'));
      expect(rec).toMatchObject({ exitCode: 0, success: false });
    });

    it('treats a non-zero exit code as a failure even with success: true', async () => {
      const result = (await hooksPostCommand.handler({
        command: 'npm test',
        exitCode: 2,
        success: true,
      })) as Payload;
      expect(result.success).toBe(false);
      expect(await deriveRecentSuccess(join(dir, '.monomind'))).toBe(false);
    });

    it('still derives success from exit code 0 when no flag is given', async () => {
      const result = (await hooksPostCommand.handler({ command: 'ls', exitCode: 0 })) as Payload;
      expect(result.success).toBe(true);
      expect(await deriveRecentSuccess(join(dir, '.monomind'))).toBe(true);
    });
  });

  describe('hooks_pre-edit', () => {
    it('reports whether the file exists, relative to the project dir', async () => {
      writeFileSync(join(dir, 'a.ts'), 'export {};\n');
      const present = (await hooksPreEdit.handler({ filePath: 'a.ts' })) as {
        context: Payload;
      };
      const absent = (await hooksPreEdit.handler({ filePath: 'missing.ts' })) as {
        context: Payload;
      };
      const absolute = (await hooksPreEdit.handler({ filePath: join(dir, 'a.ts') })) as {
        context: Payload;
      };
      expect(present.context.fileExists).toBe(true);
      expect(absent.context.fileExists).toBe(false);
      expect(absolute.context.fileExists).toBe(true);
    });

    it('sends no placeholder patterns or related files', async () => {
      const result = (await hooksPreEdit.handler({ filePath: 'a.ts' })) as { context: Payload };
      expect(result.context).not.toHaveProperty('patterns');
      expect(result.context).not.toHaveProperty('relatedFiles');
    });
  });

  it('hooks_model-route sends no fixed confidence', async () => {
    const result = (await hooksModelRoute.handler({ task: 'refactor a module' })) as Payload;
    expect(result).not.toHaveProperty('confidence');
    expect(typeof result.complexity).toBe('number');
  });

  it('hooks_post-task sends no synthetic pattern counts or trajectory id', async () => {
    const result = (await hooksPostTask.handler({ taskId: 't1', success: true })) as {
      learningUpdates: Payload;
    };
    expect(result.learningUpdates).not.toHaveProperty('patternsUpdated');
    expect(result.learningUpdates).not.toHaveProperty('newPatterns');
    expect(result.learningUpdates).not.toHaveProperty('trajectoryId');
    expect(result.learningUpdates).toHaveProperty('controller');
    expect(result.learningUpdates).toHaveProperty('outcomePersisted');
  });

  it('hooks_session-end sends no unwritten state path or fixed files-modified count', async () => {
    const result = (await hooksSessionEnd.handler({ saveState: true })) as {
      summary: Payload;
    } & Payload;
    expect(result).not.toHaveProperty('statePath');
    expect(result.summary).not.toHaveProperty('filesModified');
    expect(existsSync(join(dir, '.claude', 'sessions'))).toBe(false);
  });

  describe('hooks_post-edit', () => {
    it('reports recorded: true only when the feedback write succeeded', async () => {
      const ok = (await hooksPostEdit.handler({ filePath: 'a.ts', success: true })) as Payload;
      expect(ok.recorded).toBe((ok.feedback as { recorded: boolean }).recorded);

      bridge.feedbackFails = true;
      const failed = (await hooksPostEdit.handler({ filePath: 'a.ts', success: true })) as Payload;
      expect(failed.recorded).toBe(false);
      expect(failed.feedback).toMatchObject({ recorded: false });
    });

    it('sends no fixed learningUpdate label', async () => {
      const result = (await hooksPostEdit.handler({ filePath: 'a.ts', success: false })) as Payload;
      expect(result).not.toHaveProperty('learningUpdate');
    });
  });
});
