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

  it('run rejects a --task that the parser promoted to an array (passed more than once) instead of stringifying it into the goal', async () => {
    const run = orgCommand.subcommands!.find(c => c.name === 'run')!;
    const cwd = mkdtempSync(join(tmpdir(), 'org-task-'));
    try {
      const res = await run.action!({ args: ['myorg'], flags: { task: ['A', 'B'] }, cwd, interactive: false } as any);
      expect(res?.success).toBe(false);
      expect(res?.message).toMatch(/--task/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('bare `org` (no subcommand) prints and returns a usage message instead of exiting silently', async () => {
    const res = await orgCommand.action!({ args: [], flags: {}, cwd: process.cwd(), interactive: false } as any);
    expect(res?.success).toBe(false);
    expect(res?.message).toMatch(/usage: monomind org/);
  });

  describe('validate', () => {
    const writeOrg = (cwd: string, name: string, def: unknown): void => {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, `${name}.json`), JSON.stringify(def));
    };
    const validate = (cwd: string, ...args: string[]) =>
      orgCommand.subcommands!.find(c => c.name === 'validate')!
        .action!({ args, flags: {}, cwd, interactive: false } as any);

    it('accepts a well-formed org config', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-validate-'));
      try {
        writeOrg(cwd, 'good', {
          name: 'good', goal: 'test', roles: [
            { id: 'boss', type: 'boss', reports_to: null },
            { id: 'worker', reports_to: 'boss' },
          ],
        });
        const res = await validate(cwd, 'good');
        expect(res?.success).toBe(true);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('rejects multiple roots, unresolved reports_to, duplicate ids, and bad schedules', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-validate-'));
      try {
        writeOrg(cwd, 'bad', {
          name: 'bad', schedule: 'whenever', roles: [
            { id: 'a', reports_to: null },
            { id: 'b', reports_to: null },
            { id: 'b', reports_to: 'ghost' },
          ],
        });
        const res = await validate(cwd, 'bad');
        expect(res?.success).toBe(false);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('rejects schema violations (empty roles array)', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-validate-'));
      try {
        writeOrg(cwd, 'empty', { name: 'empty', roles: [] });
        const res = await validate(cwd, 'empty');
        expect(res?.success).toBe(false);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('validates all orgs when no name is given and fails on the broken one', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-validate-'));
      try {
        writeOrg(cwd, 'ok', { name: 'ok', roles: [{ id: 'boss', reports_to: null }] });
        writeFileSync(join(cwd, ORG_DIR, 'broken.json'), '{not json');
        const res = await validate(cwd);
        expect(res?.success).toBe(false);
        expect(res?.message).toMatch(/1 of 2/);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('rejects a path-traversal org name', async () => {
      const res = await validate(process.cwd(), '../../etc/passwd');
      expect(res?.success).toBe(false);
    });

    it('reports a missing org as a failure', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-validate-'));
      try {
        mkdirSync(join(cwd, ORG_DIR), { recursive: true });
        const res = await validate(cwd, 'nonexistent');
        expect(res?.success).toBe(false);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  });

  it('status rejects a path-traversal org name', async () => {
    const status = orgCommand.subcommands!.find(c => c.name === 'status')!;
    const res = await status.action!({ args: ['../../x'], flags: {}, cwd: process.cwd(), interactive: false } as any);
    expect(res?.success).toBe(false);
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
