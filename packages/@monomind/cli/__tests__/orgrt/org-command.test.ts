// packages/@monomind/cli/__tests__/orgrt/org-command.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orgCommand, clearStopfile } from '../../src/commands/org.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

describe('org command', () => {
  it('registers run/stop/status/serve/test-loop subcommands', () => {
    const names = (orgCommand.subcommands ?? []).map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['run', 'stop', 'status', 'serve', 'test-loop']));
  });
  it('run requires an org name', async () => {
    const run = orgCommand.subcommands!.find(c => c.name === 'run')!;
    const res = await run.action!({ args: [], flags: {}, cwd: process.cwd(), interactive: false } as any);
    expect(res?.success).toBe(false);
    expect(res?.message).toMatch(/org name/i);
  });

  describe('stopfile lifecycle', () => {
    it('clearStopfile removes a stopfile written by stopAction', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-stopfile-'));
      try {
        const stop = orgCommand.subcommands!.find(c => c.name === 'stop')!;
        const res = await stop.action!({ args: ['myorg'], flags: {}, cwd, interactive: false } as any);
        expect(res?.success).toBe(true);
        const stopfile = join(cwd, ORG_DIR, 'myorg', 'stop');
        expect(existsSync(stopfile)).toBe(true);

        clearStopfile(cwd, 'myorg');
        expect(existsSync(stopfile)).toBe(false);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('clearStopfile is a no-op when no stopfile exists', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-stopfile-'));
      try {
        mkdirSync(join(cwd, ORG_DIR, 'other'), { recursive: true });
        writeFileSync(join(cwd, ORG_DIR, 'other', 'stop'), 'x');
        expect(() => clearStopfile(cwd, 'myorg')).not.toThrow();
        // does not touch other orgs' stopfiles
        expect(existsSync(join(cwd, ORG_DIR, 'other', 'stop'))).toBe(true);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
});
