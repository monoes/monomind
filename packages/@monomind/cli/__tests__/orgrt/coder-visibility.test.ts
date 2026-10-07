// #655: result visibility and the doctor cost-settings check.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkTokenCostSettings } from '../../src/commands/doctor-cost-checks.js';
import { resultVisibility } from '../../src/orgrt/agent-exec.js';

const u = { input: 1, output: 1, cache_read: 1, cache_creation: 1 };

describe('resultVisibility', () => {
  it('lists models that are not the selected one', () => {
    const v = resultVisibility(
      { type: 'result', model_usage: { 'claude-sonnet-5-5': u, 'claude-opus-5-5': u }, effort: 'medium' } as any,
      'claude-sonnet-5-5',
    );
    expect(v.unexpected_models).toEqual(['claude-opus-5-5']);
    expect(v.effort).toBe('medium');
  });

  it('warns past 200K of context and stays quiet below it', () => {
    expect(resultVisibility({ type: 'result', peak_context_tokens: 569_000 } as any, undefined)).toMatchObject({ context_warning: true });
    expect(resultVisibility({ type: 'result', peak_context_tokens: 90_000 } as any, undefined)).not.toHaveProperty('context_warning');
  });
});

describe('checkTokenCostSettings', () => {
  const savedHome = process.env.HOME;
  let home: string;
  let proj: string;
  beforeEach(() => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'cost-'));
    home = join(root, 'home');
    proj = join(root, 'proj');
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(proj, '.claude'), { recursive: true });
    process.env.HOME = home;
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
  });
  afterEach(() => {
    process.env.HOME = savedHome;
  });

  it('flags the global settings from #655, with the effort conflict', async () => {
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        env: { CLAUDE_CODE_EFFORT_LEVEL: 'max', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1048576', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '70000', ENABLE_TOOL_SEARCH: 'false' },
        effortLevel: 'medium',
      }),
    );
    const r = await checkTokenCostSettings(proj);
    expect(r.status).toBe('warn');
    for (const k of ['EFFORT_LEVEL=max', 'effortLevel=medium', 'AUTO_COMPACT_WINDOW', 'MAX_OUTPUT_TOKENS', 'ENABLE_TOOL_SEARCH'])
      expect(r.message).toContain(k);
  });

  it('flags a hook registered in both scopes, and passes a clean setup', async () => {
    expect((await checkTokenCostSettings(proj)).status).toBe('pass');
    const hooks = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node x.cjs pre' }] }] } };
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(hooks));
    writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify(hooks));
    expect((await checkTokenCostSettings(proj)).message).toContain('registered in');
  });
});
