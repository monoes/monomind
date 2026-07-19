// packages/@monomind/cli/__tests__/orgrt/org-command.test.ts
import { describe, it, expect, vi } from 'vitest';
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

    // Regression guard for F1: a v1-shaped config with no structural violations
    // passes `org validate` even though it is still v1 — the runorg skill's
    // auto-migrate trigger must NOT rely on `org validate` failing to detect
    // v1 configs. See .claude/skills/mastermind-runorg/SKILL.md step 2.
    it('passes a canonical v1-shaped config — validate alone cannot detect v1-ness', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-validate-v1shape-'));
      try {
        writeOrg(cwd, 'v1shaped', {
          name: 'v1shaped', goal: 'grow', version: 1, topology: 'hierarchical',
          board_id: 'b-1', todo_col_id: 'c-1', doing_col_id: 'c-2', done_col_id: 'c-3',
          loop: { poll_interval_minutes: 30 },
          roles: [
            { id: 'boss', reports_to: null, agent_type: 'coordinator' },
            { id: 'dev', reports_to: 'boss', agent_type: 'coder' },
          ],
        });
        const res = await validate(cwd, 'v1shaped');
        expect(res?.success).toBe(true);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  });

  it('run fails fast with a friendly error when the org does not exist', async () => {
    const run = orgCommand.subcommands!.find(c => c.name === 'run')!;
    const cwd = mkdtempSync(join(tmpdir(), 'org-run-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'other.json'), JSON.stringify({ name: 'other', roles: [{ id: 'boss' }] }));
      const res = await run.action!({ args: ['ghost'], flags: {}, cwd, interactive: false } as any);
      expect(res?.success).toBe(false);
      expect(res?.message).toMatch(/not found/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('run reports a schema-invalid org as a clean failure instead of an unhandled throw', async () => {
    const run = orgCommand.subcommands!.find(c => c.name === 'run')!;
    const cwd = mkdtempSync(join(tmpdir(), 'org-run-'));
    try {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'bad.json'), JSON.stringify({ name: 'bad', roles: [] }));
      const res = await run.action!({ args: ['bad'], flags: { crossProcess: false }, cwd, interactive: false } as any);
      expect(res?.success).toBe(false);
      expect(res?.message).toMatch(/start failed/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('stop reports a nonexistent org instead of writing a stray stopfile', async () => {
    const stop = orgCommand.subcommands!.find(c => c.name === 'stop')!;
    const cwd = mkdtempSync(join(tmpdir(), 'org-stop-'));
    try {
      const res = await stop.action!({ args: ['ghost'], flags: {}, cwd, interactive: false } as any);
      expect(res?.success).toBe(false);
      expect(existsSync(join(cwd, ORG_DIR, 'ghost'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  describe('delete running-org guard', () => {
    const setup = (status: string, pid: number): string => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-del-'));
      mkdirSync(join(cwd, ORG_DIR, 'live'), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'live.json'), JSON.stringify({ name: 'live', roles: [{ id: 'boss' }] }));
      writeFileSync(join(cwd, ORG_DIR, 'live', 'runtime.json'), JSON.stringify({ status, run: 'run-x', pid }));
      return cwd;
    };
    const del = (cwd: string, flags: Record<string, unknown> = {}) =>
      orgCommand.subcommands!.find(c => c.name === 'delete')!
        .action!({ args: ['live'], flags: { yes: true, ...flags }, cwd, interactive: false } as any);

    it('refuses to delete an org whose daemon pid is alive', async () => {
      const cwd = setup('running', process.pid);
      try {
        const res = await del(cwd);
        expect(res?.success).toBe(false);
        expect(res?.message).toMatch(/running/);
        expect(existsSync(join(cwd, ORG_DIR, 'live.json'))).toBe(true);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('deletes with --force even while running', async () => {
      const cwd = setup('running', process.pid);
      try {
        const res = await del(cwd, { force: true });
        expect(res?.success).toBe(true);
        expect(existsSync(join(cwd, ORG_DIR, 'live.json'))).toBe(false);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('treats a stale runtime.json (dead pid) as not running', async () => {
      const cwd = setup('running', 999999999);
      try {
        const res = await del(cwd);
        expect(res?.success).toBe(true);
        expect(existsSync(join(cwd, ORG_DIR, 'live.json'))).toBe(false);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('deletes a stopped org normally', async () => {
      const cwd = setup('stopped', process.pid);
      try {
        const res = await del(cwd);
        expect(res?.success).toBe(true);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });
  });

  it('status flags a crashed org (running status, dead pid) instead of reporting it running', async () => {
    const status = orgCommand.subcommands!.find(c => c.name === 'status')!;
    const cwd = mkdtempSync(join(tmpdir(), 'org-status-'));
    const warnings: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { warnings.push(a.join(' ')); });
    try {
      mkdirSync(join(cwd, ORG_DIR, 'dead'), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'dead.json'), JSON.stringify({ name: 'dead', roles: [{ id: 'boss' }] }));
      writeFileSync(join(cwd, ORG_DIR, 'dead', 'runtime.json'), JSON.stringify({ status: 'running', run: 'run-x', pid: 999999999 }));
      const res = await status.action!({ args: ['dead'], flags: {}, cwd, interactive: false } as any);
      expect(res?.success).toBe(true);
      expect(warnings.join('\n')).toMatch(/crashed/);
    } finally {
      spy.mockRestore();
      rmSync(cwd, { recursive: true, force: true });
    }
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
        mkdirSync(join(cwd, ORG_DIR), { recursive: true });
        writeFileSync(join(cwd, ORG_DIR, 'myorg.json'), JSON.stringify({ name: 'myorg', roles: [{ id: 'boss' }] }));
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
