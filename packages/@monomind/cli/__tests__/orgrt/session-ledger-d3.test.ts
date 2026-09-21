/**
 * ADR-O001 D3 — task-keyed session records, and the mailbox boundaries that
 * let a role's process cycle while its model session is resumed.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import {
  SessionLedger,
  ROLE_SESSION_KEY,
  taskKeyOf,
  resolveSessionScope,
  MAX_SESSION_RUNS,
} from '../../src/orgrt/session-ledger.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'd3-ledger-'));

async function pullAll(gen: AsyncGenerator<{ message: { content: string } }>): Promise<string[]> {
  const out: string[] = [];
  for await (const m of gen) out.push(m.message.content);
  return out;
}

describe('Mailbox.stream boundaries (D3)', () => {
  it('stopBefore ends the stream before a message it rejects and leaves that message queued', async () => {
    const mb = new Mailbox();
    mb.push('[task:task-1] a');
    mb.push('follow-up mail');
    mb.push('[task:task-2] b');
    const got = await pullAll(
      mb.stream('', { stopBefore: (next) => taskKeyOf(next) !== undefined && taskKeyOf(next) !== 'task-1' }),
    );
    expect(got).toEqual(['[task:task-1] a', 'follow-up mail']);
    expect(mb.peek()).toBe('[task:task-2] b');
    expect(mb.lastStreamEnd).toBe('boundary');
  });

  it('never applies stopBefore to the first message of a stream', async () => {
    const mb = new Mailbox();
    mb.push('[task:task-9] x');
    mb.close();
    const got = await pullAll(mb.stream('', { stopBefore: () => true }));
    expect(got).toEqual(['[task:task-9] x']);
  });

  it('idleExitMs ends a stream parked on an empty queue, keeping later mail for the next stream', async () => {
    const mb = new Mailbox();
    mb.push('one');
    const got = await pullAll(mb.stream('', { idleExitMs: 20 }));
    expect(got).toEqual(['one']);
    expect(mb.lastStreamEnd).toBe('idle');
    mb.push('two');
    expect(mb.peek()).toBe('two');
  });

  it('waitForMessage resolves true on push and false on close', async () => {
    const mb = new Mailbox();
    const w = mb.waitForMessage();
    mb.push('hi');
    await expect(w).resolves.toBe(true);
    const mb2 = new Mailbox();
    const w2 = mb2.waitForMessage();
    mb2.close();
    await expect(w2).resolves.toBe(false);
  });
});

describe('taskKeyOf / resolveSessionScope', () => {
  it('parses only a leading [task:<id>] tag', () => {
    expect(taskKeyOf('[task:task-3] Fix the build')).toBe('task-3');
    expect(taskKeyOf('mail mentioning [task:task-3] later')).toBeUndefined();
    expect(taskKeyOf('[system:turn-continue] go on')).toBeUndefined();
  });

  it("defaults to 'role'; run_config 'task' applies to workers but not to the coordinator", () => {
    const boss = { id: 'boss' } as any;
    const dev = { id: 'dev', reports_to: 'boss' } as any;
    expect(resolveSessionScope(dev, { run_config: {} } as any)).toBe('role');
    expect(resolveSessionScope(dev, undefined)).toBe('role');
    const def = { run_config: { session_scope: 'task' } } as any;
    expect(resolveSessionScope(dev, def)).toBe('task');
    expect(resolveSessionScope(boss, def)).toBe('role');
    expect(resolveSessionScope({ ...boss, session_scope: 'task' }, def)).toBe('task');
    expect(resolveSessionScope({ ...dev, session_scope: 'role' }, def)).toBe('role');
  });
});

describe('SessionLedger', () => {
  const base = { role: 'dev', runtime: 'claude', cwd: '/w', promptHash: 'h1' };

  it('keys records by (role, runtime, taskKey) — a different runtime is a different session', () => {
    const l = new SessionLedger();
    l.set({ ...base, taskKey: 'task-1', sessionId: 's1' });
    expect(l.resumeFor({ ...base, taskKey: 'task-1' })).toEqual({ sessionId: 's1', reason: 'resumed' });
    expect(l.resumeFor({ ...base, taskKey: 'task-1', runtime: 'codex' })).toEqual({ reason: 'fresh-no-record' });
    expect(l.resumeFor({ ...base, taskKey: 'task-2' })).toEqual({ reason: 'fresh-no-record' });
  });

  it('refuses to resume across a changed cwd or system prompt, and says why', () => {
    const l = new SessionLedger();
    l.set({ ...base, taskKey: 'task-1', sessionId: 's1' });
    expect(l.resumeFor({ ...base, taskKey: 'task-1', cwd: '/other' })).toEqual({ reason: 'fresh-cwd-changed' });
    expect(l.resumeFor({ ...base, taskKey: 'task-1', promptHash: 'h2' })).toEqual({
      reason: 'fresh-prompt-changed',
    });
  });

  it('drop() forgets a record', () => {
    const l = new SessionLedger();
    l.set({ ...base, taskKey: ROLE_SESSION_KEY, sessionId: 's1' });
    l.drop({ ...base, taskKey: ROLE_SESSION_KEY });
    expect(l.resumeFor({ ...base, taskKey: ROLE_SESSION_KEY })).toEqual({ reason: 'fresh-no-record' });
  });

  it('persists records and runs to disk and reloads them', () => {
    const file = join(tmp(), 'sessions.json');
    const l = new SessionLedger(file);
    l.set({ ...base, taskKey: 'task-1', sessionId: 's1' });
    l.recordRun({
      role: 'dev',
      runtime: 'claude',
      taskKey: 'task-1',
      sessionIdBefore: undefined,
      sessionIdAfter: 's1',
      reason: 'fresh-no-record',
      startedAt: 1,
      endedAt: 2,
    });
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk.runs[0]).toMatchObject({ sessionIdAfter: 's1', resumed: false });
    const again = new SessionLedger(file);
    expect(again.resumeFor({ ...base, taskKey: 'task-1' })).toEqual({ sessionId: 's1', reason: 'resumed' });
    expect(again.runs()).toHaveLength(1);
  });

  it('marks a run resumed only when the session id survived it', () => {
    const l = new SessionLedger();
    const r = { role: 'dev', runtime: 'claude', taskKey: 't', reason: 'resumed' as const, startedAt: 0, endedAt: 0 };
    expect(l.recordRun({ ...r, sessionIdBefore: 's1', sessionIdAfter: 's1' }).resumed).toBe(true);
    // The runner ignored `resume` and started over — exactly what the audit exists to show.
    expect(l.recordRun({ ...r, sessionIdBefore: 's1', sessionIdAfter: 's2' }).resumed).toBe(false);
  });

  it('bounds the run history', () => {
    const l = new SessionLedger();
    for (let i = 0; i < MAX_SESSION_RUNS + 10; i++) {
      l.recordRun({ role: 'dev', runtime: 'claude', taskKey: 't', reason: 'resumed', startedAt: i, endedAt: i });
    }
    expect(l.runs()).toHaveLength(MAX_SESSION_RUNS);
    expect(l.runs()[0].startedAt).toBe(10);
  });
});
