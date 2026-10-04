// packages/@monomind/cli/__tests__/orgrt/documents/eval-gate-cli.test.ts
// P3.3: `monomind org run` refuses a sections org with the harness remedy.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orgCommand } from '../../../src/commands/org.js';
import { evalGateRefusal, sectionsOrgRefusal } from '../../../src/orgrt/documents/eval-gate.js';
import { ORG_DIR } from '../../../src/orgrt/types.js';
import { sectionsRaw } from '../support/sections-defs.js';

describe('org run refuses a sections org', () => {
  let cwd: string;
  let lines: string[];
  let savedListeners: { uncaught: unknown[]; unhandled: unknown[] };

  beforeEach(() => {
    cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'eval-gate-cli-'));
    mkdirSync(join(cwd, ORG_DIR), { recursive: true });
    savedListeners = {
      uncaught: process.listeners('uncaughtException'),
      unhandled: process.listeners('unhandledRejection'),
    };
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      lines.push(a.join(' '));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const l of process.listeners('uncaughtException'))
      if (!savedListeners.uncaught.includes(l)) process.removeListener('uncaughtException', l);
    for (const l of process.listeners('unhandledRejection'))
      if (!savedListeners.unhandled.includes(l)) process.removeListener('unhandledRejection', l);
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('prints the refusal pointing at the eval path and returns a failure, starting nothing', async () => {
    writeFileSync(join(cwd, ORG_DIR, 'sec-org.json'), JSON.stringify(sectionsRaw()));
    const run = orgCommand.subcommands?.find((c) => c.name === 'run');
    const result = await run?.action?.({
      args: ['sec-org'],
      flags: { crossProcess: false, yes: true },
      cwd,
    } as never);
    expect(result?.success).toBe(false);
    expect(lines.join('\n')).toContain(evalGateRefusal('sec-org'));
    expect(lines.join('\n')).toContain('tests/eval/org/pilot/run-org.ts');
  });

  it('sectionsOrgRefusal is undefined for a legacy org and for a missing or broken file', () => {
    writeFileSync(
      join(cwd, ORG_DIR, 'legacy.json'),
      JSON.stringify({ name: 'legacy', roles: [{ id: 'boss', reports_to: null }] }),
    );
    writeFileSync(join(cwd, ORG_DIR, 'broken.json'), '{');
    const dir = join(cwd, ORG_DIR);
    expect(sectionsOrgRefusal(dir, 'legacy')).toBeUndefined();
    expect(sectionsOrgRefusal(dir, 'broken')).toBeUndefined();
    expect(sectionsOrgRefusal(dir, 'missing')).toBeUndefined();
    writeFileSync(join(dir, 'sec-org.json'), JSON.stringify(sectionsRaw()));
    expect(sectionsOrgRefusal(dir, 'sec-org')).toBe(evalGateRefusal('sec-org'));
  });
});
