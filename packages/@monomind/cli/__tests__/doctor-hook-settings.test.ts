/**
 * doctor -c hook-settings: warns when an install lacks the hooks agent picking
 * needs, or carries millisecond hook timeouts (2.16.2 wrote them), and names
 * the fix; passes on what the current generator writes.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkHookSettings } from '../src/commands/doctor-hook-settings-checks.js';
import { generateSettings } from '../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'settings',
  'settings-2.16.2.json',
);

describe('checkHookSettings', () => {
  let dir: string;
  const write = (settings: unknown) =>
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'doctor-hook-settings-'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes on freshly generated settings', async () => {
    write(generateSettings(DEFAULT_INIT_OPTIONS));
    expect(await checkHookSettings(dir)).toMatchObject({ status: 'pass' });
  });

  it('warns on 2.16.2 settings: missing pre-agent hook and ms timeouts', async () => {
    write(JSON.parse(readFileSync(FIXTURE, 'utf-8')));
    const r = await checkHookSettings(dir);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('PreToolUse: hook-handler.cjs pre-agent');
    expect(r.message).toMatch(/timeout\(s\) in milliseconds/);
    expect(r.fix).toBe('monomind init upgrade --settings');
  });

  it('warns on missing route and capture hooks', async () => {
    const s = generateSettings(DEFAULT_INIT_OPTIONS) as { hooks: Record<string, unknown> };
    delete s.hooks.UserPromptSubmit;
    delete s.hooks.SubagentStart;
    write(s);
    const r = await checkHookSettings(dir);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('UserPromptSubmit: hook-handler.cjs route');
    expect(r.message).toContain('SubagentStart: handlers/capture-handler.cjs subagent-start');
  });

  it('ignores user hooks with large timeouts', async () => {
    const s = generateSettings(DEFAULT_INIT_OPTIONS) as {
      hooks: Record<string, { hooks: unknown[] }[]>;
    };
    s.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'my-lint', timeout: 90000 });
    write(s);
    expect(await checkHookSettings(dir)).toMatchObject({ status: 'pass' });
  });
});
