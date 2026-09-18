// packages/@monomind/cli/__tests__/orgrt/org-command.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
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

  it('run scopes its local-model crash guard to the daemon process instead of exporting it to every role through process.env (#249)', async () => {
    const vars = ['MONOMIND_NO_LOCAL_EMBEDDINGS', 'MONOMIND_RERANKER'];
    const saved = Object.fromEntries(vars.map((k) => [k, process.env[k]]));
    for (const k of vars) delete process.env[k];
    try {
      const run = orgCommand.subcommands!.find(c => c.name === 'run')!;
      await run.action!({ args: [], flags: {}, cwd: process.cwd(), interactive: false } as any);
      // Roles' CLIs (and every command they run) inherit process.env.
      expect(process.env.MONOMIND_NO_LOCAL_EMBEDDINGS).toBeUndefined();
      expect(process.env.MONOMIND_RERANKER).toBeUndefined();
      // ...while the daemon itself still never loads the native models.
      const { localEmbeddingsDisabled, rerankerDisabled } = await import('../../src/memory/memory-bridge.js');
      expect(localEmbeddingsDisabled()).toBe(true);
      expect(rerankerDisabled()).toBe(true);
    } finally {
      for (const k of vars) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
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

  describe('inbox', () => {
    const inbox = (cwd: string, args: string[], flags: Record<string, unknown> = {}) =>
      orgCommand.subcommands!.find(c => c.name === 'inbox')!
        .action!({ args, flags, cwd, interactive: false } as any);
    const writeOrg = (cwd: string, name: string): void => {
      mkdirSync(join(cwd, ORG_DIR), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, `${name}.json`), JSON.stringify({
        name, roles: [
          { id: 'boss', type: 'boss', reports_to: null },
          { id: 'worker', reports_to: 'boss' },
        ],
      }));
    };

    it('queues a --json payload to the coordinator when no daemon hosts the org', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-inbox-'));
      try {
        writeOrg(cwd, 'target');
        const res = await inbox(cwd, ['target'], { json: JSON.stringify({ from: 'sales:boss', subject: 'leads', body: 'weekly leads attached' }) });
        expect(res?.success).toBe(true);
        expect(res?.message).toMatch(/queued for target:boss/);
        const spooled = readFileSync(join(cwd, ORG_DIR, 'target', 'inbox.jsonl'), 'utf8').trim();
        const msg = JSON.parse(spooled);
        expect(msg).toMatchObject({ fromQualified: 'sales:boss', toRole: 'boss', subject: 'leads', body: 'weekly leads attached' });
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('honors --to over the coordinator default', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-inbox-'));
      try {
        writeOrg(cwd, 'target');
        const res = await inbox(cwd, ['target'], { json: JSON.stringify({ from: 'a:b', subject: 's', body: 'x' }), to: 'worker' });
        expect(res?.success).toBe(true);
        const msg = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'target', 'inbox.jsonl'), 'utf8').trim());
        expect(msg.toRole).toBe('worker');
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('rejects a payload without from/body', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-inbox-'));
      try {
        writeOrg(cwd, 'target');
        const res = await inbox(cwd, ['target'], { json: JSON.stringify({ from: 'sales:boss' }) });
        expect(res?.success).toBe(false);
        expect(existsSync(join(cwd, ORG_DIR, 'target', 'inbox.jsonl'))).toBe(false);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('rejects malformed --json', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-inbox-'));
      try {
        writeOrg(cwd, 'target');
        const res = await inbox(cwd, ['target'], { json: '{nope' });
        expect(res?.success).toBe(false);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('rejects a path-traversal org name', async () => {
      const res = await inbox(process.cwd(), ['../../etc'], { json: JSON.stringify({ from: 'a:b', body: 'x' }) });
      expect(res?.success).toBe(false);
    });

    it('fails cleanly when the org does not exist', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-inbox-'));
      try {
        mkdirSync(join(cwd, ORG_DIR), { recursive: true });
        const res = await inbox(cwd, ['ghost'], { json: JSON.stringify({ from: 'a:b', body: 'x' }) });
        expect(res?.success).toBe(false);
        expect(res?.message).toMatch(/not found/);
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

  // #274: during the 2.11.1 release run, `org status release-gate` called the
  // run it was actively dispatching tasks in "crashed (runtime.json says
  // running but pid … is gone)" and told the operator to mark-complete it.
  // A recorded pid can go stale while a run is demonstrably alive, so pid
  // liveness alone must not be the whole crash verdict.
  describe('status liveness (#274)', () => {
    const setup = (
      cwd: string,
      org: string,
      runtime: Record<string, unknown>,
      opts?: { busAgeMs?: number; heartbeat?: Record<string, unknown> },
    ): void => {
      const run = runtime.run as string | undefined;
      mkdirSync(join(cwd, ORG_DIR, org), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, `${org}.json`), JSON.stringify({ name: org, roles: [{ id: 'boss' }] }));
      writeFileSync(join(cwd, ORG_DIR, org, 'runtime.json'), JSON.stringify(runtime));
      if (run && opts?.busAgeMs !== undefined) {
        mkdirSync(join(cwd, ORG_DIR, org, run), { recursive: true });
        const bus = join(cwd, ORG_DIR, org, run, 'bus.jsonl');
        writeFileSync(bus, `${JSON.stringify({ ts: Date.now() - opts.busAgeMs, type: 'status', msg: 'working' })}\n`);
        const when = new Date(Date.now() - opts.busAgeMs);
        utimesSync(bus, when, when);
      }
      if (opts?.heartbeat) {
        mkdirSync(join(cwd, '.monomind'), { recursive: true });
        writeFileSync(join(cwd, '.monomind', 'serve-heartbeat.json'), JSON.stringify(opts.heartbeat));
      }
    };
    const runStatus = async (cwd: string, org: string, flags: Record<string, unknown> = {}) => {
      const status = orgCommand.subcommands!.find(c => c.name === 'status')!;
      const lines: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
      const out: string[] = [];
      const wspy = vi.spyOn(process.stdout, 'write').mockImplementation(((s: string) => { out.push(s); return true; }) as never);
      try {
        const res = await status.action!({ args: [org], flags, cwd, interactive: false } as any);
        return { res, log: lines.join('\n'), stdout: out.join('') };
      } finally {
        wspy.mockRestore();
        spy.mockRestore();
      }
    };

    it('does not call a run crashed while its own event log is still being appended to (stale pid, live run)', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-status-live-'));
      try {
        setup(cwd, 'live', { status: 'running', run: 'run-live', pid: 999999999 }, { busAgeMs: 5_000 });
        const { res, log } = await runStatus(cwd, 'live');
        expect(res?.success).toBe(true);
        expect(log).not.toMatch(/crashed/);
        expect(log).toMatch(/live: running/);
        // ...and it says why, so the stale pid isn't a silent mystery.
        expect(log).toMatch(/999999999/);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('reports the same live run as running in --format json (protocol path)', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-status-live-json-'));
      try {
        setup(cwd, 'live', { status: 'running', run: 'run-live', pid: 999999999 }, { busAgeMs: 5_000 });
        const { stdout } = await runStatus(cwd, 'live', { format: 'json' });
        expect(JSON.parse(stdout).status).toBe('running');
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('#296: reports the idle-watchdog deadline for a running org in --format json', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-status-idle-json-'));
      try {
        setup(cwd, 'live', { status: 'running', run: 'run-live', pid: 999999999 }, { busAgeMs: 5_000 });
        const at = new Date(Date.now() + 120_000).toISOString();
        const rec = join(cwd, ORG_DIR, 'live', 'idle-watchdog.json');
        writeFileSync(rec, JSON.stringify({ run: 'run-live', idle_minutes: 1, idle_stop_at: at, hold: null }));
        let json = JSON.parse((await runStatus(cwd, 'live', { format: 'json' })).stdout);
        expect(json).toMatchObject({ idle_stop_at: at, idle_hold: null });
        expect(json.idle_stop_in_seconds).toBeGreaterThan(110);
        expect(json.idle_stop_in_seconds).toBeLessThanOrEqual(120);

        // Held: no deadline, with the reason.
        writeFileSync(rec, JSON.stringify({ run: 'run-live', idle_minutes: 1, idle_stop_at: null, hold: 'pending-approval' }));
        json = JSON.parse((await runStatus(cwd, 'live', { format: 'json' })).stdout);
        expect(json).toMatchObject({ idle_stop_at: null, idle_stop_in_seconds: null, idle_hold: 'pending-approval' });

        // A record left by another run is not this run's deadline.
        writeFileSync(rec, JSON.stringify({ run: 'run-old', idle_minutes: 1, idle_stop_at: at, hold: null }));
        json = JSON.parse((await runStatus(cwd, 'live', { format: 'json' })).stdout);
        expect(json).toMatchObject({ idle_stop_at: null, idle_stop_in_seconds: null, idle_hold: 'unknown' });
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('trusts a fresh serve heartbeat that still lists the org when the recorded pid is stale', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-status-hb-'));
      try {
        setup(cwd, 'live', { status: 'running', run: 'run-live', pid: 999999999 }, {
          heartbeat: { pid: process.pid, updatedAt: new Date().toISOString(), running: ['live'] },
        });
        const { log } = await runStatus(cwd, 'live');
        expect(log).not.toMatch(/crashed/);
        expect(log).toMatch(/live: running/);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('reports a cleanly finished run as stopped, never as crashed (#251 guard)', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-status-done-'));
      try {
        setup(cwd, 'done', { status: 'stopped', run: 'run-done', pid: 999999999, closedBy: 'org-complete' }, { busAgeMs: 60_000 });
        const { log } = await runStatus(cwd, 'done');
        expect(log).not.toMatch(/crashed/);
        expect(log).toMatch(/done: stopped/);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('still reports a genuinely dead run (stale pid, long-silent event log) as crashed', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-status-dead-'));
      try {
        setup(cwd, 'dead', { status: 'running', run: 'run-dead', pid: 999999999 }, { busAgeMs: 6 * 60 * 60 * 1000 });
        const { log } = await runStatus(cwd, 'dead');
        expect(log).toMatch(/crashed/);
        expect(log).toMatch(/mark-complete/);
      } finally { rmSync(cwd, { recursive: true, force: true }); }
    });

    it('marks a live but long-silent run idle rather than running or crashed', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'org-status-idle-'));
      try {
        setup(cwd, 'quiet', { status: 'running', run: 'run-quiet', pid: process.pid }, { busAgeMs: 3 * 60 * 60 * 1000 });
        const { log } = await runStatus(cwd, 'quiet');
        expect(log).not.toMatch(/crashed/);
        expect(log).toMatch(/quiet: running \(idle\)/);
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
        mkdirSync(join(cwd, ORG_DIR, 'myorg'), { recursive: true });
        writeFileSync(join(cwd, ORG_DIR, 'myorg.json'), JSON.stringify({ name: 'myorg', roles: [{ id: 'boss' }] }));
        // stopAction now refuses to write a stopfile nothing will read, so this
        // lifecycle test needs a live "running" record (see state-integrity.test.ts).
        writeFileSync(join(cwd, ORG_DIR, 'myorg', 'runtime.json'),
          JSON.stringify({ status: 'running', run: 'run-x', pid: process.pid }));
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
