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

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hooksPostCommand } from '../mcp-tools/hooks-routing.js';
import { deriveRecentSuccess, readCommandOutcomes } from '../monovector/command-outcomes.js';

type Payload = Record<string, unknown>;

describe('hooks_* MCP payloads carry only real values (#341 follow-up)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-payload-'));
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    process.env.MONOMIND_CWD = dir;
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
});
