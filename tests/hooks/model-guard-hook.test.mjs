/**
 * PreToolUse Task|Agent → `hook-handler.cjs pre-agent` refuses a subagent
 * launch that names a blocked model (Claude Fable, GPT Astra), and its
 * patterns stay identical to the TypeScript model guard's.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isBlockedModel as tsIsBlocked } from '../../packages/@monomind/cli/src/model-guard.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLER = path.resolve(__dirname, '../../.claude/helpers/hook-handler.cjs');
const cjs = createRequire(import.meta.url)('../../.claude/helpers/handlers/model-guard.cjs');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'model-guard-hook-'));
  fs.mkdirSync(path.join(tmp, '.monomind', 'routes'), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(toolInput, tool = 'Agent') {
  return spawnSync(process.execPath, [HANDLER, 'pre-agent'], {
    cwd: tmp,
    input: JSON.stringify({
      session_id: 's1',
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_input: toolInput,
    }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, MONOMIND_HOOK_QUIET: '1' },
    encoding: 'utf-8',
    timeout: 10000,
  });
}

describe('pre-agent model guard', () => {
  it('blocks a launch naming Fable or Astra, with a block decision on stderr and exit 2', () => {
    for (const model of ['fable', 'claude-fable-5-1', 'gpt-6-astra']) {
      for (const tool of ['Agent', 'Task']) {
        const r = run({ model, description: 'x', prompt: 'y' }, tool);
        expect(r.status, `${tool}/${model}`).toBe(2);
        expect(JSON.parse(r.stderr.trim().split('\n').pop())).toMatchObject({ decision: 'block' });
        expect(r.stdout).toBe('');
      }
    }
  });

  it('writes no adherence record for a blocked launch', () => {
    run({ model: 'fable', description: 'x', prompt: 'y' });
    expect(fs.existsSync(path.join(tmp, '.monomind', 'pick-adherence.jsonl'))).toBe(false);
  });

  it('lets other models and launches with no model through', () => {
    for (const toolInput of [
      { model: 'opus', description: 'x', prompt: 'y' },
      { model: 'claude-sonnet-5-5', description: 'x', prompt: 'y' },
      { description: 'x', prompt: 'y' },
    ]) {
      expect(run(toolInput).status).toBe(0);
    }
  });
});

describe('the hook and the TypeScript guard agree', () => {
  it('give the same answer on every sample name', () => {
    for (const id of [
      'claude-fable-5-1',
      'fable',
      'Fable 5.1',
      'gpt-6-astra',
      'GPT-6-Astra',
      'astra',
      'claude-opus-5-5',
      'opus',
      'sonnet',
      'default',
      'gpt-5.6-terra',
      'gemini-3.8-flash-high',
      'contrast-model',
      'unfabled',
      'catastrophe',
      '',
      'anthropic/claude-fable-5-1',
    ]) {
      expect(cjs.isBlockedModel(id), id).toBe(tsIsBlocked(id));
    }
    expect(cjs.isBlockedModel(undefined)).toBe(false);
  });
});
