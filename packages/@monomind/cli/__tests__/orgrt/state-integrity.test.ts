// packages/@monomind/cli/__tests__/orgrt/state-integrity.test.ts
//
// Regressions for four org-runtime state bugs that lost data or misreported state:
//   a. answerQuestion persisted "answered" BEFORE delivery was attempted, so a rejected
//      delivery destroyed the answer (the `already answered` guard then blocked retries).
//   b. `org mark-complete` — the exact remedy `org status` prints — never touched
//      runtime.json, so the stale "running" record it exists to clear survived.
//   c. drainInbox renamed an emptied snapshot back over inbox.jsonl, clobbering messages
//      queued during the drain window after their sender got a "queued" receipt.
//   d. `org stop` was a silent no-op (exit 0, "daemon exits within 2s") when nothing
//      polled the stopfile — notably against an `org serve` daemon.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queueMessage, drainInbox, inboxCount } from '../../src/orgrt/inbox.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { orgCommand, pollStopfiles } from '../../src/commands/org.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

function orgFixture(root: string, name: string): void {
  mkdirSync(join(root, ORG_DIR), { recursive: true });
  writeFileSync(join(root, ORG_DIR, `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
    ],
  }));
}

const readQuestions = (root: string, org: string) =>
  JSON.parse(readFileSync(join(root, ORG_DIR, org, 'questions.json'), 'utf8')).questions as
    Array<{ questionId: string; answer: string | null; answeredAt: number | null }>;

const qidOf = (receipt: string): string => /id (q-[^)]+)\)/.exec(receipt)![1];

// ---------------------------------------------------------------- (a)
describe('answerQuestion — persist AFTER delivery', () => {
  it('leaves the question pending and retryable when live delivery is rejected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ans-live-'));
    orgFixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    try {
      await d.startOrg('alpha');
      const qid = qidOf(await d.askHuman('alpha', 'coder', 'red or blue?'));

      // Delivery to a role that doesn't exist must be rejected AND must not record
      // the answer. Pre-fix: ok:false, yet questions.json said answer:"blue".
      const bad = await d.answerQuestion('alpha', 'ghost', qid, 'blue');
      expect(bad).toEqual({ ok: false, error: 'role "ghost" not found in org "alpha"' });
      const afterFail = readQuestions(root, 'alpha')[0];
      expect(afterFail.answer).toBeNull();
      expect(afterFail.answeredAt).toBeNull();

      // ...so the human can retry against the right role and it actually lands.
      const good = await d.answerQuestion('alpha', 'coder', qid, 'blue');
      expect(good).toEqual({ ok: true });
      const afterOk = readQuestions(root, 'alpha')[0];
      expect(afterOk.answer).toBe('blue');
      expect(afterOk.answeredAt).toBeTypeOf('number');
    } finally {
      await d.stopAll();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('does not record the answer when the target mailbox is already closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ans-closed-'));
    orgFixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    try {
      const running = await d.startOrg('alpha');
      const qid = qidOf(await d.askHuman('alpha', 'coder', 'ship?'));
      running.agents.get('coder')!.mailbox.close();

      const res = await d.answerQuestion('alpha', 'coder', qid, 'yes');
      expect(res.ok).toBe(false);
      expect(readQuestions(root, 'alpha')[0].answer).toBeNull();
    } finally {
      await d.stopAll();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('does not record the answer when the offline queue write fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ans-offline-'));
    orgFixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    try {
      await d.startOrg('alpha');
      const qid = qidOf(await d.askHuman('alpha', 'coder', 'go?'));
      await d.stopAll(); // org offline -> queueMessage path

      // Make the append genuinely fail — no mocks: a directory where inbox.jsonl
      // belongs makes appendFileSync throw EISDIR.
      const inboxFile = join(root, ORG_DIR, 'alpha', 'inbox.jsonl');
      rmSync(inboxFile, { force: true });
      mkdirSync(inboxFile, { recursive: true });

      const res = await d.answerQuestion('alpha', 'coder', qid, 'go');
      rmSync(inboxFile, { recursive: true, force: true });

      expect(res.ok).toBe(false);
      expect(readQuestions(root, 'alpha')[0].answer).toBeNull(); // still answerable
      expect(inboxCount(root, 'alpha')).toBe(0);

      const retry = await d.answerQuestion('alpha', 'coder', qid, 'go');
      expect(retry).toEqual({ ok: true });
      expect(readQuestions(root, 'alpha')[0].answer).toBe('go');
      expect(inboxCount(root, 'alpha')).toBeGreaterThan(0);
    } finally {
      await d.stopAll();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});

// ---------------------------------------------------------------- (c)
describe('drainInbox — no message loss', () => {
  it('recovers a .draining file left by a crashed drain instead of overwriting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'drain-crash-'));
    try {
      queueMessage(root, 'org1', { fromQualified: 'a:b', toRole: 'z', subject: 'crashed', body: '', ts: 1 });
      const path = join(root, ORG_DIR, 'org1', 'inbox.jsonl');
      renameSync(path, `${path}.draining`); // process died right here
      queueMessage(root, 'org1', { fromQualified: 'a:b', toRole: 'z', subject: 'after', body: '', ts: 2 });

      const msgs = drainInbox(root, 'org1');
      expect(msgs.map(m => m.subject).sort()).toEqual(['after', 'crashed']);
      expect(existsSync(`${path}.draining`)).toBe(false);
      expect(drainInbox(root, 'org1')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- (b)
describe('org mark-complete — clears the stale runtime.json org status reads', () => {
  const markComplete = orgCommand.subcommands!.find(c => c.name === 'mark-complete')!;
  const status = orgCommand.subcommands!.find(c => c.name === 'status')!;

  const staleFixture = (pid: number): string => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-mc-'));
    mkdirSync(join(cwd, ORG_DIR, 'stale'), { recursive: true });
    writeFileSync(join(cwd, ORG_DIR, 'stale.json'), JSON.stringify({ name: 'stale', roles: [{ id: 'boss' }] }));
    writeFileSync(join(cwd, ORG_DIR, 'stale', 'runtime.json'),
      JSON.stringify({ status: 'running', run: 'run-123', pid }));
    return cwd;
  };
  const capture = async (fn: () => Promise<unknown>): Promise<{ res: any; out: string }> => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')); });
    try { return { res: await fn(), out: lines.join('\n') }; } finally { spy.mockRestore(); }
  };

  it('rewrites runtime.json so a subsequent org status no longer reports "crashed"', async () => {
    const cwd = staleFixture(999999999);
    try {
      const before = await capture(() => status.action!({ args: ['stale'], flags: {}, cwd, interactive: false } as any));
      expect(before.out).toMatch(/crashed/);
      expect(before.out).toMatch(/mark-complete stale/); // status recommends exactly this

      // Follow status's own advice. No dashboard is running in the test env — the
      // command must still clear local state and succeed.
      const mc = await capture(() => markComplete.action!({ args: ['stale'], flags: {}, cwd, interactive: false } as any));
      expect(mc.res?.success).toBe(true);

      const rt = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'stale', 'runtime.json'), 'utf8'));
      expect(rt.status).toBe('stopped');
      expect(rt.run).toBe('run-123');

      const after = await capture(() => status.action!({ args: ['stale'], flags: {}, cwd, interactive: false } as any));
      expect(after.out).not.toMatch(/crashed/);
      expect(after.out).toMatch(/stopped/);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }, 20000);

  it('refuses to clear a run whose daemon pid is alive', async () => {
    const cwd = staleFixture(process.pid);
    try {
      const { res, out } = await capture(() => markComplete.action!({ args: ['stale'], flags: {}, cwd, interactive: false } as any));
      expect(res?.success).toBe(false);
      expect(out).toMatch(/org stop stale/);
      expect(JSON.parse(readFileSync(join(cwd, ORG_DIR, 'stale', 'runtime.json'), 'utf8')).status).toBe('running');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  }, 20000);
});

// ---------------------------------------------------------------- (d)
describe('org stop — honest about whether anything will act on it', () => {
  const stop = orgCommand.subcommands!.find(c => c.name === 'stop')!;
  const run = (cwd: string) => stop.action!({ args: ['served'], flags: {}, cwd, interactive: false } as any);
  const quiet = async (fn: () => Promise<any>) => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => { /* silence */ });
    try { return await fn(); } finally { spy.mockRestore(); }
  };
  const fixture = (rt?: object): string => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-stop2-'));
    mkdirSync(join(cwd, ORG_DIR, 'served'), { recursive: true });
    writeFileSync(join(cwd, ORG_DIR, 'served.json'), JSON.stringify({ name: 'served', roles: [{ id: 'boss' }] }));
    if (rt) writeFileSync(join(cwd, ORG_DIR, 'served', 'runtime.json'), JSON.stringify(rt));
    return cwd;
  };

  it('reports failure (and writes no stopfile) when the org is not running', async () => {
    const cwd = fixture();
    try {
      const res = await quiet(() => run(cwd));
      expect(res?.success).toBe(false);
      expect(res?.message).toMatch(/not running/);
      expect(existsSync(join(cwd, ORG_DIR, 'served', 'stop'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('reports a crashed daemon and points at mark-complete instead of pretending to stop it', async () => {
    const cwd = fixture({ status: 'running', run: 'r1', pid: 999999999 });
    try {
      const res = await quiet(() => run(cwd));
      expect(res?.success).toBe(false);
      expect(res?.message).toMatch(/mark-complete/);
      expect(existsSync(join(cwd, ORG_DIR, 'served', 'stop'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('writes the stopfile when a live daemon is recorded as running', async () => {
    const cwd = fixture({ status: 'running', run: 'r1', pid: process.pid });
    try {
      const res = await quiet(() => run(cwd));
      expect(res?.success).toBe(true);
      expect(existsSync(join(cwd, ORG_DIR, 'served', 'stop'))).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('org serve honours that stopfile — the org is actually stopped and the file cleared', async () => {
    // Pre-fix serveAction never looked at the stopfile at all, so a serve daemon kept
    // the org running forever after a successful-looking `org stop`.
    const root = mkdtempSync(join(tmpdir(), 'serve-stop-'));
    orgFixture(root, 'served');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    try {
      await d.startOrg('served');
      expect(d.listRunning()).toEqual(['served']);

      // nothing to do before `org stop` runs
      expect(await quiet(() => pollStopfiles(root, d))).toEqual([]);
      expect(d.listRunning()).toEqual(['served']);

      const res = await quiet(() => stop.action!({ args: ['served'], flags: {}, cwd: root, interactive: false } as any));
      expect(res?.success).toBe(true);

      expect(await quiet(() => pollStopfiles(root, d))).toEqual(['served']);
      expect(d.listRunning()).toEqual([]);
      expect(existsSync(join(root, ORG_DIR, 'served', 'stop'))).toBe(false); // cleared for the next scheduled run
    } finally {
      await d.stopAll();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
