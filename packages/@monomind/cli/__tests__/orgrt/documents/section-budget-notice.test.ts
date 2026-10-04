// P4.6: the durable budget notices, the engine alone: the real journal in a temp directory, a fake deliver. The
// durability matrix of P3.8 and P3.9: a crash between the crossing and the delivery, a resume that never repeats a
// delivered notice, a retry, the give-up, a torn journal tail and a journal that cannot be written.
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type BudgetNoticeSink,
  type BudgetNoticeSpec,
  KIND_BUDGET_WARNING,
  SectionBudgetNotices,
} from '../../../src/orgrt/documents/section-budget-notice.js';
import { tmp } from './store-support.js';

const spec = (over: Partial<BudgetNoticeSpec> = {}): BudgetNoticeSpec => ({
  crossing: 'warn:section:dev:30',
  kind: KIND_BUDGET_WARNING,
  scope: 'section:dev',
  recipients: ['dev-lead', 'boss'],
  subject: 'budget: section "dev" at 80 percent',
  body: 'Section "dev" has spent $24.00 of $30.00.',
  ...over,
});

type Sent = { to: string; subject: string };
function rig(dir = tmp('p46n-'), opts: { maxFailures?: number } = {}) {
  const sent: Sent[] = [];
  const events: Array<{ reason: string; data: Record<string, unknown> }> = [];
  let fail: ((to: string) => string | undefined) | undefined;
  const engine = new SectionBudgetNotices(dir, opts);
  const sink: BudgetNoticeSink = {
    deliver: async (to, subject) => {
      const err = fail?.(to);
      if (err) return err;
      sent.push({ to, subject });
      return `delivered to ${to}`;
    },
    emit: (e) => events.push(e),
  };
  return { dir, engine, sent, events, sink, failWith: (f: typeof fail) => (fail = f) };
}
const reopen = (dir: string, opts: { maxFailures?: number } = {}) => rig(dir, opts);

describe('a crossing is owed once', () => {
  it('delivers one message per recipient, and the same crossing is never owed twice', async () => {
    const r = rig();
    r.engine.start(r.sink);
    expect(r.engine.owe(spec())).toBe(true);
    expect(r.engine.owe(spec())).toBe(false);
    await r.engine.idle();
    expect(r.sent.map((m) => m.to)).toEqual(['dev-lead', 'boss']);
    expect(r.engine.known('warn:section:dev:30')).toBe(true);
    expect(r.engine.pending()).toEqual([]);
  });

  it('a different allocation is a different crossing; a duplicate recipient is told once', async () => {
    const r = rig();
    r.engine.start(r.sink);
    r.engine.owe(spec({ recipients: ['boss', 'boss'] }));
    r.engine.owe(spec({ crossing: 'warn:section:dev:40' }));
    await r.engine.idle();
    expect(r.sent.map((m) => m.to)).toEqual(['boss', 'dev-lead', 'boss']);
  });
});

describe('durability', () => {
  it('a crash between the crossing and the delivery: the obligation is on disk, and a restart sends it once', async () => {
    const dir = tmp('p46n-');
    const first = rig(dir); // never started: the crash comes before any delivery
    first.engine.owe(spec());
    await first.engine.idle();
    expect(first.sent).toEqual([]);
    expect(readFileSync(join(dir, 'budget-notices.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2); // two owed lines
    const second = reopen(dir);
    expect(second.engine.known('warn:section:dev:30')).toBe(true);
    expect(second.engine.owe(spec())).toBe(false); // the evaluator would find the crossing again and must not re-owe it
    second.engine.start(second.sink);
    await second.engine.idle();
    expect(second.sent.map((m) => m.to)).toEqual(['dev-lead', 'boss']);
    // a second restart sends nothing
    const third = reopen(dir);
    third.engine.start(third.sink);
    await third.engine.idle();
    expect(third.sent).toEqual([]);
  });

  it('a resume never repeats a delivered notice', async () => {
    const dir = tmp('p46n-');
    const a = rig(dir);
    a.engine.start(a.sink);
    a.engine.owe(spec());
    await a.engine.idle();
    const b = reopen(dir);
    b.engine.start(b.sink);
    expect(b.engine.owe(spec())).toBe(false);
    await b.engine.idle();
    expect(b.sent).toEqual([]);
    expect(b.engine.records().map((x) => x.state)).toEqual(['delivered', 'delivered']);
  });

  it('a crash after one recipient was told: only the other is sent at the restart', async () => {
    const dir = tmp('p46n-');
    const a = rig(dir);
    a.engine.start(a.sink);
    a.failWith((to) => (to === 'boss' ? 'ERROR: boss is down' : undefined));
    a.engine.owe(spec());
    await a.engine.idle();
    expect(a.sent.map((m) => m.to)).toEqual(['dev-lead']);
    const b = reopen(dir);
    b.engine.start(b.sink);
    await b.engine.idle();
    expect(b.sent.map((m) => m.to)).toEqual(['boss']);
  });

  it('a torn final line is ignored and not appended after', async () => {
    const dir = tmp('p46n-');
    mkdirSync(dir, { recursive: true });
    const a = rig(dir);
    a.engine.owe(spec());
    appendFileSync(join(dir, 'budget-notices.jsonl'), '{"t":"owed","key":"torn');
    const b = reopen(dir);
    expect(b.engine.known('warn:section:dev:30')).toBe(true);
    b.engine.owe(spec({ crossing: 'closed:section:dev:30' }));
    b.engine.start(b.sink);
    await b.engine.idle();
    expect(b.sent).toHaveLength(4);
    const c = reopen(dir);
    expect(c.engine.records()).toHaveLength(4);
  });

  it('a journal that cannot be written still sends from memory, once, in this process', async () => {
    const dir = tmp('p46n-');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'budget-notices.jsonl'), '');
    chmodSync(join(dir, 'budget-notices.jsonl'), 0o444);
    const r = rig(dir);
    r.engine.start(r.sink);
    r.engine.owe(spec());
    await r.engine.idle();
    await r.engine.retry();
    expect(r.sent.map((m) => m.to)).toEqual(['dev-lead', 'boss']);
    expect(r.engine.owe(spec())).toBe(false);
  });
});

describe('retry and give-up', () => {
  it('a failed delivery is retried at the next opportunity and then delivered', async () => {
    const r = rig();
    r.engine.start(r.sink);
    let n = 0;
    r.failWith((to) => (to === 'boss' && n++ < 2 ? 'ERROR: unreachable' : undefined));
    r.engine.owe(spec());
    await r.engine.idle();
    expect(r.sent.map((m) => m.to)).toEqual(['dev-lead']);
    expect(r.events.map((e) => e.reason)).toEqual(['section-budget-notice-failed']);
    await r.engine.retry();
    await r.engine.retry();
    expect(r.sent.map((m) => m.to)).toEqual(['dev-lead', 'boss']);
    expect(r.engine.pending()).toEqual([]);
  });

  it('gives up after the bound, says so once, and never tries again', async () => {
    const r = rig(undefined, { maxFailures: 3 });
    r.engine.start(r.sink);
    r.failWith(() => 'REFUSED: no such role');
    r.engine.owe(spec({ recipients: ['boss'] }));
    for (let i = 0; i < 6; i++) await r.engine.retry();
    expect(r.events.map((e) => e.reason)).toEqual([
      'section-budget-notice-failed',
      'section-budget-notice-failed',
      'section-budget-notice-gave-up',
    ]);
    expect(r.engine.records()[0]).toMatchObject({ state: 'exhausted', failures: 3 });
    expect(r.engine.pending()).toEqual([]);
    // a restart does not resurrect it
    const again = reopen(r.dir, { maxFailures: 3 });
    again.failWith(() => 'REFUSED: no such role');
    again.engine.start(again.sink);
    await again.engine.idle();
    expect(again.events).toEqual([]);
  });
});
